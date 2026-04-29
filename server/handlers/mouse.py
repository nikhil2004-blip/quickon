"""
mouse.py — Mouse event handler
Handles mouse_move, mouse_click, mouse_scroll, mouse_down, mouse_up events.

On Windows: uses SetCursorPos() to bypass Windows Pointer Acceleration entirely.
GetCursorPos is called ONCE per connect to seed the position cache, then we
maintain an internal float position cache. This eliminates the blocking
GetCursorPos syscall that was serializing every move event.

On other platforms: falls back to pynput.
"""

import logging
import platform
import ctypes
import ctypes.wintypes
import sys
import threading
import time

logger = logging.getLogger(__name__)

# ── Configurable sensitivity ──────────────────────────────────────────────────
SENSITIVITY: float = 1.0

# Server-side float accumulators to prevent sub-pixel data loss
_accum_dx = 0.0
_accum_dy = 0.0

# Timestamp of the last mouse_move call (monotonic seconds).
# Used to detect idle periods when the physical mouse may have moved
# the cursor out from under our cached position.
_last_move_time: float = 0.0
# Bumped from 1.0s → 5.0s. The reseed adds a GetCursorPos syscall on the
# move-worker hot path; the user is unlikely to touch the physical mouse
# mid-mobile-control session, and clicks already reseed (handle_mouse_click).
RESEED_IDLE_SECONDS: float = 5.0

# ── Platform detection ────────────────────────────────────────────────────────
_IS_WINDOWS = platform.system() == "Windows"

# ── Sub-millisecond scheduling ────────────────────────────────────────────────
# Two changes that dramatically reduce input jitter:
#
#  1. timeBeginPeriod(1) — Windows defaults to a 15.625ms timer tick. Any
#     thread sleep, Event.wait timeout, or GIL hand-off can be delayed by
#     up to 15ms. Setting the system timer to 1ms makes thread wake-ups
#     near-immediate. This is the single biggest server-side win for
#     "stuck/laggy" feel after pauses.
#
#  2. sys.setswitchinterval(0.001) — Python's GIL hands off between threads
#     at most once every 5ms by default. The asyncio thread parses incoming
#     WebSocket frames and the move-worker thread applies SetCursorPos —
#     they need to interleave smoothly. 1ms gives 5× more chances per
#     second for the worker to grab the GIL right after a new delta lands.
try:
    sys.setswitchinterval(0.001)
except (AttributeError, ValueError):
    pass

if _IS_WINDOWS:
    try:
        # winmm.timeBeginPeriod(1) is process-global until timeEndPeriod or
        # process exit. We deliberately never call timeEndPeriod — the
        # PocketDeck process is short-lived from the OS's perspective and
        # the slight power impact is worth the latency win.
        ctypes.windll.winmm.timeBeginPeriod(1)
    except Exception:
        logger.debug("timeBeginPeriod(1) unavailable", exc_info=True)

