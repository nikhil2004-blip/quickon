"""
mouse.py — Mouse event handler
Handles mouse_move, mouse_click, mouse_scroll events.

On Windows: uses SendInput() — the correct modern Win32 API for injecting
hardware-level relative mouse events. This preserves Windows Pointer
Acceleration ("Enhance Pointer Precision") exactly like a physical trackpad.

On other platforms: falls back to pynput.
"""

import logging
import platform
import ctypes
import ctypes.wintypes

logger = logging.getLogger(__name__)

# ── Configurable sensitivity ──────────────────────────────────────────────────
# The JS side already applies its own sensitivity (default 3.0×).
# Keep this at 1.0 on the server to avoid double-amplification.
SENSITIVITY: float = 1.0

# ── Platform detection ────────────────────────────────────────────────────────
_IS_WINDOWS = platform.system() == "Windows"

# ── Win32 SendInput setup ─────────────────────────────────────────────────────
if _IS_WINDOWS:
    # MOUSEINPUT structure
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

    # Flags
    MOUSE_MOVE       = 0x0001  # relative move
    MOUSE_LEFTDOWN   = 0x0002
    MOUSE_LEFTUP     = 0x0004
    MOUSE_RIGHTDOWN  = 0x0008
    MOUSE_RIGHTUP    = 0x0010
    MOUSE_MIDDLEDOWN = 0x0020
    MOUSE_MIDDLEUP   = 0x0040
    MOUSE_WHEEL      = 0x0800
    MOUSE_HWHEEL     = 0x1000
    INPUT_MOUSE = 0

    def _send_mouse(flags: int, dx: int = 0, dy: int = 0, data: int = 0) -> None:
        inp = INPUT(type=INPUT_MOUSE)
        inp.mi.dx        = dx
        inp.mi.dy        = dy
        inp.mi.mouseData = ctypes.c_ulong(data).value
        inp.mi.dwFlags   = flags
        inp.mi.time      = 0
        inp.mi.dwExtraInfo = ctypes.pointer(ctypes.c_ulong(0))
        _SendInput(1, ctypes.byref(inp), ctypes.sizeof(INPUT))

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
# Public handlers
# ══════════════════════════════════════════════════════════════════════════════

def handle_mouse_move(dx: float, dy: float) -> None:
    """Move the cursor by (dx, dy) pixels (relative)."""
    mx = int(dx * SENSITIVITY)
    my = int(dy * SENSITIVITY)
    if mx == 0 and my == 0:
        return
    if _IS_WINDOWS:
        _send_mouse(MOUSE_MOVE, dx=mx, dy=my)
    elif _PYNPUT_OK:
        _pynput_mouse.move(mx, my)


def handle_mouse_click(button: str, double: bool = False) -> None:
    """Fire a left / right / middle click (or double-click)."""
    btn = button.lower()
    clicks = 2 if double else 1

    if _IS_WINDOWS:
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


def handle_mouse_scroll(dx: float, dy: float) -> None:
    """
    Scroll the wheel.
    Client convention: dy > 0 = two-finger drag DOWN = scroll content DOWN.
    Windows WHEEL:     positive = scroll UP  →  negate dy.
    WHEEL_DELTA = 120 per notch; scale smoothly by 30 per unit from client.
    """
    if _IS_WINDOWS:
        if dy != 0:
            _send_mouse(MOUSE_WHEEL, data=int(dy * 30))
        if dx != 0:
            _send_mouse(MOUSE_HWHEEL, data=int(dx * 30))
    elif _PYNPUT_OK:
        _pynput_mouse.scroll(int(dx), int(dy))
