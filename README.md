<div align="center">
  <img src="assets/logo.png" alt="PocketDeck Logo" width="160" style="border-radius: 32px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); margin-bottom: 20px;" />
  <h1>PocketDeck</h1>
  <p><b>Control your Windows PC from your phone over local Wi-Fi.</b></p>

  [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)
  [![Made with Python](https://img.shields.io/badge/Python-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://www.python.org/)

  <p>
    <a href="https://github.com/nikhil2004-blip/quickcon/releases/latest/download/PocketDeck.exe">
      <img src="https://img.shields.io/badge/Download-PocketDeck.exe-2ea44f?style=for-the-badge&logo=windows&logoColor=white" alt="Download PocketDeck.exe" />
    </a>
  </p>
</div>

PocketDeck turns your phone browser into a remote control for your PC: touchpad, keyboard, terminal, widgets, and media controls.  
Everything runs on your local network (LAN), no cloud relay.

---

## Features

- Touchpad with gestures and smooth cursor control (`ph ph-hand-swipe-right`)
- On-screen keyboard with modifier keys (`Ctrl`, `Alt`, `Shift`, `Win`) (`ph ph-keyboard`)
- Terminal streaming from your Windows machine (`ph ph-terminal-window`)
- Widget automation via `server/widgets.yaml` (`ph ph-rocket-launch`)
- Media controls (`ph ph-music-notes`)

---

## Requirements (Windows only)

- Windows 10 or Windows 11
- Phone + PC must be connected to the **same Wi-Fi network**
- Python 3.10+ only if you want to run from source

> If phone and PC are on different networks (or VPN-isolated), connection will fail.

---

## Quick Start (Using `.exe`)

### 1) Download and run

Download `PocketDeck.exe`, then double-click it.

The app runs in the background (system tray), so no main window appears.

### 2) Open QR from tray

1. Click the `^` hidden icons arrow in Windows taskbar
2. Right-click the PocketDeck tray icon
3. Click **Show QR Code**

<p align="center">
  <img src="assets/tray_menu.png" alt="System Tray Menu" width="300" style="border-radius: 8px; border: 1px solid #444; margin-top: 10px;" />
</p>

### 3) Connect from phone

1. Scan the QR code
2. Open the URL on your phone
3. Enter token if prompted
4. Start controlling your PC

Tip: Add the page to home screen for app-like usage.

---

## Run From Source (Windows)

```powershell
git clone https://github.com/nikhil2004-blip/quickcon.git
cd quickcon

python -m venv .venv
.\.venv\Scripts\Activate.ps1

pip install -r server/requirements.txt
python server/server.py
```

---

## Build `.exe` (Windows / PyInstaller)

```powershell
pyinstaller --noconfirm --onefile --noconsole --add-data "client;client" --add-data "server;server" --add-data "app.ico;." --icon app.ico --name PocketDeck server/server.py
```

Output: `dist/PocketDeck.exe`

---

## Widget Customization

Edit `server/widgets.yaml` to add your own actions.

Use icon style consistent with this project in the exact format below, for example:

```yaml
widgets:
  - id: open-terminal
    label: "Terminal"
    icon: "<i class='ph ph-terminal-window'></i>"
    color: "#0ea5e9"
    actions:
      - type: shell
        command: "start wt"
```

---

## SmartScreen Note

If Windows shows **"Windows protected your PC"**, that is expected for unsigned executables.

For distribution:
1. Sign `PocketDeck.exe` with Authenticode
2. Prefer EV certificate for faster SmartScreen reputation
3. Optionally ship signed MSI/MSIX

---

## Tech Stack

- Backend: Python (`asyncio`, `websockets`, input handlers)
- Frontend: Vanilla HTML/CSS/JS + `xterm.js`
- Packaging: PyInstaller
