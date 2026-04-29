"""
server.py — PocketDeck main entry point
Pure asyncio WebSocket server + HTTP static server.
Phase 1: QR → scan → mouse working loop.

Architecture:
- Port 8765: WebSocket server (control messages)
- Port 8766: HTTP server (serves client/ directory — the PWA)
- Auth: token validated before any input events processed
- Mouse: pynput controller, sub-20ms target
"""

import asyncio
import base64
import json
import logging
import os
import socket
import sys
import threading
import webbrowser
from io import BytesIO
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import websockets
from websockets.server import serve, WebSocketServerProtocol


def _ensure_stdio_for_windowless_mode() -> None:
    """Provide valid stdio streams when running without a console window."""
    if sys.stdout is None:
        sys.stdout = open(os.devnull, "w", encoding="utf-8")
    if sys.stderr is None:
        sys.stderr = open(os.devnull, "w", encoding="utf-8")


_ensure_stdio_for_windowless_mode()


def _detach_console_after_connect() -> None:
    """Detach from the Windows console so the taskbar console entry disappears."""
    if os.name != "nt" or not getattr(sys, "frozen", False):
        return

    try:
        import ctypes

        # Move stdio away from the console before detaching to avoid write errors.
        devnull = open(os.devnull, "w", encoding="utf-8")
        sys.stdout = devnull
        sys.stderr = devnull

        root_logger = logging.getLogger()
        for handler in root_logger.handlers:
            if hasattr(handler, "setStream"):
                try:
                    handler.setStream(devnull)
                except Exception:
                    pass

        console_window = ctypes.windll.kernel32.GetConsoleWindow()
        if console_window:
            ctypes.windll.user32.ShowWindow(console_window, 0)

        ctypes.windll.kernel32.FreeConsole()
    except Exception:
        logging.getLogger("pocketdeck").debug("Unable to detach console window", exc_info=True)

# ── local imports & path setup ──────────────────────────────────
# Handle PyInstaller _MEIPASS extraction directory for standalone .exe
if getattr(sys, 'frozen', False):
    # Running as packaged executable
    _BASE_DIR = Path(sys._MEIPASS)
    _SERVER_DIR = _BASE_DIR / "server"
    sys.path.insert(0, str(_SERVER_DIR))
    CLIENT_DIR = _BASE_DIR / "client"
else:
    # Running in normal development environment
    _SERVER_DIR = Path(__file__).parent
    sys.path.insert(0, str(_SERVER_DIR))
    CLIENT_DIR = _SERVER_DIR.parent / "client"

from utils.auth import generate_token, validate_token
from utils.network import get_local_ips, get_os_name
from utils.qr import print_startup_banner
from handlers.mouse import (
    handle_mouse_move, handle_mouse_click, handle_mouse_scroll, handle_mouse_button
)
from handlers.keyboard import handle_key_tap, handle_key_down, handle_key_up, handle_text_type
from handlers.widgets import load_widgets, get_widget_list_payload, run_widget
from handlers.media import handle_media

# ── configuration ─────────────────────────────────────────────
WS_PORT   = 8765
HTTP_PORT = 8766
AUTH_TIMEOUT = 3.0   # seconds to authenticate before drop

# ── logging ───────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("pocketdeck")

# ── global state ──────────────────────────────────────────────
TOKEN: str = ""
active_terminals = {}
_startup_ready = threading.Event()
_startup_info = {"ips": ["127.0.0.1"], "token": ""}


def _ensure_terminal_session(ws: WebSocketServerProtocol):
    """Create a terminal session only when the client actually uses terminal panel."""
    term = active_terminals.get(ws)
    if term is not None:
        return term

    from handlers.terminal import TerminalSession

    term = TerminalSession(ws)
    active_terminals[ws] = term
    term.start()
    return term

# Thread pool for blocking syscalls (SendInput, pynput) so they don't stall the event loop.
#
# IMPORTANT — two separate executors:
#   _move_executor  (1 worker)  — mouse_move only.  Single-threaded so that
#       SendInput calls are always serialized; a 4-worker pool lets concurrent
#       calls race and arrive OUT OF ORDER at the OS → cursor jitter.
#   _input_executor (2 workers) — everything else (clicks, keyboard, scroll).
#       2 workers = click and keyboard can run concurrently without blocking each
#       other, but never pile up behind a backlog of in-flight mouse moves.
_move_executor  = ThreadPoolExecutor(max_workers=1, thread_name_prefix="move")
_input_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="input")


