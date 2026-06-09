[CmdletBinding()]
param(
    [switch]$Help,
    [switch]$SkipBuild,
    [ValidateSet("claude-code", "codex", "opencode")]
    [string]$Runtime = "claude-code",
    [string]$CliPath = "",
    [switch]$RealCli,
    [switch]$AllowMissingCli,
    [switch]$SkipCli,
    [string]$Prompt = "reply with just the word ok",
    [int]$TimeoutSec = 60,
    [string]$EdgeUrl = "",
    [string]$EdgeHost = "127.0.0.1",
    [int]$Port = 3299,
    [string]$EdgeBinary = (Join-Path ([System.IO.Path]::GetTempPath()) "agenthub-edge-runtime-smoke.exe"),
    [string]$LogDir = "",
    [string]$OutputJson = "",
    [switch]$IncludeLocalPaths
)

$ErrorActionPreference = "Stop"

function Show-Help {
    @"
edge-runtime-smoke.ps1 - Edge runtime smoke gate

This script starts AgentHub Edge locally, creates one run, and verifies the
Edge REST + WebSocket runtime event path. It is not a full Hub/PG/Redis/OIDC
E2E gate.

Usage:
  pwsh -File scripts/edge-runtime-smoke.ps1 -Port 3299
  pwsh -File scripts/edge-runtime-smoke.ps1 -RealCli -Runtime claude-code -Port 3299
  pwsh -File scripts/edge-runtime-smoke.ps1 -RealCli -Runtime codex -CliPath C:\tools\codex.exe
  pwsh -File scripts/edge-runtime-smoke.ps1 -RealCli -Runtime opencode -EdgeUrl http://127.0.0.1:3301

Key parameters:
  -RealCli                               Opt in to real CLI/model execution. Omitted by default for CI-safe smoke.
  -Runtime <claude-code|codex|opencode>  Runtime adapter to require.
  -CliPath <path-or-command>             Explicit CLI path for the selected runtime.
  -AllowMissingCli                       If the selected CLI is missing, warn and skip with exit 0.
  -SkipCli                               Deprecated alias for the default fake process fixture mode.
  -EdgeUrl <http://host:port>            Edge URL to use; defaults to -EdgeHost/-Port.
  -Port <int>                            Local Edge port when -EdgeUrl is not set.
  -TimeoutSec <int>                      Run/event timeout.
  -Prompt <text>                         Prompt sent to the runtime.
  -OutputJson <path>                     Optional path for the structured result JSON.
  -IncludeLocalPaths                      Include absolute local log paths in JSON. Off by default.

Exit codes:
  0  smoke passed or real CLI was explicitly skipped with -AllowMissingCli
  1  smoke failed
  2  invalid usage/configuration
"@ | Write-Host
}

if ($Help) {
    Show-Help
    exit 0
}

if ($TimeoutSec -le 0) {
    Write-Error "-TimeoutSec must be greater than 0"
    exit 2
}
if ($Port -le 0 -or $Port -gt 65535) {
    Write-Error "-Port must be between 1 and 65535"
    exit 2
}

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
if ([string]::IsNullOrWhiteSpace($LogDir)) {
    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $LogDir = Join-Path ([System.IO.Path]::GetTempPath()) "agenthub-edge-runtime-smoke-$stamp-$PID"
}
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

$EdgeStdoutLog = Join-Path $LogDir "edge.stdout.log"
$EdgeStderrLog = Join-Path $LogDir "edge.stderr.log"
$EventsLog = Join-Path $LogDir "events.ndjson"
$BuildLog = Join-Path $LogDir "build.log"
$EventLogPath = Join-Path $LogDir "edge-event-log.ndjson"