# ── Win32 SendInput setup ─────────────────────────────────────────────────────
if _IS_WINDOWS:
    class MOUSEINPUT(ctypes.Structure):
        _fields_ = [
            ("dx",          ctypes.c_long),
            ("dy",          ctypes.c_long),
            ("mouseData",   ctypes.c_ulong),
            ("dwFlags",     ctypes.c_ulong),
            ("time",        ctypes.c_ulong),
            ("dwExtraInfo", ctypes.POINTER(ctypes.c_ulong)),
        ]

    class INPUT(ctypes.Structure):
        class _INPUT(ctypes.Union):
            _fields_ = [("mi", MOUSEINPUT)]
        _anonymous_ = ("_input",)
        _fields_  = [("type", ctypes.c_ulong), ("_input", _INPUT)]

    _SendInput = ctypes.windll.user32.SendInput
    _SendInput.argtypes = [ctypes.c_uint, ctypes.POINTER(INPUT), ctypes.c_int]
    _SendInput.restype  = ctypes.c_uint

    MOUSE_MOVE       = 0x0001
    MOUSE_LEFTDOWN   = 0x0002
    MOUSE_LEFTUP     = 0x0004
    MOUSE_RIGHTDOWN  = 0x0008
    MOUSE_RIGHTUP    = 0x0010
    MOUSE_MIDDLEDOWN = 0x0020
    MOUSE_MIDDLEUP   = 0x0040
    MOUSE_WHEEL      = 0x0800
    MOUSE_HWHEEL     = 0x1000
    INPUT_MOUSE = 0

    _EXTRA_INFO = ctypes.pointer(ctypes.c_ulong(0))
    _INPUT_SIZE = ctypes.sizeof(INPUT)

    # Pre-allocated INPUT struct for the move-thread path.
    # _move_executor has max_workers=1, so this is never accessed concurrently.
    _MOVE_INPUT = INPUT(type=INPUT_MOUSE)
    _MOVE_INPUT.mi.time = 0
    _MOVE_INPUT.mi.dwExtraInfo = _EXTRA_INFO

    # Pre-allocated POINT for GetCursorPos reseed (avoids alloc per reseed)
    _RESEED_PT = ctypes.wintypes.POINT()

    def _send_mouse(flags: int, dx: int = 0, dy: int = 0, data: int = 0) -> None:
        """General-purpose SendInput wrapper — allocates a fresh INPUT struct.
        Used for clicks, scroll, and button press/release (infrequent calls)."""
        inp = INPUT(type=INPUT_MOUSE)
        inp.mi.dx        = dx
        inp.mi.dy        = dy
        inp.mi.mouseData = data
        inp.mi.dwFlags   = flags
        inp.mi.time      = 0
        inp.mi.dwExtraInfo = _EXTRA_INFO
        _SendInput(1, ctypes.byref(inp), _INPUT_SIZE)

    # ── Cached cursor position ────────────────────────────────────────────────
    # FIX: The old code called GetCursorPos() on EVERY mouse_move event.
    # GetCursorPos is a blocking Win32 syscall that:
    # 1. Requires a kernel transition (user→kernel→user mode switch)
    # 2. Can stall briefly when the system is under load or DWM is compositing
    # 3. Was the bottleneck serializing all 120Hz move events through one thread
    #
    # Fix: seed position from GetCursorPos once at startup/connect, then
    # maintain a float cache in userspace. No more kernel round-trip per move.
    # The cache stays accurate because we are the only source of cursor movement
    # (SetCursorPos is the authoritative setter, and we track every delta we send).
    # If another process moves the cursor (e.g. user touches the physical mouse),
    # the cache drifts — but we re-seed it on the next click (safe sync point).
    _cursor_lock = threading.Lock()
    _cursor_x: float = 0.0
    _cursor_y: float = 0.0
    _cursor_seeded: bool = False

    def _seed_cursor_pos() -> None:
        """Read real cursor position from OS. Call once on connect and after clicks."""
        global _cursor_x, _cursor_y, _cursor_seeded
        pt = ctypes.wintypes.POINT()
        ctypes.windll.user32.GetCursorPos(ctypes.byref(pt))
        with _cursor_lock:
            _cursor_x = float(pt.x)
            _cursor_y = float(pt.y)
            _cursor_seeded = True

    # Seed on module load so first move works correctly
    try:
        _seed_cursor_pos()
    except Exception:
        pass

    def _get_screen_size():
        """Return (width, height) of the primary monitor."""
        w = ctypes.windll.user32.GetSystemMetrics(0)
        h = ctypes.windll.user32.GetSystemMetrics(1)
        return float(w), float(h)

    _screen_w, _screen_h = 0.0, 0.0
    try:
        _screen_w, _screen_h = _get_screen_size()
    except Exception:
        _screen_w, _screen_h = 1920.0, 1080.0

# ── pynput fallback ───────────────────────────────────────────────────────────
_pynput_mouse = None
_PYNPUT_OK    = False

if not _IS_WINDOWS:
    try:
        from pynput.mouse import Button as _Button, Controller as _MouseController
        _pynput_mouse = _MouseController()
        _PYNPUT_OK    = True
    except Exception as e:
        logger.warning(f"pynput mouse unavailable: {e}")


# ══════════════════════════════════════════════════════════════════════════════
# Public handlers & Accumulator Thread
# ══════════════════════════════════════════════════════════════════════════════

