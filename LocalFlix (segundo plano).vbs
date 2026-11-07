' Inicia LocalFlix sin ventana. El registro queda en data\server.log
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dir
If Not fso.FolderExists(dir & "\data") Then fso.CreateFolder(dir & "\data")
sh.Run "cmd /c node server.js > data\server.log 2>&1", 0, False
