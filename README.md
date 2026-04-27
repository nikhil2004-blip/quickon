<div align="center">
   <img src="assets/logo.png" alt="PocketDeck" width="128" style="border-radius: 24px; margin-bottom: 14px;" />

   <h1>📱 PocketDeck</h1>
   <p><strong>Your PC, in your pocket.</strong></p>
   <p>A background-first, local-network mobile companion that turns your phone into a touchpad, keyboard, terminal, media remote, and widget controller for Windows.</p>

   <p>
      <a href="https://github.com/nikhil2004-blip/quickon/releases">
         <img src="https://img.shields.io/github/v/release/nikhil2004-blip/quickon?label=release" alt="GitHub release" />
      </a>
      <a href="https://github.com/nikhil2004-blip/quickon/blob/main/README.md">
         <img src="https://img.shields.io/badge/platform-Windows%20%7C%20Android%20%7C%20iPhone-blue" alt="Platform badge" />
      </a>
      <img src="https://img.shields.io/badge/backend-Python%20%7C%20asyncio%20%7C%20WebSockets-3776AB" alt="Backend badge" />
      <img src="https://img.shields.io/badge/frontend-Vanilla%20HTML%20%7C%20CSS%20%7C%20JS-222222" alt="Frontend badge" />
      <img src="https://img.shields.io/badge/license-Unlicensed%20%2F%20not%20specified-lightgrey" alt="License status" />
   </p>
</div>

---

## What PocketDeck Is

PocketDeck lets you control your PC from your phone over your local Wi-Fi. It is designed to feel lightweight, fast, and invisible once running:

- No cloud account
- No internet relay
- No mobile app installation required
- No terminal window in the release build
- Tray-based background mode on Windows

The app exposes:

- A responsive touchpad
- A native keyboard sheet
- A terminal panel
- Media controls
- Widgets/launch actions

---

## Product Tags

`touchpad` `keyboard` `terminal` `tray app` `Windows` `local network` `QR pairing` `background mode` `low latency` `WebSockets` `PWA`

---

## Visual Identity

PocketDeck uses a compact, high-contrast product identity:

- Primary background: `#0f0f13`
- Surface background: dark slate / graphite tones
- Accent feel: clean blue highlights
- Text: bright neutral white for readability
- Product icon: [app.ico](app.ico)

### Brand Assets

- App icon: [app.ico](app.ico)
- Logo image: [assets/logo.png](assets/logo.png)

If you want to swap in a new product banner or screenshots later, place them in `assets/` and update the image links below.

---

## Feature Highlights

### Touchpad

- One-finger drag for cursor movement
- Tap for left click
- Two-finger scroll
- Drag lock for screenshot selection / click-drag workflows
- Smoothing and jitter suppression
- Startup burst filtering for Android/mobile touch noise

### Keyboard

- QWERTY sheet with modifiers
- Ctrl/Alt/Shift/Win combinations
- Direct character entry
- Quick access from the touchpad panel

### Terminal

- Remote PowerShell session in the terminal panel
- Resize-aware terminal view
- Lazy-started only when you actually use terminal mode

### Widgets and Media

- Widget list from `widgets.yaml`
- Launch external apps and shortcuts
- Media controls for play/pause, next, previous, volume

### Background Tray Mode

- Windows system tray icon
- No visible terminal window in release builds
- Tray actions:
   - Show QR Code
   - Show Connection Info
   - Exit PocketDeck

---

## Quick Start for Users

This is the simplest way to use PocketDeck from a GitHub Release.

### Step 1: Download