# The accumulator thread solves a critical memory/latency leak:
# At 120-240Hz, if Windows SendInput takes longer than 4ms, a standard ThreadPool
# queue grows infinitely. Over 1 minute of dragging, you get thousands of queued
# events, causing lag to grow from 0s to several seconds.
# This thread ensures the queue is strictly bounded to 1. If SendInput is busy,
# incoming WebSocket events just add their dx/dy to the pending float. No dropped
# distance, but no infinitely growing backlog either.
_pending_lock = threading.Lock()
_pending_dx = 0.0
_pending_dy = 0.0
_move_event = threading.Event()

def queue_mouse_move(dx: float, dy: float) -> None:
    """Fast, non-blocking queueing of mouse deltas from the WebSocket thread."""
    global _pending_dx, _pending_dy
    with _pending_lock:
        _pending_dx += dx
        _pending_dy += dy
    _move_event.set()

def _move_worker_loop():
    """
    Drain pending deltas and apply them to the cursor.

    Tight loop semantics:
      * After each SetCursorPos we re-check pending under the lock — if more
        deltas arrived while we were syscalling, drain them in the same
        iteration. This avoids an extra wait()+wake() round-trip per frame
        under sustained motion.
      * Only when pending is truly empty do we clear the event and wait.
        The clear/wait order avoids the classic "lost-wakeup" race.
    """
    global _pending_dx, _pending_dy
    while True:
        _move_event.wait()

        # Inner drain loop — keep applying as long as deltas keep arriving.
        while True:
            with _pending_lock:
                dx = _pending_dx
                dy = _pending_dy
                _pending_dx = 0.0
                _pending_dy = 0.0
                if dx == 0.0 and dy == 0.0:
                    # No work left — clear the event WHILE holding the lock so
                    # any concurrent queue_mouse_move re-sets it after our clear.
                    _move_event.clear()
                    break

            handle_mouse_move(dx, dy)

# Start the dedicated move thread
_move_worker = threading.Thread(target=_move_worker_loop, name="pocketdeck_move", daemon=True)
_move_worker.start()

def handle_mouse_move(dx: float, dy: float) -> None:
    """Move the cursor by (dx, dy) pixels (relative)."""
    global _accum_dx, _accum_dy

    _accum_dx += dx * SENSITIVITY
    _accum_dy += dy * SENSITIVITY

    mx = int(_accum_dx)
    my = int(_accum_dy)

    if mx == 0 and my == 0:
        return

    _accum_dx -= mx
    _accum_dy -= my

    if _IS_WINDOWS:
        global _cursor_x, _cursor_y, _cursor_seeded, _last_move_time

        now = time.monotonic()
        need_reseed = not _cursor_seeded or (now - _last_move_time) >= RESEED_IDLE_SECONDS

        # GetCursorPos OUTSIDE the lock — this is a kernel syscall (~5-15µs)
        # and holding the lock during it would stall click handlers.
        if need_reseed:
            ctypes.windll.user32.GetCursorPos(ctypes.byref(_RESEED_PT))

        with _cursor_lock:
            if need_reseed:
                _cursor_x = float(_RESEED_PT.x)
                _cursor_y = float(_RESEED_PT.y)
                _cursor_seeded = True

            _last_move_time = now

            new_x = _cursor_x + mx
            new_y = _cursor_y + my

            # Clamp to screen bounds
            if _screen_w > 0:
                new_x = max(0.0, min(new_x, _screen_w - 1))
            if _screen_h > 0:
                new_y = max(0.0, min(new_y, _screen_h - 1))

            _cursor_x = new_x
            _cursor_y = new_y
            ix = int(new_x)
            iy = int(new_y)

        ctypes.windll.user32.SetCursorPos(ix, iy)

    elif _PYNPUT_OK:
        _pynput_mouse.move(mx, my)


