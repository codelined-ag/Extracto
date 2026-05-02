#Requires -Version 5.1

[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [string]$Command = "help",

    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$RemainingArguments
)

$ErrorActionPreference = "Stop"

$ScriptDir   = Split-Path -Parent (Resolve-Path $MyInvocation.MyCommand.Path).Path
$ProjectDir  = if ($env:EXTRACTO_PROJECT_DIR) { $env:EXTRACTO_PROJECT_DIR } else { Resolve-Path (Join-Path $ScriptDir "..") | Select-Object -ExpandProperty Path }
$LogDir      = if ($env:EXTRACTO_LOG_DIR)     { $env:EXTRACTO_LOG_DIR }     else { Join-Path $env:LOCALAPPDATA "extracto\logs" }
$RuntimeEnv  = Join-Path $ProjectDir ".extracto.env"
$UserBinDir  = Join-Path $env:LOCALAPPDATA "Extracto"
$UserBinFile = Join-Path $UserBinDir "extracto.cmd"

if (-not (Test-Path $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
}

function Write-Info ($Message) { Write-Host ("• {0}" -f $Message) -ForegroundColor Cyan }
function Write-Ok   ($Message) { Write-Host ("✔ {0}" -f $Message) -ForegroundColor Green }
function Write-Warn ($Message) { Write-Host ("! {0}" -f $Message) -ForegroundColor Yellow }
function Fail       ($Message) { Write-Host ("✖ {0}" -f $Message) -ForegroundColor Red; exit 1 }

function Assert-Project {
    if (-not (Test-Path (Join-Path $ProjectDir "docker-compose.yml"))) {
        Fail "docker-compose.yml not found at $ProjectDir"
    }
    if (-not (Test-Path (Join-Path $ProjectDir "docker.env"))) {
        Fail "docker.env not found at $ProjectDir"
    }
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        Fail "Docker is not installed. Install Docker Desktop: https://www.docker.com/products/docker-desktop/"
    }
}

function New-AuthSecret {
    $bytes = New-Object byte[] 32
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    -join ($bytes | ForEach-Object { $_.ToString("x2") })
}

function Read-EnvAuthSecret ($EnvFile) {
    if (-not (Test-Path $EnvFile)) { return $null }
    foreach ($line in Get-Content -LiteralPath $EnvFile) {
        if ($line -match '^\s*#') { continue }
        if ($line -match '^\s*AUTH_SECRET\s*=\s*(.+)$') {
            return $Matches[1].Trim().Trim('"', "'")
        }
    }
    return $null
}

function Ensure-AuthSecret {
    if ($env:AUTH_SECRET) { return }
    if (Read-EnvAuthSecret (Join-Path $ProjectDir "docker.env")) { return }
    if (Read-EnvAuthSecret $RuntimeEnv) { return }
    $secret = New-AuthSecret
    Set-Content -LiteralPath $RuntimeEnv -Value "AUTH_SECRET=$secret" -NoNewline
    Add-Content -LiteralPath $RuntimeEnv -Value ""
    Write-Ok "Generated local AUTH_SECRET in $RuntimeEnv"
}

function Invoke-Compose {
    param([string[]]$ComposeArgs)
    $base = @("compose", "--env-file", "docker.env")
    if (Test-Path $RuntimeEnv) { $base += @("--env-file", $RuntimeEnv) }
    Push-Location $ProjectDir
    try {
        & docker @($base + $ComposeArgs)
        if ($LASTEXITCODE -ne 0) { throw "docker compose $($ComposeArgs -join ' ') failed (exit $LASTEXITCODE)" }
    } finally {
        Pop-Location
    }
}

function Invoke-Step {
    param([string]$Label, [scriptblock]$Action)
    Write-Info $Label
    try {
        & $Action
        Write-Ok $Label
    } catch {
        Write-Host ("✖ {0}" -f $Label) -ForegroundColor Red
        throw
    }
}

function Cmd-On {
    Assert-Project
    Ensure-AuthSecret
    Invoke-Step "Turning up Extracto" { Invoke-Compose @("up", "-d", "--build") }
    Invoke-Step "Checking Extracto health" { Invoke-Compose @("ps") }
    Write-Ok "Extracto is running at http://localhost:3000"
}

