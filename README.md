<div align="center">
  <img src="assets/logo.png" alt="PocketDeck Logo" width="160" style="border-radius: 32px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); margin-bottom: 20px;" />

  <h1>📱 PocketDeck</h1>
  <p><b>A blazing-fast, background-first mobile companion for your PC.</b></p>

  [![Download PocketDeck.exe](https://img.shields.io/badge/Download-PocketDeck.exe-2ea44f?style=for-the-badge&logo=windows)](dist/PocketDeck.exe)
  [![GitHub Release](https://img.shields.io/github/v/release/nikhil2004-blip/quickon?color=blue&style=for-the-badge)](https://github.com/nikhil2004-blip/quickon/releases)
</div>

<br />

PocketDeck transforms your smartphone into a premium control surface for your computer over your local network. No cloud accounts, no internet relays, and absolutely no mobile app installation required. It just works.

---

## ✨ Features That Matter

- 🚀 **Zero-Latency Touchpad:** Hardware-accelerated finger tracking with jitter suppression and a beautiful dark UI.
- ⌨️ **Native Laptop Emulation:** Full QWERTY keyboard with `Ctrl`, `Alt`, `Shift`, `Win`, and `Tab` modifiers for shortcuts like `Alt+Tab` or `Ctrl+C`.
- 💻 **The "Killer" Terminal:** A real, persistent PTY session (PowerShell/CMD) streamed to your phone with full ANSI colors, interactive command support (`vim`, `htop`), and tab autocomplete.
- ⚡ **Custom Automations:** Launch apps, trigger scripts, or run complex macro sequences via a simple `widgets.yaml` configuration.
- 🎵 **Media Center:** Control playback, volume, and tracks right from the palm of your hand.
- 🛡️ **Secure & Private:** Token-based authentication restricted entirely to your local network.

---

## 📥 Quick Start

PocketDeck is designed to be invisible when you don't need it, and instant when you do. 

### 1. Download & Run
Download the latest executable directly from the repository:
[**Download PocketDeck.exe**](dist/PocketDeck.exe)

Double-click the downloaded file. **PocketDeck runs completely in the background**—you won't see a visible window.

### 2. Connect Your Phone
To connect your phone, you need to open the QR code from the **Hidden Icon Tray** in your Windows taskbar.

1. Click the **up arrow** `^` in your Windows taskbar to show hidden icons.
2. Find the **PocketDeck icon** (the blue icon).
3. Right-click the icon and select **"Show QR Code"**.

<p align="center">
  <img src="assets/tray_menu.png" alt="System Tray Menu" width="450" style="border-radius: 8px; border: 1px solid #444; margin-top: 10px;" />
  <br />
  <em>Right-click the PocketDeck icon in the hidden tray to reveal the menu.</em>
</p>

4. Scan the QR code with your phone's camera.
5. The PocketDeck Web App will open in your mobile browser. **You are now connected!**

*(Pro Tip: Use "Add to Home Screen" on your mobile browser for a full-screen, native-app experience!)*

---

## 🛠️ For Developers (Build from Source)

Want to tweak the code or build the executable yourself?

```bash
# 1. Clone the repository
git clone https://github.com/nikhil2004-blip/quickon.git
cd quickon

# 2. Setup the virtual environment
python -m venv .venv
.\.venv\Scripts\activate

# 3. Install dependencies
pip install -r server/requirements.txt

# 4. Run the development server
python server/server.py

# 5. Build the executable (creates dist/PocketDeck.exe)
build.bat
```

---

## ⚙️ Customizing Your Deck

You can easily add your own buttons to the PocketDeck by modifying the `server/widgets.yaml` file. 

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

Actions support running terminal commands, launching applications, sending keystrokes, and adding delays.

---

## 🏗️ Technical Architecture

PocketDeck achieves its extreme performance through a carefully designed stack:
- **Backend:** Pure Python using `asyncio`, `websockets`, and `pynput`. A split-thread pool architecture perfectly serializes Windows API calls to eliminate cursor jitter.
- **Frontend:** Zero-framework Vanilla HTML/CSS/JS. Powered by `xterm.js` for the terminal and `requestAnimationFrame` for buttery-smooth 60fps gesture tracking.
- **Packaging:** Bundled via PyInstaller into a standalone, zero-dependency executable.

---

<div align="center">
  Built with ❤️ for power users and developers.
</div>