# ══════════════════════════════════════════════════════════════
# WebSocket handler
# ══════════════════════════════════════════════════════════════

async def handle_connection(ws: WebSocketServerProtocol) -> None:
    """
    Lifecycle for one mobile client:
    1. Wait for auth message (3-second timeout)
    2. Validate token
    3. Send server_info + widget_list
    4. Process control messages until disconnect
    """
    client_addr = ws.remote_address
    logger.info(f"Client connected: {client_addr}")

    # ── Phase 1: Authentication ────────────────────────────────
    try:
        raw = await asyncio.wait_for(ws.recv(), timeout=AUTH_TIMEOUT)
    except asyncio.TimeoutError:
        logger.warning(f"Auth timeout from {client_addr} — closing")
        await ws.close(4001, "auth timeout")
        return
    except websockets.exceptions.ConnectionClosed:
        logger.info(f"Client {client_addr} disconnected before auth")
        return

    try:
        msg = json.loads(raw)
    except json.JSONDecodeError:
        logger.warning(f"Invalid JSON from {client_addr}: {raw!r}")
        await ws.close(4000, "invalid json")
        return

    if msg.get("type") != "auth":
        logger.warning(f"Expected auth, got {msg.get('type')!r} from {client_addr}")
        await ws.close(4001, "auth required")
        return

    provided_token = msg.get("token", "")
    if not validate_token(provided_token, TOKEN):
        logger.warning(f"Bad token from {client_addr}")
        await ws.send(json.dumps({"type": "auth_fail"}))
        await ws.close(4003, "bad token")
        return

    logger.info(f"Authenticated: {client_addr}")
    _detach_console_after_connect()
    await ws.send(json.dumps({"type": "auth_ok"}))

    # Send server_info
    await ws.send(json.dumps({
        "type": "server_info",
        "os": get_os_name(),
        "hostname": socket.gethostname(),
    }))

    # Send widget_list (loaded from widgets.yaml)
    await ws.send(json.dumps({"type": "widget_list", "widgets": get_widget_list_payload()}))

    # ── Phase 2: Control loop ──────────────────────────────────
    try:
        async for raw_msg in ws:
            await _dispatch(ws, raw_msg)
    except websockets.exceptions.ConnectionClosed as e:
        logger.info(f"Client {client_addr} disconnected: {e.code} {e.reason}")
    except Exception as e:
        logger.exception(f"Unhandled error from {client_addr}: {e}")
    finally:
        logger.info(f"Connection closed: {client_addr}")
        if ws in active_terminals:
            await active_terminals[ws].stop()
            del active_terminals[ws]


async def _dispatch(ws: WebSocketServerProtocol, raw: str) -> None:
    """Route a single JSON message to the correct handler."""
    try:
        msg = json.loads(raw)
    except json.JSONDecodeError:
        logger.debug(f"Bad JSON: {raw!r}")
        return

    t = msg.get("type", "")

    # ── Mouse ──────────────────────────────────────────────────
    # Run ALL mouse/keyboard calls in the thread-pool so blocking Win32
    # syscalls (SendInput) never stall the asyncio event loop.
    loop = asyncio.get_event_loop()
    if t == "mouse_move":
        # mouse_move MUST use the single-worker executor to stay ordered.
        # Concurrent SendInput(MOUSEEVENTF_MOVE) calls from multiple threads
        # race inside Windows and can deliver deltas out of sequence → jitter.
        loop.run_in_executor(_move_executor, handle_mouse_move,
                             msg.get("dx", 0), msg.get("dy", 0))

    elif t == "mouse_click":
        loop.run_in_executor(_input_executor, handle_mouse_click,
                             msg.get("button", "left"), msg.get("double", False))

    elif t == "mouse_scroll":
        loop.run_in_executor(_input_executor, handle_mouse_scroll,
                             msg.get("dx", 0), msg.get("dy", 0))

    elif t == "mouse_button":
        # Independent press/release — used for drag-lock (screenshot selection etc.)
        loop.run_in_executor(_input_executor, handle_mouse_button,
                             msg.get("button", "left"), msg.get("pressed", True))

    # ── Keyboard ───────────────────────────────────────────────
    elif t == "key_tap":
        loop.run_in_executor(_input_executor, handle_key_tap, msg.get("key", ""))

    elif t == "key_down":
        loop.run_in_executor(_input_executor, handle_key_down, msg.get("key", ""))

    elif t == "key_up":
        loop.run_in_executor(_input_executor, handle_key_up, msg.get("key", ""))

    elif t == "text_type":
        loop.run_in_executor(_input_executor, handle_text_type, msg.get("text", ""))

    # ── Terminal (Phase 3) ─────────────────────────────────────
    elif t == "terminal_in":
        _ensure_terminal_session(ws).write(msg.get("data", ""))

    elif t == "terminal_resize":
        _ensure_terminal_session(ws).resize(msg.get("cols", 80), msg.get("rows", 24))

    # ── Widgets (Phase 5) ──────────────────────────────────────
    elif t == "widget_run":
        asyncio.create_task(run_widget(msg.get("id", ""), active_terminals, ws))

    # ── Media (Phase 6) ───────────────────────────────────────
    elif t == "media":
        handle_media(msg.get("action", ""))

    else:
        logger.debug(f"Unknown message type: {t!r}")


