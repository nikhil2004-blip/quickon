# PocketDeck — Complete 2-Hour Pitch Document (Part 1: Context, Problem, Architecture)

---

## 1. WHAT IS POCKETDECK?

**PocketDeck** (codenamed `quickcon` in the repo) is a **LAN-based mobile-to-PC remote control system** that turns any smartphone browser into a full control surface for a Windows/Mac/Linux desktop.

In plain English: **you run one Python script on your PC, scan a QR code on your phone, and your phone becomes a trackpad + keyboard + live terminal + macro launcher for your computer — with no app install required.**

### The One-Line Pitch
> "KDE Connect meets a real PTY terminal, delivered as a zero-install PWA over your local network."

---

## 2. THE PROBLEM — WHY THIS EXISTS

### Existing Tools and Why They Fail

| Tool | Problem |
|------|---------|
| **KDE Connect** | Linux-only ecosystem, requires app install |
| **Unified Remote** | Paywalled, no real terminal (just stdout dump) |
| **TeamViewer / RDP** | Screen mirroring — bandwidth-heavy, not lightweight control |
| **SSH from phone** | Raw SSH client — no mouse, no GUI automation |

### Three Specific Failures We Solve

**2.1 No Real Terminal**
Tools like Unified Remote run a command and return stdout as plain text. They do NOT spawn a real PTY (Pseudo-Terminal). This means:
- TAB autocomplete is **disabled** — the shell detects it's not a real terminal
- ANSI color codes appear as raw escape characters (`\x1b[32m`)
- Interactive programs like `vim`, `htop`, `python REPL` **break immediately**
- Shell state (current directory, environment variables) does **not persist** between commands

**2.2 Incomplete Keyboard**
Most tools omit TAB, modifier combinations (Ctrl+C, Alt+Tab, Win key), and function keys. These are critical for developer workflows.

**2.3 No Programmable Automation**
No widget/macro system. Every action requires manual navigation. Opening a dev environment means: open terminal → cd project → npm run dev — three manual steps with no way to collapse into one button.

---

## 3. THE SOLUTION — WHAT WE BUILT

PocketDeck has **5 panels** accessible from the phone browser:

| Panel | What it does |
|-------|-------------|
| **Touchpad** | Full trackpad emulation — 1-finger move, tap=click, 2-finger scroll, multi-finger gestures |
| **Keyboard** | Full QWERTY with sticky modifiers (Ctrl, Alt, Win, Shift) — sends real keypresses to PC |
| **Terminal** | Live PTY terminal streamed to phone — TAB complete, ANSI colors, vim works |
| **Widgets** | One-tap macro buttons defined in a YAML file — launch apps, run commands, sequences |
| **Media** | Play/Pause, Next, Prev, Volume Up/Down, Mute |

**The killer feature**: a real interactive terminal on your phone. Not a command runner — an actual shell session where `vim` opens, `htop` shows processes, `python3` gives you a REPL, and TAB autocomplete works exactly like sitting at your desk.

---

## 4. TECH STACK — EVERY CHOICE EXPLAINED

### Backend: Python 3.11+ on the PC

```
Package          Version   Why we chose it
─────────────────────────────────────────────────────────
websockets        12.x     Asyncio-native WebSocket server
pynput            1.7.x    Mouse + keyboard injection (cross-platform)
pywinpty          2.x      Real PTY on Windows (ConPTY API)
ptyprocess        0.7.x    Real PTY on Linux/macOS (POSIX)
qrcode[pil]       7.x      QR code generation
pyyaml            6.x      widgets.yaml parsing
pystray           (tray)   Windows system tray icon
```

### Frontend: Pure HTML + Vanilla JS on the Phone

```
Library          Source    Why
─────────────────────────────────────────────────────────
xterm.js          CDN      Terminal emulator with ANSI support
Vanilla JS        —        Everything else (no React, no Vue)
Vanilla CSS       —        Layout, dark mode
```

**Why no React?** The PRD explicitly forbids it. A PWA with 5 panels and one WebSocket has zero state complexity that justifies React's overhead. Vanilla JS loads faster on mobile, is easier to debug, and produces a smaller payload.

---

## 5. WHAT IS A WEBSOCKET? (Explained from scratch)

### Normal HTTP (Request-Response)
Regular web: your browser sends a **request** → server sends a **response** → connection closes. Every interaction needs a new request. This is like sending a letter and waiting for a reply each time.

