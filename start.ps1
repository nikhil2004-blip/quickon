# start.ps1 — Run PocketDeck server
# Usage: .\start.ps1
# Requires: .venv created by: python -m venv .venv && .venv\Scripts\pip install -r server\requirements.txt

Write-Host "Starting PocketDeck..." -ForegroundColor Cyan
& "$PSScriptRoot\.venv\Scripts\python.exe" "$PSScriptRoot\server\server.py"