# ══════════════════════════════════════════════════════════════
# HTTP server — serves client/ over plain HTTP
# ══════════════════════════════════════════════════════════════

async def _serve_http() -> None:
    """
    Minimal asyncio-compatible HTTP server that serves the client/ directory.
    Uses Python's built-in http.server.SimpleHTTPRequestHandler in a thread pool
    so it doesn't block the event loop.
    """
    import http.server
    import threading
    import functools

    class _PocketDeckHandler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(CLIENT_DIR), **kwargs)

        def log_message(self, *args):
            pass

        def do_GET(self):
            if self.path == "/app.ico":
                icon_path = Path(sys._MEIPASS) / "app.ico" if getattr(sys, "frozen", False) else Path(__file__).resolve().parent.parent / "app.ico"
                if icon_path.exists():
                    try:
                        data = icon_path.read_bytes()
                        self.send_response(200)
                        self.send_header("Content-Type", "image/x-icon")
                        self.send_header("Content-Length", str(len(data)))
                        self.end_headers()
                        self.wfile.write(data)
                        return
                    except Exception:
                        pass
            elif self.path.startswith("/assets/"):
                # Handle requests for static assets (like logo.png)
                file_name = self.path[len("/assets/"):]
                asset_path = Path(sys._MEIPASS) / "assets" / file_name if getattr(sys, "frozen", False) else Path(__file__).resolve().parent.parent / "assets" / file_name
                if asset_path.exists():
                    try:
                        data = asset_path.read_bytes()
                        self.send_response(200)
                        # Basic content type mapping for logo.png
                        content_type = "image/png" if file_name.endswith(".png") else "application/octet-stream"
                        self.send_header("Content-Type", content_type)
                        self.send_header("Content-Length", str(len(data)))
                        self.end_headers()
                        self.wfile.write(data)
                        return
                    except Exception:
                        pass

            return super().do_GET()

    server = http.server.HTTPServer(("0.0.0.0", HTTP_PORT), _PocketDeckHandler)

    logger.info(f"HTTP server → http://0.0.0.0:{HTTP_PORT}  (serving {CLIENT_DIR})")

    # Run in a daemon thread — it lives as long as the process
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()


# ══════════════════════════════════════════════════════════════
# Entry point
# ══════════════════════════════════════════════════════════════

async def main() -> None:
    global TOKEN
    TOKEN = "123456"

    # Load widgets.yaml once on startup
    load_widgets()

    ips = get_local_ips()
    if not ips:
        logger.warning("No non-loopback IPs found — using 127.0.0.1")
        ips = ["127.0.0.1"]

    _startup_info["ips"] = ips
    _startup_info["token"] = TOKEN
    _startup_ready.set()

    # Start HTTP server in background thread
    await _serve_http()

    # Print QR codes / banner
    print_startup_banner(ips, HTTP_PORT, WS_PORT, TOKEN)

    logger.info(f"WebSocket server → ws://0.0.0.0:{WS_PORT}")

    async with serve(
        handle_connection,
        "0.0.0.0",
        WS_PORT,
        ping_interval=20,
        ping_timeout=10,
        # Disable Nagle's algorithm: send each frame immediately, no buffering
        compression=None,
    ):
        logger.info("PocketDeck ready — waiting for connections…")
        await asyncio.Future()   # run forever


