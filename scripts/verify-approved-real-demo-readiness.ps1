#!/usr/bin/env pwsh
<#
AgentHub approved-real/no-secret demo readiness runner.

Composes existing no-spend gates into a redacted manifest for a recordable
Web -> Hub -> Desktop/Edge -> mock adapter -> replay demo rehearsal. It never
performs TokenDanceID login, real CLI/model/API calls, deployment, signing,
release upload, or Mobile work.
#>

[CmdletBinding()]
param(
    [string]$RepoRoot = ".",
    [string]$ArtifactRoot = "",
    [string]$ManifestPath = "",
    [string]$PreflightManifestPath = "",
    [string[]]$WebSmokeManifestPath = @(),
    [switch]$SkipObservedFixture,
    [switch]$RunLocalStackSmoke,
    [int]$TimeoutSec = 12
)

$ErrorActionPreference = "Stop"

if ($TimeoutSec -le 0) {
    Write-Host "FAIL: -TimeoutSec must be greater than zero." -ForegroundColor Red
    exit 2
}

$RepoRoot = (Resolve-Path $RepoRoot).ProviderPath
if ([string]::IsNullOrWhiteSpace($ArtifactRoot)) {
    $ArtifactRoot = Join-Path $RepoRoot ".tmp\approved-real-demo-readiness\run-$PID"
} elseif (-not [System.IO.Path]::IsPathRooted($ArtifactRoot)) {
    $ArtifactRoot = Join-Path $RepoRoot $ArtifactRoot
}
$ArtifactRoot = [System.IO.Path]::GetFullPath($ArtifactRoot)

if ([string]::IsNullOrWhiteSpace($ManifestPath)) {
    $ManifestPath = Join-Path $ArtifactRoot "redacted-manifest.json"
} elseif (-not [System.IO.Path]::IsPathRooted($ManifestPath)) {
    $ManifestPath = Join-Path $RepoRoot $ManifestPath
}
$ManifestPath = [System.IO.Path]::GetFullPath($ManifestPath)

$EvidenceDir = Join-Path $ArtifactRoot "evidence"
$Failures = @()
$Warnings = @()
$Segments = @()
$Files = @()
$GeneratedAt = Get-Date

function Add-Failure([string]$Text) {
    $script:Failures += $Text
    Write-Host "FAIL: $Text" -ForegroundColor Red
}

function Add-Warning([string]$Text) {
    $script:Warnings += $Text
    Write-Host "WARN: $Text" -ForegroundColor Yellow
}

function Pass([string]$Text) {
    Write-Host "PASS: $Text" -ForegroundColor Green
}

function Redact-SecretLike {
    param([string]$Value)

    if ([string]::IsNullOrEmpty($Value)) {
        return $Value
    }

    $safe = $Value
    $safe = $safe -replace '(?i)(Authorization:\s*Bearer\s+)[^"''\s,}]+', '${1}<redacted-token>'
    $safe = $safe -replace '(?i)(bearer\s+)[a-z0-9._-]{12,}', '${1}<redacted-token>'
    $safe = $safe -replace '(?i)(sk|ghp|gho|ghu|ghs|glpat|xox[baprs])-[-_A-Za-z0-9]{8,}', '<redacted-token>'
    $safe = $safe -replace '(?i)((?:access[_-]?token|refresh[_-]?token|id[_-]?token|client_secret|password|api[_-]?key)\s*[=:]\s*)[^"''\s,}]+', '${1}<redacted-secret>'
    $safe = $safe -replace '(?i)("?(?:access[_-]?token|refresh[_-]?token|id[_-]?token|client_secret|password|api[_-]?key)"?\s*:\s*")[^"]+', '${1}<redacted-secret>'
    return $safe
}

