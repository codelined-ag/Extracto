#!/usr/bin/env pwsh
$ErrorActionPreference = "Stop"

$RepoUrl    = if ($env:EXTRACTO_REPO_URL)    { $env:EXTRACTO_REPO_URL }    else { "https://github.com/codelined-ag/Extracto.git" }
$RepoRef    = if ($env:EXTRACTO_REPO_REF)    { $env:EXTRACTO_REPO_REF }    else { "v0.5.4" }
if ($RepoUrl -notmatch "^https://") {
  Write-Host "EXTRACTO_REPO_URL must be https:// (got $RepoUrl)" -ForegroundColor Red
  exit 1
}
$InstallDir = if ($env:EXTRACTO_INSTALL_DIR) { $env:EXTRACTO_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA "Extracto" }
$AutoStart  = if ($env:EXTRACTO_AUTOSTART)   { $env:EXTRACTO_AUTOSTART }   else { "1" }

function Info($msg) { Write-Host "• $msg" -ForegroundColor Blue }
function Ok($msg)   { Write-Host "✔ $msg" -ForegroundColor Green }
function Die($msg)  { Write-Host "✖ $msg" -ForegroundColor Red; exit 1 }

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Die "git is required. Install Git for Windows from https://git-scm.com and re-run."
}

$parent = Split-Path -Parent $InstallDir
if (-not (Test-Path $parent)) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }

Info "Plan: clone $RepoUrl @ $RepoRef -> $InstallDir (Ctrl-C within 3s to abort)"
Start-Sleep -Seconds 3

if (Test-Path (Join-Path $InstallDir ".git")) {
  Info "Updating Extracto checkout at $InstallDir"
  git -C "$InstallDir" fetch --depth 1 origin "$RepoRef"
  git -C "$InstallDir" reset --hard FETCH_HEAD
} else {
  Info "Cloning $RepoUrl @ $RepoRef -> $InstallDir"
  $staging = "$InstallDir.partial.$PID"
  try {
    git clone --depth 1 --branch "$RepoRef" "$RepoUrl" "$staging"
    Move-Item -LiteralPath $staging -Destination $InstallDir
  } catch {
    if (Test-Path $staging) { Remove-Item -Recurse -Force $staging }
    throw
  }
}

Set-Location $InstallDir
& powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\extracto.ps1" install

Ok "Extracto installed at $InstallDir"

if ($AutoStart -eq "1") {
  Info "Starting Extracto..."
  & powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\extracto.ps1" on
} else {
  Info "Run 'extracto on' to start. Open http://localhost:3000 to sign up."
}
