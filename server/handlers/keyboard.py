"""
keyboard.py — Keyboard event handler using pynput
Maps protocol key names to pynput Key constants.
Handles: regular keys, modifiers, combinations, text typing.
"""

import logging
from typing import Optional

try:
    from pynput.keyboard import Key, Controller as KeyboardController, HotKey
    _kb = KeyboardController()
    PYNPUT_AVAILABLE = True
except Exception as e:
    PYNPUT_AVAILABLE = False
    _kb = None
    logging.warning(f"pynput keyboard unavailable: {e}")

logger = logging.getLogger(__name__)

# Map protocol key names → pynput Key constants
_KEY_MAP: dict = {
    # Modifiers
    "ctrl":    Key.ctrl,
    "control": Key.ctrl,
    "alt":     Key.alt,
    "shift":   Key.shift,
    "win":     Key.cmd,
    "cmd":     Key.cmd,
    "super":   Key.cmd,
    "meta":    Key.cmd,
    # Function keys
    "f1":  Key.f1,  "f2":  Key.f2,  "f3":  Key.f3,  "f4":  Key.f4,
    "f5":  Key.f5,  "f6":  Key.f6,  "f7":  Key.f7,  "f8":  Key.f8,
    "f9":  Key.f9,  "f10": Key.f10, "f11": Key.f11, "f12": Key.f12,
    # Navigation
    "tab":    Key.tab,
    "esc":    Key.esc,
    "escape": Key.esc,
    "enter":  Key.enter,
    "return": Key.enter,
    "space":  Key.space,
    "backspace": Key.backspace,
    "delete": Key.delete,
    "del":    Key.delete,
    "home":   Key.home,
    "end":    Key.end,
    "pgup":   Key.page_up,
    "pageup": Key.page_up,
    "pgdn":   Key.page_down,
    "pagedown": Key.page_down,
    "up":     Key.up,
    "down":   Key.down,
    "left":   Key.left,
    "right":  Key.right,
    # Media
    "media_play_pause": Key.media_play_pause,
    "media_next":       Key.media_next,
    "media_previous":   Key.media_previous,
    "media_volume_up":  Key.media_volume_up,
    "media_volume_down": Key.media_volume_down,
    "media_volume_mute": Key.media_volume_mute,
}


def _resolve_key(name: str):
    """
    Resolve a single key name to a pynput Key or a single character.
    Returns None if the key cannot be resolved.
    """
    lower = name.lower().strip()
    if lower in _KEY_MAP:
        return _KEY_MAP[lower]
    if len(name) == 1:
        return name
    logger.warning(f"Unknown key: {name!r}")
    return None


def handle_key_tap(key_combo: str) -> None:
    """
    Tap a key combination, e.g. 'ctrl+c', 'alt+tab', 'f5', 'a'.
    Parses '+'-separated parts; holds all modifiers while tapping the final key.
    """
    if not PYNPUT_AVAILABLE:
        return

    parts = [p.strip() for p in key_combo.split("+")]
    keys = [_resolve_key(p) for p in parts]
    keys = [k for k in keys if k is not None]

    if not keys:
        logger.warning(f"Could not resolve any keys from: {key_combo!r}")
        return

    # All except last are held as modifiers
    modifiers = keys[:-1]
    final = keys[-1]

    try:
        for mod in modifiers:
            _kb.press(mod)
        _kb.tap(final)
    finally:
        for mod in reversed(modifiers):
            _kb.release(mod)


def handle_key_down(key_combo: str) -> None:
    """Press (hold) keys — used for modifier-key-down events."""
    if not PYNPUT_AVAILABLE:
        return
    parts = [p.strip() for p in key_combo.split("+")]
    for part in parts:
        k = _resolve_key(part)
        if k:
            _kb.press(k)


def handle_key_up(key_combo: str) -> None:
    """Release keys."""
    if not PYNPUT_AVAILABLE:
        return
    parts = [p.strip() for p in key_combo.split("+")]
    for part in parts:
        k = _resolve_key(part)
        if k:
            _kb.release(k)


def handle_text_type(text: str) -> None:
    """Type a string of text using pynput keyboard.type()."""
    if not PYNPUT_AVAILABLE:
        return
    try:
        _kb.type(text)
    except Exception as e:
        logger.error(f"Error typing text: {e}")