$StartedEdge = $false
$EdgeProc = $null
$ExitCode = 1
$EffectiveCliPath = $null
$Result = [ordered]@{
    script = "edge-runtime-smoke"
    status = "failed"
    mode = "fake-process-fixture"
    runtime = $Runtime
    cliPath = $null
    edgeUrl = $null
    port = $Port
    prompt = $Prompt
    timeoutSec = $TimeoutSec
    runId = $null
    startedAt = (Get-Date).ToString("o")
    endedAt = $null
    durationMs = $null
    eventCounts = [ordered]@{}
    seenTypes = @()
    terminal = [ordered]@{
        type = $null
        seq = $null
        error = $null
    }
    runtimeResult = $null
    runtimeFailures = @()
    frames = [ordered]@{
        received = 0
        matchedRun = 0
        ignoredOtherRun = 0
        lastCursor = 0
    }
    assertions = [ordered]@{}
    warnings = @()
    errors = @()
    logs = [ordered]@{
        dirName = Split-Path -Leaf $LogDir
        edgeStdout = Split-Path -Leaf $EdgeStdoutLog
        edgeStderr = Split-Path -Leaf $EdgeStderrLog
        events = Split-Path -Leaf $EventsLog
        build = Split-Path -Leaf $BuildLog
        edgeEventLog = Split-Path -Leaf $EventLogPath
    }
}
if ($IncludeLocalPaths) {
    $Result.localLogs = [ordered]@{
        dir = $LogDir
        edgeStdout = $EdgeStdoutLog
        edgeStderr = $EdgeStderrLog
        events = $EventsLog
        build = $BuildLog
        edgeEventLog = $EventLogPath
    }
}
$StartedAt = Get-Date

function Add-WarningMessage {
    param([string]$Message)
    $safe = Protect-LocalText $Message
    $script:Result.warnings += $safe
    Write-Warning $safe
}

function Write-Step {
    param([string]$Text)
    Write-Host "`n=== $Text ===" -ForegroundColor Cyan
}

function Format-Result {
    $script:Result.endedAt = (Get-Date).ToString("o")
    $script:Result.durationMs = [int]((Get-Date) - $script:StartedAt).TotalMilliseconds
    $json = $script:Result | ConvertTo-Json -Depth 10
    $json = Protect-LocalText $json 0
    if (-not [string]::IsNullOrWhiteSpace($OutputJson)) {
        Set-Content -Path $OutputJson -Value $json -Encoding utf8
    }
    Write-Host "`n=== Structured result ===" -ForegroundColor Cyan
    Write-Output $json
}

function Resolve-PathExecutable {
    param([string]$CommandName)

    if ([string]::IsNullOrWhiteSpace($CommandName)) {
        return $null
    }

    function Resolve-ScriptWrapper {
        param([string]$ScriptPath)

        $resolvedScript = $null
        try {
            if (Test-Path -LiteralPath $ScriptPath -PathType Leaf) {
                $resolvedScript = (Resolve-Path -LiteralPath $ScriptPath).ProviderPath
            }
        } catch {
            $resolvedScript = $null
        }
        if ([string]::IsNullOrWhiteSpace($resolvedScript)) {
            return $null
        }

        $dir = Split-Path -Parent $resolvedScript
        $stem = [System.IO.Path]::GetFileNameWithoutExtension($resolvedScript)
        foreach ($ext in @(".cmd", ".exe", ".bat", ".com")) {
            $sibling = Join-Path $dir "$stem$ext"
            if (Test-Path -LiteralPath $sibling -PathType Leaf) {
                return (Resolve-Path -LiteralPath $sibling).ProviderPath
            }
        }
        return $null
    }

    if (Test-Path -LiteralPath $CommandName -PathType Leaf) {
        $resolved = (Resolve-Path -LiteralPath $CommandName).ProviderPath
        if ($resolved -match '\.(exe|cmd|bat|com)$') {
            return $resolved
        }
        if ($resolved -match '\.ps1$') {
            $wrapped = Resolve-ScriptWrapper $resolved
            if (-not [string]::IsNullOrWhiteSpace($wrapped)) {
                return $wrapped
            }
            throw "PowerShell script CLI path requires a sibling native wrapper (.cmd/.exe/.bat/.com): $resolved"
        }
        return $resolved
    }

    $candidates = @()
    try {
        $candidates = @(where.exe $CommandName 2>$null)
    } catch {
        $candidates = @()
    }
    foreach ($candidate in $candidates) {
        $value = [string]$candidate
        if ($value -match '\.(exe|cmd|bat|com)$') {
            return $value
        }
    }
    foreach ($candidate in $candidates) {
        $value = [string]$candidate
        if ($value -and $value -notmatch '\.ps1$') {
            return $value
        }
    }
    foreach ($candidate in $candidates) {
        $value = [string]$candidate
        if ($value -match '\.ps1$') {
            $wrapped = Resolve-ScriptWrapper $value
            if (-not [string]::IsNullOrWhiteSpace($wrapped)) {
                return $wrapped
            }
            throw "PowerShell script CLI path requires a sibling native wrapper (.cmd/.exe/.bat/.com): $value"
        }
    }

    $found = Get-Command $CommandName -ErrorAction SilentlyContinue
    if ($found -and $found.Source -and $found.Source -notmatch '\.ps1$') {
        return $found.Source
    }
    if ($found -and $found.Source -and $found.Source -match '\.ps1$') {
        $wrapped = Resolve-ScriptWrapper $found.Source
        if (-not [string]::IsNullOrWhiteSpace($wrapped)) {
            return $wrapped
        }
        throw "PowerShell script CLI path requires a sibling native wrapper (.cmd/.exe/.bat/.com): $($found.Source)"
    }
    return $null
}

