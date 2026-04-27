@echo off
echo ========================================================
echo Compiling PocketDeck into a Standalone Executable
echo ========================================================

echo.
echo Installing requirements including PyInstaller...
pip install -r requirements.txt
pip install pyinstaller

echo.
echo Building executable...
REM --noconfirm: Overwrite existing build
REM --onefile: Create a single executable
REM --add-data: Include the client folder and server folder structure
REM --name: Set the output executable name
REM --noconsole: Run in background with no terminal window
pyinstaller --noconfirm --onefile --noconsole --icon app.ico --add-data "client;client" --add-data "server;server" --add-data "app.ico;." --name PocketDeck server/server.py

echo.
echo ========================================================
echo Build Complete!
echo You can find the executable at: dist\PocketDeck.exe
echo ========================================================
pause
