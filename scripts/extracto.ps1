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
$ExtractoUrl = if ($env:EXTRACTO_URL) { $env:EXTRACTO_URL } else { "http://127.0.0.1:3000" }
$ConfigFile  = Join-Path $env:USERPROFILE ".extracto\config"

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

function Resolve-ApiToken {
    if ($env:EXTRACTO_TOKEN) { return $env:EXTRACTO_TOKEN }
    if (Test-Path $ConfigFile) {
        foreach ($line in Get-Content -LiteralPath $ConfigFile) {
            if ($line -match '^\s*EXTRACTO_TOKEN\s*=\s*(.+)$') {
                return $Matches[1].Trim().Trim('"', "'")
            }
        }
    }
    return $null
}

function Require-ApiToken {
    $token = Resolve-ApiToken
    if (-not $token) {
        Fail "no API token found. Set EXTRACTO_TOKEN, or run 'extracto api-key create <email> <name>' and store the result in $ConfigFile as EXTRACTO_TOKEN=<key>."
    }
    return $token
}

function Invoke-Api {
    param(
        [string]$Method,
        [string]$Path,
        [object]$Body
    )
    $token = Require-ApiToken
    $headers = @{ Authorization = "Bearer $token"; Accept = "application/json" }
    $url = "${ExtractoUrl}${Path}"
    $params = @{
        Uri = $url
        Method = $Method
        Headers = $headers
        ErrorAction = "Stop"
    }
    if ($PSBoundParameters.ContainsKey("Body") -and $null -ne $Body) {
        $params.ContentType = "application/json"
        if ($Body -is [string]) {
            $params.Body = $Body
        } else {
            $params.Body = ($Body | ConvertTo-Json -Depth 10 -Compress)
        }
    }
    try {
        $resp = Invoke-WebRequest @params
        return $resp.Content
    } catch {
        $statusCode = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
        $bodyText = ""
        try {
            if ($_.Exception.Response) {
                $stream = $_.Exception.Response.GetResponseStream()
                $reader = New-Object System.IO.StreamReader($stream)
                $bodyText = $reader.ReadToEnd()
            }
        } catch { }
        if ($statusCode -gt 0) {
            Fail "HTTP $statusCode from ${url}: $bodyText"
        }
        Fail "$url failed: $($_.Exception.Message)"
    }
}

function Remove-StaleContainers {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { return }
    $ids = & docker ps -a --filter 'name=^extracto$' --format '{{.ID}}' 2>$null
    if (-not $ids) { return }
    foreach ($id in $ids) {
        if (-not $id) { continue }
        $proj = & docker inspect --format '{{ index .Config.Labels "com.docker.compose.project" }}' $id 2>$null
        if (-not $proj -or $proj -eq '<no value>') {
            Write-Warn "Removing stale container 'extracto' (created by 'docker run', conflicts with compose stack)"
            & docker rm -f $id 2>$null | Out-Null
        }
    }
}

function Cmd-On {
    Assert-Project
    Ensure-AuthSecret
    Remove-StaleContainers
    $buildLocally = $RemainingArguments -contains "--build"
    if ($buildLocally) {
        Invoke-Step "Building Extracto from source" { Invoke-Compose @("build") }
        Invoke-Step "Turning up Extracto" { Invoke-Compose @("up", "-d") }
    } else {
        Invoke-Step "Pulling Extracto image from ghcr.io" { Invoke-Compose @("pull") }
        Invoke-Step "Turning up Extracto" { Invoke-Compose @("up", "-d") }
    }
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

function Cmd-Upgrade {
    Assert-Project
    Remove-StaleContainers
    Invoke-Step "Pulling latest Extracto image from ghcr.io" { Invoke-Compose @("pull") }
    Invoke-Step "Recreating Extracto container" { Invoke-Compose @("up", "-d", "--force-recreate") }
    Write-Ok "Extracto upgraded and running at http://localhost:3000"
}

function Broadcast-EnvChange {
    try {
        if (-not ('Native.Win32EnvBroadcast' -as [type])) {
            $sig = @'
[DllImport("user32.dll", SetLastError=true, CharSet=CharSet.Auto)]
public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, UIntPtr wParam, string lParam, uint fuFlags, uint uTimeout, out UIntPtr lpdwResult);
'@
            Add-Type -MemberDefinition $sig -Name "Win32EnvBroadcast" -Namespace "Native"
        }
        $HWND_BROADCAST = [IntPtr]0xFFFF
        $WM_SETTINGCHANGE = 0x1A
        $SMTO_ABORTIFHUNG = 0x2
        [UIntPtr]$out = [UIntPtr]::Zero
        [Native.Win32EnvBroadcast]::SendMessageTimeout($HWND_BROADCAST, $WM_SETTINGCHANGE, [UIntPtr]::Zero, "Environment", $SMTO_ABORTIFHUNG, 5000, [ref]$out) | Out-Null
    } catch {
        Write-Warn "Could not broadcast PATH update; you may need to log out and back in."
    }
}

