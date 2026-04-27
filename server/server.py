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
import json
import logging
import os
import socket
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pystray
from PIL import Image

import websockets
from websockets.server import serve, WebSocketServerProtocol

# ── local imports & path setup ──────────────────────────────────
# Handle PyInstaller _MEIPASS extraction directory for standalone .exe
if getattr(sys, 'frozen', False):
    # Running as packaged executable
    _BASE_DIR = Path(sys._MEIPASS)
    _SERVER_DIR = _BASE_DIR / "server"
    sys.path.insert(0, str(_SERVER_DIR))
    CLIENT_DIR = _BASE_DIR / "client"
    
    # Redirect stdout and stderr to devnull to prevent console write errors
    # when running with --noconsole
    if sys.stdout is None:
        sys.stdout = open(os.devnull, 'w')
    if sys.stderr is None:
        sys.stderr = open(os.devnull, 'w')
else:
    # Running in normal development environment
    _SERVER_DIR = Path(__file__).parent
    sys.path.insert(0, str(_SERVER_DIR))
    CLIENT_DIR = _SERVER_DIR.parent / "client"

from utils.auth import generate_token, validate_token
from utils.network import get_local_ips, get_os_name
from utils.qr import print_startup_banner, show_qr_image
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
    await ws.send(json.dumps({"type": "auth_ok"}))

    # Send server_info
    await ws.send(json.dumps({
        "type": "server_info",
        "os": get_os_name(),
        "hostname": socket.gethostname(),
    }))

    # Send widget_list (loaded from widgets.yaml)
    await ws.send(json.dumps({"type": "widget_list", "widgets": get_widget_list_payload()}))

    # ── Phase 3: Start Terminal ────────────────────────────────
    from handlers.terminal import TerminalSession
    term = TerminalSession(ws)
    active_terminals[ws] = term
    term.start()

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
        if ws in active_terminals:
            active_terminals[ws].write(msg.get("data", ""))

    elif t == "terminal_resize":
        if ws in active_terminals:
            active_terminals[ws].resize(msg.get("cols", 80), msg.get("rows", 24))

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
    Threaded HTTP server that serves the client/ directory.
    Uses ThreadingHTTPServer so mobile browsers can make multiple parallel
    requests (HTML + CSS + JS) without queuing behind each other.
    """
    import http.server
    import threading

    client_dir = str(CLIENT_DIR)

    # Subclass to silence noisy request logs and fix directory binding.
    class _QuietHandler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=client_dir, **kwargs)

        def log_message(self, format, *args):  # noqa: A002
            pass  # suppress all access logs

        def log_error(self, format, *args):  # noqa: A002
            pass  # suppress all error logs

    # ThreadingHTTPServer — handles each request in its own thread so parallel
    # asset fetches (html/css/js) don't block one another.
    server = http.server.ThreadingHTTPServer(("0.0.0.0", HTTP_PORT), _QuietHandler)

    logger.info(f"HTTP server → http://0.0.0.0:{HTTP_PORT}  (serving {CLIENT_DIR})")

    # Run in a daemon thread — lives as long as the process
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


def run_tray_icon(ips: list[str], http_port: int, ws_port: int, token: str):
    icon_path = _BASE_DIR / "app.ico" if getattr(sys, 'frozen', False) else _SERVER_DIR.parent / "app.ico"
    
    try:
        image = Image.open(str(icon_path))
    except Exception as e:
        logger.error(f"Failed to load icon from {icon_path}: {e}")
        # fallback to a blank image
        image = Image.new('RGB', (64, 64), color='white')

    url = f"http://{ips[0]}:{http_port}" if ips else f"http://127.0.0.1:{http_port}"
    
    def on_show_qr(icon, item):
        logger.info("Show QR Code clicked.")
        show_qr_image(url, token)
        
    def on_exit(icon, item):
        logger.info("Tray Exit clicked.")
        icon.stop()
        os._exit(0)

    menu = pystray.Menu(
        pystray.MenuItem(f'Token: {token}', lambda: None, enabled=False),
        pystray.MenuItem('Show QR Code', on_show_qr),
        pystray.MenuItem('Exit PocketDeck', on_exit)
    )
    
    icon = pystray.Icon("PocketDeck", image, "PocketDeck Server", menu)
    
    def setup(icon):
        icon.visible = True
        try:
            icon.notify(f"Server running at {url}\nToken: {token}", "PocketDeck")
        except:
            pass
            
    if getattr(sys, 'frozen', False):
        try:
            show_qr_image(url, token)
        except Exception as e:
            logger.error(f"Failed to auto-show QR: {e}")
            
    icon.run(setup)

def run_asyncio_loop():
    # We must create a new event loop for this thread
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        loop.run_until_complete(main())
    except Exception as e:
        logger.error(f"Event loop failed: {e}")

if __name__ == "__main__":
    TOKEN = "123456"

    # Start the asyncio server loop in a background daemon thread
    server_thread = threading.Thread(target=run_asyncio_loop, daemon=True)
    server_thread.start()

    # Give servers a moment to bind before advertising the QR code.
    # Without this the QR may appear before the HTTP port is open.
    import time
    time.sleep(1.0)

    ips = get_local_ips()
    if not ips:
        ips = ["127.0.0.1"]

    # Start the blocking system tray loop on the main thread
    run_tray_icon(ips, HTTP_PORT, WS_PORT, TOKEN)
