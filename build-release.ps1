<#
  Package the release zip.

  Produces:
    release\dsh-thirdparty-memory-<version>\
    release\dsh-thirdparty-memory-<version>.zip

  What goes in: sources, docs (all three languages, .md + .txt), the manager
  source, the single-file exe, launchers, an empty memory.json template and the
  license files. What never goes in: node_modules (junctions), real memory data,
  backups, and the release folder itself.

  Usage:
    powershell -ExecutionPolicy Bypass -File build-release.ps1
    powershell -ExecutionPolicy Bypass -File build-release.ps1 -Version 0.4.7
#>
[CmdletBinding()]
param(
  [string]$Version = "",
  [string]$PluginDir = "",
  [switch]$KeepStaging
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($PluginDir)) {
  if ($PSScriptRoot) { $PluginDir = $PSScriptRoot }
  else { $PluginDir = Split-Path -Parent $MyInvocation.MyCommand.Path }
}
$PluginDir = (Resolve-Path -LiteralPath $PluginDir).Path

if ([string]::IsNullOrWhiteSpace($Version)) {
  $pkg = Get-Content -LiteralPath (Join-Path $PluginDir "package.json") -Raw -Encoding UTF8 | ConvertFrom-Json
  $Version = $pkg.version
}
Write-Host "plugin  : $PluginDir"
Write-Host "version : $Version"

$releaseDir = Join-Path $PluginDir "release"
$stageName = "dsh-thirdparty-memory-$Version"
$stage = Join-Path $releaseDir $stageName
$zip = Join-Path $releaseDir ("$stageName.zip")

if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
New-Item -ItemType Directory -Path $stage -Force | Out-Null

# relative path inside the package -> source path
$files = @(
  "README.md",
  "README.txt",
  "README.zh-CN.md",
  "README.zh-CN.txt",
  "README.zh-TW.md",
  "README.zh-TW.txt",
  "RELEASE-$Version.txt",
  "LICENSE",
  "package.json",
  "cordis.patch.yml",
  "index.js",
  "core.js",
  "server.js",
  "ui.html",
  "attach.ps1",
  "build-single-exe.ps1",
  "build-release.ps1",
  "dsh-memory-manager.exe",
  "manager\DshMemoryManager.cs",
  "tools\md2txt.mjs",
  "examples\cordis.patch.yml.example",
  "docs\tutorial.md",
  "docs\tutorial.txt",
  "docs\tutorial.zh-CN.md",
  "docs\tutorial.zh-CN.txt",
  "docs\tutorial.zh-TW.md",
  "docs\tutorial.zh-TW.txt",
  "docs\NODE-LICENSE.txt",
  "start-memory-page.vbs",
  "start-memory-page.bat",
  "stop-memory-page.bat",
  "启动记忆页.bat",
  "停止记忆页.bat"
)

$copied = 0
$missing = @()
foreach ($rel in $files) {
  $src = Join-Path $PluginDir $rel
  if (-not (Test-Path -LiteralPath $src)) { $missing += $rel; continue }
  $dst = Join-Path $stage $rel
  $dstDir = Split-Path -Parent $dst
  if (-not (Test-Path -LiteralPath $dstDir)) { New-Item -ItemType Directory -Path $dstDir -Force | Out-Null }
  Copy-Item -LiteralPath $src -Destination $dst -Force
  $copied++
}
if ($missing.Count -gt 0) { Write-Host "  [warn] missing: $($missing -join ', ')" -ForegroundColor Yellow }

# an empty store template — never ship real memories
$dataDir = Join-Path $stage "data"
New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
$template = "{`n  `"version`": 2,`n  `"entries`": [],`n  `"settings`": { `"enabled`": true, `"lang`": `"en`" }`n}`n"
[System.IO.File]::WriteAllText((Join-Path $dataDir "memory.json"), $template, (New-Object System.Text.UTF8Encoding($false)))

# ── leak check: no personal absolute paths, no real memories ───────────────
# The patterns are derived from the build machine at run time, so this script
# itself never hard-codes a user name or a machine-specific path.
$patterns = @(
  [regex]::Escape($env:USERPROFILE),                  # C:\Users\<name>
  [regex]::Escape((Split-Path -Parent $PluginDir)),   # parent of the checkout, e.g. F:\dev
  [regex]::Escape($PluginDir),                        # the checkout path itself
  'mem-mw',                                           # real memory ids
  '192\.168\.'                                        # LAN addresses
) | Where-Object { $_ -and $_.Length -gt 4 }
$leaks = @()
Get-ChildItem -LiteralPath $stage -Recurse -File |
  Where-Object { $_.Name -ne 'build-release.ps1' -and $_.Extension -in '.md', '.txt', '.js', '.html', '.json', '.yml', '.example', '.ps1', '.cs', '.mjs', '.bat', '.vbs' } |
  ForEach-Object {
    $text = Get-Content -LiteralPath $_.FullName -Raw -Encoding UTF8
    foreach ($p in $patterns) {
      if ($text -match $p) { $leaks += ("{0}: {1}" -f $_.FullName.Substring($stage.Length), $p) }
    }
  }
if ($leaks.Count -gt 0) {
  Write-Host "  [LEAK] personal paths / data found in the package:" -ForegroundColor Red
  $leaks | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
} else {
  Write-Host "  leak check: clean" -ForegroundColor Green
}

if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force }
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory($stage, $zip, [System.IO.Compression.CompressionLevel]::Optimal, $true)

if (-not $KeepStaging) { Remove-Item -LiteralPath $stage -Recurse -Force }

$zipped = Get-Item -LiteralPath $zip
Write-Host ("OK  {0} files  ->  {1}  ({2:N1} MB)" -f $copied, $zipped.FullName, ($zipped.Length / 1MB))
if ($leaks.Count -gt 0) { exit 5 }