function Protect-LocalText {
    param(
        [AllowNull()][string]$Text,
        [int]$MaxLength = 800
    )
    if ($null -eq $Text) {
        return $null
    }
    $safe = $Text
    $paths = @($Root, $LogDir, $env:TEMP, $env:TMP, $env:USERPROFILE) |
        Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
        Sort-Object { ([string]$_).Length } -Descending -Unique
    foreach ($path in $paths) {
        $safe = $safe.Replace([string]$path, "<local-path>")
        try {
            $resolved = (Resolve-Path -LiteralPath $path -ErrorAction Stop).ProviderPath
            if (-not [string]::IsNullOrWhiteSpace($resolved)) {
                $safe = $safe.Replace([string]$resolved, "<local-path>")
            }
        } catch {
        }
    }
    $safe = $safe -replace '(?i)[A-Z]:\\[^"''\s,}]+', '<local-path>'
    $safe = $safe -replace '(?i)(Authorization:\s*Bearer\s+)[^"''\s,}]+', '${1}<redacted-token>'
    $safe = $safe -replace '(?i)(\b[A-Z0-9_]*(?:API_KEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*\s*=\s*)[^"''\s,}]+', '${1}<redacted-secret>'
    $safe = $safe -replace '(?i)("?(?:access[_-]?token|refresh[_-]?token|id[_-]?token)"?\s*:\s*")[^"]+', '${1}<redacted-token>'
    $safe = $safe -replace '(?i)((?:access[_-]?token|refresh[_-]?token|id[_-]?token)\s*[=:]\s*)[^"''\s,}]+', '${1}<redacted-token>'
    $safe = $safe -replace '(?i)(sk|ghp|gho|ghu|ghs|glpat|xox[baprs])-[-_A-Za-z0-9]{12,}', '<redacted-token>'
    if ($MaxLength -gt 0 -and $safe.Length -gt $MaxLength) {
        $safe = $safe.Substring(0, $MaxLength) + "...<truncated>"
    }
    return $safe
}

function Add-ErrorMessage {
    param([string]$Message)
    $safe = Protect-LocalText $Message
    $script:Result.errors += $safe
    Write-Host "ERROR $safe" -ForegroundColor Red
}

