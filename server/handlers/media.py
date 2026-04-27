"""
media.py — Media key handler (Phase 6)

Windows:  pynput multimedia keys (Key.media_play_pause etc.)
Linux:    playerctl via subprocess, falls back to pynput keys
macOS:    pynput multimedia keys

Protocol action values:
  play_pause, next, previous, volume_up, volume_down, mute
"""

import logging
import platform
import subprocess

logger = logging.getLogger(__name__)

_SYS = platform.system()

# ── pynput keyboard controller (all platforms) ────────────────────────────────
try:
    from pynput.keyboard import Key, Controller as _KeyController
    _kb = _KeyController()
    _PYNPUT_OK = True
except Exception as e:
    _kb = None
    _PYNPUT_OK = False
    logger.warning(f"pynput keyboard unavailable for media keys: {e}")

# Mapping: action name → pynput Key constant
_PYNPUT_KEYS = {
    "play_pause":  getattr(Key, "media_play_pause",  None),
    "next":        getattr(Key, "media_next",         None),
    "previous":    getattr(Key, "media_previous",     None),
    "volume_up":   getattr(Key, "media_volume_up",    None),
    "volume_down": getattr(Key, "media_volume_down",  None),
    "mute":        getattr(Key, "media_volume_mute",  None),
}

# ── playerctl action mapping (Linux) ─────────────────────────────────────────
_PLAYERCTL_CMD = {
    "play_pause":  ["playerctl", "play-pause"],
    "next":        ["playerctl", "next"],
    "previous":    ["playerctl", "previous"],
    "volume_up":   ["playerctl", "volume", "0.05+"],
    "volume_down": ["playerctl", "volume", "0.05-"],
    "mute":        None,  # playerctl has no native mute — fall back to pynput
}


def handle_media(action: str) -> None:
    """
    Handle a media control action.
    action: one of play_pause, next, previous, volume_up, volume_down, mute
    """
    action = action.lower().strip()

    if _SYS == "Linux":
        _handle_linux(action)
    else:
        _handle_pynput(action)


def _handle_pynput(action: str) -> None:
    if not _PYNPUT_OK:
        logger.warning(f"pynput not available — cannot send media action: {action}")
        return
    key = _PYNPUT_KEYS.get(action)
    if key is None:
        logger.warning(f"No pynput key mapping for media action: {action!r}")
        return
    try:
        _kb.tap(key)
        logger.debug(f"Media key sent: {action}")
    except Exception as e:
        logger.error(f"Error sending media key '{action}': {e}")


def _handle_linux(action: str) -> None:
    """Try playerctl first; fall back to pynput on failure."""
    cmd = _PLAYERCTL_CMD.get(action)
    if cmd is not None:
        try:
            result = subprocess.run(cmd, capture_output=True, timeout=2)
            if result.returncode == 0:
                logger.debug(f"playerctl: {action}")
                return
            logger.debug(f"playerctl returned {result.returncode} for {action} — falling back to pynput")
        except FileNotFoundError:
            logger.debug("playerctl not found — falling back to pynput")
        except Exception as e:
            logger.debug(f"playerctl error: {e} — falling back to pynput")
    # Fallback
    _handle_pynput(action)
