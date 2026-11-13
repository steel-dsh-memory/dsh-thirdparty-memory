<#
  dsh-thirdparty-memory 多宿主接线脚本（UTF-8 with BOM：Windows PowerShell 5.1 会把无 BOM 的
  UTF-8 .ps1 当 ANSI 读，中文会乱码，所以本文件固定保存为带 BOM 的 UTF-8）。

  作用：把插件接到任意一个 DSH profile 上（junction + bundles + patch 块），
  并可把插件的 peer 依赖（@deepseek-ai/dsh-tools）重新指向指定运行时的副本。

  用法：
    .\attach.ps1                                           # 自动探测所有 DSH home 的 profile 并接线
    .\attach.ps1 -CreateWeb                                # 顺手给缺 web profile 的 home 建一个再接线
    .\attach.ps1 -Repair                                   # 只修各 profile 清单里的 UTF-8 BOM，然后退出
    .\attach.ps1 -ProfileDir "<profile dir>"               # 只接指定 profile（可给多个）
    .\attach.ps1 -DataFile "<store path>"                  # 把 dataFile 写进 patch（省略则沿用已有值）
    .\attach.ps1 -RuntimeDir "<host>\node_modules\@deepseek-ai" -Force
                                                           # 把 peer 重指到指定宿主运行时

  说明：插件已把 @deepseek-ai/schemastery 依赖去掉（改用内置 Standard Schema），
  现在只需要 host 的 @deepseek-ai/dsh-tools。
#>
[CmdletBinding()]
param(
  [string[]]$ProfileDir = @(),
  [string]$PluginDir = "",
  [string]$RuntimeDir = "",
  [string]$DataFile = "",
  [switch]$CreateWeb,
  [switch]$Repair,
  [switch]$Force
)

$ErrorActionPreference = "Stop"
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

# $PSScriptRoot 在 param 默认值里可能是空的（powershell -File 时），这里兜底。
if ([string]::IsNullOrWhiteSpace($PluginDir)) {
  if ($PSScriptRoot) { $PluginDir = $PSScriptRoot }
  else { $PluginDir = Split-Path -Parent $MyInvocation.MyCommand.Path }
}

function Write-Step($text) { Write-Host $text }
function Write-Ok($text) { Write-Host "  [ok]   $text" }
function Write-Skip($text) { Write-Host "  [skip] $text" }
function Write-Warn2($text) { Write-Host "  [warn] $text" -ForegroundColor Yellow }
function Write-Bad($text) { Write-Host "  [fail] $text" -ForegroundColor Red }

function Read-Json($path) {
  return (Get-Content -LiteralPath $path -Raw -Encoding UTF8) | ConvertFrom-Json
}

function Write-Json($path, $value) {
  $text = $value | ConvertTo-Json -Depth 20
  [System.IO.File]::WriteAllText($path, $text + "`n", $Utf8NoBom)
}

function Write-Text($path, $text) {
  [System.IO.File]::WriteAllText($path, $text, $Utf8NoBom)
}

# Strip a UTF-8 BOM from a JSON manifest. DSH's readProfileManifest does a bare
# JSON.parse and dies on BOM (DesktopHostFatalError at startup), so a BOM here
# means "the desktop app cannot boot". Backs up first; never touches data files.
function Repair-BomFile($path) {
  if (-not (Test-Path -LiteralPath $path)) { return "missing" }
  $bytes = [System.IO.File]::ReadAllBytes($path)
  if ($bytes.Length -lt 3) { return "clean" }
  if ($bytes[0] -ne 0xEF -or $bytes[1] -ne 0xBB -or $bytes[2] -ne 0xBF) { return "clean" }
  $backup = $path + ".bak_bom_" + (Get-Date -Format "yyyyMMdd_HHmmss")
  Copy-Item -LiteralPath $path -Destination $backup -Force
  $text = [System.Text.Encoding]::UTF8.GetString($bytes, 3, $bytes.Length - 3)
  [System.IO.File]::WriteAllText($path, $text, $Utf8NoBom)
  return "repaired:" + $backup
}

function Ensure-Junction($link, $target, [switch]$Replace) {
  if (Test-Path -LiteralPath $link) {
    $item = Get-Item -LiteralPath $link -Force
    $current = if ($item.Target) { $item.Target -join ";" } else { "" }
    if ($current -eq $target -and -not $Replace) { return "same" }
    if (-not $Replace) { return "different:" + $current }
    try { $item.Delete() } catch { Remove-Item -LiteralPath $link -Recurse -Force -ErrorAction SilentlyContinue }
  }
  New-Item -ItemType Junction -Path $link -Target $target | Out-Null
  return "created"
}