def handle_mouse_click(button: str, double: bool = False) -> None:
    """Fire a left / right / middle click (or double-click)."""
    btn = button.lower()
    clicks = 2 if double else 1

    if _IS_WINDOWS:
        # Re-seed cursor position cache after a click.
        # Clicks are infrequent so the GetCursorPos cost is negligible here,
        # and it keeps the cache accurate if a physical mouse moved since last sync.
        _seed_cursor_pos()

        if btn == "right":
            down, up = MOUSE_RIGHTDOWN,  MOUSE_RIGHTUP
        elif btn == "middle":
            down, up = MOUSE_MIDDLEDOWN, MOUSE_MIDDLEUP
        else:
            down, up = MOUSE_LEFTDOWN,   MOUSE_LEFTUP
        for _ in range(clicks):
            _send_mouse(down)
            _send_mouse(up)

    elif _PYNPUT_OK:
        from pynput.mouse import Button as _B
        b = {"right": _B.right, "middle": _B.middle}.get(btn, _B.left)
        _pynput_mouse.click(b, clicks)


_scroll_lock = threading.Lock()
_pending_scroll_dx = 0.0
_pending_scroll_dy = 0.0
_scroll_event = threading.Event()

def queue_mouse_scroll(dx: float, dy: float) -> None:
    global _pending_scroll_dx, _pending_scroll_dy
    with _scroll_lock:
        _pending_scroll_dx += dx
        _pending_scroll_dy += dy
    _scroll_event.set()

def _scroll_worker_loop():
    global _pending_scroll_dx, _pending_scroll_dy
    while True:
        _scroll_event.wait()
        _scroll_event.clear()
        
        with _scroll_lock:
            dx = _pending_scroll_dx
            dy = _pending_scroll_dy
            _pending_scroll_dx = 0.0
            _pending_scroll_dy = 0.0
            
        if dx != 0 or dy != 0:
            handle_mouse_scroll(dx, dy)

_scroll_worker = threading.Thread(target=_scroll_worker_loop, name="pocketdeck_scroll", daemon=True)
_scroll_worker.start()

def handle_mouse_scroll(dx: float, dy: float) -> None:
    """
    Scroll the wheel (natural scroll direction).
    Client convention: dy > 0 = two-finger drag DOWN = scroll DOWN (content moves up).
    Windows WHEEL:     positive = scroll UP,  negative = scroll DOWN.
    """
    if _IS_WINDOWS:
        # WHEEL_DELTA = 120 in Windows. One "notch" = 120 units.
        # With the client sending integer clicks (1 click = 3px of finger travel),
        # multiply by 40 to get sub-notch smooth scrolling (40 < 120 = partial notch).
        if dy != 0:
            _send_mouse(MOUSE_WHEEL, data=int(-dy * 40))
        if dx != 0:
            _send_mouse(MOUSE_HWHEEL, data=int(dx * 40))
    elif _PYNPUT_OK:
        _pynput_mouse.scroll(int(dx), int(dy))


def handle_mouse_button(button: str, pressed: bool) -> None:
    """
    Press OR release a single mouse button without the paired up/down.
    Used for drag-lock.
    """
    btn = button.lower()
    if _IS_WINDOWS:
        # Re-seed on button press so drag starts from the correct position
        if pressed:
            _seed_cursor_pos()

        if btn == "right":
            flag = MOUSE_RIGHTDOWN if pressed else MOUSE_RIGHTUP
        elif btn == "middle":
            flag = MOUSE_MIDDLEDOWN if pressed else MOUSE_MIDDLEUP
        else:
            flag = MOUSE_LEFTDOWN if pressed else MOUSE_LEFTUP
        _send_mouse(flag)
    elif _PYNPUT_OK:
        from pynput.mouse import Button as _B
        b = {"right": _B.right, "middle": _B.middle}.get(btn, _B.left)
        if pressed:
            _pynput_mouse.press(b)
        else:
            _pynput_mouse.release(b)


def reseed_cursor() -> None:
    """
    Public function to force a position re-sync from the OS.
    Called by server.py after auth_ok so the cache is fresh when a new
    client connects (e.g. after the physical mouse has moved).
    Also resets sub-pixel accumulators so the first mobile move after
    reconnect doesn't inherit a phantom fractional delta from a previous
    session (eliminates the tiny jump on first movement after reconnect).
    """
    global _accum_dx, _accum_dy, _last_move_time
    _accum_dx = 0.0
    _accum_dy = 0.0
    _last_move_time = 0.0  # force GetCursorPos reseed on next move
    if _IS_WINDOWS:
        try:
            _seed_cursor_pos()
        except Exception:
            pass