#!/usr/bin/env pwsh
<#
AgentHub P0 Desktop/Edge/CLI smoke.

This script validates the smallest no-secret, no-spend path:
Desktop app surface -> bundled Local Edge sidecar binary -> Edge health ->
selected CLI binary/version probe. It never submits a model run, never reads
CLI auth files, and never performs TokenDanceID login.
#>

[CmdletBinding()]
param(
    [string]$RepoRoot = ".",
    [ValidateSet("codex", "claude-code", "opencode", "mock")]
    [string]$Runtime = "mock",
    [string]$CliPath = "",
    [int]$Port = 3298,
    [int]$TimeoutSec = 30,
    [string]$ArtifactRoot = ".tmp\p0-desktop-edge-cli-smoke",
    [switch]$SkipSidecarBuild,
    [switch]$SkipDesktopDev,
    [switch]$RequireDesktopDev,
    [switch]$StartTauriDev,
    [switch]$KeepServices
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path $RepoRoot).ProviderPath
$Started = New-Object System.Collections.Generic.List[object]
$Failures = New-Object System.Collections.Generic.List[string]
$Warnings = New-Object System.Collections.Generic.List[string]
$desktopStatus = "not_started"
$tauriDevStatus = "not_requested"
$edgeStarted = $false
$SecretLikePattern = '(?i)(sk-[a-z0-9_-]{8,}|gh[pousr]_[a-z0-9_]{8,}|xox[baprs]-[a-z0-9-]+|AKIA[0-9A-Z]{12,}|-----BEGIN [A-Z ]*PRIV(?:ATE) KEY-----|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|(?:token|secret|api[_-]?key|password|authorization)\s*[:=]\s*\S+)'

function Step([string]$Text) {
    Write-Host "`n=== $Text ===" -ForegroundColor Cyan
}

function Pass([string]$Text) {
    Write-Host "PASS $Text" -ForegroundColor Green
}

function Warn-Smoke([string]$Text) {
    [void]$Warnings.Add($Text)
    Write-Host "WARN $Text" -ForegroundColor Yellow
}

function Fail-Smoke([string]$Text) {
    [void]$Failures.Add($Text)
    Write-Host "FAIL $Text" -ForegroundColor Red
}

function Assert-True([bool]$Condition, [string]$Text) {
    if ($Condition) { Pass $Text } else { Fail-Smoke $Text }
}

function Redact([string]$Text) {
    if ([string]::IsNullOrWhiteSpace($Text)) { return $Text }
    $safe = $Text -replace [regex]::Escape($RepoRoot), "<repo>"
    $safe = $safe -replace $SecretLikePattern, "<redacted>"
    return $safe
}

function Join-Repo([string]$Path) {
    if ([System.IO.Path]::IsPathRooted($Path)) { return $Path }
    return Join-Path $RepoRoot $Path
}

function Test-LoopbackUrl([string]$Url) {
    return $Url -match '^http://(127\.0\.0\.1|localhost):\d+(/.*)?$'
}

function Resolve-Executable([string]$Value) {
    if ([string]::IsNullOrWhiteSpace($Value)) { return "" }
    if ([System.IO.Path]::IsPathRooted($Value) -and (Test-Path -LiteralPath $Value -PathType Leaf)) {
        return (Resolve-Path $Value).ProviderPath
    }
    $cmd = Get-Command $Value -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($cmd) { return $cmd.Source }
    return ""
}

function Resolve-Cli {
    if ($Runtime -eq "mock") { return "" }
    if (-not [string]::IsNullOrWhiteSpace($CliPath)) {
        return Resolve-Executable $CliPath
    }
    switch ($Runtime) {
        "codex" {
            if ($env:AGENTHUB_CODEX_PATH) { return Resolve-Executable $env:AGENTHUB_CODEX_PATH }
            if ($env:CODEX_PATH) { return Resolve-Executable $env:CODEX_PATH }
            return Resolve-Executable "codex"
        }
        "claude-code" {
            if ($env:AGENTHUB_CLAUDE_CODE_PATH) { return Resolve-Executable $env:AGENTHUB_CLAUDE_CODE_PATH }
            return Resolve-Executable "claude"
        }
        "opencode" {
            if ($env:AGENTHUB_OPENCODE_PATH) { return Resolve-Executable $env:AGENTHUB_OPENCODE_PATH }
            if ($env:OPENCODE_PATH) { return Resolve-Executable $env:OPENCODE_PATH }
            return Resolve-Executable "opencode"
        }
    }
}

function Get-CliPathFlag {
    switch ($Runtime) {
        "codex" { return "--codex-path" }
        "claude-code" { return "--claude-code-path" }
        "opencode" { return "--opencode-path" }
        default { return "" }
    }
}