function Get-DshHomes {
  $homes = @()
  if ($env:DSH_HOME) { $homes += $env:DSH_HOME }
  if ($env:APPDATA) { $homes += (Join-Path $env:APPDATA "com.yeagoo.dsh-desktop\harness") }
  if ($env:APPDATA) { $homes += (Join-Path $env:APPDATA "@deepseek-ai\dsh-desktop") }
  if ($env:USERPROFILE) { $homes += (Join-Path $env:USERPROFILE ".dsh") }
  # MSIX / Store 版会被文件系统重定向到包的 LocalCache，这里也要找到。
  if ($env:LOCALAPPDATA) {
    $packages = Join-Path $env:LOCALAPPDATA "Packages"
    if (Test-Path -LiteralPath $packages) {
      Get-ChildItem -LiteralPath $packages -Directory -ErrorAction SilentlyContinue | ForEach-Object {
        $homes += (Join-Path $_.FullName "LocalCache\Roaming\com.yeagoo.dsh-desktop\harness")
      }
    }
  }
  return @($homes | Where-Object { $_ -and (Test-Path -LiteralPath (Join-Path $_ "profiles")) } | Select-Object -Unique)
}

function New-WebProfile($dshHome) {
  $dir = Join-Path $dshHome "profiles\web"
  if (Test-Path -LiteralPath (Join-Path $dir "package.json")) { return $dir }
  New-Item -ItemType Directory -Path $dir -Force | Out-Null
  $manifest = [ordered]@{
    name = "dsh-profile-web"
    private = $true
    dependencies = @{}
    dsh = @{ profile = @{ bundles = @("@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app") } }
  }
  Write-Json (Join-Path $dir "package.json") $manifest
  Write-Text (Join-Path $dir "cordis.yml") "# dsh profile root - an empty entry list. Edit cordis.patch.yml, not this file.`n[]`n"
  Write-Text (Join-Path $dir "cordis.patch.yml") "# profile patch layer`n[]`n"
  Write-Text (Join-Path $dir "pnpm-workspace.yaml") "packages:`n  - .`n`nnodeLinker: hoisted`nautoInstallPeers: false`n"
  return $dir
}

function Resolve-HostRuntime($profilePath) {
  # profilePath = <home>\profiles\<name>；宿主的 in-box 包通常挂在 <home>\profiles\node_modules
  $candidates = @()
  $profilesDir = Split-Path -Parent $profilePath
  if ($profilesDir) {
    $candidates += (Join-Path $profilesDir "node_modules\@deepseek-ai")
    $candidates += (Join-Path (Split-Path -Parent $profilesDir) "node_modules\@deepseek-ai")
  }
  if ($env:APPDATA) {
    $candidates += (Join-Path $env:APPDATA "com.yeagoo.dsh-desktop\harness\profiles\node_modules\@deepseek-ai")
  }
  if ($env:USERPROFILE) {
    $candidates += (Join-Path $env:USERPROFILE ".dsh\profiles\node_modules\@deepseek-ai")
  }
  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path -LiteralPath (Join-Path $candidate "dsh-tools\package.json"))) { return $candidate }
  }
  return ""
}

