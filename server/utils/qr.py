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

def print_startup_banner(ips: list[str], http_port: int, ws_port: int, token: str) -> None:
    """Prints the beautiful startup banner with scanable QR codes."""
    border = "=" * 60
    print("\n" + border)
    print("  PocketDeck \u2014 Mobile Remote Control")
    print(border + "\n")

    # Use bright color for the token
    print(f"  Auth Token: {Style.BRIGHT}{token}{Style.RESET_ALL}  (enter this on your phone)\n")
    print("  Scan the QR code below to connect:")

    for ip in ips:
        url = f"http://{ip}:{http_port}"
        print(f"\n  {url}")
        try:
            # Print the QR code with a bit of top/bottom margin
            print("\n")
            print(get_qr_ascii(url))
            print("\n")
        except Exception as e:
            print(f"  [!] Could not render QR for {ip}: {e}")

    print("  WebSocket: ws://[ip]:" + str(ws_port))
    print("  HTTP:      http://[ip]:" + str(http_port))
    print("\n" + border + "\n")
    sys.stdout.flush()
