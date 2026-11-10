<#
  Build the single-file dsh-memory-manager.exe.

  It embeds:
    - plugin sources (index.js / core.js / server.js / ui.html / cordis.patch.yml / package.json)
    - attach.ps1, README.md, docs (tutorial in .md and .txt), LICENSE files
    - a gzip-compressed Node.js runtime (node.exe)

  On first run the exe extracts everything into %LOCALAPPDATA%\dsh-thirdparty-memory\.

  Usage:
    powershell -ExecutionPolicy Bypass -File build-single-exe.ps1
    powershell -ExecutionPolicy Bypass -File build-single-exe.ps1 -NodeExe "D:\node.exe"
#>
[CmdletBinding()]
param(
  [string]$NodeExe = "",
  [string]$Out = "",
  [string]$PluginDir = ""
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($PluginDir)) {
  if ($PSScriptRoot) { $PluginDir = $PSScriptRoot }
  else { $PluginDir = Split-Path -Parent $MyInvocation.MyCommand.Path }
}
$PluginDir = (Resolve-Path -LiteralPath $PluginDir).Path
if ([string]::IsNullOrWhiteSpace($Out)) { $Out = Join-Path $PluginDir "dsh-memory-manager.exe" }

# pick a node runtime: prefer the DSH bundled one (24.x), then whatever `where node` finds
if ([string]::IsNullOrWhiteSpace($NodeExe)) {
  $candidates = @(
    (Join-Path $env:USERPROFILE ".dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"),
    "D:\node.exe",
    "C:\Program Files\nodejs\node.exe"
  )
  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate) { $NodeExe = $candidate; break }
  }
}
if (-not $NodeExe -or -not (Test-Path -LiteralPath $NodeExe)) { throw "node.exe not found; pass -NodeExe" }
Write-Host "plugin : $PluginDir"
Write-Host "node   : $NodeExe ($([math]::Round((Get-Item $NodeExe).Length/1MB,1)) MB)"

# ── 1. gzip the node runtime ───────────────────────────────────────────────
$gzPath = Join-Path $env:TEMP ("node_bundle_" + [guid]::NewGuid().ToString("N") + ".gz")
Write-Host "packing node runtime -> gzip ..."
Add-Type -AssemblyName System.IO.Compression
$input = [System.IO.File]::OpenRead($NodeExe)
$output = [System.IO.File]::Create($gzPath)
$gzip = New-Object System.IO.Compression.GZipStream($output, [System.IO.Compression.CompressionLevel]::Optimal, $true)
$input.CopyTo($gzip)
$gzip.Dispose(); $output.Dispose(); $input.Dispose()
Write-Host ("        {0:N1} MB -> {1:N1} MB" -f ((Get-Item $NodeExe).Length/1MB), ((Get-Item $gzPath).Length/1MB))

# ── 2. collect resources ───────────────────────────────────────────────────
$resources = [ordered]@{
  "app_index.js"           = Join-Path $PluginDir "index.js"
  "app_core.js"            = Join-Path $PluginDir "core.js"
  "app_server.js"          = Join-Path $PluginDir "server.js"
  "app_ui.html"            = Join-Path $PluginDir "ui.html"
  "app_patch.yml"          = Join-Path $PluginDir "cordis.patch.yml"
  "app_package.json"       = Join-Path $PluginDir "package.json"
  "app_attach.ps1"         = Join-Path $PluginDir "attach.ps1"
  "app_readme.md"          = Join-Path $PluginDir "README.md"
  "app_readme_zh_cn.md"    = Join-Path $PluginDir "README.zh-CN.md"
  "app_readme_zh_tw.md"    = Join-Path $PluginDir "README.zh-TW.md"
  "app_tutorial.md"        = Join-Path $PluginDir "docs\tutorial.md"
  "app_tutorial_zh_cn.md"  = Join-Path $PluginDir "docs\tutorial.zh-CN.md"
  "app_tutorial_zh_tw.md"  = Join-Path $PluginDir "docs\tutorial.zh-TW.md"
  "app_tutorial.txt"       = Join-Path $PluginDir "docs\tutorial.txt"
  "app_tutorial_zh_cn.txt" = Join-Path $PluginDir "docs\tutorial.zh-CN.txt"
  "app_tutorial_zh_tw.txt" = Join-Path $PluginDir "docs\tutorial.zh-TW.txt"
  "app_license.txt"        = Join-Path $PluginDir "LICENSE"
  "app_node_license.txt"   = Join-Path $PluginDir "docs\NODE-LICENSE.txt"
}

$missing = @()
$resourceArgs = @()
foreach ($name in $resources.Keys) {
  $path = $resources[$name]
  if (-not (Test-Path -LiteralPath $path)) { $missing += $name; continue }
  $resourceArgs += "/resource:$path,$name"
}
if ($missing.Count -gt 0) {
  Write-Host "  [warn] missing resources (skipped): $($missing -join ', ')" -ForegroundColor Yellow
}

# the C# source requires every resource; create placeholders for missing ones
$placeholderDir = Join-Path $env:TEMP ("dshmem_ph_" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $placeholderDir -Force | Out-Null
foreach ($name in $missing) {
  $placeholder = Join-Path $placeholderDir ($name + ".txt")
  [System.IO.File]::WriteAllText($placeholder, "(placeholder)")
  $resourceArgs += "/resource:$placeholder,$name"
}
$resourceArgs += "/resource:$gzPath,node_gz"

# ── 3. compile ─────────────────────────────────────────────────────────────
$csc = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path $csc)) { $csc = "C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe" }
if (-not (Test-Path $csc)) { throw "csc.exe not found (.NET Framework 4.x required)" }
$source = Join-Path $PluginDir "manager\DshMemoryManager.cs"
if (-not (Test-Path -LiteralPath $source)) { throw "source not found: $source" }

if (Test-Path -LiteralPath $Out) { Remove-Item -LiteralPath $Out -Force }
Write-Host "compiling ..."
$cscArgs = @(
  "/nologo", "/target:winexe", "/optimize+", "/platform:anycpu",
  "/out:$Out",
  "/r:System.dll", "/r:System.Core.dll", "/r:System.Windows.Forms.dll", "/r:System.Drawing.dll", "/r:System.Management.dll"
) + $resourceArgs + @($source)
& $csc @cscArgs
if ($LASTEXITCODE -ne 0) { throw "csc failed with exit code $LASTEXITCODE" }

Remove-Item -LiteralPath $gzPath -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $placeholderDir -Recurse -Force -ErrorAction SilentlyContinue

$built = Get-Item -LiteralPath $Out
Write-Host ("OK  {0}  ({1:N1} MB)" -f $built.FullName, ($built.Length / 1MB))