function Attach-Profile($dir) {
  $manifestPath = Join-Path $dir "package.json"
  if (-not (Test-Path -LiteralPath $manifestPath)) { Write-Bad "no package.json: $dir"; return $false }
  # 先修 BOM：带 BOM 的清单会让 DSH 启动时 readProfileManifest 直接崩。
  $bomState = Repair-BomFile $manifestPath
  if ($bomState -ne "clean" -and $bomState -ne "missing") { Write-Ok ("manifest BOM stripped: " + $manifestPath) }
  Write-Step "profile: $dir"

  # 1) plugin junction in the profile's node_modules
  $modules = Join-Path $dir "node_modules"
  New-Item -ItemType Directory -Path $modules -Force | Out-Null
  $link = Join-Path $modules "dsh-thirdparty-memory"
  $result = Ensure-Junction $link $PluginDir -Replace:$Force
  switch ($result) {
    "created" { Write-Ok "junction -> $PluginDir" }
    "same" { Write-Skip "junction already points here" }
    default { Write-Warn2 ("junction points elsewhere (" + $result.Substring(10) + "), use -Force to repoint") }
  }

  # 2) register the bundle
  $manifest = Read-Json $manifestPath
  if (-not $manifest.dsh) { $manifest | Add-Member -NotePropertyName dsh -NotePropertyValue ([pscustomobject]@{}) -Force }
  if (-not $manifest.dsh.profile) { $manifest.dsh | Add-Member -NotePropertyName profile -NotePropertyValue ([pscustomobject]@{}) -Force }
  $bundles = @()
  if ($manifest.dsh.profile.bundles) { $bundles = @($manifest.dsh.profile.bundles) }
  if ($bundles -notcontains "dsh-thirdparty-memory") {
    $bundles += "dsh-thirdparty-memory"
    $manifest.dsh.profile | Add-Member -NotePropertyName bundles -NotePropertyValue $bundles -Force
    Write-Json $manifestPath $manifest
    Write-Ok "bundles += dsh-thirdparty-memory"
  } else {
    Write-Skip "bundle already registered"
  }

  # 3) loader patch entry（可选带 dataFile，用于把记忆存到自定义目录）
  $patchPath = Join-Path $dir "cordis.patch.yml"
  $existing = ""
  if (Test-Path -LiteralPath $patchPath) { $existing = [System.IO.File]::ReadAllText($patchPath, [System.Text.Encoding]::UTF8) }
  $wantedData = ""
  if (-not [string]::IsNullOrWhiteSpace($DataFile)) { $wantedData = ($DataFile -replace "\\", "/") }
  $existingLines = @()
  if ($existing.Length -gt 0) { $existingLines = @($existing -split "`r?`n") }

  # Locate the existing thirdparty-memory block. If we are not changing dataFile,
  # leave the block byte-for-byte alone: enabled/autoExtract/inbox/maxBytes/...
  # are user configuration, not values this script has any right to reset.
  $blockStart = -1
  $blockEnd = -1
  for ($i = 0; $i -lt $existingLines.Count; $i++) {
    if ($existingLines[$i] -match "^\s*-\s*id:\s*thirdparty-memory\s*$") {
      $blockStart = $i
      $blockEnd = $existingLines.Count
      for ($j = $i + 1; $j -lt $existingLines.Count; $j++) {
        if ($existingLines[$j] -match "^\s*-\s*id:") { $blockEnd = $j; break }
      }
      break
    }
  }
  $existingData = ""
  if ($blockStart -ge 0) {
    for ($i = $blockStart; $i -lt $blockEnd; $i++) {
      $match = [regex]::Match($existingLines[$i], "^\s*dataFile\s*:\s*(.+?)\s*$")
      if ($match.Success) { $existingData = $match.Groups[1].Value.Trim().Trim("'").Trim('"'); break }
    }
  }
  $explicitData = -not [string]::IsNullOrWhiteSpace($DataFile)
  if (-not $explicitData) { $wantedData = $existingData }
  $dataChanged = $explicitData -and ($wantedData -ne $existingData)

  if ($blockStart -ge 0 -and -not $dataChanged) {
    Write-Skip "cordis.patch.yml already up to date"
    return $true
  }

  if ($blockStart -ge 0) {
    # Only replace/insert dataFile; keep every other config line (including
    # enabled: false) and any comments the user added inside the block.
    $newBlock = New-Object System.Collections.ArrayList
    $dataWritten = $false
    $dataIndent = "    "
    for ($i = $blockStart; $i -lt $blockEnd; $i++) {
      $line = $existingLines[$i]
      if ($line -match "^(\s*)dataFile\s*:") {
        if (-not $dataWritten) {
          $dataIndent = $Matches[1]
          [void]$newBlock.Add($dataIndent + "dataFile: '" + $wantedData + "'")
          $dataWritten = $true
        }
        continue
      }
      [void]$newBlock.Add($line)
    }
    if (-not $dataWritten -and $wantedData.Length -gt 0) {
      $configAt = -1
      for ($i = 0; $i -lt $newBlock.Count; $i++) {
        if ($newBlock[$i] -match "^\s*config\s*:") { $configAt = $i; break }
      }
      if ($configAt -ge 0) { $newBlock.Insert($configAt + 1, $dataIndent + "dataFile: '" + $wantedData + "'") }
      else { $newBlock.Add($dataIndent + "dataFile: '" + $wantedData + "'") }
    }
    $before = @()
    if ($blockStart -gt 0) { $before = @($existingLines[0..($blockStart - 1)]) }
    $after = @()
    if ($blockEnd -lt $existingLines.Count) { $after = @($existingLines[$blockEnd..($existingLines.Count - 1)]) }
    $final = (@($before) + @($newBlock) + @($after)) -join "`n"
  } else {
    $blockLines = @(
      "# dsh-thirdparty-memory (third-party long-term memory, unofficial)",
      "- id: thirdparty-memory",
      "  name: dsh-thirdparty-memory",
      "  config:",
      "    enabled: true",
      "    autoExtract: true",
      "    inbox: true   # all automatic writes go to the review inbox (0.4.4+)"
    )
    if ($wantedData.Length -gt 0) { $blockLines += ("    dataFile: '" + $wantedData + "'") }
    $kept = New-Object System.Collections.ArrayList
    foreach ($line in $existingLines) {
      if ($line.Trim() -eq "[]") { continue }
      if ($line -match "^#\s*dsh-thirdparty-memory") { continue }
      [void]$kept.Add($line)
    }
    $body = ($kept -join "`n").TrimEnd()
    if ($body.Length -gt 0) { $body = $body + "`n`n" }
    $final = @($body + ($blockLines -join "`n") + "`n") -join "`n"
  }

  if ($final -eq $existing) {
    Write-Skip "cordis.patch.yml already up to date"
  } else {
    Write-Text $patchPath $final
    if ($wantedData.Length -gt 0) { Write-Ok "cordis.patch.yml updated (dataFile -> $wantedData)" }
    else { Write-Ok "cordis.patch.yml updated" }
  }
  return $true
}

