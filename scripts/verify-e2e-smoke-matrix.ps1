#!/usr/bin/env pwsh
<#
AgentHub E2E/smoke matrix runner.

Runs the CI-safe real-surface smoke set for Web approved-real mode,
Desktop renderer/Tauri dry gates, Local Edge/Hub service health, and
approval/artifact replay. Real TokenDance ID login and live Hub dispatch are
recorded as BLOCKED_WITH_EVIDENCE unless the separate approval gate is satisfied.
#>

[CmdletBinding()]
param(
    [string]$RepoRoot = ".",
    [string]$ArtifactRoot = "",
    [string]$OutputPath = "",
    [int]$CommandTimeoutSec = 180,
    [switch]$SkipWebE2E,
    [switch]$SkipDesktopE2E,
    [switch]$SkipLocalStack,
    [switch]$SkipEdgeClientSmoke,
    [switch]$SkipLoginReadiness,
    [switch]$SkipTauriDry,
    [switch]$RequireHub,
    [switch]$RequireRealLogin
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path $RepoRoot).ProviderPath
if ([string]::IsNullOrWhiteSpace($ArtifactRoot)) {
    $ArtifactRoot = Join-Path $RepoRoot ".tmp\e2e-smoke-matrix\run-$PID"
}
if (-not [System.IO.Path]::IsPathRooted($ArtifactRoot)) {
    $ArtifactRoot = Join-Path $RepoRoot $ArtifactRoot
}
$ArtifactRoot = [System.IO.Path]::GetFullPath($ArtifactRoot)
if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    $OutputPath = Join-Path $ArtifactRoot "e2e-smoke-matrix.json"
}
if (-not [System.IO.Path]::IsPathRooted($OutputPath)) {
    $OutputPath = Join-Path $RepoRoot $OutputPath
}
$OutputPath = [System.IO.Path]::GetFullPath($OutputPath)

$Rows = @()
$StartedAt = Get-Date