function ConvertTo-SafePayload {
    param($Payload)
    if ($null -eq $Payload) {
        return $null
    }
    $json = $Payload | ConvertTo-Json -Compress -Depth 8
    $json = Protect-LocalText $json 0
    $parsed = $null
    try {
        $parsed = $json | ConvertFrom-Json
    } catch {
        $parsed = [pscustomobject]@{
            truncated = $false
            text = $json
        }
    }
    if ($json.Length -gt 1200) {
        return [pscustomobject]@{
            truncated = $true
            json = $json.Remove(1200) + "...<truncated>"
        }
    }
    return $parsed
}

function Read-RuntimeResult {
    param($Event)
    if ($Event.type -ne "run.agent.result" -or $null -eq $Event.payload) {
        return $null
    }
    $payload = ConvertTo-SafePayload $Event.payload
    return [ordered]@{
        seq = $Event.seq
        success = [bool]$payload.success
        payload = $payload
    }
}

function Resolve-AgentPath {
    param(
        [string]$RuntimeId,
        [string]$ExplicitPath
    )

    if (-not [string]::IsNullOrWhiteSpace($ExplicitPath)) {
        return Resolve-PathExecutable $ExplicitPath
    }

    switch ($RuntimeId) {
        "claude-code" {
            if ($env:AGENTHUB_CLAUDE_CODE_PATH) { return Resolve-PathExecutable $env:AGENTHUB_CLAUDE_CODE_PATH }
            if ($env:CLAUDE_PATH) { return Resolve-PathExecutable $env:CLAUDE_PATH }
            return Resolve-PathExecutable "claude"
        }
        "codex" {
            if ($env:AGENTHUB_CODEX_PATH) { return Resolve-PathExecutable $env:AGENTHUB_CODEX_PATH }
            if ($env:CODEX_PATH) { return Resolve-PathExecutable $env:CODEX_PATH }
            return Resolve-PathExecutable "codex"
        }
        "opencode" {
            if ($env:AGENTHUB_OPENCODE_PATH) { return Resolve-PathExecutable $env:AGENTHUB_OPENCODE_PATH }
            if ($env:OPENCODE_PATH) { return Resolve-PathExecutable $env:OPENCODE_PATH }
            return Resolve-PathExecutable "opencode"
        }
        default {
            throw "unsupported runtime: $RuntimeId"
        }
    }
}

function Get-AgentPathFlag {
    param([string]$RuntimeId)
    switch ($RuntimeId) {
        "claude-code" { return "--claude-code-path" }
        "codex" { return "--codex-path" }
        "opencode" { return "--opencode-path" }
        default { throw "unsupported runtime: $RuntimeId" }
    }
}

function Resolve-Endpoint {
    if (-not [string]::IsNullOrWhiteSpace($EdgeUrl)) {
        $uri = [Uri]$EdgeUrl
        if ($uri.Scheme -ne "http") {
            throw "-EdgeUrl must use http:// because this local smoke starts a plain HTTP Edge server"
        }
        if ($uri.IsDefaultPort) {
            throw "-EdgeUrl must include an explicit port"
        }
        return [pscustomobject]@{
            Url = $uri.GetLeftPart([System.UriPartial]::Authority).TrimEnd("/")
            Addr = "$($uri.Host):$($uri.Port)"
            WebSocketUrl = "ws://$($uri.Authority)/v1/events"
            Port = $uri.Port
        }
    }

    $url = "http://$EdgeHost`:$Port"
    [pscustomobject]@{
        Url = $url
        Addr = "$EdgeHost`:$Port"
        WebSocketUrl = "ws://$EdgeHost`:$Port/v1/events"
        Port = $Port
    }
}

function Test-EdgeHealth {
    param([string]$Url)
    try {
        $health = Invoke-RestMethod -Uri "$Url/v1/health" -TimeoutSec 2
        if ($null -eq $health) {
            return $false
        }
        if ($health.version -eq "v1") {
            return $true
        }
        if ($null -ne $health.data -and $health.data.version -eq "v1") {
            return $true
        }
        return ($health.code -eq "OK")
    } catch {
        return $false
    }
}