function Cmd-Off {
    Assert-Project
    Invoke-Step "Shutting down Extracto" { Invoke-Compose @("down") }
    Write-Ok "Extracto is shut down"
}

function Cmd-Logs {
    Assert-Project
    Invoke-Compose (@("logs", "-f", "--tail", "200") + $RemainingArguments)
}

function Cmd-Status {
    Assert-Project
    Invoke-Compose @("ps")
}

function Cmd-Update {
    Assert-Project
    Invoke-Step "Pulling latest images" { Invoke-Compose @("pull") }
    Invoke-Step "Rebuilding services"   { Invoke-Compose @("up", "-d", "--build") }
    Write-Ok "Extracto updated"
}

function Cmd-Install {
    Assert-Project
    if (-not (Test-Path $UserBinDir)) {
        New-Item -ItemType Directory -Path $UserBinDir -Force | Out-Null
    }
    $launcher = @"
@echo off
setlocal
set SCRIPT="%~dp0extracto.ps1"
powershell -NoProfile -ExecutionPolicy Bypass -File "$($PSCommandPath)" %*
endlocal
"@
    Set-Content -LiteralPath $UserBinFile -Value $launcher -Encoding ASCII
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if (-not ($userPath.Split(";") | Where-Object { $_ -ieq $UserBinDir })) {
        $newPath = if ([string]::IsNullOrWhiteSpace($userPath)) { $UserBinDir } else { "$userPath;$UserBinDir" }
        [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
        Write-Ok "Added $UserBinDir to user PATH (open a new shell to pick it up)"
    }
    Write-Ok "Installed launcher at $UserBinFile"
    Write-Info "Use:  extracto on | off | logs | status | update | uninstall"
}

function Cmd-Uninstall {
    if (Test-Path $UserBinFile) {
        Remove-Item -LiteralPath $UserBinFile -Force
        Write-Ok "Removed $UserBinFile"
    }
    if (Test-Path $UserBinDir) {
        try {
            Remove-Item -LiteralPath $UserBinDir -Force
            Write-Ok "Removed $UserBinDir"
        } catch {
            Write-Warn "Could not remove $UserBinDir (not empty)"
        }
    }
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if ($userPath) {
        $cleaned = ($userPath.Split(";") | Where-Object { $_ -and ($_ -ne $UserBinDir) }) -join ";"
        if ($cleaned -ne $userPath) {
            [Environment]::SetEnvironmentVariable("Path", $cleaned, "User")
            Write-Ok "Removed Extracto bin from user PATH"
        }
    }
    Assert-Project
    Invoke-Compose @("down", "-v")
    Write-Ok "Extracto uninstalled"
}

function Cmd-Help {
    Write-Host "Extracto — Windows installer / runner" -ForegroundColor Magenta
    Write-Host ""
    Write-Host "Usage:"
    Write-Host "  scripts\extracto.ps1 install      # add 'extracto' to your PATH (one time)"
    Write-Host "  extracto on                        # build + start container"
    Write-Host "  extracto off                       # stop container"
    Write-Host "  extracto logs                      # tail container logs"
    Write-Host "  extracto status                    # show docker compose ps"
    Write-Host "  extracto update                    # pull + rebuild"
    Write-Host "  extracto uninstall                 # full teardown (removes volumes)"
    Write-Host ""
    Write-Host "Requirements: Docker Desktop for Windows" -ForegroundColor DarkGray
    Write-Host "Docs:         https://github.com/codelined-ag" -ForegroundColor DarkGray
}

switch ($Command.ToLowerInvariant()) {
    "on"        { Cmd-On }
    "up"        { Cmd-On }
    "start"     { Cmd-On }
    "off"       { Cmd-Off }
    "down"      { Cmd-Off }
    "stop"      { Cmd-Off }
    "logs"      { Cmd-Logs }
    "status"    { Cmd-Status }
    "ps"        { Cmd-Status }
    "update"    { Cmd-Update }
    "install"   { Cmd-Install }
    "uninstall" { Cmd-Uninstall }
    "help"      { Cmd-Help }
    default     { Cmd-Help }
}
