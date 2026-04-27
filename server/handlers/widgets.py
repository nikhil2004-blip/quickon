"""
widgets.py — Widget executor (Phase 5)
Parses widgets.yaml, executes widget action sequences.

Action types:
  terminal  — writes a command to the active PTY session
  launch    — opens an application via subprocess / os.startfile
  keypress  — fires a key combination
  delay     — waits N milliseconds before next action
"""

import asyncio
import logging
import os
import platform
import subprocess
from pathlib import Path
from typing import Any

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
            _launch_app(app, args)

        elif atype == "keypress":
            key = action.get("key", "")
            if key:
                from handlers.keyboard import handle_key_tap
                handle_key_tap(key)

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
            # os.startfile works great for apps registered in PATH / registry
            if args:
                subprocess.Popen([app] + args, shell=True)
            else:
                os.startfile(app)
        elif _sys == "Darwin":
            subprocess.Popen(["open", "-a", app] + args)
        else:
            subprocess.Popen([app] + args)
        logger.info(f"Launched: {app} {args}")
    except Exception as e:
        logger.error(f"Failed to launch '{app}': {e}")
