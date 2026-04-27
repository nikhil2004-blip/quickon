"""
widgets.py — Widget executor (Phase 5)
Parses widgets.yaml, executes widget action sequences.

Action types:
  terminal  — writes a command to the active PTY session
  launch    — opens an application via subprocess
  shell     — runs a raw shell command string (e.g. "start powershell")
  keypress  — fires a key combination
  browser   — opens a URL in the default browser
  lock      — locks the workstation (Win32 LockWorkStation API)
  delay     — waits N milliseconds before next action
"""

import asyncio
import logging
import os
import platform
import subprocess
import webbrowser
from pathlib import Path

import yaml

logger = logging.getLogger(__name__)

_WIDGETS: list[dict] = []
_WIDGETS_LOADED = False

WIDGETS_YAML = Path(__file__).parent.parent / "widgets.yaml"


def load_widgets() -> list[dict]:
    """Load (or reload) widgets from widgets.yaml. Returns the list."""
    global _WIDGETS, _WIDGETS_LOADED
    if not WIDGETS_YAML.exists():
        logger.warning(f"widgets.yaml not found at {WIDGETS_YAML}")
        _WIDGETS = []
        _WIDGETS_LOADED = True
        return _WIDGETS

    try:
        with open(WIDGETS_YAML, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f)
        _WIDGETS = data.get("widgets", []) if isinstance(data, dict) else []
        _WIDGETS_LOADED = True
        logger.info(f"Loaded {len(_WIDGETS)} widgets from {WIDGETS_YAML.name}")
    except Exception as e:
        logger.error(f"Failed to load widgets.yaml: {e}")
        _WIDGETS = []
    return _WIDGETS


def get_widgets() -> list[dict]:
    """Return the widget list (loads once on first call)."""
    if not _WIDGETS_LOADED:
        load_widgets()
    return _WIDGETS


def _widget_payload(w: dict) -> dict:
    """Return the JSON-serialisable widget descriptor for the client."""
    return {
        "id":    w.get("id", ""),
        "label": w.get("label", ""),
        "icon":  w.get("icon", "⚡"),
        "color": w.get("color", "#4f46e5"),
    }


def get_widget_list_payload() -> list[dict]:
    """Return client-safe widget descriptors (no server-side action details)."""
    return [_widget_payload(w) for w in get_widgets()]


async def run_widget(widget_id: str, terminal_sessions: dict, ws) -> None:
    """
    Execute all actions for the given widget ID sequentially.
    terminal_sessions: the active_terminals dict from server.py
    ws: the current WebSocket connection (to find the right PTY)
    """
    widgets = get_widgets()
    widget = next((w for w in widgets if w.get("id") == widget_id), None)

    if widget is None:
        logger.warning(f"Widget not found: {widget_id!r}")
        return

    actions: list[dict] = widget.get("actions", [])
    logger.info(f"Running widget '{widget_id}' ({len(actions)} actions)")

    loop = asyncio.get_event_loop()

    for action in actions:
        atype = action.get("type", "")

        if atype == "terminal":
            cmd = action.get("command", "")
            if ws in terminal_sessions:
                terminal_sessions[ws].write(cmd)
            else:
                logger.warning("Widget terminal action — no active PTY for this connection")

        elif atype == "launch":
            app  = action.get("app", "")
            args = action.get("args", [])
            # Run in executor — Popen can block for ~100-400ms on Windows
            await loop.run_in_executor(None, _launch_app, app, args)

        elif atype == "shell":
            cmd = action.get("command", "")
            if cmd:
                await loop.run_in_executor(None, _shell_run, cmd)

        elif atype == "keypress":
            key = action.get("key", "")
            if key:
                from handlers.keyboard import handle_key_tap
                await loop.run_in_executor(None, handle_key_tap, key)

        elif atype == "browser":
            url = action.get("url", "")
            if url:
                # webbrowser.open_new_tab is fast but run in executor to be safe
                await loop.run_in_executor(None, _open_browser, url)

        elif atype == "lock":
            await loop.run_in_executor(None, _lock_workstation)

        elif atype == "delay":
            ms = action.get("ms", 0)
            if ms > 0:
                await asyncio.sleep(ms / 1000.0)

        else:
            logger.warning(f"Unknown widget action type: {atype!r}")


def _launch_app(app: str, args: list[str]) -> None:
    """Open an application using the platform-appropriate method."""
    if not app:
        return

    _sys = platform.system()
    try:
        if _sys == "Windows":
            if args:
                subprocess.Popen([app] + list(args), shell=True,
                                 creationflags=subprocess.CREATE_NEW_CONSOLE)
            else:
                subprocess.Popen(app, shell=True,
                                 creationflags=subprocess.CREATE_NEW_CONSOLE)
        elif _sys == "Darwin":
            subprocess.Popen(["open", "-a", app] + list(args))
        else:
            subprocess.Popen([app] + list(args))
        logger.info(f"Launched: {app} {args}")
    except Exception as e:
        logger.error(f"Failed to launch '{app}': {e}")


def _shell_run(cmd: str) -> None:
    """Run a raw shell command string. Safe for fire-and-forget openers."""
    try:
        subprocess.Popen(cmd, shell=True,
                         creationflags=subprocess.CREATE_NEW_CONSOLE
                         if platform.system() == "Windows" else 0)
        logger.info(f"Shell: {cmd}")
    except Exception as e:
        logger.error(f"Shell command failed '{cmd}': {e}")


def _open_browser(url: str) -> None:
    """Open a URL in the PC's default browser (new tab)."""
    try:
        webbrowser.open_new_tab(url)
        logger.info(f"Opened browser: {url}")
    except Exception as e:
        logger.error(f"Failed to open browser for '{url}': {e}")


def _lock_workstation() -> None:
    """Lock the PC. Uses Win32 LockWorkStation() on Windows."""
    _sys = platform.system()
    if _sys == "Windows":
        try:
            import ctypes
            result = ctypes.windll.user32.LockWorkStation()
            if result:
                logger.info("Workstation locked via LockWorkStation()")
            else:
                err = ctypes.get_last_error()
                logger.error(f"LockWorkStation() returned 0, error={err}")
                # Fallback: rundll32 method
                subprocess.Popen(
                    "rundll32.exe user32.dll,LockWorkStation",
                    shell=True
                )
                logger.info("Workstation lock via rundll32 fallback")
        except Exception as e:
            logger.error(f"LockWorkStation failed: {e}")
    else:
        try:
            from handlers.keyboard import handle_key_tap
            handle_key_tap("ctrl+alt+l")
        except Exception as e:
            logger.error(f"Lock fallback failed: {e}")