function Invoke-CliVersionProbe([string]$Path) {
    if ([string]::IsNullOrWhiteSpace($Path)) {
        return [ordered]@{ status = "skipped"; command_name = $null; output = $null; reason = "Runtime is mock or CLI is not installed" }
    }
    $old = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $output = & $Path --version 2>&1 | Out-String
        $exitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $old
    }
    $trimmed = (Redact $output).Trim()
    if ($exitCode -eq 0 -and -not [string]::IsNullOrWhiteSpace($trimmed)) {
        return [ordered]@{ status = "passed"; command_name = Split-Path -Leaf $Path; output = $trimmed; reason = "no-spend version probe only" }
    }
    return [ordered]@{ status = "blocked"; command_name = Split-Path -Leaf $Path; output = $trimmed; reason = "--version probe failed with exit code $exitCode" }
}

function Join-NativeArguments {
    param([string[]]$Arguments)

    $quoted = foreach ($arg in $Arguments) {
        if ($null -eq $arg) {
            '""'
            continue
        }
        if ($arg -notmatch '[\s"]' -and $arg.Length -gt 0) {
            $arg
            continue
        }

        $builder = [System.Text.StringBuilder]::new()
        [void]$builder.Append('"')
        $slashes = 0
        foreach ($char in $arg.ToCharArray()) {
            if ($char -eq '\') {
                $slashes++
                continue
            }
            if ($char -eq '"') {
                [void]$builder.Append(('\' * (($slashes * 2) + 1)))
                [void]$builder.Append('"')
                $slashes = 0
                continue
            }
            if ($slashes -gt 0) {
                [void]$builder.Append(('\' * $slashes))
                $slashes = 0
            }
            [void]$builder.Append($char)
        }
        if ($slashes -gt 0) {
            [void]$builder.Append(('\' * ($slashes * 2)))
        }
        [void]$builder.Append('"')
        $builder.ToString()
    }

    return ($quoted -join " ")
}

function Start-ManagedProcess {
    param(
        [string]$Name,
        [string]$FileName,
        [string[]]$Arguments,
        [string]$WorkingDirectory,
        [string]$StdoutPath,
        [string]$StderrPath
    )
    $psi = [System.Diagnostics.ProcessStartInfo]::new()
    $psi.FileName = $FileName
    $psi.Arguments = Join-NativeArguments $Arguments
    $psi.WorkingDirectory = $WorkingDirectory
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true
    $proc = [System.Diagnostics.Process]::new()
    $proc.StartInfo = $psi
    [void]$proc.Start()
    $stdoutTask = $proc.StandardOutput.ReadToEndAsync()
    $stderrTask = $proc.StandardError.ReadToEndAsync()
    [void]$Started.Add([pscustomobject]@{ name = $Name; process = $proc; stdout = $StdoutPath; stderr = $StderrPath; stdoutTask = $stdoutTask; stderrTask = $stderrTask; file = $FileName })
    return $proc
}

function Test-DesktopDependencies {
    $desktopNodeModules = Join-Path $RepoRoot "app\desktop\node_modules"
    $appNodeModules = Join-Path $RepoRoot "app\node_modules"
    return (Test-Path -LiteralPath $desktopNodeModules -PathType Container) -or (Test-Path -LiteralPath $appNodeModules -PathType Container)
}

function Save-StartedLogs {
    foreach ($entry in $Started) {
        try {
            if ($entry.stdoutTask.IsCompleted) { $entry.stdoutTask.Result | Set-Content -LiteralPath $entry.stdout -Encoding UTF8 }
            if ($entry.stderrTask.IsCompleted) { $entry.stderrTask.Result | Set-Content -LiteralPath $entry.stderr -Encoding UTF8 }
        } catch {}
    }
}

function Stop-Started {
    if ($KeepServices) { return }
    foreach ($entry in $Started) {
        $proc = $entry.process
        if ($proc -and -not $proc.HasExited) {
            Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
        }
    }
}

function Test-HttpHealth([string]$Url, [int]$Seconds) {
    $deadline = (Get-Date).AddSeconds($Seconds)
    while ((Get-Date) -lt $deadline) {
        try {
            $body = Invoke-RestMethod -Uri $Url -TimeoutSec 2
            return $body
        } catch {
            Start-Sleep -Milliseconds 300
        }
    }
    return $null
}

Write-Host "AgentHub P0 Desktop/Edge/CLI no-spend smoke" -ForegroundColor Magenta
Write-Host "Boundary: no secrets, no real model run, no TokenDanceID login, no deploy/signing/release." -ForegroundColor Magenta

if ($Port -le 0 -or $Port -gt 65535) { Fail-Smoke "-Port must be between 1 and 65535" }
if (-not (Test-LoopbackUrl "http://127.0.0.1:$Port")) { Fail-Smoke "Edge URL must be loopback" }
foreach ($inputValue in @($CliPath, $ArtifactRoot)) {
    if ($inputValue -match $SecretLikePattern) { Fail-Smoke "input contains secret-like content" }
}

$ArtifactRoot = [System.IO.Path]::GetFullPath((Join-Repo $ArtifactRoot))
$allowedArtifactRoot = [System.IO.Path]::GetFullPath((Join-Path $RepoRoot ".tmp\p0-desktop-edge-cli-smoke"))
if (-not ($ArtifactRoot -eq $allowedArtifactRoot -or $ArtifactRoot.StartsWith($allowedArtifactRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase))) {
    Fail-Smoke "ArtifactRoot must stay under .tmp\p0-desktop-edge-cli-smoke"
}
New-Item -ItemType Directory -Force -Path $ArtifactRoot | Out-Null
$EvidencePath = Join-Path $ArtifactRoot "smoke-result.json"
$LogRoot = Join-Path $ArtifactRoot "logs"
New-Item -ItemType Directory -Force -Path $LogRoot | Out-Null

$cliResolved = Resolve-Cli
$cliProbe = Invoke-CliVersionProbe $cliResolved

try {
    if ($Failures.Count -eq 0) {
        Step "Tauri sidecar binary"
        $prepareArgs = @("-NoProfile", "-File", (Join-Path $RepoRoot "scripts\prepare-tauri-sidecar-local.ps1"), "-RepoRoot", $RepoRoot)
        if ($SkipSidecarBuild) { $prepareArgs += "-NoBuild" }
        & pwsh @prepareArgs
        if ($LASTEXITCODE -ne 0) { Fail-Smoke "prepare-tauri-sidecar-local.ps1 failed" }
        & pwsh -NoProfile -File (Join-Path $RepoRoot "scripts\verify-tauri-sidecar-binary-smoke.ps1") -RepoRoot $RepoRoot
        if ($LASTEXITCODE -ne 0) { Fail-Smoke "verify-tauri-sidecar-binary-smoke.ps1 failed" }
        $sidecar = Join-Path $RepoRoot "app\desktop\src-tauri\binaries\agenthub-edge-x86_64-pc-windows-msvc.exe"
        Assert-True (Test-Path -LiteralPath $sidecar -PathType Leaf) "Tauri sidecar binary exists"

        Step "Desktop app surface"
        if ($SkipDesktopDev) {
            Warn-Smoke "Desktop Vite startup skipped by caller"
        } elseif (-not (Test-DesktopDependencies)) {
            $desktopStatus = "blocked"
            $message = "Desktop app dependencies are missing; run package install before requiring Desktop app startup"
            if ($RequireDesktopDev) { Fail-Smoke $message } else { Warn-Smoke $message }
        } else {
            $corepack = Get-Command corepack.cmd -ErrorAction SilentlyContinue
            if ($corepack) {
                Start-ManagedProcess -Name "desktop-vite" -FileName $corepack.Source -Arguments @("pnpm", "--dir", (Join-Path $RepoRoot "app\desktop"), "exec", "vite", "--host", "127.0.0.1", "--port", "5173", "--strictPort") -WorkingDirectory (Join-Path $RepoRoot "app\desktop") -StdoutPath (Join-Path $LogRoot "desktop-vite.stdout.log") -StderrPath (Join-Path $LogRoot "desktop-vite.stderr.log") | Out-Null
                $desktopProbe = Test-HttpHealth "http://127.0.0.1:5173" ([Math]::Min(10, $TimeoutSec))
                if ($null -ne $desktopProbe) {
                    $desktopStatus = "started"
                    Pass "Desktop Vite app surface started on 127.0.0.1:5173"
                } else {
                    $desktopStatus = "blocked"
                    $message = "Desktop Vite app surface did not start"
                    if ($RequireDesktopDev) { Fail-Smoke $message } else { Warn-Smoke $message }
                }
            } else {
                $desktopStatus = "blocked"
                $message = "corepack.cmd unavailable for Desktop Vite startup"
                if ($RequireDesktopDev) { Fail-Smoke $message } else { Warn-Smoke $message }
            }
        }
        if ($StartTauriDev) {
            $corepack = Get-Command corepack.cmd -ErrorAction SilentlyContinue
            if ($corepack) {
                Start-ManagedProcess -Name "tauri-dev" -FileName $corepack.Source -Arguments @("pnpm", "--dir", (Join-Path $RepoRoot "app\desktop"), "tauri", "dev") -WorkingDirectory (Join-Path $RepoRoot "app\desktop") -StdoutPath (Join-Path $LogRoot "tauri-dev.stdout.log") -StderrPath (Join-Path $LogRoot "tauri-dev.stderr.log") | Out-Null
                Start-Sleep -Seconds ([Math]::Min(8, $TimeoutSec))
                $tauriDevStatus = "started_probe_only"
                Pass "Tauri dev process launched for startup probe"
            } else {
                $tauriDevStatus = "blocked"
                Fail-Smoke "corepack.cmd unavailable for Tauri dev startup"
            }
        }

        Step "CLI binary no-spend probe"
        if ($Runtime -eq "mock") {
            Pass "Runtime=mock uses built-in mock runner; CLI probe intentionally skipped"
        } elseif ($cliProbe.status -eq "passed") {
            Pass "$Runtime CLI binary is visible via --version"
        } else {
            Fail-Smoke "$Runtime CLI binary/probe is not available: $($cliProbe.reason)"
        }

        Step "Local Edge startup"
        $edgeUrl = "http://127.0.0.1:$Port"
        $edgeHealth = "$edgeUrl/v1/health"
        $edgeDb = Join-Path $ArtifactRoot "agenthub-edge.sqlite"
        $edgeEventLog = Join-Path $ArtifactRoot "edge-event-log.ndjson"
        $edgeArgs = @("--addr", "127.0.0.1:$Port", "--dev", "--store-backend", "sqlite", "--store-db", $edgeDb, "--event-log-path", $edgeEventLog)
        if ($Runtime -eq "mock") {
            $edgeArgs += @("--runner-profile", "agenthub-runner-mock")
        } else {
            $edgeArgs += @("--runner-profile", $Runtime, (Get-CliPathFlag), $cliResolved)
        }
        $edgeProc = Start-ManagedProcess -Name "local-edge-sidecar" -FileName $sidecar -Arguments $edgeArgs -WorkingDirectory $RepoRoot -StdoutPath (Join-Path $LogRoot "edge.stdout.log") -StderrPath (Join-Path $LogRoot "edge.stderr.log")
        $health = Test-HttpHealth $edgeHealth $TimeoutSec
        if ($null -eq $health) {
            Fail-Smoke "Local Edge did not become healthy"
        } else {
            $edgeStarted = $true
            Pass "Local Edge sidecar started and /v1/health responded"
        }
    }
} finally {
    Stop-Started
    Save-StartedLogs
}

$passed = $Failures.Count -eq 0
$evidence = [ordered]@{
    schema = "agenthub-p0-desktop-edge-cli-smoke-v1"
    status = if ($passed) { "P0_DESKTOP_EDGE_CLI_SMOKE_PASSED" } else { "P0_DESKTOP_EDGE_CLI_SMOKE_FAILED" }
    generated_at = (Get-Date).ToString("o")
    repo_root = "<repo>"
    artifact_root = ".tmp/p0-desktop-edge-cli-smoke"
    runtime = $Runtime
    claims = [ordered]@{
        tauri_app_startup = if ($StartTauriDev) { $tauriDevStatus } else { "not_requested" }
        desktop_app_surface = $desktopStatus
        sidecar_edge_started = $edgeStarted
        cli_binary_probe_visible = ($cliProbe.status -eq "passed")
        mock_adapter_used = ($Runtime -eq "mock")
        real_cli_tested = $false
        real_model_tested = $false
        tokendance_id_login = $false
        real_api_budget_spend = $false
    }
    cli_probe = $cliProbe
    edge = [ordered]@{
        url = "http://127.0.0.1:$Port"
        health_path = "/v1/health"
        runner_profile = if ($Runtime -eq "mock") { "agenthub-runner-mock" } else { $Runtime }
        model_run_submitted = $false
    }
    logs = [ordered]@{ root = "logs" }
    failures = @($Failures)
    warnings = @($Warnings)
    blockers = @(
        "Real model execution is intentionally not performed by this smoke.",
        "TokenDanceID login is intentionally not performed by this smoke.",
        "CLI auth files and secret env values are not read or recorded."
    )
}
($evidence | ConvertTo-Json -Depth 12) | Set-Content -LiteralPath $EvidencePath -Encoding UTF8

Write-Host "EvidencePath: $EvidencePath" -ForegroundColor White
Write-Host "TauriAppStartup=$($evidence.claims.tauri_app_startup)" -ForegroundColor White
Write-Host "SidecarEdgeStarted=$($evidence.claims.sidecar_edge_started)" -ForegroundColor White
Write-Host "CliBinaryProbeVisible=$($evidence.claims.cli_binary_probe_visible)" -ForegroundColor White
Write-Host "RealCliTested=false" -ForegroundColor White
Write-Host "RealModelTested=false" -ForegroundColor White
Write-Host "TokenDanceIDLogin=false" -ForegroundColor White

if ($passed) {
    Write-Host "Status: P0_DESKTOP_EDGE_CLI_SMOKE_PASSED" -ForegroundColor Green
    exit 0
}

Write-Host "Status: P0_DESKTOP_EDGE_CLI_SMOKE_FAILED" -ForegroundColor Red
exit 1