### WebSocket — The Upgrade
WebSocket starts as a regular HTTP request but sends an `Upgrade: websocket` header. The server agrees, and the connection is **transformed into a persistent, full-duplex channel** — both sides can send data at any time without the overhead of opening new connections.

```
Phone Browser                    PC (Python server)
     |                                  |
     |--- HTTP GET /  ----------------> |   (loads the PWA)
     |<-- 200 OK (HTML/JS/CSS) -------- |
     |                                  |
     |--- WS Upgrade ws://ip:8765 ----> |   (open persistent channel)
     |<-- 101 Switching Protocols ------ |
     |                                  |
     |--- {"type":"auth","token":"123"} >|   (authenticate)
     |<-- {"type":"auth_ok"} ---------- |
     |                                  |
     |--- {"type":"mouse_move","dx":5}  >|   (control messages, real-time)
     |--- {"type":"mouse_move","dx":3}  >|
     |<-- {"type":"terminal_out","data">|   (terminal output streams back)
```

**Why WebSocket over HTTP polling?**
- HTTP polling: phone asks "anything new?" every 100ms → 10 requests/second of overhead
- WebSocket: server pushes data the **instant** it's available → ~5ms latency vs ~100ms

**Why not TCP sockets directly?**
WebSocket runs on top of TCP but is browser-friendly. Raw TCP sockets are not accessible from browser JavaScript — browsers only expose WebSocket and HTTP.

---

## 6. WHAT IS A PTY? (The core technical concept)

### The Problem with subprocess.PIPE

When Python spawns a shell with `subprocess.PIPE`, the shell detects it's **not a real terminal** (no TTY file descriptor attached). Shells behave differently without a TTY:
- Readline is disabled → no TAB autocomplete, no arrow-key history
- Colored output is disabled (`ls --color=auto` produces no color)
- Interactive programs (`vim`, `htop`) crash immediately — they require terminal control codes (cursor positioning, screen clearing)

### What a PTY Is

A **PTY (Pseudo-Terminal)** is a pair of file descriptors that act exactly like a physical terminal:
- **Master side**: the program reading/writing (our Python server)
- **Slave side**: what the shell sees — it looks like a real `/dev/tty` device

When a shell is spawned inside a PTY, it thinks it's running in a real terminal window. TAB completion works. ANSI colors work. `vim` works.

```
Python server                 PTY Master/Slave             PowerShell
     |                              |                          |
     |-- write("ls\r") -----------> |-- stdin ---------------> |
     |<-- read() <---------------- |<-- stdout (ANSI) -------- |
     |                              |                          |
     |  send terminal_out to phone  |   Tab pressed → complete  |
```

### Platform Difference

| Platform | Library | Internal API |
|----------|---------|-------------|
| Windows | `pywinpty` | Windows ConPTY (introduced Win10 1903) |
| Linux/macOS | `ptyprocess` | POSIX `openpty()` system call |

**Windows ConPTY** is Microsoft's answer to the POSIX PTY — introduced in Windows Terminal. `pywinpty` wraps this API, letting us spawn PowerShell inside a real PTY on Windows.

---

## 7. DATA FLOW — END TO END (Touchpad Example)

```
[Phone screen] User drags finger
       ↓
[touchpad.js] pointerdown event captured
       ↓
[touchpad.js] Raw dx/dy calculated (clientX - prevX)
       ↓
[touchpad.js] Dead-zone filter: if |dx| < 2px → ignore (kills sensor noise)
       ↓
[touchpad.js] EMA smoothing: emaDx = emaDx*0.4 + rawDx*0.6
       ↓
[touchpad.js] Sensitivity multiplier: dx *= 1.5
       ↓
[touchpad.js] Accumulate into _accDx, schedule requestAnimationFrame
       ↓
[rAF at 60fps] _flushNow() called — send ONE message per frame
       ↓
[WebSocket] JSON: {"type":"mouse_move","dx":7,"dy":-3}
       ↓  (travels over WiFi LAN ~1-5ms)
[server.py] _dispatch() receives message
       ↓
[server.py] loop.run_in_executor(_move_executor, handle_mouse_move, 7, -3)
            ↑ Why executor? SendInput() is a blocking Win32 syscall.
              Running it in asyncio directly would stall the event loop.
              Single-worker executor keeps move calls ORDERED (no race).
       ↓
[mouse.py] _send_mouse(MOUSE_MOVE, dx=7, dy=-3)
       ↓
[Win32 SendInput()] OS moves the cursor by (7, -3) pixels
       ↓
[PC screen] Cursor moves
```