function Test-PathUnderRoot {
    param([string]$Path, [string]$Root)

    $full = [System.IO.Path]::GetFullPath($Path).TrimEnd([char[]]@('\', '/'))
    $rootFull = [System.IO.Path]::GetFullPath($Root).TrimEnd([char[]]@('\', '/'))
    if ($full.Equals($rootFull, [System.StringComparison]::OrdinalIgnoreCase)) {
        return $true
    }
    return $full.StartsWith($rootFull + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)
}

function Redact-SecretLike {
    param([string]$Value)

    if ([string]::IsNullOrEmpty($Value)) {
        return $Value
    }
    $safe = $Value
    $safe = $safe -replace '(?i)(Authorization:\s*Bearer\s+)[^"''\s,}]+', '${1}<redacted-token>'
    $safe = $safe -replace '(?i)(bearer\s+)[a-z0-9._-]{12,}', '${1}<redacted-token>'
    $safe = $safe -replace '(?i)\b(sk|ghp|gho|ghu|ghs|glpat|xox[baprs])-[-_A-Za-z0-9]{8,}', '<redacted-token>'
    $safe = $safe -replace '(?i)((?:access[_-]?token|refresh[_-]?token|id[_-]?token|client_secret|password)\s*[=:]\s*)[^"''\s,}]+', '${1}<redacted-secret>'
    $safe = $safe -replace '(?i)("?(?:access[_-]?token|refresh[_-]?token|id[_-]?token|client_secret|password)"?\s*:\s*")[^"]+', '${1}<redacted-secret>'
    return $safe
}

function Shorten-Text {
    param([string]$Text, [int]$Max = 5000)

    $safe = Redact-SecretLike $Text
    if ($safe.Length -le $Max) {
        return $safe
    }
    return $safe.Substring(0, $Max) + "`n...<truncated>..."
}

function Get-CommandPath {
    param([object]$CommandInfo)

    if ($null -eq $CommandInfo) {
        return ""
    }
    if (-not [string]::IsNullOrWhiteSpace($CommandInfo.Source)) {
        return $CommandInfo.Source
    }
    if (-not [string]::IsNullOrWhiteSpace($CommandInfo.Path)) {
        return $CommandInfo.Path
    }
    return [string]$CommandInfo.Name
}

function Get-FreePort {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Parse("127.0.0.1"), 0)
    $listener.Start()
    try {
        return $listener.LocalEndpoint.Port
    }
    finally {
        $listener.Stop()
    }
}

function Join-NativeArguments {
    param([string[]]$Arguments)

    $quoted = foreach ($arg in $Arguments) {
        if ($null -eq $arg) {
            '""'
            continue
        }
        if ($arg.Length -gt 0 -and $arg -notmatch '[\s"]') {
            $arg
            continue
        }
        '"' + ($arg -replace '\\(?=")', '\\' -replace '"', '\"') + '"'
    }
    return ($quoted -join " ")
}

function Invoke-MatrixCommand {
    param(
        [string]$Name,
        [string]$Area,
        [string]$Command,
        [string[]]$Arguments,
        [string]$WorkingDirectory,
        [int[]]$BlockedExitCodes = @(),
        [string]$BlockedReason = "",
        [switch]$Skipped,
        [string]$SkipReason = ""
    )

    if ($Skipped) {
        $script:Rows += [pscustomobject][ordered]@{
            name = $Name
            area = $Area
            status = "skipped"
            exit_code = $null
            duration_ms = 0
            command = "$Command $(Join-NativeArguments $Arguments)"
            working_directory = $WorkingDirectory
            evidence = $SkipReason
        }
        Write-Host "SKIP  $Name - $SkipReason" -ForegroundColor Yellow
        return
    }

    $started = Get-Date
    if ([string]::IsNullOrWhiteSpace($Command)) {
        $script:Rows += [pscustomobject][ordered]@{
            name = $Name
            area = $Area
            status = "failed"
            exit_code = "missing-command"
            duration_ms = 0
            command = ""
            working_directory = $WorkingDirectory
            evidence = "Command path could not be resolved."
        }
        Write-Host "FAIL  $Name - command path could not be resolved" -ForegroundColor Red
        return
    }
    $psi = [System.Diagnostics.ProcessStartInfo]::new()
    $psi.FileName = $Command
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true
    $psi.WorkingDirectory = $WorkingDirectory
    $psi.Arguments = Join-NativeArguments $Arguments
    $psi.EnvironmentVariables["AGENTHUB_EDGE_AUTH_TOKEN"] = ""

    Write-Host "RUN   $Name" -ForegroundColor Cyan
    $proc = [System.Diagnostics.Process]::Start($psi)
    $stdoutBuilder = [System.Text.StringBuilder]::new()
    $stderrBuilder = [System.Text.StringBuilder]::new()
    $stdoutEvent = Register-ObjectEvent -InputObject $proc -EventName OutputDataReceived -MessageData $stdoutBuilder -Action {
        if ($null -ne $EventArgs.Data) {
            [void]$Event.MessageData.AppendLine($EventArgs.Data)
        }
    }
    $stderrEvent = Register-ObjectEvent -InputObject $proc -EventName ErrorDataReceived -MessageData $stderrBuilder -Action {
        if ($null -ne $EventArgs.Data) {
            [void]$Event.MessageData.AppendLine($EventArgs.Data)
        }
    }
    $proc.BeginOutputReadLine()
    $proc.BeginErrorReadLine()
    if (-not $proc.WaitForExit($CommandTimeoutSec * 1000)) {
        try { $proc.Kill($true) } catch { $proc.Kill() }
        Start-Sleep -Milliseconds 200
        Unregister-Event -SubscriptionId $stdoutEvent.Id -ErrorAction SilentlyContinue
        Unregister-Event -SubscriptionId $stderrEvent.Id -ErrorAction SilentlyContinue
        Remove-Job -Id $stdoutEvent.Id, $stderrEvent.Id -Force -ErrorAction SilentlyContinue
        $stdout = $stdoutBuilder.ToString()
        $stderr = $stderrBuilder.ToString()
        $script:Rows += [pscustomobject][ordered]@{
            name = $Name
            area = $Area
            status = "failed"
            exit_code = "timeout"
            duration_ms = [int]((Get-Date) - $started).TotalMilliseconds
            command = "$Command $(Join-NativeArguments $Arguments)"
            working_directory = $WorkingDirectory
            evidence = Shorten-Text "Timed out after $CommandTimeoutSec seconds.`n$stdout`n$stderr"
        }
        Write-Host "FAIL  $Name - timeout" -ForegroundColor Red
        return
    }
    $proc.WaitForExit()

    Start-Sleep -Milliseconds 100
    Unregister-Event -SubscriptionId $stdoutEvent.Id -ErrorAction SilentlyContinue
    Unregister-Event -SubscriptionId $stderrEvent.Id -ErrorAction SilentlyContinue
    Remove-Job -Id $stdoutEvent.Id, $stderrEvent.Id -Force -ErrorAction SilentlyContinue
    $stdout = $stdoutBuilder.ToString()
    $stderr = $stderrBuilder.ToString()
    $exitCode = $proc.ExitCode
    $status = if ($exitCode -eq 0) {
        "passed"
    } elseif ($BlockedExitCodes -contains $exitCode) {
        "blocked_with_evidence"
    } else {
        "failed"
    }
    $evidenceText = if ($status -eq "blocked_with_evidence" -and -not [string]::IsNullOrWhiteSpace($BlockedReason)) {
        "$BlockedReason`n$stdout`n$stderr"
    } else {
        "$stdout`n$stderr"
    }

    $script:Rows += [pscustomobject][ordered]@{
        name = $Name
        area = $Area
        status = $status
        exit_code = $exitCode
        duration_ms = [int]((Get-Date) - $started).TotalMilliseconds
        command = "$Command $(Join-NativeArguments $Arguments)"
        working_directory = $WorkingDirectory
        evidence = Shorten-Text $evidenceText
    }

    if ($status -eq "passed") {
        Write-Host "PASS  $Name" -ForegroundColor Green
    } elseif ($status -eq "blocked_with_evidence") {
        Write-Host "BLOCK $Name" -ForegroundColor Yellow
    } else {
        Write-Host "FAIL  $Name" -ForegroundColor Red
    }
}

New-Item -ItemType Directory -Force -Path $ArtifactRoot | Out-Null
if (-not (Test-PathUnderRoot -Path $OutputPath -Root $ArtifactRoot)) {
    Write-Host "FAIL: OutputPath must stay under ArtifactRoot" -ForegroundColor Red
    exit 1
}

$powershell = (Get-Command pwsh -ErrorAction SilentlyContinue)
if (-not $powershell) {
    $powershell = Get-Command powershell -ErrorAction Stop
}
$PowerShellPath = Get-CommandPath $powershell
$corepack = Get-Command corepack.cmd -ErrorAction SilentlyContinue
if (-not $corepack) {
    $corepack = Get-Command corepack -ErrorAction SilentlyContinue
}
$CorepackPath = Get-CommandPath $corepack
$EdgeClientSmokeAddr = "127.0.0.1:$(Get-FreePort)"

if ($null -eq $corepack) {
    Invoke-MatrixCommand -Name "web-real-mode-playwright" -Area "web" -Command "corepack" -Arguments @() -WorkingDirectory $RepoRoot -Skipped -SkipReason "corepack is unavailable"
    Invoke-MatrixCommand -Name "desktop-renderer-playwright" -Area "desktop" -Command "corepack" -Arguments @() -WorkingDirectory $RepoRoot -Skipped -SkipReason "corepack is unavailable"
} else {
    Invoke-MatrixCommand `
        -Name "web-real-mode-playwright" `
        -Area "web" `
        -Command $CorepackPath `
        -Arguments @("pnpm", "--dir", (Join-Path $RepoRoot "app\web"), "run", "test:e2e:real-mode") `
        -WorkingDirectory (Join-Path $RepoRoot "app\web") `
        -Skipped:$SkipWebE2E `
        -SkipReason "skipped by -SkipWebE2E"

    Invoke-MatrixCommand `
        -Name "desktop-renderer-playwright" `
        -Area "desktop" `
        -Command $CorepackPath `
        -Arguments @("pnpm", "--dir", (Join-Path $RepoRoot "app\desktop"), "run", "test:e2e:smoke") `
        -WorkingDirectory (Join-Path $RepoRoot "app\desktop") `
        -Skipped:$SkipDesktopE2E `
        -SkipReason "skipped by -SkipDesktopE2E"
}

Invoke-MatrixCommand `
    -Name "localhost-services-smoke" `
    -Area "services" `
    -Command $PowerShellPath `
    -Arguments @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $RepoRoot "scripts\verify-localhost-real-stack-smoke.ps1"), "-RepoRoot", $RepoRoot, "-ArtifactRoot", (Join-Path $RepoRoot ".tmp\localhost-real-stack-smoke\e2e-matrix-$PID"), "-ProbeHub") `
    -WorkingDirectory $RepoRoot `
    -Skipped:$SkipLocalStack `
    -SkipReason "skipped by -SkipLocalStack"

Invoke-MatrixCommand `
    -Name "edge-client-smoke" `
    -Area "edge" `
    -Command $PowerShellPath `
    -Arguments @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $RepoRoot "scripts\client-smoke.ps1"), "-EdgeAddr", $EdgeClientSmokeAddr, "-EdgeAuthToken", "local-smoke-token", "-SkipGoTests", "-SkipCancel") `
    -WorkingDirectory $RepoRoot `
    -Skipped:$SkipEdgeClientSmoke `
    -SkipReason "skipped by -SkipEdgeClientSmoke"

Invoke-MatrixCommand `
    -Name "login-real-readiness-gate" `
    -Area "auth" `
    -Command $PowerShellPath `
    -Arguments @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $RepoRoot "scripts\verify-login-e2e-readiness.ps1"), "-RepoRoot", $RepoRoot, "-OutputPath", (Join-Path $ArtifactRoot "login-readiness.json")) `
    -WorkingDirectory $RepoRoot `
    -BlockedExitCodes @(2) `
    -BlockedReason "BLOCKED_WITH_EVIDENCE: real login/remote dispatch needs explicit approved test account, callback, Hub URL, artifact boundary, and operator approval metadata." `
    -Skipped:$SkipLoginReadiness `
    -SkipReason "skipped by -SkipLoginReadiness"

Invoke-MatrixCommand `
    -Name "desktop-tauri-dry-smoke" `
    -Area "tauri" `
    -Command $PowerShellPath `
    -Arguments @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $RepoRoot "scripts\verify-tauri-package-dry.ps1"), "-RepoRoot", $RepoRoot, "-ArtifactsRoot", (Join-Path $ArtifactRoot "tauri-dry"), "-SkipInstall", "-SkipExecutableCompile") `
    -WorkingDirectory $RepoRoot `
    -Skipped:$SkipTauriDry `
    -SkipReason "skipped by -SkipTauriDry"

