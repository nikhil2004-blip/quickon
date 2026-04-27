---
name: pocketdeck-protocol
description: >
  PocketDeck WebSocket message protocol reference.
  Use when working on any file that handles WebSocket messages:
  server.py, app.js, any panel JS, any handler in handlers/.
---

# PocketDeck Protocol Reference

## Transport
- **WebSocket port**: 8765 (`ws://[PC-IP]:8765`)
- **HTTP port**: 8766 (`http://[PC-IP]:8766`) — serves the PWA
- **Format**: JSON, UTF-8, always has `"type"` field
- **Auth**: first message from mobile MUST be `auth`, server drops connection after 3s timeout if not received

## Mobile → PC (commands)

| type | fields | description |
|------|--------|-------------|
| `auth` | `token: string` | First message sent — must match server token |
| `mouse_move` | `dx: number, dy: number` | Relative movement, batched per rAF frame (~16ms) |
| `mouse_click` | `button: "left"\|"right"\|"middle"`, `double?: bool` | Single or double click |
| `mouse_scroll` | `dx: number, dy: number` | Scroll delta (dy > 0 = up) |
| `key_down` | `key: string` | Hold key/modifier (e.g. `"ctrl"`) |
| `key_up` | `key: string` | Release key/modifier |
| `key_tap` | `key: string` | Tap key or combo (e.g. `"ctrl+c"`, `"alt+tab"`, `"f5"`) |
| `text_type` | `text: string` | Bulk type a string via pynput.keyboard.type() |
| `terminal_in` | `data: string` | Raw bytes to write to PTY stdin |
| `terminal_resize` | `cols: number, rows: number` | Resize PTY (triggers SIGWINCH) |
| `widget_run` | `id: string` | Execute widget by id from widgets.yaml |
| `media` | `action: "play_pause"\|"next"\|"previous"\|"volume_up"\|"volume_down"\|"mute"` | Media control |

## PC → Mobile (responses)

| type | fields | description |
|------|--------|-------------|
| `auth_ok` | — | Authentication succeeded |
| `auth_fail` | — | Wrong token — client should show error and not retry automatically |
| `server_info` | `os: string, hostname: string` | Sent after auth_ok |
| `widget_list` | `widgets: Widget[]` | List of widgets from widgets.yaml |
| `terminal_out` | `data: string` | Raw PTY output (may contain ANSI escape codes) |

## Key name format
Keys are lowercase strings, with `+` as separator for combos:
- Single: `"ctrl"`, `"alt"`, `"tab"`, `"esc"`, `"f5"`, `"a"`, `"enter"`
- Combos: `"ctrl+c"`, `"ctrl+shift+t"`, `"alt+tab"`, `"win+l"`

## Widget schema (widgets.yaml)
```yaml
id: string           # unique identifier for widget_run
label: string        # display text
icon: string         # emoji or icon name
color: string        # optional hex color for button
actions:
  - type: terminal   # write command to PTY
    command: string  # include \\r for enter
  - type: launch     # open application
    app: string
    args: list[string]
  - type: keypress   # send key combo
    key: string
  - type: delay      # wait before next action
    ms: number
```

## Error codes (WebSocket close codes)
| Code | Meaning |
|------|---------|
| 4000 | Invalid JSON |
| 4001 | Auth timeout / auth message not sent |
| 4003 | Wrong token |
