' dsh-thirdparty-memory - start the local memory page with no console window.
' This file is pure ASCII on purpose: Windows Script Host misreads non-ASCII
' content in a BOM-less file, so everything location-dependent is derived at runtime.
Option Explicit

Dim fso, shell, baseDir, nodeExe, serverJs, logFolder, logPath, command

Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

baseDir = fso.GetParentFolderName(WScript.ScriptFullName)
serverJs = baseDir & "\server.js"

nodeExe = ResolveNode()
logFolder = shell.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\dsh-thirdparty-memory"
logPath = logFolder & "\page.log"

Sub WriteLog(message)
  On Error Resume Next
  If Not fso.FolderExists(logFolder) Then fso.CreateFolder logFolder
  Dim stream
  Set stream = fso.OpenTextFile(logPath, 8, True, -1)
  stream.WriteLine Now & "  " & message
  stream.Close
End Sub

Function ResolveNode()
  Dim candidates, i, candidate, exec, line
  ResolveNode = ""
  candidates = Array( _
    baseDir & "\node.exe", _
    baseDir & "\node\node.exe", _
    baseDir & "\runtime\node.exe", _
    shell.ExpandEnvironmentStrings("%ProgramFiles%") & "\nodejs\node.exe" _
  )
  For i = 0 To UBound(candidates)
    If fso.FileExists(candidates(i)) Then
      ResolveNode = candidates(i)
      Exit Function
    End If
  Next
  On Error Resume Next
  Set exec = shell.Exec("cmd /c where node")
  If Err.Number = 0 Then
    Do While Not exec.StdOut.AtEndOfStream
      line = Trim(exec.StdOut.ReadLine())
      If line <> "" Then
        ResolveNode = line
        Exit Function
      End If
    Loop
  End If
  On Error GoTo 0
End Function

If Not fso.FileExists(serverJs) Then
  WriteLog "FAIL server.js not found: " & serverJs
  MsgBox "server.js is missing next to this launcher.", 16, "dsh memory page"
  WScript.Quit 1
End If

nodeExe = ResolveNode()
If nodeExe = "" Then
  WriteLog "FAIL node.exe not found"
  MsgBox "node.exe not found. Put node.exe next to this launcher, or install Node.js.", 16, "dsh memory page"
  WScript.Quit 1
End If

command = """" & nodeExe & """ """ & serverJs & """"
WriteLog "starting: " & command
shell.Run command, 0, False