**Total round-trip target: <20ms on LAN WiFi**

---

## 8. DATA FLOW — TERMINAL (The Killer Feature)

```
[Phone] User types "ls" + Enter in xterm.js
       ↓
[terminal.js] xterm.onData callback fires
       ↓
[terminal.js] PocketDeck.send({"type":"terminal_in","data":"ls\r"})
       ↓
[WebSocket → server.py] _dispatch() routes to terminal handler
       ↓
[server.py] _ensure_terminal_session(ws).write("ls\r")
       ↓
[terminal.py] TerminalSession.write() → self.pty.write("ls\r")
       ↓
[PTY master] bytes written to PowerShell's stdin
       ↓
[PowerShell] executes "ls", generates ANSI-colored output
       ↓
[PTY master] read() returns ANSI bytes (e.g., "\x1b[32mfile.py\x1b[0m\r\n")
       ↓
[terminal.py] _read_loop_windows() running as asyncio.Task
              → await ws.send({"type":"terminal_out","data":"<ANSI bytes>"})
       ↓
[WebSocket → phone]
       ↓
[terminal.js] TerminalPanel.write(data) → xterm.write(data)
       ↓
[xterm.js] Renders colored output with full ANSI support
       ↓
[Phone screen] User sees: "file.py  README.md  server/" in green
```

**The TAB autocomplete flow** (the hard part that other tools miss):
```
User presses TAB key in xterm.js
→ xterm.onData fires with "\x09" (ASCII 9 = TAB)
→ terminal_in {"data":"\x09"} sent to server
→ PTY.write("\x09") → PowerShell receives TAB character
→ PowerShell's readline handler processes TAB → runs completion
→ Completion result written to PTY stdout
→ terminal_out streams back to phone
→ xterm.js displays the completed text
```

This works because the shell is running in a **real PTY** — it receives the actual TAB byte just like a physical keyboard would send it.

---

## 9. AUTHENTICATION FLOW

```
Server starts → generates TOKEN (currently hardcoded "123456", PRD says random 6-char)
             → prints QR code pointing to http://[IP]:8766
             → starts HTTP server on 8766 (serves client/ PWA files)
             → starts WebSocket server on 8765

Phone scans QR → browser opens http://192.168.1.x:8766
               → downloads index.html + app.js + style.css + panel JS
               → app.js boot() reads hostname from window.location
               → auto-connects to ws://192.168.1.x:8765

WebSocket opens → phone immediately sends {"type":"auth","token":"123456"}
               → server has 3-second timeout — if auth not received → drops connection
               → validate_token() uses secrets.compare_digest() (constant-time, timing-attack safe)
               → sends {"type":"auth_ok"}
               → sends {"type":"server_info","os":"windows","hostname":"MyPC"}
               → sends {"type":"widget_list","widgets":[...]}

Full control now active.
```

**Why QR on port 8766 but WebSocket on 8765?**
The QR encodes the HTTP URL. The PWA loads from HTTP, then auto-connects WebSocket to the same IP on port 8765. This means one scan → app loaded AND server address configured. No manual IP typing needed.

---

## 10. THE ASYNCIO ARCHITECTURE (Why single-process, no threading for core logic)

### What is asyncio?

Python's `asyncio` is an **event loop** — a single thread that handles many concurrent operations by switching between them whenever one is waiting (for network I/O, timers, etc.).

```
Traditional threading approach:
  Thread 1: handle WebSocket client A
  Thread 2: handle WebSocket client B  
  Thread 3: read PTY output
  Thread 4: serve HTTP
  → Race conditions, lock complexity

asyncio approach:
  Single thread, event loop:
  - WebSocket message arrives → handle it → yield back
  - PTY has data → read it → send to phone → yield back  
  - HTTP request → serve file → yield back
  → No race conditions (only one thing runs at a time)
  → Context switches are cooperative, not OS-preempted
```

### Why Executors for Mouse/Keyboard?

`pynput` and `SendInput()` are **blocking syscalls** — they call into the OS and may take 1-5ms. If called directly in the asyncio event loop:
- The loop **freezes** for that 1-5ms
- During that freeze, no other messages are processed
- Terminal output stops, WebSocket pings fail

Solution: `loop.run_in_executor()` — runs the blocking call in a thread pool, returns a coroutine that the event loop can await without blocking.

