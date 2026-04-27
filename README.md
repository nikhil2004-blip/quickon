<div align="center">
  <h1>📱 PocketDeck</h1>
  <p><strong>Your PC, in your pocket.</strong></p>
  <p>A zero-latency, local-network mobile companion app that turns your phone into a premium touchpad, keyboard, and widget controller for your PC.</p>
</div>

---

## ⚡ Features

- **Zero-Latency Touchpad:** Hardware-accelerated finger tracking with a minimalist, premium dark mode.
- **Full Laptop Emulation:** Drag-to-move, tap-to-click, two-finger scroll, and Windows multi-finger gesture support.
- **Native Keyboard:** Send keystrokes, shortcuts (Ctrl+C, Alt+Tab), and type directly from your phone's native keyboard.
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
2. A terminal window will open and display a large QR code.

### Step 3: Connect Your Phone
1. Ensure your phone and your PC are connected to the **same Wi-Fi network**.
2. Open your phone's Camera app and **scan the QR code** shown on your PC screen.
3. Tap the link that appears. The PocketDeck web app will load in your browser.
4. You are now controlling your PC! 

*(Pro tip: You can "Add to Home Screen" from your mobile browser's menu to launch PocketDeck in full-screen mode like a native app!)*

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
5. Scan the QR code with your phone to connect!

---

## 📦 How to Build the EXE

Want to package your modified code into a standalone `.exe` to share with friends or publish a new release?

Simply run the included build script from the project root:
```bash
build.bat
```
This will automatically:
1. Install PyInstaller.
2. Package the `server.py` and the entire `client/` folder into a single executable.
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
