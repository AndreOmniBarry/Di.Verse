@echo off
rem Di.Verse installer for Windows: copies Di.Verse to your user folder
rem (no administrator rights needed), adds Desktop and Start menu shortcuts
rem and starts it. Your keys, Bibles and songs stay in %APPDATA%\Di.Verse.
setlocal
set "SRC=%~dp0"
set "DEST=%LOCALAPPDATA%\Programs\Di.Verse"
echo.
echo   Installing Di.Verse...
echo.

rem Stop a running Di.Verse first (it would hold the old files)
powershell -NoProfile -Command "Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.Path -like ($env:LOCALAPPDATA + '\Programs\Di.Verse\*') } | Stop-Process -Force" >nul 2>&1
timeout /t 1 /nobreak >nul

if exist "%DEST%" rmdir /s /q "%DEST%"
robocopy "%SRC%." "%DEST%" /E /NFL /NDL /NJH /NJS /NP /XF "Install Di.Verse.cmd" >nul
if errorlevel 8 (
  echo   Copy failed - is Di.Verse open? Close it and run this again.
  pause
  exit /b 1
)

rem Files from a downloaded zip are marked "from the internet"; clear that so
rem Windows doesn't ask every time Di.Verse starts
powershell -NoProfile -Command "Get-ChildItem -LiteralPath $env:LOCALAPPDATA\Programs\Di.Verse -Recurse | Unblock-File" >nul 2>&1

rem Shortcuts: Desktop and Start menu
powershell -NoProfile -ExecutionPolicy Bypass -Command "$d = Join-Path $env:LOCALAPPDATA 'Programs\Di.Verse'; $s = New-Object -ComObject WScript.Shell; foreach ($p in @([Environment]::GetFolderPath('Desktop'), (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'))) { $l = $s.CreateShortcut((Join-Path $p 'Di.Verse.lnk')); $l.TargetPath = (Join-Path $env:WINDIR 'System32\wscript.exe'); $l.Arguments = '\"' + (Join-Path $d 'Di.Verse.vbs') + '\"'; $l.IconLocation = (Join-Path $d 'Di.Verse.ico'); $l.WorkingDirectory = $d; $l.Description = 'Di.Verse - live scripture display'; $l.Save() }"

echo   Done. Di.Verse is on your Desktop and in the Start menu.
echo   Starting it now - the Operator page opens in Chrome.
echo.
start "" wscript.exe "%DEST%\Di.Verse.vbs"
timeout /t 4 >nul