function Attach-Peers {
  param([string]$Runtime)
  if ([string]::IsNullOrWhiteSpace($Runtime)) { return }
  if (-not (Test-Path -LiteralPath $Runtime)) { Write-Bad "runtime dir not found: $Runtime"; return }
  $target = Join-Path $Runtime "dsh-tools"
  if (-not (Test-Path -LiteralPath (Join-Path $target "package.json"))) {
    Write-Bad "dsh-tools not found under $Runtime"
    return
  }
  $peerRoot = Join-Path $PluginDir "node_modules\@deepseek-ai"
  New-Item -ItemType Directory -Path $peerRoot -Force | Out-Null
  $link = Join-Path $peerRoot "dsh-tools"
  $result = Ensure-Junction $link $target -Replace:$Force
  switch ($result) {
    "created" { Write-Ok "peer dsh-tools -> $target" }
    "same" { Write-Skip "peer dsh-tools already points here" }
    default { Write-Warn2 ("peer dsh-tools points elsewhere, use -Force (" + $result.Substring(10) + ")") }
  }
  # 不再需要 schemastery：插件用内置 Standard Schema
  $stale = Join-Path $peerRoot "schemastery"
  if (Test-Path -LiteralPath $stale) {
    Write-Skip "schemastery junction 已不再需要（可手动删除）：$stale"
  }
}

# ── main ────────────────────────────────────────────────────────────────────
$PluginDir = (Resolve-Path -LiteralPath $PluginDir).Path
if (-not (Test-Path -LiteralPath (Join-Path $PluginDir "index.js"))) {
  Write-Bad "index.js not found in $PluginDir"; exit 1
}
Write-Step "plugin: $PluginDir"

$homes = Get-DshHomes

if ($Repair) {
  Write-Step "repair: strip UTF-8 BOM from profile manifests"
  $fixed = 0; $clean = 0; $bad = 0
  foreach ($dshHome in $homes) {
    Get-ChildItem -LiteralPath (Join-Path $dshHome "profiles") -Directory -ErrorAction SilentlyContinue | ForEach-Object {
      $manifest = Join-Path $_.FullName "package.json"
      if (-not (Test-Path -LiteralPath $manifest)) { return }
      $state = Repair-BomFile $manifest
      if ($state.StartsWith("repaired:")) { $script:fixed++; Write-Ok "BOM stripped: $manifest" }
      else { $script:clean++ }
      try { $null = Read-Json $manifest } catch { $script:bad++; Write-Bad "still invalid JSON: $manifest" }
    }
  }
  Write-Step ""
  Write-Step "repair done: fixed=$fixed clean=$clean invalid=$bad"
  exit 0
}

$targets = @()
if ($ProfileDir.Count -gt 0) {
  foreach ($p in $ProfileDir) { if ($p) { $targets += (Resolve-Path -LiteralPath $p).Path } }
} else {
  foreach ($dshHome in $homes) {
    if ($CreateWeb) {
      $web = New-WebProfile $dshHome
      if ($web) { Write-Ok "web profile ready: $web" }
    }
    Get-ChildItem -LiteralPath (Join-Path $dshHome "profiles") -Directory -ErrorAction SilentlyContinue | ForEach-Object {
      if (Test-Path -LiteralPath (Join-Path $_.FullName "package.json")) { $targets += $_.FullName }
    }
  }
}

$targets = @($targets | Select-Object -Unique)
if ($targets.Count -eq 0) {
  Write-Warn2 "no DSH profile found. Pass -ProfileDir explicitly."
  exit 1
}

$okCount = 0
foreach ($dir in $targets) { if (Attach-Profile $dir) { $okCount++ } }

if ($RuntimeDir) {
  Write-Step "peer runtime: $RuntimeDir"
  Attach-Peers -Runtime $RuntimeDir
}

Write-Step ""
Write-Step "done: $okCount/$($targets.Count) profile(s) attached."
Write-Step "next: restart DSH (bundles are read at boot). Memory page: http://127.5.0.1:7891/"