def _make_tray_icon_image():
    """Load app.ico for the tray icon, falling back to a generated image if needed."""
    from PIL import Image, ImageDraw

    icon_path = Path(sys._MEIPASS) / "app.ico" if getattr(sys, "frozen", False) else Path(__file__).resolve().parent.parent / "app.ico"
    try:
        if icon_path.exists():
            return Image.open(icon_path)
    except Exception:
        pass

    img = Image.new("RGBA", (64, 64), (22, 26, 33, 255))
    draw = ImageDraw.Draw(img)
    draw.rounded_rectangle((8, 8, 56, 56), radius=12, fill=(41, 128, 255, 255))
    draw.rectangle((20, 18, 44, 26), fill=(255, 255, 255, 255))
    draw.rectangle((20, 30, 44, 46), fill=(255, 255, 255, 255))
    return img


def _run_windows_tray() -> None:
    """Keep PocketDeck in system tray for frozen Windows releases."""
    try:
        import pystray
    except Exception as e:
        logger.error(f"pystray unavailable: {e}")
        threading.Event().wait()
        return

    _startup_ready.wait(timeout=5)

    def _current_url() -> str:
        ip = _startup_info["ips"][0] if _startup_info["ips"] else "127.0.0.1"
        return f"http://{ip}:{HTTP_PORT}"

    def on_show_qr(_icon, _item):
        try:
            import qrcode

            url = _current_url()
            token = _startup_info.get("token", "")

            qr = qrcode.QRCode(version=1, box_size=8, border=2)
            qr.add_data(url)
            qr.make(fit=True)
            img = qr.make_image(fill_color="black", back_color="white")

            buf = BytesIO()
            img.save(buf, format="PNG")
            b64 = base64.b64encode(buf.getvalue()).decode("ascii")

            html = f"""<!doctype html>
<html>
<head>
    <meta charset=\"utf-8\" />
    <title>PocketDeck QR</title>
    <style>
        body {{ background: #07090d; color: #f2f4f8; font-family: Segoe UI, sans-serif; margin: 0; padding: 24px; }}
        .wrap {{ max-width: 560px; margin: 0 auto; text-align: center; }}
        img {{ width: min(82vw, 420px); background: #fff; padding: 14px; border-radius: 12px; }}
        .meta {{ margin-top: 14px; font-size: 18px; line-height: 1.5; }}
        .token {{ font-weight: 700; letter-spacing: 0.5px; }}
    </style>
</head>
<body>
    <div class=\"wrap\">
        <img src=\"data:image/png;base64,{b64}\" alt=\"PocketDeck QR\" />
        <div class=\"meta\">URL: {url}</div>
        <div class=\"meta\">Token: <span class=\"token\">{token}</span></div>
    </div>
</body>
</html>"""

            qr_page = Path(os.getenv("TEMP", ".")) / "PocketDeck_QR.html"
            qr_page.write_text(html, encoding="utf-8")
            webbrowser.open(qr_page.resolve().as_uri())
        except Exception as e:
            logger.error(f"Failed to show QR page: {e}")

    def on_info(icon, _item):
        url = _current_url()
        token = _startup_info.get("token", "")
        try:
            icon.notify(f"URL: {url}\nToken: {token}", "PocketDeck")
        except Exception:
            pass

    def on_exit(icon, _item):
        icon.stop()
        os._exit(0)

    menu = pystray.Menu(
        pystray.MenuItem("Show QR Code", on_show_qr),
        pystray.MenuItem("Show Connection Info", on_info),
        pystray.MenuItem("Exit PocketDeck", on_exit),
    )

    icon = pystray.Icon("PocketDeck", _make_tray_icon_image(), "PocketDeck", menu)
    icon.run()


if __name__ == "__main__":
    if os.name == "nt" and getattr(sys, "frozen", False):
        server_thread = threading.Thread(target=lambda: asyncio.run(main()), daemon=True)
        server_thread.start()
        _run_windows_tray()
    else:
        try:
            asyncio.run(main())
        except KeyboardInterrupt:
            logger.info("Shutting down — goodbye!")
