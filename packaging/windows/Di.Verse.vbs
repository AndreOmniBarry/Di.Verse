' Di.Verse — what runs when you open Di.Verse from the Start menu or Desktop.
' Starts Di.Verse in the background (if it isn't already running) and opens
' the Operator page in Google Chrome. Live captions need Chrome.
' Your keys, Bibles and songs: %APPDATA%\Di.Verse   Log: %APPDATA%\Di.Verse\logs\diverse.log
Option Explicit
Dim sh, fso, base, data, logFile, url, i, env
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
base = fso.GetParentFolderName(WScript.ScriptFullName)
data = sh.ExpandEnvironmentStrings("%APPDATA%") & "\Di.Verse"
url = "http://localhost:3000/operator"
If Not fso.FolderExists(data) Then fso.CreateFolder data
If Not fso.FolderExists(data & "\logs") Then fso.CreateFolder data & "\logs"
logFile = data & "\logs\diverse.log"

Function Running()
  Dim http
  Running = False
  On Error Resume Next
  Set http = CreateObject("MSXML2.ServerXMLHTTP.6.0")
  http.setTimeouts 1000, 1000, 1000, 1000
  http.Open "GET", "http://localhost:3000/api/version", False
  http.Send
  If Err.Number = 0 Then
    If http.Status = 200 Then Running = True
  End If
  Err.Clear
  On Error GoTo 0
End Function

Sub OpenOperator()
  On Error Resume Next
  sh.Run "chrome """ & url & """", 1, False
  If Err.Number <> 0 Then
    Err.Clear
    sh.Run url, 1, False
    MsgBox "Di.Verse is running." & vbCrLf & vbCrLf & "Install Google Chrome for live captions (the fastest listening) - other browsers can only use the slower Whisper listening.", vbInformation, "Di.Verse"
  End If
  On Error GoTo 0
End Sub

If Running() Then
  OpenOperator
  WScript.Quit 0
End If

' keep the log from growing forever over months of services
If fso.FileExists(logFile) Then
  If fso.GetFile(logFile).Size > 5000000 Then
    If fso.FileExists(logFile & ".old") Then fso.DeleteFile logFile & ".old"
    fso.MoveFile logFile, logFile & ".old"
  End If
End If

Set env = sh.Environment("Process")
env("DIVERSE_DATA") = data
env("DIVERSE_BUNDLED_DB") = base & "\bible.db"
env("DIVERSE_NO_BROWSER") = "1"
sh.CurrentDirectory = base & "\app"
' hidden window: cmd /c ""...\node.exe" scripts\supervisor.js >> "...\diverse.log" 2>&1"
sh.Run "cmd /c """"" & base & "\node\node.exe"" scripts\supervisor.js >> """ & logFile & """ 2>&1""", 0, False

For i = 1 To 80
  If Running() Then
    OpenOperator
    WScript.Quit 0
  End If
  WScript.Sleep 250
Next

If MsgBox("Di.Verse did not start." & vbCrLf & vbCrLf & "Is another program using port 3000? Open the log to see why?", vbYesNo + vbExclamation, "Di.Verse") = vbYes Then
  sh.Run "notepad """ & logFile & """", 1, False
End If
WScript.Quit 1
