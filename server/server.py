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
from pathlib import Path

import websockets
from websockets.server import serve, WebSocketServerProtocol

# ── local imports ─────────────────────────────────────────────
# Adjust path so we can run as: python server/server.py
_SERVER_DIR = Path(__file__).parent
sys.path.insert(0, str(_SERVER_DIR))

from utils.auth import generate_token, validate_token
from utils.network import get_local_ips, get_os_name
from utils.qr import print_startup_banner
from handlers.mouse import handle_mouse_move, handle_mouse_click, handle_mouse_scroll
from handlers.keyboard import handle_key_tap, handle_key_down, handle_key_up, handle_text_type

# ── configuration ─────────────────────────────────────────────
WS_PORT   = 8765
HTTP_PORT = 8766
AUTH_TIMEOUT = 3.0   # seconds to authenticate before drop

CLIENT_DIR = _SERVER_DIR.parent / "client"

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

    # Send empty widget_list (Phase 5 will populate)
    await ws.send(json.dumps({"type": "widget_list", "widgets": []}))

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
    if t == "mouse_move":
        handle_mouse_move(msg.get("dx", 0), msg.get("dy", 0))

    elif t == "mouse_click":
        handle_mouse_click(msg.get("button", "left"), msg.get("double", False))

    elif t == "mouse_scroll":
        handle_mouse_scroll(msg.get("dx", 0), msg.get("dy", 0))

    # ── Keyboard ───────────────────────────────────────────────
    elif t == "key_tap":
        handle_key_tap(msg.get("key", ""))

    elif t == "key_down":
        handle_key_down(msg.get("key", ""))

    elif t == "key_up":
        handle_key_up(msg.get("key", ""))

    elif t == "text_type":
        handle_text_type(msg.get("text", ""))

    # ── Terminal (Phase 3) ─────────────────────────────────────
    elif t == "terminal_in":
        if ws in active_terminals:
            active_terminals[ws].write(msg.get("data", ""))

    elif t == "terminal_resize":
        if ws in active_terminals:
            active_terminals[ws].resize(msg.get("cols", 80), msg.get("rows", 24))

    # ── Widgets (Phase 5) ──────────────────────────────────────
    elif t == "widget_run":
        logger.debug(f"Widget run (Phase 5 not yet implemented): {msg.get('id')}")

    # ── Media (Phase 6) ───────────────────────────────────────
    elif t == "media":
        logger.debug(f"Media action (Phase 6 not yet implemented): {msg.get('action')}")

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

    handler = functools.partial(
        http.server.SimpleHTTPRequestHandler,
        directory=str(CLIENT_DIR),
    )
    # Silence the request log spam from SimpleHTTPRequestHandler
    handler.log_message = lambda *args: None  # type: ignore[attr-defined]

    server = http.server.HTTPServer(("0.0.0.0", HTTP_PORT), handler)

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
        # Ping every 20 seconds to keep connection alive over mobile networks
        ping_interval=20,
        ping_timeout=10,
    ):
        logger.info("PocketDeck ready — waiting for connections…")
        await asyncio.Future()   # run forever


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("Shutting down — goodbye!")
