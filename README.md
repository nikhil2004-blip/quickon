<div align="center">
  <img src="assets/logo.png" alt="PocketDeck Logo" width="160" style="border-radius: 32px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); margin-bottom: 20px;" />

  <h1>📱 PocketDeck</h1>
  <p><b>Because getting out of your chair to pause a video is just too much work.</b></p>

  [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)
  [![Made with Python](https://img.shields.io/badge/Python-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://www.python.org/)
</div>

<br />

PocketDeck turns your phone into a remote control for your PC. It works entirely over your local network, meaning no sketchy cloud accounts, no random internet relays, and no need to download yet another bloated app from the App Store. Just scan a QR code and you're in.

---

## ✨ Why should you care?

- 🚀 **Touchpad that actually works:** No weird lag. Just a smooth, dark UI so your eyes don't bleed at 2 AM.
- ⌨️ **A real keyboard:** Yes, it has `Ctrl`, `Alt`, `Shift`, `Win`, and `Tab`. So you can finally `Alt+Tab` from your bed.
- 💻 **Terminal in your pocket:** A proper PTY session (PowerShell/CMD) streamed right to your phone. It supports colors, `vim` (if you know how to exit it), and autocomplete.
- ⚡ **Automations:** Too lazy to type? Launch apps and run scripts using a simple `widgets.yaml` file.
- 🎵 **Media Control:** Because playing/pausing Spotify shouldn't require touching your mouse.
- 🛡️ **Privacy:** Everything stays on your local network. I don't want your data anyway.

---

## 📥 Quick Start

PocketDeck hides in the background until you need it. Because nobody wants another random window cluttering their screen.

### 1. Download & Run
Just download the `.exe` file directly (no annoying redirects):

<div align="center">
  <br />
  <a href="https://raw.githubusercontent.com/nikhil2004-blip/quickon/master/dist/PocketDeck.exe">
    <img src="https://img.shields.io/badge/⬇️_Direct_Download-PocketDeck.exe-2ea44f?style=for-the-badge&logo=windows" alt="Download PocketDeck.exe" />
  </a>
  <br /><br />
</div>

Double-click it. Nothing will happen on screen. Don't panic, it's running in the background.

### 2. Connect Your Phone
Since there's no visible window, you have to use the Windows hidden icon tray to actually connect.

1. Click the **up arrow** `^` in your Windows taskbar (you know, where all the background stuff lives).
2. Look for the blue **PocketDeck icon**.
3. Right-click it and hit **"Show QR Code"**.

<p align="center">
  <img src="assets/tray_menu.png" alt="System Tray Menu" width="300" style="border-radius: 8px; border: 1px solid #444; margin-top: 10px;" />
  <br />
  <em>Right-click the icon to reveal the menu. Yes, it's that easy.</em>
</p>

4. Scan the QR code with your phone.
5. It'll open in your browser. Boom, connected.

*(Pro Tip: Tap "Add to Home Screen" on your phone to hide the browser UI and make it look like a real app.)*

---

## ⚙️ Customizing

Want to add your own buttons? Just edit `server/widgets.yaml`. It's pretty straightforward.

```yaml
widgets:
  - id: start-dev-server
    label: "Start Dev Server"
    icon: "🚀"
    actions:
      - type: terminal
        command: "cd ~/projects/myapp && npm run dev\r"
      - type: launch
        app: "code"
        args: ["."]
```

You can run terminal commands, launch apps, or mash keyboard shortcuts with it. 

---

## 🛠️ Build it yourself

Don't trust my `.exe` file? Fair enough. Build it yourself:

```bash
# 1. Clone this thing
git clone https://github.com/nikhil2004-blip/quickon.git
cd quickon

# 2. Setup your virtual environment
python -m venv .venv
.\.venv\Scripts\activate

# 3. Install the stuff it needs
pip install -r server/requirements.txt

# 4. Run it locally
python server/server.py

# 5. Build the executable (dumps it in dist/PocketDeck.exe)
build.bat
```

### SmartScreen warning

If Windows shows "Windows protected your PC", that is SmartScreen flagging an unsigned executable. There is no clean way to remove that screen for downloaded builds unless the `.exe` is code-signed with a trusted certificate and distributed through a trusted channel.

For real distribution, the practical fixes are:

1. Sign `PocketDeck.exe` with an Authenticode certificate before shipping it.
2. Prefer an EV code-signing certificate if you want SmartScreen reputation to build faster.
3. Optionally package and sign an MSI or MSIX installer instead of shipping a raw `.exe`.

For your own PC only, you can use the temporary bypass in the dialog, but that does not remove the warning from the file.

---

## 🏗️ How it works

In case you care about the tech:
- **Backend:** Python. Uses `asyncio`, `websockets`, and `pynput`. It uses a thread pool to avoid cursor jitter, so your mouse doesn't jump around like crazy.
- **Frontend:** Good old Vanilla HTML/CSS/JS. No React bloat. Uses `xterm.js` for the terminal and tracks your fingers at a smooth 60fps.
- **Packaging:** Dumped into an `.exe` using PyInstaller.

---

<div align="center">
  Made so I can control my PC without leaving the couch.
</div>
