#!/usr/bin/env pwsh
$ErrorActionPreference = "Stop"

$RepoUrl    = if ($env:EXTRACTO_REPO_URL)    { $env:EXTRACTO_REPO_URL }    else { "https://github.com/codelined-ag/Extracto.git" }
$RepoRef    = if ($env:EXTRACTO_REPO_REF)    { $env:EXTRACTO_REPO_REF }    else { "main" }
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

if (Test-Path (Join-Path $InstallDir ".git")) {
  Info "Updating Extracto checkout at $InstallDir"
  git -C $InstallDir fetch --depth 1 origin $RepoRef
  git -C $InstallDir reset --hard FETCH_HEAD
} else {
  Info "Cloning $RepoUrl -> $InstallDir"
  git clone --depth 1 --branch $RepoRef $RepoUrl $InstallDir
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
