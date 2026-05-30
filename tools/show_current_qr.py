import qrcode
import base64
import io
import webbrowser
import tempfile
import os
import sys

# Ensure the server directory is on sys.path so we can import the project's
# internal utils package the same way the server does at runtime.
sys.path.insert(0, os.path.join(os.getcwd(), 'server'))
from utils.network import get_local_ips

TOKEN = "123456"
HTTP_PORT = 8766

ips = get_local_ips()
ip = ips[0] if ips else "127.0.0.1"
url = f"http://{ip}:{HTTP_PORT}"

qr = qrcode.QRCode(version=2, box_size=8, border=2)
qr.add_data(url)
qr.make(fit=True)
img = qr.make_image(fill_color="black", back_color="white")

buf = io.BytesIO()
img.save(buf, format="PNG")
b64 = base64.b64encode(buf.getvalue()).decode("ascii")

html = f"""<!doctype html>
<html>
<head>
  <meta charset=\"utf-8\" />
  <title>PocketDeck QR</title>
  <style>
    body {{ background: #07090d; color: #f2f4f8; font-family: Segoe UI, sans-serif; margin: 0; padding: 24px; }}
    .wrap {{ max-width: 560px; margin: 0 auto; text-align: center; }}
    img {{ width: min(82vw, 420px); background: #fff; padding: 14px; border-radius: 12px; }}
    .meta {{ margin-top: 14px; font-size: 18px; line-height: 1.5; }}
    .token {{ font-weight: 700; letter-spacing: 0.5px; }}
  </style>
</head>
<body>
  <div class=\"wrap\">
    <img src=\"data:image/png;base64,{b64}\" alt=\"PocketDeck QR\" />
    <div class=\"meta\">URL: {url}</div>
    <div class=\"meta\">Token: <span class=\"token\">{TOKEN}</span></div>
  </div>
</body>
</html>
"""

out = os.path.join(tempfile.gettempdir(), "PocketDeck_QR.html")
with open(out, "w", encoding="utf-8") as f:
    f.write(html)

webbrowser.open(out)
print(f"Wrote QR page to: {out}")
print(f"URL: {url} | Token: {TOKEN}")
