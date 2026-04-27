import asyncio
import platform
import logging
import json
import os
from typing import Optional

logger = logging.getLogger("pocketdeck.terminal")

IS_WINDOWS = platform.system() == "Windows"

if IS_WINDOWS:
    try:
        from winpty import PtyProcess
    except ImportError:
        logger.error("pywinpty not installed. Terminal will not work.")
        PtyProcess = None
else:
    try:
        import ptyprocess
    except ImportError:
        logger.error("ptyprocess not installed. Terminal will not work.")
        ptyprocess = None


class TerminalSession:
    def __init__(self, ws, cols=80, rows=24):
        self.ws = ws
        self.cols = cols
        self.rows = rows
        self.pty = None
        self._read_task: Optional[asyncio.Task] = None
        self._loop = asyncio.get_running_loop()

    def start(self):
        if IS_WINDOWS:
            if not PtyProcess:
                logger.error("Terminal: winpty not available.")
                return
            
            # Spawn powershell on Windows
            try:
                self.pty = PtyProcess.spawn("powershell.exe", dimensions=(self.rows, self.cols))
                self._read_task = asyncio.create_task(self._read_loop_windows())
                logger.info("Terminal session started (powershell).")
            except Exception as e:
                logger.error(f"Failed to spawn PTY: {e}")
        else:
            if not ptyprocess:
                logger.error("Terminal: ptyprocess not available.")
                return
                
            shell = os.environ.get("SHELL", "/bin/bash")
            try:
                self.pty = ptyprocess.PtyProcessUnicode.spawn([shell], dimensions=(self.rows, self.cols))
                self._read_task = asyncio.create_task(self._read_loop_posix())
                logger.info(f"Terminal session started ({shell}).")
            except Exception as e:
                logger.error(f"Failed to spawn PTY: {e}")

    async def stop(self):
        if self._read_task:
            self._read_task.cancel()
            try:
                await self._read_task
            except asyncio.CancelledError:
                pass

        if self.pty:
            if IS_WINDOWS:
                # pywinpty PtyProcess has close() or terminate()
                try:
                    self.pty.terminate()
                except:
                    pass
            else:
                try:
                    self.pty.terminate(force=True)
                except:
                    pass
            self.pty = None
        logger.info("Terminal session stopped.")

    async def _read_loop_windows(self):
        # pywinpty read() is blocking
        try:
            while True:
                # run in executor to avoid blocking the asyncio event loop
                data = await self._loop.run_in_executor(None, self.pty.read, 4096)
                if not data:
                    break
                # Ensure it's a string, winpty usually returns str
                if isinstance(data, bytes):
                    data = data.decode("utf-8", errors="replace")
                
                try:
                    await self.ws.send(json.dumps({"type": "terminal_out", "data": data}))
                except Exception as ws_err:
                    logger.debug(f"Terminal websocket send error: {ws_err}")
                    break
        except Exception as e:
            logger.error(f"Terminal read loop error: {e}")
        finally:
            logger.info("Terminal read loop exited.")

    async def _read_loop_posix(self):
        import fcntl
        fd = self.pty.fd
        fl = fcntl.fcntl(fd, fcntl.F_GETFL)
        fcntl.fcntl(fd, fcntl.F_SETFL, fl | os.O_NONBLOCK)

        try:
            while True:
                try:
                    # Non-blocking read
                    data = self.pty.read(4096)
                    if data:
                        await self.ws.send(json.dumps({"type": "terminal_out", "data": data}))
                    else:
                        break
                except EOFError:
                    break
                except BlockingIOError:
                    await asyncio.sleep(0.01)
                except Exception as ws_err:
                    logger.debug(f"Terminal websocket send error: {ws_err}")
                    break
        except Exception as e:
            logger.error(f"Terminal read loop error: {e}")
        finally:
            logger.info("Terminal read loop exited.")

    def write(self, data: str):
        if self.pty:
            try:
                self.pty.write(data)
            except Exception as e:
                logger.error(f"Terminal write error: {e}")

    def resize(self, cols: int, rows: int):
        self.cols = cols
        self.rows = rows
        if self.pty:
            try:
                self.pty.setwinsize(rows, cols)
            except Exception as e:
                logger.error(f"Terminal resize error: {e}")