```python
# This would BLOCK the event loop:
handle_mouse_move(dx, dy)  # BAD

# This runs in thread pool, event loop continues:
loop.run_in_executor(_move_executor, handle_mouse_move, dx, dy)  # GOOD
```

**Two separate executors:**
- `_move_executor` (1 worker): mouse_move ONLY — single-threaded to keep moves ordered
- `_input_executor` (2 workers): clicks, keyboard, scroll — can run concurrently

Why single-worker for moves? With multiple workers, concurrent `SendInput(MOUSE_MOVE)` calls race inside Windows and arrive OUT OF ORDER → cursor jitter.

---

## 11. THE TOUCHPAD — SIGNAL PROCESSING PIPELINE

The touchpad is more complex than it looks. Raw pointer events from mobile browsers are noisy and high-frequency. Here's the full pipeline:

### Step 1: Dead-Zone Filter
```javascript
const deadDx = Math.abs(rawDx) < 2.0 ? 0 : rawDx;
```
Ignore micro-movements below 2px. Kills sensor noise and involuntary finger tremor.

### Step 2: EMA (Exponential Moving Average) Smoothing
```javascript
_emaDx = _emaDx * (1 - 0.6) + deadDx * 0.6;
// = 40% previous + 60% new
```
A **low-pass filter** — smooths jitter while preserving fast intentional movements. Lower alpha = more smooth but more lag. 0.6 is the tuned sweet spot.

### Step 3: Sensitivity Multiplier
```javascript
result.dx = _emaDx * CFG.sensitivity;  // default 1.5×
```
Applied AFTER smoothing to avoid amplifying jitter.

### Step 4: Sub-pixel Accumulation
```javascript
_accDx += filteredDx;
// later in rAF:
sendDx = Math.floor(_accDx);
_accDx -= sendDx;  // keep remainder
```
Sub-pixel precision — slow drags accumulate fractional pixels until they add up to 1.

### Step 5: requestAnimationFrame Batching
```javascript
function _scheduleFlush() {
  if (_rafId === null) _rafId = requestAnimationFrame(_flushNow);
}
```
Mobile touchscreens fire `pointermove` at up to 120Hz. Sending a WebSocket message per event would flood the network with 120 messages/second. rAF collapses ALL moves in a 16.67ms frame into **one message**. Smooth cursor, minimal bandwidth.

### Gesture System
| Gesture | Action sent to PC |
|---------|------------------|
| 1-finger drag | `mouse_move` |
| 1-finger tap | `mouse_click left` |
| 2-finger drag | `mouse_scroll` |
| 2-finger tap | `mouse_click right` |
| 3-finger swipe ↓ | `key_tap win+d` (show desktop) |
| 3-finger swipe → | `key_tap alt+tab` (switch apps) |
| 4-finger swipe | Virtual desktop switch |

---

## 12. WIDGET SYSTEM — YAML-DRIVEN AUTOMATION

### How It Works

`widgets.yaml` defines macro buttons. On server startup, it's parsed once. On client connection, the full widget list is sent. On phone tap, `widget_run` message is sent, server executes the action sequence.

```yaml
- id: start-dev-environment
  label: "Dev Server"
  icon: "🚀"
  color: "#8b5cf6"
  actions:
    - type: browser
      url: "https://chatgpt.com"
    - type: browser  
      url: "https://claude.ai"
    - type: delay
      ms: 800
    - type: launch
      app: "code"
      args: ["."]
    - type: shell
      command: "start powershell"
```

### Action Types

| Type | What happens on PC |
|------|-------------------|
| `terminal` | Writes command to active PTY shell |
| `launch` | `subprocess.Popen(app, shell=True)` |
| `shell` | Raw shell command string |
| `keypress` | Calls `handle_key_tap()` via pynput |
| `browser` | `webbrowser.open_new_tab(url)` |
| `lock` | `ctypes.windll.user32.LockWorkStation()` |
| `delay` | `await asyncio.sleep(ms/1000)` |

### Why `asyncio.create_task()` for widgets?

```python
elif t == "widget_run":
    asyncio.create_task(run_widget(msg.get("id"), active_terminals, ws))
```

Widget execution is `async` (it uses `await asyncio.sleep()` for delays). It can't block the main message dispatch loop — a widget with a 5-second delay would freeze all other input. `create_task()` runs it as a background coroutine.

---

## 13. KEYBOARD HANDLER — KEY MAPPING AND MODIFIERS

