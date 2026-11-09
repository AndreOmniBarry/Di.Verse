@echo off
rem Removes Di.Verse and its shortcuts. Your keys, Bibles and songs in
rem %APPDATA%\Di.Verse are kept (delete that folder too to remove everything).
powershell -NoProfile -Command "Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.Path -like ($env:LOCALAPPDATA + '\Programs\Di.Verse\*') } | Stop-Process -Force" >nul 2>&1
del "%USERPROFILE%\Desktop\Di.Verse.lnk" >nul 2>&1
powershell -NoProfile -Command "Remove-Item -LiteralPath ([Environment]::GetFolderPath('Desktop') + '\Di.Verse.lnk'), ($env:APPDATA + '\Microsoft\Windows\Start Menu\Programs\Di.Verse.lnk') -ErrorAction SilentlyContinue"
echo Di.Verse removed. Your data is still in %APPDATA%\Di.Verse
start "" /b cmd /c "timeout /t 1 >nul & rmdir /s /q "%LOCALAPPDATA%\Programs\Di.Verse""