function Start-EdgeProcess {
    param([string[]]$Arguments)

    $psi = [System.Diagnostics.ProcessStartInfo]::new()
    $psi.FileName = $EdgeBinary
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    foreach ($arg in $Arguments) {
        [void]$psi.ArgumentList.Add($arg)
    }

    $proc = [System.Diagnostics.Process]::Start($psi)
    $script:StdoutTask = $proc.StandardOutput.ReadToEndAsync()
    $script:StderrTask = $proc.StandardError.ReadToEndAsync()
    return $proc
}

function Save-AsyncTextTask {
    param(
        [AllowNull()]$Task,
        [string]$Path
    )

    if ($null -eq $Task) {
        if (-not (Test-Path $Path)) {
            "" | Set-Content -Path $Path -Encoding utf8
        }
        return
    }

    try {
        if ($Task.Wait(5000)) {
            $Task.Result | Set-Content -Path $Path -Encoding utf8
            return
        }
        "[log stream did not drain before timeout]" | Set-Content -Path $Path -Encoding utf8
    } catch {
        "[log stream read failed: $($_.Exception.Message)]" | Set-Content -Path $Path -Encoding utf8
    }
}

function Receive-WebSocketText {
    param(
        [System.Net.WebSockets.ClientWebSocket]$WebSocket,
        [int]$TimeoutMs
    )

    $cts = [System.Threading.CancellationTokenSource]::new()
    $cts.CancelAfter($TimeoutMs)
    $buffer = New-Object byte[] 65536
    $segment = [System.ArraySegment[byte]]::new($buffer)
    $stream = [System.IO.MemoryStream]::new()
    try {
        do {
            $receive = $WebSocket.ReceiveAsync($segment, $cts.Token).GetAwaiter().GetResult()
            if ($receive.MessageType -eq [System.Net.WebSockets.WebSocketMessageType]::Close) {
                return $null
            }
            if ($receive.Count -gt 0) {
                $stream.Write($buffer, 0, $receive.Count)
            }
        } while (-not $receive.EndOfMessage)

        if ($stream.Length -eq 0) {
            return $null
        }
        return [System.Text.Encoding]::UTF8.GetString($stream.ToArray())
    } catch [System.OperationCanceledException] {
        return $null
    } finally {
        $stream.Dispose()
        $cts.Dispose()
    }
}

function Get-EventRunID {
    param($Event)
    if ($null -ne $Event.scope -and $null -ne $Event.scope.runId) {
        return [string]$Event.scope.runId
    }
    if ($null -ne $Event.payload -and $null -ne $Event.payload.runId) {
        return [string]$Event.payload.runId
    }
    return ""
}

function Read-RunOutputText {
    param($Event)
    if ($Event.type -ne "run.output.batch" -or $null -eq $Event.payload) {
        return ""
    }
    $text = ""
    foreach ($chunk in @($Event.payload.chunks)) {
        if ($null -ne $chunk.text) {
            $text += [string]$chunk.text
        }
    }
    return $text
}

function Add-EventCount {
    param([string]$Type)
    if ([string]::IsNullOrWhiteSpace($Type)) {
        return
    }
    if (-not $script:Result.eventCounts.Contains($Type)) {
        $script:Result.eventCounts[$Type] = 0
    }
    $script:Result.eventCounts[$Type] = [int]$script:Result.eventCounts[$Type] + 1
}

function Get-RunIDFromResponse {
    param($Response)
    if ($null -eq $Response) {
        return ""
    }
    if ($null -ne $Response.runId) {
        return [string]$Response.runId
    }
    if ($null -ne $Response.data -and $null -ne $Response.data.runId) {
        return [string]$Response.data.runId
    }
    return ""
}

function Set-Assertion {
    param(
        [string]$Name,
        [bool]$Passed
    )
    $script:Result.assertions[$Name] = $Passed
    if ($Passed) {
        Write-Host "PASS $Name" -ForegroundColor Green
    } else {
        Write-Host "FAIL $Name" -ForegroundColor Red
    }
}