$failed = @($Rows | Where-Object { $_.status -eq "failed" })
$blocked = @($Rows | Where-Object { $_.status -eq "blocked_with_evidence" })
if ($RequireHub) {
    $localStackRow = @($Rows | Where-Object { $_.name -eq "localhost-services-smoke" })[0]
    if ($localStackRow -and $localStackRow.evidence -match '"name"\s*:\s*"hub"[^}]*"status"\s*:\s*"missing"') {
        $failed += [pscustomobject]@{ name = "hub-required"; status = "failed" }
    }
}
if ($RequireRealLogin -and $blocked.Count -gt 0) {
    $failed += [pscustomobject]@{ name = "real-login-required"; status = "failed" }
}

$overall = if ($failed.Count -gt 0) {
    "failed"
} elseif ($blocked.Count -gt 0) {
    "passed_with_blockers"
} else {
    "passed"
}

$manifest = [ordered]@{
    schema = "agenthub-e2e-smoke-matrix-v1"
    status = $overall
    generated_at = (Get-Date).ToString("o")
    started_at = $StartedAt.ToString("o")
    repo_root = $RepoRoot
    artifact_root = $ArtifactRoot
    rows = @($Rows)
    blocked_count = $blocked.Count
    failed_count = $failed.Count
    boundaries = [ordered]@{
        secrets_handled = $false
        real_tokendance_id_login_executed = $false
        real_cli_or_model_execution_required = $false
        web_direct_local_edge_allowed = $false
        hub_probe_only_without_db_redis = $true
    }
}

$manifest | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $OutputPath -Encoding UTF8

Write-Host "Matrix: $overall" -ForegroundColor $(if ($overall -eq "failed") { "Red" } elseif ($overall -eq "passed_with_blockers") { "Yellow" } else { "Green" })
Write-Host "EvidencePath: $OutputPath"
Write-Host "BlockedWithEvidence: $($blocked.Count)"
Write-Host "Failed: $($failed.Count)"

if ($failed.Count -gt 0) {
    exit 1
}
exit 0