### Protocol → pynput Mapping
```python
_KEY_MAP = {
    "ctrl": Key.ctrl,
    "alt": Key.alt,
    "win": Key.cmd,      # pynput calls Win/Cmd the same
    "tab": Key.tab,
    "f1": Key.f1,
    # ... all keys
}
```

### Sticky Modifier State Machine (Client-Side)
```
User taps [Ctrl] → _mods.ctrl = true → button highlights
User taps [C]    → combo = ["ctrl", "c"] → sends key_tap "ctrl+c"
                 → _mods reset to all false
```

### Server-Side Execution
```python
def handle_key_tap(key_combo: str):
    parts = key_combo.split("+")   # ["ctrl", "c"]
    keys = [_resolve_key(p) for p in parts]
    modifiers = keys[:-1]          # [Key.ctrl]
    final = keys[-1]               # "c"
    
    for mod in modifiers:
        _kb.press(mod)             # hold Ctrl
    _kb.tap(final)                 # tap C
    for mod in reversed(modifiers):
        _kb.release(mod)           # release Ctrl
```

This produces an **actual Ctrl+C keypress** at the OS level — identical to pressing the physical keys.

---

## 14. RECONNECT LOGIC — EXPONENTIAL BACKOFF

```javascript
const BACKOFF_INIT = 500;   // start at 500ms
const BACKOFF_MAX  = 10000; // cap at 10 seconds

function _onClose(event) {
    if (event.code === 4003) {
        // Bad token — don't retry (wrong password)
        _showConnectScreen();
        return;
    }
    
    const delay = _backoff;
    _backoff = Math.min(_backoff * 2, BACKOFF_MAX);
    // 500ms → 1s → 2s → 4s → 8s → 10s → 10s → ...
    
    setTimeout(() => connect(_host, _token), delay);
}
```

**iOS-specific fix:** iOS Safari suspends JavaScript when the screen turns off. `visibilitychange` listener fires when screen is unlocked — immediately reconnects instead of waiting for next backoff timer.

```javascript
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !_wsReady) {
        connect(_host, _token);
    }
});
```

---

## 15. PACKAGING — FROM PYTHON SCRIPT TO .EXE

PocketDeck ships as a standalone `.exe` using **PyInstaller**.

### What PyInstaller Does
Bundles Python interpreter + all dependencies + your code into a single executable. When run, it extracts to a temp directory (`sys._MEIPASS`) and executes.

### The `PocketDeck.spec` File
```
Analysis(['server/server.py'], ...)
  datas=[('client', 'client'), ('server/widgets.yaml', 'server'), ('app.ico', '.')]
```
Tells PyInstaller: include the `client/` folder, `widgets.yaml`, and the icon inside the exe.

### Windows Tray Mode
When running as a frozen exe, the server runs in a **system tray icon** (using `pystray`):
- No terminal window visible
- Right-click tray → "Show QR Code" → opens browser with QR
- Right-click → "Exit"

```python
if os.name == "nt" and getattr(sys, "frozen", False):
    server_thread = threading.Thread(target=lambda: asyncio.run(main()), daemon=True)
    server_thread.start()
    _run_windows_tray()  # blocks main thread with tray icon
```

---

## 16. SECURITY MODEL

- **Auth token**: printed at server start, must be provided within 3 seconds
- **Constant-time comparison**: `secrets.compare_digest()` prevents timing attacks
- **LAN-only binding**: server binds to `0.0.0.0` but only reachable on local network
- **No TLS**: deliberate — LAN tool, generating certs adds friction. Token alone is sufficient since an attacker must already be on your WiFi.
- **No sandboxing for widgets**: user defines their own widgets — this is a local power-user tool

---

## 17. FILE STRUCTURE TOUR