1. Open the [Releases page](https://github.com/nikhil2004-blip/quickon/releases).
2. Download the latest `PocketDeck.exe`.

### Step 2: Launch on Your PC

1. Double-click `PocketDeck.exe`.
2. Allow Windows Firewall access if prompted so your phone can reach your PC on the local network.
3. PocketDeck starts quietly in the background and appears in the Windows tray.

### Step 3: Open the QR Menu

1. Right-click the PocketDeck tray icon.
2. Click **Show QR Code**.

### Step 4: Scan and Connect

1. Make sure your phone and PC are on the same Wi-Fi network.
2. Scan the QR code from the tray menu.
3. Open the link on your phone.
4. Start controlling your PC.

### Visual Flow

<div align="center">
   <img src="assets/logo.png" alt="PocketDeck visual" width="180" />
</div>

1. Launch the app.
2. Find it in the tray.
3. Open `Show QR Code`.
4. Scan from your phone.
5. Use the touchpad, keyboard, terminal, widgets, and media controls.

> Tip: If you want a full-screen mobile shortcut, use your browser’s **Add to Home Screen** option after opening the web app.

---

## Tray Menu

The tray menu is the preferred entry point for release builds.

- **Show QR Code**: Opens a QR page for quick pairing.
- **Show Connection Info**: Shows the URL and auth token.
- **Exit PocketDeck**: Closes the background server.

This lets PocketDeck behave like a real background utility instead of a visible terminal app.

---

## Developer Setup

If you want to modify the project locally:

### Requirements

- Python 3.10+
- Windows 10/11 for full input support
- Phone and PC on the same local network

### Install and Run

```bash
git clone https://github.com/nikhil2004-blip/quickon.git
cd quickon
python -m venv .venv
.\.venv\Scripts\activate
pip install -r server/requirements.txt
python server/server.py
```

### Source Behavior Notes

- Release builds run in tray/background mode on Windows.
- The terminal panel is started lazily when needed.
- Touchpad and keyboard features are always available from the browser UI.

---

## Build the Release EXE

PocketDeck is packaged with PyInstaller.

### Build Command

```bash
pyinstaller --noconfirm --onefile --noconsole --add-data "client;client" --add-data "server;server" --add-data "app.ico;." --icon app.ico --name PocketDeck server/server.py
```

### Build Script

Or just run:

```bash
build.bat
```

That script will:

1. Install required Python packages.
2. Install PyInstaller.
3. Package the server, client, and icon into a single background executable.

---

## Release Publishing Checklist

When you publish a new GitHub Release:

1. Run the build command or `build.bat`.
2. Confirm `dist\PocketDeck.exe` exists.
3. Upload the executable to GitHub Releases.
4. Add a short summary of what changed.
5. Mention any breaking changes or new tray behavior.

Suggested release notes:

- Background tray mode added
- QR pairing moved into tray menu
- No terminal window shown in release builds
- `app.ico` used for app branding and launcher icon

---

## How It Works

### Architecture

- **Backend:** Python `asyncio` + `websockets` + input automation via `pynput` / Windows APIs
- **Frontend:** Vanilla HTML, CSS, and JavaScript
- **Transport:** WebSockets over local network
- **Pairing:** QR code with local URL + auth token

### Runtime Flow

1. Start PocketDeck.exe.
2. The server comes up in the background.
3. The tray icon becomes available.
4. Open `Show QR Code`.
5. Scan the QR from your phone.
6. Authenticate and start controlling the PC.

---

## Security and Privacy

PocketDeck is designed for local use.

- No cloud relay server
- No account sign-in
- Token-based pairing
- LAN-only communication
- The connection only works when devices are on the same network

Important note:

- Windows Firewall may still prompt on the first launch of a new network-facing exe.
- That prompt is controlled by Windows, not the app.

---

## Troubleshooting

### I don’t see the tray icon

- Check the hidden tray icons area near the clock.
- If the app was just launched, wait a moment for startup.
- Confirm you used the new release build, not an older exe.

### The QR page does not open

- Use `Show Connection Info` and manually open the URL on your phone.
- Make sure the PC and phone are on the same Wi-Fi.

### My phone can’t connect

- Verify the firewall allowed access.
- Confirm the token matches.
- Make sure the phone is scanning the QR from the tray menu of the current running app.

### Touchpad feels late at the start

- The app uses startup smoothing and burst suppression.
- If needed, you can fine-tune the touchpad inhibit in `client/app.js`.

---

## File Map

- [server/server.py](server/server.py): main server, tray mode, QR actions, WebSocket loop
- [server/handlers/terminal.py](server/handlers/terminal.py): terminal session handling
- [server/handlers/mouse.py](server/handlers/mouse.py): cursor, click, scroll, drag input handling
- [client/app.js](client/app.js): routing, connect flow, panel switching
- [client/panels/touchpad.js](client/panels/touchpad.js): touchpad gestures and drag logic
- [client/panels/terminal.js](client/panels/terminal.js): xterm integration
- [client/manifest.json](client/manifest.json): web app metadata
- [PocketDeck.spec](PocketDeck.spec): PyInstaller spec
- [build.bat](build.bat): packaging script

---

## License

No license file is currently included in this repository.

If you want to publish PocketDeck publicly, add a license file such as:

- MIT
- Apache 2.0
- GPL-3.0

Until then, the repository should be treated as all rights reserved by default.

---

## Acknowledgments

- Built with Python, WebSockets, and a lightweight browser UI.
- QR pairing and tray behavior are optimized for a smooth release-user experience.

---

## ⚡ Features

- **Zero-Latency Touchpad:** Hardware-accelerated finger tracking with a minimalist, premium dark mode.
- **Full Laptop Emulation:** Drag-to-move, tap-to-click, two-finger scroll, and Windows multi-finger gesture support.
- **Native Keyboard:** Send keystrokes, shortcuts (Ctrl+C, Alt+Tab), and type directly from your phone's native keyboard.
- **Background Tray Mode:** Runs silently in the Windows system tray after connect. No terminal window stays open.
- **One-Click QR Access:** Right-click the tray icon and choose **Show QR Code** whenever you need to reconnect.
- **Secure & Private:** Works entirely over your local Wi-Fi. No cloud, no tracking, sub-20ms latency.
- **Standalone:** No app installation required on your phone. Just scan a QR code!

---

## 🚀 How to Use (For Regular Users)

You do **not** need to install Python or understand code to use PocketDeck!

### Step 1: Download the App
1. Go to the [Releases page](https://github.com/nikhil2004-blip/quickon/releases) of this repository.
2. Under the latest release, download the `PocketDeck.exe` file.

### Step 2: Run on Your PC
1. Double-click the downloaded `PocketDeck.exe` file.
   - *Note: If Windows SmartScreen shows a "Windows protected your PC" warning, click **More info** -> **Run anyway**. This happens because the app is new and not yet digitally signed by a paid publisher.*
   - *Note: If Windows Firewall asks for permission, click **Allow access** so your phone can connect to your PC over the local network.*
2. PocketDeck will start in the background and place itself in the Windows system tray.
3. Right-click the PocketDeck tray icon and choose **Show QR Code**.

   <p align="center">
     <img src="assets/logo.png" alt="PocketDeck tray icon" width="96" />
   </p>

### Step 3: Connect Your Phone
1. Ensure your phone and your PC are connected to the **same Wi-Fi network**.
2. Open your phone's Camera app and **scan the QR code** shown from the tray menu.
3. Tap the link that appears. The PocketDeck web app will load in your browser.
4. You are now controlling your PC!

*(Pro tip: You can "Add to Home Screen" from your mobile browser's menu to launch PocketDeck in full-screen mode like a native app!)*

### Tray Menu

The tray icon gives you quick access without opening a terminal:

![PocketDeck tray mode](assets/logo.png)

- **Show QR Code**: opens a QR page you can scan from your phone.
- **Show Connection Info**: shows the current URL and auth token.
- **Exit PocketDeck**: closes the background server.

---

## 💻 How to Run from Source (For Developers)

If you want to modify the code or run it directly from Python:

### Prerequisites
- Python 3.10 or newer
- Windows OS (Required for `pynput` and `ctypes` low-level input control)
- Both phone and PC on the same local network

### Setup & Run
1. **Clone the repository**:
   ```bash
   git clone https://github.com/nikhil2004-blip/quickon.git
   cd quickon
   ```
2. **Create and activate a virtual environment**:
   ```bash
   python -m venv .venv
   .\.venv\Scripts\activate
   ```
3. **Install dependencies**:
   ```bash
   pip install -r requirements.txt
   ```
4. **Run the server**:
   ```bash
   python server/server.py
   ```
5. On Windows release builds, the app can run from the tray and show the QR code from the tray menu.

---

## 📦 How to Build the EXE

Want to package your modified code into a standalone `.exe` to share with friends or publish a new release?

Simply run the included build script from the project root:
```bash
build.bat
```
This will automatically:
1. Install PyInstaller.
2. Package the `server.py`, the entire `client/` folder, and `app.ico` into a single background executable.
3. Output the final file to `dist\PocketDeck.exe`.

### 🌍 How to Publish a Release
If you want to share your updated `.exe` with the public:
1. Run `build.bat` to generate the latest `dist\PocketDeck.exe`.
2. Go to your repository on GitHub.
3. Click on **Releases** on the right sidebar, then click **Draft a new release**.
4. Choose a tag (e.g., `v1.0.0`), add a title and description of what's new.
5. Drag and drop the `dist\PocketDeck.exe` file into the "Attach binaries" section.
6. Click **Publish release**.

---

## 🛠️ Architecture

- **Backend:** Python (`asyncio`, `websockets`, `pynput`). Uses a split thread-pool architecture (1 worker for mouse movement, 2 for other inputs) to ensure perfect serialization of Windows API calls and eliminate cursor jitter.
- **Frontend:** Vanilla HTML/CSS/JS. No heavy frameworks. Uses `requestAnimationFrame` for buttery smooth 60fps gesture tracking and battery efficiency.
- **Communication:** Sub-protocol WebSockets with a short-lived, randomly generated Auth Token to secure the connection against unauthorized local network access.