function Test-PathUnderRoot {
    param(
        [string]$Path,
        [string]$Root
    )

    $normalized = [System.IO.Path]::GetFullPath($Path).TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
    $normalizedRoot = [System.IO.Path]::GetFullPath($Root).TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
    if ($normalized.Equals($normalizedRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        return $true
    }
    $prefix = $normalizedRoot + [System.IO.Path]::DirectorySeparatorChar
    return $normalized.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)
}

function Test-AllowedArtifactRoot([string]$Path) {
    $tempBase = if (-not [string]::IsNullOrWhiteSpace($env:TEMP)) { $env:TEMP } else { [System.IO.Path]::GetTempPath() }
    foreach ($root in @(
        (Join-Path $RepoRoot ".tmp\approved-real-demo-readiness"),
        (Join-Path $RepoRoot "tmp\approved-real-demo-readiness"),
        (Join-Path $tempBase "AgentHub\approved-real-demo-readiness")
    )) {
        if (Test-PathUnderRoot -Path $Path -Root $root) {
            return $true
        }
    }
    return $false
}

function Join-NativeArguments {
    param([string[]]$Arguments)

    $quoted = foreach ($arg in $Arguments) {
        if ($null -eq $arg) { '""'; continue }
        if ($arg -notmatch '[\s"]' -and $arg.Length -gt 0) { $arg; continue }

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

function Find-PowerShell {
    $pwsh = Get-Command "pwsh" -ErrorAction SilentlyContinue
    if ($pwsh) { return $pwsh.Source }
    $powershell = Get-Command "powershell" -ErrorAction SilentlyContinue
    if ($powershell) { return $powershell.Source }
    return $null
}

function Invoke-RepoScript {
    param(
        [string]$RelativePath,
        [string[]]$Arguments
    )

    $scriptPath = Join-Path $RepoRoot $RelativePath
    $powershellExe = Find-PowerShell
    if (-not $powershellExe) {
        return [pscustomobject]@{ ExitCode = -1; Output = "PowerShell executable is unavailable"; ScriptPath = $scriptPath }
    }
    if (-not (Test-Path -LiteralPath $scriptPath -PathType Leaf)) {
        return [pscustomobject]@{ ExitCode = -1; Output = "missing $RelativePath"; ScriptPath = $scriptPath }
    }

    $psi = [System.Diagnostics.ProcessStartInfo]::new()
    $psi.FileName = $powershellExe
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.WorkingDirectory = $RepoRoot
    $psi.Arguments = Join-NativeArguments (@("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $scriptPath) + $Arguments)
    $proc = [System.Diagnostics.Process]::Start($psi)
    $stdout = $proc.StandardOutput.ReadToEnd()
    $stderr = $proc.StandardError.ReadToEnd()
    $proc.WaitForExit()

    return [pscustomobject]@{
        ExitCode = $proc.ExitCode
        Output = Redact-SecretLike ($stdout + "`n" + $stderr)
        ScriptPath = $scriptPath
    }
}

function Add-Segment {
    param(
        [string]$Name,
        [string]$Mode,
        [int]$ExitCode,
        [string]$Evidence = "",
        [string]$Output = ""
    )

    $status = if ($ExitCode -eq 0) { "PASS" } else { "FAIL" }
    $script:Segments += [pscustomobject][ordered]@{
        name = $Name
        mode = $Mode
        status = $status
        exit_code = $ExitCode
        evidence = $Evidence
        output_excerpt = if ($Output.Length -gt 1200) { $Output.Substring(0, 1200) } else { $Output }
    }
    if ($ExitCode -eq 0) {
        Pass "$Name"
    } else {
        Add-Failure "$Name failed"
    }
}

function Resolve-InputPath {
    param([string]$Path)
    if ([string]::IsNullOrWhiteSpace($Path)) { return "" }
    if ([System.IO.Path]::IsPathRooted($Path)) { return [System.IO.Path]::GetFullPath($Path) }
    return [System.IO.Path]::GetFullPath((Join-Path $RepoRoot $Path))
}

function Copy-EvidenceFile {
    param(
        [string]$SourcePath,
        [string]$RelativeName
    )

    if ([string]::IsNullOrWhiteSpace($SourcePath) -or -not (Test-Path -LiteralPath $SourcePath -PathType Leaf)) {
        return ""
    }

    $destination = Join-Path $EvidenceDir $RelativeName
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
    $content = Get-Content -Raw -LiteralPath $SourcePath
    $content = Redact-SecretLike $content
    $content | Set-Content -LiteralPath $destination -Encoding UTF8
    return $destination
}

function Add-ManifestFile {
    param([string]$Path)

    if ([string]::IsNullOrWhiteSpace($Path) -or -not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return
    }

    $fullPath = [System.IO.Path]::GetFullPath($Path)
    $root = [System.IO.Path]::GetFullPath($ArtifactRoot).TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
    $relative = $fullPath.Substring($root.Length).TrimStart([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar).Replace("\", "/")
    $hash = Get-Sha256 $Path
    $script:Files += [pscustomobject][ordered]@{
        path = $relative
        sha256 = $hash
        bytes = (Get-Item -LiteralPath $Path).Length
    }
}

function Get-Sha256 {
    param([string]$Path)

    $stream = [System.IO.File]::OpenRead($Path)
    try {
        $sha = [System.Security.Cryptography.SHA256]::Create()
        try {
            $bytes = $sha.ComputeHash($stream)
            return (($bytes | ForEach-Object { $_.ToString("x2") }) -join "")
        } finally {
            $sha.Dispose()
        }
    } finally {
        $stream.Dispose()
    }
}

function Write-JsonFile {
    param(
        [object]$Value,
        [string]$Path
    )

    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Path) | Out-Null
    $json = $Value | ConvertTo-Json -Depth 16
    $json = Redact-SecretLike $json
    $json | Set-Content -LiteralPath $Path -Encoding UTF8
}

function Test-WebSmokeManifestObserved {
    param([string[]]$Paths)

    foreach ($rawPath in $Paths) {
        $path = Resolve-InputPath $rawPath
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
            Add-Warning "Web smoke manifest missing: $rawPath"
            continue
        }
        try {
            $manifest = Get-Content -Raw -LiteralPath $path | ConvertFrom-Json
            if ($manifest.dataMode -eq "approved-real" -and $manifest.directLocalEdge -eq $false -and $manifest.realCliOrModelExecuted -eq $false) {
                return $true
            }
        }
        catch {
            Add-Warning "Web smoke manifest is unreadable: $rawPath"
        }
    }
    return $false
}

Write-Host "AgentHub approved-real/no-secret demo readiness" -ForegroundColor Magenta
Write-Host "Boundary: no real TokenDanceID login, no real CLI/model/API, no deploy/signing/release, no Mobile." -ForegroundColor Magenta

if (-not (Test-AllowedArtifactRoot $ArtifactRoot)) {
    Add-Failure "ArtifactRoot must stay under .tmp\approved-real-demo-readiness, tmp\approved-real-demo-readiness, or `$env:TEMP\AgentHub\approved-real-demo-readiness"
}
if (-not (Test-PathUnderRoot -Path $ManifestPath -Root $ArtifactRoot)) {
    Add-Failure "ManifestPath must stay under ArtifactRoot"
}

New-Item -ItemType Directory -Force -Path $ArtifactRoot, $EvidenceDir | Out-Null

$ObservedGateRoot = Join-Path $RepoRoot ".tmp\localhost-observed-loop\approved-real-demo-$PID"
$observedManifest = Join-Path $ObservedGateRoot "observed-dispatch-manifest.json"
$observedReport = Join-Path $ObservedGateRoot "observed-dispatch-report.json"
$observedPassed = $false

if ($Failures.Count -eq 0 -and -not $SkipObservedFixture) {
    $observedRun = Invoke-RepoScript "scripts\verify-localhost-observed-loop.ps1" @(
        "-RepoRoot", $RepoRoot,
        "-Mode", "FixtureManifest",
        "-ArtifactRoot", $ObservedGateRoot,
        "-ManifestPath", $observedManifest,
        "-ObservedDispatchReportPath", $observedReport,
        "-TimeoutSec", ([string]$TimeoutSec)
    )
    Add-Segment "localhost_observed_fixture_replay" "fixture-observed" $observedRun.ExitCode $observedManifest $observedRun.Output
    $observedPassed = ($observedRun.ExitCode -eq 0)
}

$LocalStackGateRoot = Join-Path $RepoRoot ".tmp\localhost-real-stack-smoke\approved-real-demo-$PID"
$localStackEvidence = Join-Path $LocalStackGateRoot "localhost-real-stack-smoke.json"
if ($Failures.Count -eq 0 -and $RunLocalStackSmoke) {
    $localStackRun = Invoke-RepoScript "scripts\verify-localhost-real-stack-smoke.ps1" @(
        "-RepoRoot", $RepoRoot,
        "-ArtifactRoot", $LocalStackGateRoot,
        "-EvidencePath", $localStackEvidence,
        "-SkipWeb",
        "-SkipDesktop",
        "-ProbeHub",
        "-TimeoutSec", ([string]$TimeoutSec)
    )
    Add-Segment "localhost_real_stack_smoke" "mock-sqlite-readiness" $localStackRun.ExitCode $localStackEvidence $localStackRun.Output
} elseif (-not $RunLocalStackSmoke) {
    $Segments += [pscustomobject][ordered]@{
        name = "localhost_real_stack_smoke"
        mode = "optional"
        status = "NOT_RUN"
        exit_code = $null
        evidence = ""
        output_excerpt = "Use -RunLocalStackSmoke to start/probe the safe Local Edge mock+SQLite subset."
    }
}

$preflightStatus = "NOT_PROVIDED"
$preflightCopy = ""
if (-not [string]::IsNullOrWhiteSpace($PreflightManifestPath)) {
    $resolvedPreflight = Resolve-InputPath $PreflightManifestPath
    $preflightCopy = Copy-EvidenceFile $resolvedPreflight "approved-real-preflight.json"
    $preflightRun = Invoke-RepoScript "scripts\verify-approved-real-preflight.ps1" @(
        "-RepoRoot", $RepoRoot,
        "-ManifestPath", $resolvedPreflight
    )
    Add-Segment "approved_real_preflight_manifest" "approval-gate" $preflightRun.ExitCode $preflightCopy $preflightRun.Output
    $preflightStatus = if ($preflightRun.ExitCode -eq 0) { "VALIDATED" } else { "BLOCKED" }
}

foreach ($rawWebSmoke in $WebSmokeManifestPath) {
    $resolvedWebSmoke = Resolve-InputPath $rawWebSmoke
    $name = "web-smoke-" + ([System.IO.Path]::GetFileName($resolvedWebSmoke))
    [void](Copy-EvidenceFile $resolvedWebSmoke $name)
}

[void](Copy-EvidenceFile $observedManifest "localhost-observed-loop/observed-dispatch-manifest.json")
[void](Copy-EvidenceFile $observedReport "localhost-observed-loop/observed-dispatch-report.json")
if (Test-Path -LiteralPath $localStackEvidence -PathType Leaf) {
    [void](Copy-EvidenceFile $localStackEvidence "localhost-real-stack-smoke.json")
}

$webReplayObserved = $observedPassed -or (Test-WebSmokeManifestObserved $WebSmokeManifestPath)
$readyForApproval = ($Failures.Count -eq 0 -and $webReplayObserved)
$status = if ($readyForApproval) { "READY_FOR_APPROVAL" } else { "BLOCKED" }
if ($preflightStatus -eq "BLOCKED") {
    $status = "BLOCKED"
}

Get-ChildItem -LiteralPath $EvidenceDir -File -Recurse | ForEach-Object {
    Add-ManifestFile $_.FullName
}

$demoFields = [ordered]@{
    RealLoginTested = $false
    RealCliTested = $false
    MockAdapterUsed = $true
    HubSessionSource = if ($webReplayObserved) { "fixture-observed-hub-replay" } else { "not-observed" }
    WebReplayObserved = [bool]$webReplayObserved
}

$manifest = [ordered]@{
    schema = "agenthub-redacted-evidence-manifest-v1"
    status = $status
    generated_at = $GeneratedAt.ToString("o")
    repo_root = $RepoRoot
    artifact_root = $ArtifactRoot
    evidence_boundary = [ordered]@{
        label = "approved-real"
        real_tested = $false
        readiness_only = $true
        no_secret = $true
        note = "approved-real/no-secret demo readiness only; not proof of real login or real CLI/model/API execution"
    }
    redaction = [ordered]@{
        status = "passed"
        policy = "text evidence is copied into this package after secret-like value redaction"
    }
    RealLoginTested = $demoFields.RealLoginTested
    RealCliTested = $demoFields.RealCliTested
    MockAdapterUsed = $demoFields.MockAdapterUsed
    HubSessionSource = $demoFields.HubSessionSource
    WebReplayObserved = $demoFields.WebReplayObserved
    demo_readiness = $demoFields
    gates = [ordered]@{
        approved_real_preflight = $preflightStatus
        observed_fixture_replay = if ($observedPassed) { "PASS" } elseif ($SkipObservedFixture) { "SKIPPED" } else { "FAIL" }
        localhost_real_stack_smoke = if ($RunLocalStackSmoke) { "SEE_SEGMENT" } else { "NOT_RUN" }
    }
    topology = [ordered]@{
        chain = "Web -> Hub -> Desktop/Edge -> mock adapter -> Hub replay -> Web"
        web = "http://127.0.0.1:5174"
        hub = "http://127.0.0.1:8080"
        desktop_bridge = "http://127.0.0.1:5173"
        local_edge = "http://127.0.0.1:3210"
        adapter = "fixture-sdk-adapter"
    }
    approval = [ordered]@{
        status = if ($preflightStatus -eq "VALIDATED") { "approved_preflight_manifest_validated" } else { "operator_approval_required" }
        ready_for_approval = [bool]($status -eq "READY_FOR_APPROVAL")
        real_recording_requires_secrets_or_safe_env = $true
    }
    claims = [ordered]@{
        real_tokendance_id_login = $false
        real_cli_or_model_invoked = $false
        real_api_budget_spend = $false
        public_deploy_used = $false
        signing_or_release_used = $false
        mobile_touched = $false
    }
    segments = @($Segments)
    files = @($Files)
    blockers = @(
        "real TokenDanceID login still requires approved safe env or no-secret browser evidence",
        "real CLI/model/API execution remains untested and must not run without separate approval",
        "recording still needs a human-approved run plan and capture of the local Web/Desktop surfaces"
    )
    failures = @($Failures)
    warnings = @($Warnings)
}

Write-JsonFile $manifest $ManifestPath
$script:Files = @()
Get-ChildItem -LiteralPath $EvidenceDir -File -Recurse | ForEach-Object {
    Add-ManifestFile $_.FullName
}
$manifest["files"] = @($Files)
Write-JsonFile $manifest $ManifestPath

Write-Host "ManifestPath: $ManifestPath" -ForegroundColor White
Write-Host "RealLoginTested=false" -ForegroundColor White
Write-Host "RealCliTested=false" -ForegroundColor White
Write-Host "MockAdapterUsed=true" -ForegroundColor White
Write-Host "HubSessionSource=$($demoFields.HubSessionSource)" -ForegroundColor White
Write-Host "WebReplayObserved=$($demoFields.WebReplayObserved)" -ForegroundColor White
Write-Host "Status: $status" -ForegroundColor $(if ($status -eq "READY_FOR_APPROVAL") { "Green" } else { "Red" })

if ($status -eq "READY_FOR_APPROVAL") { exit 0 }
exit 1
