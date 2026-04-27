"""
qr.py — QR code generation and terminal display
Generates high-contrast (Black on White) QR codes using terminal background colors.
"""

import sys
import qrcode
from qrcode.constants import ERROR_CORRECT_L
import colorama
from colorama import Back, Style

# Initialize colorama to handle ANSI escapes on Windows
colorama.init()

def get_qr_ascii(url: str) -> str:
    """
    Generates a terminal-friendly QR code using background colors.
    This creates solid blocks (Black on White) which are highly scannable.
    """
    qr = qrcode.QRCode(
        version=1,
        error_correction=ERROR_CORRECT_L,
        box_size=1,
        border=2,  # Important quiet zone for scanners
    )
    qr.add_data(url)
    qr.make(fit=True)

    matrix = qr.get_matrix()
    output = ""

    # Each cell in the matrix is 1 module.
    # We use two spaces "  " to make it roughly square in the terminal.
    for row in matrix:
        line = "    " # Left padding
        for cell in row:
            if cell:
                # Black module
                line += Back.BLACK + "  "
            else:
                # White background
                line += Back.WHITE + "  "
        output += line + Style.RESET_ALL + "\n"
    
    return output
def show_qr_image(url: str, token: str) -> None:
    """
    Generates a QR code and displays it in a custom Tkinter window.
    When the window is closed, it gracefully exits the window loop 
    while the background application continues.
    """
    qr = qrcode.QRCode(
        version=1,
        error_correction=ERROR_CORRECT_L,
        box_size=10,
        border=4,
    )
    qr.add_data(url)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")

    try:
        import tkinter as tk
        from PIL import ImageTk
        
        root = tk.Tk()
        root.title("PocketDeck - Scan QR to Connect")
        # Prevent resizing to keep it clean
        root.resizable(False, False)
        
        # Bring window to front
        root.lift()
        root.attributes('-topmost', True)
        root.after_idle(root.attributes, '-topmost', False)

        # Convert PIL image to PhotoImage
        tk_img = ImageTk.PhotoImage(img)

        # Build UI
        lbl_img = tk.Label(root, image=tk_img, bg="white")
        lbl_img.pack(padx=20, pady=(20, 10))

        lbl_token = tk.Label(
            root, 
            text=f"Auth Token: {token}", 
            font=("Consolas", 14, "bold"), 
            bg="white", 
            fg="#333"
        )
        lbl_token.pack(pady=(0, 10))

        lbl_info = tk.Label(
            root, 
            text="Close this window after scanning.\nPocketDeck will continue running in the background tray.",
            font=("Arial", 10), 
            bg="white", 
            fg="#666",
            justify=tk.CENTER
        )
        lbl_info.pack(pady=(0, 20))

        root.configure(bg="white")
        
        # Center window on screen
        root.update_idletasks()
        w = root.winfo_reqwidth()
        h = root.winfo_reqheight()
        ws = root.winfo_screenwidth()
        hs = root.winfo_screenheight()
        x = (ws/2) - (w/2)
        y = (hs/2) - (h/2)
        root.geometry('%dx%d+%d+%d' % (w, h, x, y))

        root.mainloop()
    except Exception as e:
        safe_print(f"Tkinter failed: {e}. Falling back to default image viewer.")
        img.show()


def safe_print(text: str) -> None:
    try:
        if sys.stdout is not None:
            print(text)
    except Exception:
        pass

def print_startup_banner(ips: list[str], http_port: int, ws_port: int, token: str) -> None:
    """Prints the beautiful startup banner with scanable QR codes."""
    border = "=" * 60
    safe_print("\n" + border)
    safe_print("  PocketDeck \u2014 Mobile Remote Control")
    safe_print(border + "\n")

    # Use bright color for the token
    safe_print(f"  Auth Token: {Style.BRIGHT}{token}{Style.RESET_ALL}  (enter this on your phone)\n")
    safe_print("  Scan the QR code below to connect:")

    for ip in ips:
        url = f"http://{ip}:{http_port}"
        safe_print(f"\n  {url}")
        try:
            # Print the QR code with a bit of top/bottom margin
            safe_print("\n")
            safe_print(get_qr_ascii(url))
            safe_print("\n")
        except Exception as e:
            safe_print(f"  [!] Could not render QR for {ip}: {e}")

    safe_print("  WebSocket: ws://[ip]:" + str(ws_port))
    safe_print("  HTTP:      http://[ip]:" + str(http_port))
    safe_print("\n" + border + "\n")
    
    try:
        if sys.stdout is not None:
            sys.stdout.flush()
    except Exception:
        pass