function Cmd-Install {
    Assert-Project
    if (-not (Test-Path $UserBinDir)) {
        New-Item -ItemType Directory -Path $UserBinDir -Force | Out-Null
    }
    $scriptPath = $PSCommandPath
    $launcher = @"
@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$scriptPath" %*
"@
    Set-Content -LiteralPath $UserBinFile -Value $launcher -Encoding ASCII
    Write-Ok "Installed launcher at $UserBinFile"

    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    $userPathParts = if ($userPath) { $userPath.Split(";") } else { @() }
    $alreadyOnPath = $userPathParts | Where-Object { $_ -and ($_.TrimEnd('\') -ieq $UserBinDir.TrimEnd('\')) }
    if (-not $alreadyOnPath) {
        $newPath = if ([string]::IsNullOrWhiteSpace($userPath)) { $UserBinDir } else { "$userPath;$UserBinDir" }
        [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
        Broadcast-EnvChange
        Write-Ok "Added $UserBinDir to user PATH"
    } else {
        Write-Info "$UserBinDir was already on the user PATH"
    }

    if ($env:Path -notlike "*$UserBinDir*") {
        $env:Path = "$env:Path;$UserBinDir"
    }

    try {
        $verify = & cmd /c "where extracto" 2>&1
        if ($LASTEXITCODE -eq 0 -and $verify -match [regex]::Escape($UserBinFile)) {
            Write-Ok "Resolved on PATH: $verify"
        } else {
            Write-Warn "Launcher not yet on PATH for child cmd processes (this is expected; restart your terminal)."
        }
    } catch {
        Write-Warn "Could not verify launcher resolution: $($_.Exception.Message)"
    }

    Write-Info "Open a NEW terminal WINDOW (not just a new tab in an existing session: tabs inherit the parent env). Then run: extracto on"
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

function Cmd-ApiKey {
    Assert-Project
    if ($RemainingArguments.Count -lt 1) {
        Fail "usage: extracto api-key <create|list|revoke> [args...]"
    }
    $execScript = @'
if [ -z "${AUTH_SECRET:-}" ] && [ -f /app/data/.auth_secret ]; then
  AUTH_SECRET="$(tr -d "\r\n" < /app/data/.auth_secret)"
  export AUTH_SECRET
fi
exec bun run scripts/api-key-cli.ts "$@"
'@
    $composeArgs = @("compose", "--env-file", "docker.env")
    if (Test-Path $RuntimeEnv) { $composeArgs += @("--env-file", $RuntimeEnv) }
    $composeArgs += @("exec", "-T", "app", "sh", "-c", $execScript, "--") + $RemainingArguments
    Push-Location $ProjectDir
    try {
        & docker @composeArgs
        if ($LASTEXITCODE -ne 0) { Fail "api-key command failed (exit $LASTEXITCODE)" }
    } finally {
        Pop-Location
    }
}

function Get-FileMimeType ($Path) {
    switch -regex ($Path) {
        '\.pdf$'  { return "application/pdf" }
        '\.png$'  { return "image/png" }
        '\.jpe?g$' { return "image/jpeg" }
        '\.webp$' { return "image/webp" }
        default   { Fail "unsupported file type: $($Path -replace '.*\.', '')" }
    }
    return $null
}

function Resolve-PageSpec {
    param([string]$Spec)
    $out = New-Object System.Collections.Generic.List[int]
    $seen = @{}
    foreach ($raw in $Spec.Split(",")) {
        $part = $raw.Trim()
        if (-not $part) { continue }
        if ($part.Contains("-")) {
            $sides = $part.Split("-")
            if ($sides.Count -ne 2) { Fail "malformed range: '$raw'" }
            $aStr = $sides[0].Trim(); $bStr = $sides[1].Trim()
            if (-not $aStr -or -not $bStr) { Fail "malformed range: '$raw' (missing endpoint)" }
            $a = 0; $b = 0
            if (-not [int]::TryParse($aStr, [ref]$a) -or -not [int]::TryParse($bStr, [ref]$b)) {
                Fail "malformed range: '$raw' (non-integer endpoint)"
            }
            if ($a -lt 1 -or $b -lt 1) { Fail "page numbers must be >= 1 ('$raw')" }
            $lo = [Math]::Min($a, $b); $hi = [Math]::Max($a, $b)
            if ($hi - $lo -gt 9999) { Fail "range too wide: '$raw'" }
            for ($n = $lo; $n -le $hi; $n++) {
                if (-not $seen.ContainsKey($n)) { $seen[$n] = $true; $out.Add($n) | Out-Null }
            }
        } else {
            $n = 0
            if (-not [int]::TryParse($part, [ref]$n)) { Fail "not an integer: '$raw'" }
            if ($n -lt 1) { Fail "page numbers must be >= 1 ('$raw')" }
            if (-not $seen.ContainsKey($n)) { $seen[$n] = $true; $out.Add($n) | Out-Null }
        }
    }
    if ($out.Count -eq 0) { Fail "no valid page numbers" }
    return ($out | Sort-Object)
}

function Cmd-Ocr {
    if ($RemainingArguments.Count -lt 1) {
        Fail "usage: extracto ocr <file> --model NAME [--out PATH] [--no-wait] [--pages 1-5,7] [--preset generic|academic|invoice|contract|form] [--no-text-layer] [--page-concurrency N]"
    }
    $file = $RemainingArguments[0]
    if (-not (Test-Path -LiteralPath $file)) { Fail "file not found: $file" }

    $model = ""
    $outPath = ""
    $waitFlag = $true
    $pagesSpec = ""
    $preset = ""
    $preferTextLayer = $null
    $pageConcurrency = $null
    $i = 1
    while ($i -lt $RemainingArguments.Count) {
        $arg = $RemainingArguments[$i]
        switch ($arg) {
            "--model"          { $model = $RemainingArguments[$i + 1]; $i += 2 }
            "--out"            { $outPath = $RemainingArguments[$i + 1]; $i += 2 }
            "--no-wait"        { $waitFlag = $false; $i += 1 }
            "--pages"          { $pagesSpec = $RemainingArguments[$i + 1]; $i += 2 }
            "--preset"         {
                $preset = $RemainingArguments[$i + 1]
                if ($preset -notin @("generic", "academic", "invoice", "contract", "form")) {
                    Fail "--preset must be one of: generic, academic, invoice, contract, form (got '$preset')"
                }
                $i += 2
            }
            "--no-text-layer"  { $preferTextLayer = $false; $i += 1 }
            "--text-layer"     { $preferTextLayer = $true; $i += 1 }
            "--page-concurrency" {
                $pcRaw = $RemainingArguments[$i + 1]
                $pc = 0
                if (-not [int]::TryParse($pcRaw, [ref]$pc) -or $pc -lt 1 -or $pc -gt 16) {
                    Fail "--page-concurrency must be an integer between 1 and 16 (got '$pcRaw')"
                }
                $pageConcurrency = $pc
                $i += 2
            }
            default            { Fail "unknown ocr flag: $arg" }
        }
    }
    if (-not $model) { Fail "--model is required (e.g. --model llava:13b or --model mistral-ocr-latest)" }

    $sizeBytes = (Get-Item -LiteralPath $file).Length
    if ($sizeBytes -gt 33554432) {
        $sizeMb = [math]::Round($sizeBytes / 1024 / 1024)
        Fail "file is too large for the CLI uploader ($sizeMb MiB > 32 MiB). Use the web UI for big files."
    }

    $mime = Get-FileMimeType $file
    $fileBaseName = Split-Path -Leaf $file
    $resolvedPath = (Resolve-Path -LiteralPath $file).Path

    $sourcePdf = ""
    if ($mime -eq "application/pdf") {
        $rawBytes = [System.IO.File]::ReadAllBytes($resolvedPath)
        $sourcePdf = "data:application/pdf;base64," + [Convert]::ToBase64String($rawBytes)
    }

    $settingsHash = [ordered]@{}
    if ($preset) { $settingsHash.documentPreset = $preset }
    if ($null -ne $preferTextLayer) { $settingsHash.preferTextLayer = $preferTextLayer }
    if ($null -ne $pageConcurrency) { $settingsHash.pageConcurrency = $pageConcurrency }

    $bodyEntry = $null
    if ($pagesSpec) {
        if ($mime -ne "application/pdf") { Fail "--pages only applies to PDF input" }
        if (-not (Get-Command pdftoppm -ErrorAction SilentlyContinue)) {
            Fail "--pages requires 'pdftoppm' (poppler-utils). Install on Windows via: scoop install poppler  OR  choco install poppler"
        }
        $resolvedPages = Resolve-PageSpec -Spec $pagesSpec
        $tmpdir = Join-Path $env:TEMP "extracto-pages-$([Guid]::NewGuid().ToString('N'))"
        New-Item -ItemType Directory -Path $tmpdir -Force | Out-Null
        try {
            $pageEntries = New-Object System.Collections.Generic.List[object]
            $pageNumberArr = New-Object System.Collections.Generic.List[int]
            foreach ($pageNum in $resolvedPages) {
                $stem = Join-Path $tmpdir "page-$pageNum"
                & pdftoppm -singlefile -f $pageNum -l $pageNum -jpeg -r 150 $resolvedPath $stem 2>$null
                if ($LASTEXITCODE -ne 0) { Fail "pdftoppm failed on page $pageNum" }
                $rendered = "$stem.jpg"
                if (-not (Test-Path -LiteralPath $rendered)) { Fail "no rendered output for page $pageNum" }
                $renderedBytes = [System.IO.File]::ReadAllBytes($rendered)
                $renderedB64 = [Convert]::ToBase64String($renderedBytes)
                $pageEntries.Add("data:image/jpeg;base64,$renderedB64") | Out-Null
                $pageNumberArr.Add([int]$pageNum) | Out-Null
                Remove-Item -LiteralPath $rendered -Force
            }
            Write-Info "extracted $($pageNumberArr.Count) page(s) via pdftoppm: pages=$($pageNumberArr -join ',')"
            $bodyEntry = [ordered]@{
                fileName = $fileBaseName
                model = $model
                preview = $pageEntries[0]
                pages = $pageEntries.ToArray()
                pageNumbers = $pageNumberArr.ToArray()
            }
        } finally {
            Remove-Item -LiteralPath $tmpdir -Recurse -Force -ErrorAction SilentlyContinue
        }
    } else {
        $bytes = [System.IO.File]::ReadAllBytes($resolvedPath)
        $b64 = [Convert]::ToBase64String($bytes)
        $dataUrl = "data:${mime};base64,${b64}"
        $bodyEntry = [ordered]@{ fileName = $fileBaseName; model = $model; preview = $dataUrl }
    }

    if ($sourcePdf) { $bodyEntry.sourcePdf = $sourcePdf }
    if ($settingsHash.Count -gt 0) { $bodyEntry.settings = $settingsHash }

    $body = @{ files = @($bodyEntry) }

    Write-Info "submitting OCR for $fileBaseName..."
    $response = Invoke-Api -Method POST -Path "/api/v1/ocr/batch" -Body $body
    if ($outPath) {
        Set-Content -LiteralPath $outPath -Value $response -Encoding UTF8
        Write-Ok "saved response to $outPath"
    } else {
        Write-Output $response
    }

    if ($waitFlag) {
        $jobId = $null
        try {
            $parsed = $response | ConvertFrom-Json
            if ($parsed.files -and $parsed.files.Count -gt 0 -and $parsed.files[0].jobId) {
                $jobId = $parsed.files[0].jobId
            } elseif ($parsed.jobId) {
                $jobId = $parsed.jobId
            }
        } catch { }
        if ($jobId) {
            Write-Info "waiting for job $jobId..."
            Invoke-JobWait -JobId $jobId
        } else {
            Write-Warn "no jobId in response: the submission may have failed. Inspect the JSON above."
        }
    }
}

function Invoke-JobWait {
    param([string]$JobId)
    $status = "QUEUED"
    while ($status -eq "QUEUED" -or $status -eq "RUNNING") {
        Start-Sleep -Seconds 2
        $body = Invoke-Api -Method GET -Path "/api/jobs/$JobId"
        try {
            $parsed = $body | ConvertFrom-Json
            $status = $parsed.status
        } catch { $status = "UNKNOWN" }
        Write-Info "  status=$status"
    }
    Write-Output $body
}

function Cmd-Jobs {
    $sub = if ($RemainingArguments.Count -ge 1) { $RemainingArguments[0] } else { "list" }
    $rest = if ($RemainingArguments.Count -ge 2) { $RemainingArguments[1..($RemainingArguments.Count - 1)] } else { @() }
    switch ($sub) {
        "list" {
            $limit = if ($rest.Count -ge 1) { $rest[0] } else { "20" }
            Write-Output (Invoke-Api -Method GET -Path "/api/jobs?limit=$limit")
        }
        "get" {
            if ($rest.Count -lt 1) { Fail "usage: extracto jobs get <job-id>" }
            Write-Output (Invoke-Api -Method GET -Path "/api/jobs/$($rest[0])")
        }
        "delete" {
            if ($rest.Count -lt 1) { Fail "usage: extracto jobs delete <job-id>" }
            Write-Output (Invoke-Api -Method DELETE -Path "/api/jobs/$($rest[0])")
        }
        "cancel" {
            if ($rest.Count -lt 1) { Fail "usage: extracto jobs cancel <job-id>" }
            Write-Output (Invoke-Api -Method POST -Path "/api/jobs/$($rest[0])/control" -Body @{ action = "stop" })
        }
        "wait" {
            if ($rest.Count -lt 1) { Fail "usage: extracto jobs wait <job-id>" }
            Invoke-JobWait -JobId $rest[0]
        }
        default { Fail "usage: extracto jobs <list|get|delete|cancel|wait> [args...]" }
    }
}

function Cmd-Presets {
    $sub = if ($RemainingArguments.Count -ge 1) { $RemainingArguments[0] } else { "list" }
    $rest = if ($RemainingArguments.Count -ge 2) { $RemainingArguments[1..($RemainingArguments.Count - 1)] } else { @() }
    switch ($sub) {
        "list" {
            Write-Output (Invoke-Api -Method GET -Path "/api/v1/presets")
        }
        "create" {
            if ($rest.Count -lt 2) { Fail "usage: extracto presets create <name> <instruction> [markdown|json]" }
            $name = $rest[0]
            $instruction = $rest[1]
            $format = if ($rest.Count -ge 3) { $rest[2] } else { "markdown" }
            Write-Output (Invoke-Api -Method POST -Path "/api/v1/presets" -Body @{
                name = $name; instruction = $instruction; outputFormat = $format
            })
        }
        "delete" {
            if ($rest.Count -lt 1) { Fail "usage: extracto presets delete <preset-id>" }
            Write-Output (Invoke-Api -Method DELETE -Path "/api/v1/presets/$($rest[0])")
        }
        default { Fail "usage: extracto presets <list|create|delete> [args...]" }
    }
}

function Cmd-Settings {
    $sub = if ($RemainingArguments.Count -ge 1) { $RemainingArguments[0] } else { "get" }
    switch ($sub) {
        "get" { Write-Output (Invoke-Api -Method GET -Path "/api/settings") }
        default { Fail "usage: extracto settings get   (use the web UI to change settings)" }
    }
}

function Parse-KbExportFlags {
    param([string[]]$Args)
    $opts = @{
        Collection = ""; StoreUrl = ""; StoreKind = "chroma"; StoreKey = ""
        EmbedModel = ""; EmbedProvider = "ollama"; EmbedEndpoint = "http://127.0.0.1:11434"; EmbedKey = ""
        Strategy = "paragraph"; ChunkSize = 1200; Overlap = $null; MinChunkSize = 0
        BreakpointPercentile = $null; MaxHeadingDepth = $null
    }
    $i = 0
    while ($i -lt $Args.Count) {
        $arg = $Args[$i]
        switch ($arg) {
            "--collection"            { $opts.Collection = $Args[$i + 1]; $i += 2 }
            "--store"                 { $opts.StoreKind = $Args[$i + 1]; $i += 2 }
            "--store-url"             { $opts.StoreUrl = $Args[$i + 1]; $i += 2 }
            "--store-key"             { $opts.StoreKey = $Args[$i + 1]; $i += 2 }
            "--embed-model"           { $opts.EmbedModel = $Args[$i + 1]; $i += 2 }
            "--embed-provider"        { $opts.EmbedProvider = $Args[$i + 1]; $i += 2 }
            "--embed-endpoint"        { $opts.EmbedEndpoint = $Args[$i + 1]; $i += 2 }
            "--embed-key"             { $opts.EmbedKey = $Args[$i + 1]; $i += 2 }
            "--strategy"              { $opts.Strategy = $Args[$i + 1]; $i += 2 }
            "--chunk-size"            { $opts.ChunkSize = [int]$Args[$i + 1]; $i += 2 }
            "--overlap"               { $opts.Overlap = [int]$Args[$i + 1]; $i += 2 }
            "--min-chunk-size"        { $opts.MinChunkSize = [int]$Args[$i + 1]; $i += 2 }
            "--breakpoint-percentile" { $opts.BreakpointPercentile = [double]$Args[$i + 1]; $i += 2 }
            "--max-heading-depth"     { $opts.MaxHeadingDepth = [int]$Args[$i + 1]; $i += 2 }
            "--embed-concurrency"     {
                $ec = 0
                if (-not [int]::TryParse($Args[$i + 1], [ref]$ec) -or $ec -lt 1 -or $ec -gt 16) {
                    Fail "--embed-concurrency must be an integer between 1 and 16"
                }
                $opts.EmbedConcurrency = $ec
                $i += 2
            }
            default                   { Fail "unknown kb export flag: $arg" }
        }
    }
    return $opts
}

function Cmd-Kb {
    if ($RemainingArguments.Count -lt 1) {
        Fail "usage: extracto kb {export|test-connection} [flags]"
    }
    $sub = $RemainingArguments[0]
    $rest = if ($RemainingArguments.Count -ge 2) { $RemainingArguments[1..($RemainingArguments.Count - 1)] } else { @() }
    switch ($sub) {
        "export" {
            if ($rest.Count -lt 1) {
                Fail "usage: extracto kb export <job-id> --collection NAME --store-url URL --embed-model MODEL [flags]"
            }
            $jobId = $rest[0]
            $flags = if ($rest.Count -ge 2) { $rest[1..($rest.Count - 1)] } else { @() }
            $opts = Parse-KbExportFlags -Args $flags
            if (-not $opts.Collection) { Fail "--collection is required" }
            if (-not $opts.StoreUrl) { Fail "--store-url is required" }
            if (-not $opts.EmbedModel) { Fail "--embed-model is required" }

            $payload = [ordered]@{
                jobId = $jobId
                collectionName = $opts.Collection
                vectorStore = [ordered]@{ kind = $opts.StoreKind; baseUrl = $opts.StoreUrl }
                embedding = [ordered]@{
                    provider = $opts.EmbedProvider
                    apiEndpoint = $opts.EmbedEndpoint
                    model = $opts.EmbedModel
                }
                chunking = [ordered]@{ strategy = $opts.Strategy; maxChunkSize = $opts.ChunkSize }
            }
            if ($opts.StoreKey) { $payload.vectorStore.apiKey = $opts.StoreKey }
            if ($opts.EmbedKey) { $payload.embedding.apiKey = $opts.EmbedKey }
            if ($null -ne $opts.Overlap -and $opts.Strategy -eq "fixed") { $payload.chunking.overlap = $opts.Overlap }
            if ($opts.MinChunkSize -gt 0) { $payload.chunking.minChunkSize = $opts.MinChunkSize }
            if ($null -ne $opts.BreakpointPercentile) { $payload.chunking.breakpointPercentile = $opts.BreakpointPercentile }
            if ($null -ne $opts.MaxHeadingDepth) { $payload.chunking.maxHeadingDepth = $opts.MaxHeadingDepth }
            if ($null -ne $opts.EmbedConcurrency) { $payload.embeddingConcurrency = $opts.EmbedConcurrency }

            Write-Info "exporting job $jobId to $($opts.StoreKind)://$($opts.StoreUrl)/$($opts.Collection)..."
            Write-Output (Invoke-Api -Method POST -Path "/api/v1/export/kb" -Body $payload)
        }
        "test-connection" {
            $kind = "chroma"; $url = ""; $key = ""
            $i = 0
            while ($i -lt $rest.Count) {
                switch ($rest[$i]) {
                    "--store"     { $kind = $rest[$i + 1]; $i += 2 }
                    "--store-url" { $url = $rest[$i + 1]; $i += 2 }
                    "--store-key" { $key = $rest[$i + 1]; $i += 2 }
                    default       { Fail "unknown kb test-connection flag: $($rest[$i])" }
                }
            }
            if (-not $url) { Fail "usage: extracto kb test-connection --store chroma|qdrant|weaviate --store-url URL [--store-key KEY]" }
            $body = [ordered]@{ kind = $kind; baseUrl = $url }
            if ($key) { $body.apiKey = $key }
            Write-Info "testing $kind at $url..."
            Write-Output (Invoke-Api -Method POST -Path "/api/v1/kb/test-connection" -Body $body)
        }
        default { Fail "usage: extracto kb {export|test-connection} [flags]" }
    }
}

function Cmd-Help {
    Write-Host "Extracto: Windows installer / runner / API client" -ForegroundColor Magenta
    Write-Host ""
    Write-Host "Usage:"
    Write-Host "  scripts\extracto.ps1 install      add 'extracto' to your PATH (one time)"
    Write-Host ""
    Write-Host "Lifecycle:"
    Write-Host "  extracto on [--build]              start (pulls image; --build = source build)"
    Write-Host "  extracto off                       stop container"
    Write-Host "  extracto upgrade                   pull latest image, recreate container"
    Write-Host "  extracto status                    docker compose ps"
    Write-Host "  extracto logs                      tail container logs"
    Write-Host "  extracto uninstall                 full teardown (removes volumes)"
    Write-Host ""
    Write-Host "API:"
    Write-Host "  extracto api-key <create|list|revoke> [args...]"
    Write-Host "  extracto ocr <file> --model NAME [--out PATH] [--no-wait] [--pages 1-5,7]"
    Write-Host "                                     [--preset generic|academic|invoice|contract|form] [--no-text-layer]"
    Write-Host "  extracto jobs <list|get|delete|cancel|wait> [args...]"
    Write-Host "  extracto presets <list|create|delete> [args...]"
    Write-Host "  extracto settings get"
    Write-Host "  extracto kb export <job-id> --collection N --store-url URL --embed-model M"
    Write-Host "                                     export an OCR job's text to a vector store"
    Write-Host "  extracto kb test-connection --store chroma|qdrant|weaviate --store-url URL [--store-key KEY]"
    Write-Host "                                     probe a vector store for reachability + auth"
    Write-Host ""
    Write-Host "Environment:" -ForegroundColor DarkGray
    Write-Host "  EXTRACTO_URL      Base URL (default http://127.0.0.1:3000)" -ForegroundColor DarkGray
    Write-Host "  EXTRACTO_TOKEN    Bearer token for /api/v1/* requests" -ForegroundColor DarkGray
    Write-Host ""
    Write-Host "Requirements: Docker Desktop for Windows" -ForegroundColor DarkGray
    Write-Host "Docs:         https://extracto.help" -ForegroundColor DarkGray
}

switch ($Command.ToLowerInvariant()) {
    "on"             { Cmd-On }
    "up"             { Cmd-On }
    "start"          { Cmd-On }
    "off"            { Cmd-Off }
    "down"           { Cmd-Off }
    "stop"           { Cmd-Off }
    "logs"           { Cmd-Logs }
    "status"         { Cmd-Status }
    "ps"             { Cmd-Status }
    "upgrade"        { Cmd-Upgrade }
    "update"         { Cmd-Upgrade }
    "install"        { Cmd-Install }
    "uninstall"      { Cmd-Uninstall }
    "api-key"        { Cmd-ApiKey }
    "ocr"            { Cmd-Ocr }
    "jobs"           { Cmd-Jobs }
    "presets"        { Cmd-Presets }
    "settings"       { Cmd-Settings }
    "kb"             { Cmd-Kb }
    "help"           { Cmd-Help }
    default          { Cmd-Help }
}
