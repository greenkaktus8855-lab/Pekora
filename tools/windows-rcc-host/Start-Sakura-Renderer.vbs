Option Explicit
Dim shell, fso, scriptPath, powershellPath, command
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
scriptPath = fso.BuildPath(fso.GetParentFolderName(WScript.ScriptFullName), "Start-Sakura-Renderer.ps1")
powershellPath = shell.ExpandEnvironmentStrings("%SystemRoot%") & "\System32\WindowsPowerShell\v1.0\powershell.exe"
If Not fso.FileExists(scriptPath) Then
    MsgBox "Start-Sakura-Renderer.ps1 is missing. Extract the whole launcher folder first.", vbCritical, "Sakura Renderer"
    WScript.Quit 1
End If
command = """" & powershellPath & """ -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & scriptPath & """"
shell.Run command, 0, False
