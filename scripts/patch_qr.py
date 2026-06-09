"""Patch script: replaces the broken on_show_qr try-block with the correct
multi-IP implementation using _build_qr_html."""

from pathlib import Path

SERVER = Path(__file__).parent.parent / "server" / "server.py"
content = SERVER.read_text(encoding="utf-8")

# Identify the broken block by a unique, short marker that won't clash
MARKER_START = "            current_ips = _get_current_ips()\n            token = _startup_info.get(\"token\", \"\")\n            img.save(buf, format=\"PNG\")"
MARKER_END   = "        except Exception as e:\n            logger.error(f\"Failed to show QR page: {e}\")\n\n    def on_info"

if MARKER_START not in content:
    print("ERROR: marker not found — file may already be patched or has unexpected content")
    # Print the suspect region for debugging
    lines = content.split("\n")
    for i, line in enumerate(lines[648:692], start=649):
        print(f"{i}: {repr(line)}")
    raise SystemExit(1)

# Find the full block we need to replace
start_idx = content.index(MARKER_START)
end_idx   = content.index(MARKER_END) + len(MARKER_END)

old_block = content[start_idx:end_idx]
print("=== OLD BLOCK (first 200 chars) ===")
print(repr(old_block[:200]))

new_block = (
    '            current_ips = _get_current_ips()\n'
    '            token = _startup_info.get("token", "")\n'
    '            html = _build_qr_html(current_ips, HTTP_PORT, token)\n'
    '            qr_page = Path(os.getenv("TEMP", ".")) / "PocketDeck_QR.html"\n'
    '            qr_page.write_text(html, encoding="utf-8")\n'
    '            webbrowser.open(qr_page.resolve().as_uri())\n'
    '        except Exception as e:\n'
    '            logger.error(f"Failed to show QR page: {e}")\n'
    '\n'
    '    def on_info'
)

content = content[:start_idx] + new_block + content[end_idx:]
SERVER.write_text(content, encoding="utf-8")
print("SUCCESS: on_show_qr body patched to use _build_qr_html")