```
quickcon/
├── server/
│   ├── server.py           ← Main entry: asyncio event loop, WS + HTTP servers
│   ├── handlers/
│   │   ├── mouse.py        ← Win32 SendInput + pynput fallback
│   │   ├── keyboard.py     ← pynput key mapping, combo execution
│   │   ├── terminal.py     ← TerminalSession: PTY spawn + read loop + write
│   │   ├── widgets.py      ← YAML parser + action executor
│   │   └── media.py        ← Media key handling (play/pause/volume)
│   ├── utils/
│   │   ├── auth.py         ← Token generation + constant-time validation
│   │   ├── network.py      ← Local IP detection (hostname + UDP trick)
│   │   └── qr.py           ← ASCII QR code generation + startup banner
│   └── widgets.yaml        ← User-editable macro definitions
│
├── client/                 ← Served over HTTP:8766 (the PWA)
│   ├── index.html          ← Shell: loads all JS, defines panel DOM
│   ├── app.js              ← WS client, reconnect logic, panel router
│   ├── style.css           ← Dark UI, panel layouts, animations
│   ├── manifest.json       ← PWA manifest (installable on home screen)
│   └── panels/
│       ├── touchpad.js     ← Pointer events, EMA, rAF batching, gestures
│       ├── terminal.js     ← xterm.js integration
│       ├── widgets.js      ← Widget grid rendering
│       └── media.js        ← Media control buttons
│
├── PocketDeck.spec         ← PyInstaller packaging config
├── build.bat               ← One-click build script
└── start.ps1               ← Dev launch script (activates venv)
```

---

## 18. KEY TECHNICAL DECISIONS AND RATIONALE (From PRD Section 12)

| Decision | Rationale |
|----------|-----------|
| **No React** | No state complexity justifies it. Faster load, easier mobile debug, smaller payload |
| **ptyprocess over subprocess** | subprocess.PIPE doesn't create a TTY → shells disable readline + autocomplete |
| **Delta batching via rAF** | 120Hz pointer events → one WS message per 16ms frame → smooth + low bandwidth |
| **Single Python process, pure asyncio** | Threading adds race conditions. asyncio handles WS + PTY + HTTP cleanly in one thread |
| **Shared secret over TLS** | LAN tool. TLS cert generation adds friction. Token = sufficient for local threat model |
| **QR → HTTP:8766, WS:8765** | One scan loads app AND configures WS host. No manual IP entry |
| **Win32 SendInput vs pynput on Windows** | SendInput respects Windows Pointer Acceleration (mouse feel). pynput bypasses it |

---

## 19. DEVELOPMENT PHASES (How we built it)

| Phase | Goal | Key Work |
|-------|------|---------|
| **1** | QR → scan → mouse working | Server skeleton, IP detection, QR, auth, mouse handler, touchpad JS |
| **2** | Full keyboard | keyboard.py pynput mapping, QWERTY layout, sticky modifiers |
| **3** | Basic terminal | PTY spawn, read loop, terminal_out streaming, xterm.js |
| **4** | Live PTY | TAB, Ctrl+C, arrow keys, vim, python REPL all working |
| **5** | Widgets | YAML parser, action executor, widget grid UI |
| **6** | Media + polish | Media keys, tray icon, reconnect, packaging to .exe |

---

## 20. FROM CODE TO GITHUB — THE FULL WORKFLOW

1. **Dev environment**: Python venv at `.venv/`, activated via `start.ps1`
2. **Run locally**: `python server/server.py` — starts both HTTP:8766 and WS:8765
3. **Build exe**: `build.bat` → runs PyInstaller → outputs `dist/PocketDeck.exe`
4. **Version control**: `.gitignore` excludes `.venv/`, `__pycache__/`, `dist/`, `build/`
5. **GitHub**: repo at `nikhil2004-blip/quickon` — pushed with standard git workflow
6. **Releases**: `PocketDeck.exe` published as GitHub Release asset for direct download

```bash
git add .
git commit -m "feat: add drag lock and multi-finger gestures"
git push origin main
# → GitHub Actions / manual release upload
```

---

## 21. WHAT MAKES THIS IMPRESSIVE TECHNICALLY

1. **Real PTY on Windows** — Most devs don't know about ConPTY. Getting `vim` to work on a phone browser over WebSocket is genuinely non-trivial.

2. **Sub-20ms mouse latency** — The signal processing pipeline (dead zone → EMA → rAF batching → single-worker executor) is carefully engineered to feel like a real trackpad.

3. **Pure asyncio, no threads for I/O** — A single Python process correctly handles concurrent WebSocket messages, PTY output streaming, and HTTP file serving without any threading.

4. **Zero mobile install** — The QR → HTTP → WebSocket flow means the phone needs no app. It works in Safari, Chrome, any browser.

5. **YAML-driven automation** — The widget system is a mini-automation engine: multi-step action sequences with delays, app launches, terminal commands, and browser opens, all user-configurable without touching code.

6. **Win32 SendInput** — Instead of pynput's cross-platform abstraction, Windows uses the native `SendInput()` syscall directly via ctypes. This preserves Windows Pointer Acceleration exactly like a physical trackpad, giving a natural mouse feel.

---