try {
    $endpoint = Resolve-Endpoint
    $Result.edgeUrl = $endpoint.Url
    $Result.port = $endpoint.Port

    Write-Step "Resolve runtime"
    if ($SkipCli) {
        Add-WarningMessage "-SkipCli is deprecated; fake process fixture mode is now the default. Pass -RealCli to run a real CLI/model smoke."
    }
    if (-not $RealCli) {
        $Result.mode = "fake-process-fixture"
        Add-WarningMessage "Running the default fake process fixture. Pass -RealCli to run a real CLI/model smoke."
        $fakeCommand = Resolve-PathExecutable "pwsh"
        if ([string]::IsNullOrWhiteSpace($fakeCommand)) {
            throw "fake process fixture requires pwsh"
        }
        $EffectiveCliPath = $fakeCommand
        $Result.cliPath = Split-Path -Leaf $fakeCommand
        if ($IncludeLocalPaths) {
            $Result.localCliPath = $fakeCommand
        }
    } else {
        $Result.mode = "real-cli"
        $resolvedCli = Resolve-AgentPath $Runtime $CliPath
        if ([string]::IsNullOrWhiteSpace($resolvedCli)) {
            $message = "missing CLI for runtime '$Runtime'. Install it, set the runtime path env var, pass -CliPath, use -AllowMissingCli, or omit -RealCli to run the default fake fixture."
            if ($AllowMissingCli) {
                Add-WarningMessage $message
                $Result.status = "skipped"
                $Result.mode = "missing-cli-skipped"
                $ExitCode = 0
                return
            }
            throw $message
        }
        $EffectiveCliPath = $resolvedCli
        $Result.cliPath = Split-Path -Leaf $resolvedCli
        if ($IncludeLocalPaths) {
            $Result.localCliPath = $resolvedCli
        }
        Write-Host "Runtime CLI: $($Result.cliPath)"
    }

    Write-Step "Build Edge"
    if (-not $SkipBuild) {
        Push-Location (Join-Path $Root "edge-server")
        try {
            $buildOutput = go build -o $EdgeBinary .\cmd\agenthub-edge\ 2>&1
            $buildOutput | Set-Content -Path $BuildLog -Encoding utf8
            if ($LASTEXITCODE -ne 0) {
                throw "go build failed; see $BuildLog"
            }
        } finally {
            Pop-Location
        }
    } elseif (-not (Test-Path $EdgeBinary)) {
        throw "edge binary missing: $EdgeBinary; rerun without -SkipBuild or pass -EdgeBinary"
    } else {
        "build skipped; using $EdgeBinary" | Set-Content -Path $BuildLog -Encoding utf8
    }

    if (Test-EdgeHealth $endpoint.Url) {
        throw "Edge is already responding on $($endpoint.Url); choose a different -Port/-EdgeUrl or stop the existing process"
    }

    Write-Step "Start Edge"
    $edgeArgs = @(
        "--addr", $endpoint.Addr,
        "--dev",
        "--event-log-path", $EventLogPath
    )
    if (-not $RealCli) {
        $edgeArgs += @(
            "--runner-command", $EffectiveCliPath,
            "--runner-arg", "-NoProfile",
            "--runner-arg", "-Command",
            "--runner-arg", "Write-Output 'agenthub fake runtime ok'"
        )
    } else {
        $edgeArgs += @(
            "--runner-profile", $Runtime,
            (Get-AgentPathFlag $Runtime), $EffectiveCliPath
        )
    }

    $EdgeProc = Start-EdgeProcess $edgeArgs
    $StartedEdge = $true
    Write-Host "Edge PID: $($EdgeProc.Id)"

    $readyDeadline = (Get-Date).AddSeconds([Math]::Min(15, [Math]::Max(3, $TimeoutSec)))
    $ready = $false
    while ((Get-Date) -lt $readyDeadline) {
        Start-Sleep -Milliseconds 250
        if ($EdgeProc.HasExited) {
            throw "Edge exited before health check passed; see $EdgeStderrLog"
        }
        if (Test-EdgeHealth $endpoint.Url) {
            $ready = $true
            break
        }
    }
    if (-not $ready) {
        throw "Edge did not become healthy before timeout; see $EdgeStderrLog"
    }

    Write-Step "Create run"
    $body = @{
        projectId = "proj_local"
        threadId = "thread_local"
        prompt = $Prompt
    }
    if ($RealCli) {
        $body.agentId = $Runtime
    }
    $run = Invoke-RestMethod -Uri "$($endpoint.Url)/v1/runs" -Method Post -Body ($body | ConvertTo-Json) -ContentType "application/json" -TimeoutSec 10
    $Result.runId = Get-RunIDFromResponse $run
    if ([string]::IsNullOrWhiteSpace($Result.runId)) {
        throw "POST /v1/runs did not return runId"
    }
    Write-Host "Run ID: $($Result.runId)"

    Write-Step "Read WebSocket events"
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    $cursor = 0
    $seenTypes = New-Object System.Collections.Generic.List[string]
    $stdout = ""
    $terminalType = ""
    $terminalError = ""
    while ((Get-Date) -lt $deadline -and [string]::IsNullOrWhiteSpace($terminalType)) {
        $ws = [System.Net.WebSockets.ClientWebSocket]::new()
        $connectCts = [System.Threading.CancellationTokenSource]::new()
        $connectCts.CancelAfter(5000)
        try {
            $uri = "$($endpoint.WebSocketUrl)?cursor=$cursor"
            $ws.Options.SetRequestHeader("Origin", "http://localhost")
            $null = $ws.ConnectAsync([Uri]$uri, $connectCts.Token).GetAwaiter().GetResult()

            while ((Get-Date) -lt $deadline -and $ws.State -eq [System.Net.WebSockets.WebSocketState]::Open) {
                $raw = Receive-WebSocketText $ws 5000
                if ([string]::IsNullOrWhiteSpace($raw)) {
                    break
                }
                Add-Content -Path $EventsLog -Value $raw -Encoding utf8
                $Result.frames.received = [int]$Result.frames.received + 1
                $event = $raw | ConvertFrom-Json
                if ($null -ne $event.seq) {
                    $cursor = [int64]$event.seq + 1
                    $Result.frames.lastCursor = [int64]$event.seq
                }
                $eventRunID = Get-EventRunID $event
                if ($eventRunID -eq $Result.runId) {
                    $Result.frames.matchedRun = [int]$Result.frames.matchedRun + 1
                    $eventType = [string]$event.type
                    [void]$seenTypes.Add($eventType)
                    $Result.seenTypes += $eventType
                    Add-EventCount $eventType
                    $stdout += Read-RunOutputText $event
                    $runtimeResult = Read-RuntimeResult $event
                    if ($null -ne $runtimeResult) {
                        $Result.runtimeResult = $runtimeResult
                        if (-not $runtimeResult.success) {
                            $Result.runtimeFailures += $runtimeResult
                        }
                    }
                    if ($eventType -eq "run.failed") {
                        $terminalType = $eventType
                        $Result.terminal.type = $eventType
                        $Result.terminal.seq = $event.seq
                        if ($null -ne $event.payload -and $null -ne $event.payload.error) {
                            $terminalError = Protect-LocalText ($event.payload.error | ConvertTo-Json -Compress -Depth 8)
                            $Result.terminal.error = $terminalError
                        }
                        break
                    }
                    if ($eventType -eq "run.finished" -or $eventType -eq "run.cancelled") {
                        $terminalType = $eventType
                        $Result.terminal.type = $eventType
                        $Result.terminal.seq = $event.seq
                        break
                    }
                } elseif (-not [string]::IsNullOrWhiteSpace($eventRunID)) {
                    $Result.frames.ignoredOtherRun = [int]$Result.frames.ignoredOtherRun + 1
                }
            }
        } finally {
            $connectCts.Dispose()
            if ($ws.State -eq [System.Net.WebSockets.WebSocketState]::Open -or $ws.State -eq [System.Net.WebSockets.WebSocketState]::CloseReceived) {
                $closeCts = [System.Threading.CancellationTokenSource]::new()
                $closeCts.CancelAfter(2000)
                try {
                    $null = $ws.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, "", $closeCts.Token).GetAwaiter().GetResult()
                } catch {
                } finally {
                    $closeCts.Dispose()
                }
            }
            $ws.Dispose()
        }
    }

    Write-Host "Run events: $($seenTypes -join ', ')"
    if (-not [string]::IsNullOrWhiteSpace($terminalError)) {
        Write-Host "Terminal error: $terminalError" -ForegroundColor DarkGray
    }

    Write-Step "Assertions"
    $hasStarted = $seenTypes.Contains("run.started")
    $hasFinished = $seenTypes.Contains("run.finished")
    $hasFailed = $seenTypes.Contains("run.failed")
    $hasCancelled = $seenTypes.Contains("run.cancelled")
    $hasRunOutput = $seenTypes.Contains("run.output.batch")
    $hasTextDelta = $seenTypes.Contains("run.agent.text_delta")
    $hasTextBlock = $seenTypes.Contains("run.agent.text_block")
    $hasResult = $seenTypes.Contains("run.agent.result")
    $runtimeSucceeded = $false
    if ($null -ne $Result.runtimeResult) {
        $runtimeSucceeded = [bool]$Result.runtimeResult.success
    }
    $hasSessionInit = $seenTypes.Contains("run.agent.session_init")
    $hasThinking = $seenTypes.Contains("run.agent.thinking")
    $hasToolCall = $seenTypes.Contains("run.agent.tool_call")
    $hasRuntimeEvent = $hasSessionInit -or $hasTextDelta -or $hasTextBlock -or $hasResult -or $hasThinking -or $hasToolCall
    $hasTerminal = -not [string]::IsNullOrWhiteSpace($terminalType)

    Set-Assertion "run.started present" $hasStarted
    Set-Assertion "terminal event present" $hasTerminal
    Set-Assertion "run did not fail/cancel" (-not $hasFailed -and -not $hasCancelled)
    if (-not $RealCli) {
        Set-Assertion "fake fixture emitted raw output" ($hasRunOutput -and $stdout.Contains("agenthub fake runtime ok"))
        Set-Assertion "run.finished present" $hasFinished
    } else {
        Set-Assertion "runtime structured event present" $hasRuntimeEvent
        Set-Assertion "runtime output or result present" ($hasTextDelta -or $hasTextBlock -or $hasResult)
        Set-Assertion "runtime result success" $runtimeSucceeded
        Set-Assertion "run.finished present" $hasFinished
    }

    $failedAssertions = @($Result.assertions.GetEnumerator() | Where-Object { -not $_.Value })
    if ($failedAssertions.Count -gt 0) {
        throw "smoke assertions failed: $($failedAssertions.Name -join ', ')"
    }

    $Result.status = "passed"
    $ExitCode = 0
} catch {
    Add-ErrorMessage $_.Exception.Message
    $Result.status = "failed"
    $ExitCode = 1
} finally {
    if ($StartedEdge -and $null -ne $EdgeProc -and -not $EdgeProc.HasExited) {
        Write-Step "Stop Edge"
        Stop-Process -Id $EdgeProc.Id -Force -ErrorAction SilentlyContinue
        try {
            $EdgeProc.WaitForExit(5000) | Out-Null
        } catch {
        }
    }

    Save-AsyncTextTask $script:StdoutTask $EdgeStdoutLog
    Save-AsyncTextTask $script:StderrTask $EdgeStderrLog
    if (-not (Test-Path $EventsLog)) {
        "" | Set-Content -Path $EventsLog -Encoding utf8
    }
    if (-not (Test-Path $BuildLog)) {
        "" | Set-Content -Path $BuildLog -Encoding utf8
    }

    Format-Result
}

exit $ExitCode
