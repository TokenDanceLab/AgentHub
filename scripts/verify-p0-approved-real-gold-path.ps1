#!/usr/bin/env pwsh
<#
AgentHub P0 approved-real gold-path harness.

Composes no-secret gates for:
TokenDanceID readiness -> Hub session evidence -> Desktop target -> Local Edge
-> CLI no-spend/approved safe run -> Hub replay -> Web display -> redacted
manifest.

This harness does not submit credentials, exchange tokens, run paid model/API
calls, deploy, sign, notarize, upload releases, or touch Mobile.
#>

[CmdletBinding()]
param(
    [string]$RepoRoot = ".",
    [string]$ArtifactRoot = "",
    [string]$ManifestPath = "",
    [string]$PreflightManifestPath = "",
    [string]$TokenDanceIDReadinessPath = "",
    [string]$DesktopEdgeCliSmokePath = "",
    [string]$DemoReadinessManifestPath = "",
    [string[]]$WebSmokeManifestPath = @(),
    [ValidateSet("codex", "claude-code", "opencode", "mock")]
    [string]$Runtime = "mock",
    [int]$TimeoutSec = 12,
    [switch]$RunDesktopEdgeCliSmoke,
    [switch]$RunLocalStackSmoke,
    [switch]$SkipTokenDanceIDReadiness,
    [switch]$SkipDemoReadiness
)

$ErrorActionPreference = "Stop"

if ($TimeoutSec -le 0) {
    Write-Host "FAIL: -TimeoutSec must be greater than zero." -ForegroundColor Red
    exit 2
}

$RepoRoot = (Resolve-Path $RepoRoot).ProviderPath
if ([string]::IsNullOrWhiteSpace($ArtifactRoot)) {
    $ArtifactRoot = Join-Path $RepoRoot ".tmp\p0-approved-real-gold-path\run-$PID"
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
$SecretLikePattern = '(?i)(Authorization\s*:\s*Bearer\s+(?!<redacted)[^\s,;]+|(?:password|passwd|client[_ -]?secret|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|id[_ -]?token|auth[_ -]?token)\s*[:=]\s*(?!"?(?:false|true|null|none|not[_ -]?provided|not[_ -]?required|blocked|redacted|<redacted|fixture|manifest|approved|operator-owned)[^"]*"?)[^"''\s,;}]{8,}|(?<![A-Za-z0-9_])(?:sk|ghp|gho|ghu|ghs|glpat|xox[baprs])-[-_A-Za-z0-9]{12,})'

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

function Redact-Text {
    param([string]$Value)
    if ([string]::IsNullOrEmpty($Value)) { return $Value }
    $safe = $Value -replace [regex]::Escape($RepoRoot), "<repo>"
    $jsonEscapedRepoRoot = $RepoRoot.Replace("\", "\\")
    $safe = $safe -replace [regex]::Escape($jsonEscapedRepoRoot), "<repo>"
    $safe = $safe -replace $SecretLikePattern, "<redacted-secret>"
    return $safe
}

function Test-PathUnderRoot {
    param(
        [string]$Path,
        [string]$Root
    )
    $normalized = [System.IO.Path]::GetFullPath($Path).TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
    $normalizedRoot = [System.IO.Path]::GetFullPath($Root).TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
    if ($normalized.Equals($normalizedRoot, [System.StringComparison]::OrdinalIgnoreCase)) { return $true }
    return $normalized.StartsWith($normalizedRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)
}

function Test-AllowedArtifactRoot([string]$Path) {
    $tempBase = if (-not [string]::IsNullOrWhiteSpace($env:TEMP)) { $env:TEMP } else { [System.IO.Path]::GetTempPath() }
    foreach ($root in @(
        (Join-Path $RepoRoot ".tmp\p0-approved-real-gold-path"),
        (Join-Path $RepoRoot "tmp\p0-approved-real-gold-path"),
        (Join-Path $tempBase "AgentHub\p0-approved-real-gold-path")
    )) {
        if (Test-PathUnderRoot -Path $Path -Root $root) { return $true }
    }
    return $false
}

function Resolve-InputPath {
    param([string]$Path)
    if ([string]::IsNullOrWhiteSpace($Path)) { return "" }
    if ([System.IO.Path]::IsPathRooted($Path)) { return [System.IO.Path]::GetFullPath($Path) }
    return [System.IO.Path]::GetFullPath((Join-Path $RepoRoot $Path))
}

function Find-PowerShell {
    $pwsh = Get-Command "pwsh" -ErrorAction SilentlyContinue
    if ($pwsh) { return $pwsh.Source }
    $powershell = Get-Command "powershell" -ErrorAction SilentlyContinue
    if ($powershell) { return $powershell.Source }
    return $null
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

function Invoke-RepoScript {
    param(
        [string]$RelativePath,
        [string[]]$Arguments
    )
    $scriptPath = Join-Path $RepoRoot $RelativePath
    $shell = Find-PowerShell
    if (-not $shell) {
        return [pscustomobject]@{ ExitCode = -1; Output = "PowerShell executable unavailable"; ScriptPath = $scriptPath }
    }
    if (-not (Test-Path -LiteralPath $scriptPath -PathType Leaf)) {
        return [pscustomobject]@{ ExitCode = -1; Output = "missing $RelativePath"; ScriptPath = $scriptPath }
    }

    $psi = [System.Diagnostics.ProcessStartInfo]::new()
    $psi.FileName = $shell
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
        Output = Redact-Text ($stdout + "`n" + $stderr)
        ScriptPath = $scriptPath
    }
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
    (Redact-Text (Get-Content -Raw -LiteralPath $SourcePath)) | Set-Content -LiteralPath $destination -Encoding UTF8
    return $destination
}

function Add-ManifestFile {
    param([string]$Path)
    if ([string]::IsNullOrWhiteSpace($Path) -or -not (Test-Path -LiteralPath $Path -PathType Leaf)) { return }
    $fullPath = [System.IO.Path]::GetFullPath($Path)
    $root = [System.IO.Path]::GetFullPath($ArtifactRoot).TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
    $relative = $fullPath.Substring($root.Length).TrimStart([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar).Replace("\", "/")
    $script:Files += [pscustomobject][ordered]@{
        path = $relative
        sha256 = Get-Sha256 $Path
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

function Read-JsonEvidence {
    param([string]$Path)
    if ([string]::IsNullOrWhiteSpace($Path) -or -not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
    try {
        return Get-Content -Raw -LiteralPath $Path | ConvertFrom-Json
    } catch {
        Add-Warning "Evidence JSON is unreadable: $Path"
        return $null
    }
}

function Add-Segment {
    param(
        [string]$Name,
        [string]$Mode,
        [string]$Status,
        [Nullable[int]]$ExitCode,
        [string]$Evidence = "",
        [string]$Output = ""
    )
    $script:Segments += [pscustomobject][ordered]@{
        name = $Name
        mode = $Mode
        status = $Status
        exit_code = $ExitCode
        evidence = $Evidence
        output_excerpt = if (($Output -as [string]).Length -gt 1200) { ($Output -as [string]).Substring(0, 1200) } else { ($Output -as [string]) }
    }
    if ($Status -eq "PASS") { Pass $Name } elseif ($Status -eq "SKIPPED") { Add-Warning "$Name skipped" } else { Add-Failure "$Name blocked" }
}

function Write-Manifest {
    param([object]$Manifest)
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $ManifestPath) | Out-Null
    $json = $Manifest | ConvertTo-Json -Depth 16
    $json = Redact-Text $json
    $json | Set-Content -LiteralPath $ManifestPath -Encoding UTF8
}

Write-Host "AgentHub P0 approved-real gold-path harness" -ForegroundColor Magenta
Write-Host "Boundary: no secrets, no credential submission, no paid model/API call, no deploy/signing/release, no Mobile." -ForegroundColor Magenta

if (-not (Test-AllowedArtifactRoot $ArtifactRoot)) {
    Add-Failure "ArtifactRoot must stay under .tmp\p0-approved-real-gold-path, tmp\p0-approved-real-gold-path, or `$env:TEMP\AgentHub\p0-approved-real-gold-path"
}
if (-not (Test-PathUnderRoot -Path $ManifestPath -Root $ArtifactRoot)) {
    Add-Failure "ManifestPath must stay under ArtifactRoot"
}

New-Item -ItemType Directory -Force -Path $ArtifactRoot, $EvidenceDir | Out-Null

$tokenEvidence = if ([string]::IsNullOrWhiteSpace($TokenDanceIDReadinessPath)) { Join-Path $ArtifactRoot "tokendance-id-readiness.json" } else { Resolve-InputPath $TokenDanceIDReadinessPath }
$edgeEvidence = if ([string]::IsNullOrWhiteSpace($DesktopEdgeCliSmokePath)) { Join-Path $ArtifactRoot "desktop-edge-cli-smoke.json" } else { Resolve-InputPath $DesktopEdgeCliSmokePath }
$defaultDemoRoot = Join-Path $RepoRoot ".tmp\approved-real-demo-readiness\p0-gold-path-$PID"
$demoManifest = if ([string]::IsNullOrWhiteSpace($DemoReadinessManifestPath)) { Join-Path $defaultDemoRoot "redacted-manifest.json" } else { Resolve-InputPath $DemoReadinessManifestPath }

if ($Failures.Count -eq 0) {
    if ($SkipTokenDanceIDReadiness) {
        Add-Segment "tokendance_id_readiness" "no-secret-readiness" "SKIPPED" $null "" "Skipped by caller."
    } elseif ([string]::IsNullOrWhiteSpace($TokenDanceIDReadinessPath)) {
        $tokenRun = Invoke-RepoScript "scripts\verify-token-dance-id-login-readiness.ps1" @("-RepoRoot", $RepoRoot, "-OutputPath", $tokenEvidence)
        Add-Segment "tokendance_id_readiness" "no-secret-readiness" $(if ($tokenRun.ExitCode -eq 0) { "PASS" } else { "BLOCKED" }) $tokenRun.ExitCode $tokenEvidence $tokenRun.Output
    } else {
        Add-Segment "tokendance_id_readiness" "evidence-file" $(if (Test-Path -LiteralPath $tokenEvidence -PathType Leaf) { "PASS" } else { "BLOCKED" }) $null $tokenEvidence "Using caller-provided TokenDanceID readiness evidence."
    }

    if ($RunDesktopEdgeCliSmoke) {
        $edgeRoot = Join-Path $ArtifactRoot "desktop-edge-cli-smoke"
        $edgeRun = Invoke-RepoScript "scripts\verify-p0-desktop-edge-cli-smoke.ps1" @(
            "-RepoRoot", $RepoRoot,
            "-Runtime", $Runtime,
            "-ArtifactRoot", $edgeRoot,
            "-SkipDesktopDev",
            "-TimeoutSec", ([string]$TimeoutSec)
        )
        $edgeEvidence = Join-Path $edgeRoot "smoke-result.json"
        Add-Segment "desktop_edge_cli_no_spend_smoke" "no-spend-runtime" $(if ($edgeRun.ExitCode -eq 0) { "PASS" } else { "BLOCKED" }) $edgeRun.ExitCode $edgeEvidence $edgeRun.Output
    } elseif (-not [string]::IsNullOrWhiteSpace($DesktopEdgeCliSmokePath)) {
        Add-Segment "desktop_edge_cli_no_spend_smoke" "evidence-file" $(if (Test-Path -LiteralPath $edgeEvidence -PathType Leaf) { "PASS" } else { "BLOCKED" }) $null $edgeEvidence "Using caller-provided Desktop/Edge/CLI smoke evidence."
    } else {
        Add-Segment "desktop_edge_cli_no_spend_smoke" "not-run" "BLOCKED" $null "" "Pass -RunDesktopEdgeCliSmoke or -DesktopEdgeCliSmokePath to prove Local Edge + CLI no-spend readiness."
    }

    if ($SkipDemoReadiness) {
        Add-Segment "hub_replay_web_redacted_manifest" "approved-real-demo" "SKIPPED" $null "" "Skipped by caller."
    } elseif ([string]::IsNullOrWhiteSpace($DemoReadinessManifestPath)) {
        $demoRoot = $defaultDemoRoot
        $demoArgs = @("-RepoRoot", $RepoRoot, "-ArtifactRoot", $demoRoot, "-ManifestPath", $demoManifest, "-TimeoutSec", ([string]$TimeoutSec))
        if (-not [string]::IsNullOrWhiteSpace($PreflightManifestPath)) {
            $demoArgs += @("-PreflightManifestPath", (Resolve-InputPath $PreflightManifestPath))
        }
        foreach ($webSmoke in $WebSmokeManifestPath) {
            $demoArgs += @("-WebSmokeManifestPath", (Resolve-InputPath $webSmoke))
        }
        if ($RunLocalStackSmoke) { $demoArgs += "-RunLocalStackSmoke" }
        $demoRun = Invoke-RepoScript "scripts\verify-approved-real-demo-readiness.ps1" $demoArgs
        Add-Segment "hub_replay_web_redacted_manifest" "approved-real-demo" $(if ($demoRun.ExitCode -eq 0) { "PASS" } else { "BLOCKED" }) $demoRun.ExitCode $demoManifest $demoRun.Output
    } else {
        Add-Segment "hub_replay_web_redacted_manifest" "evidence-file" $(if (Test-Path -LiteralPath $demoManifest -PathType Leaf) { "PASS" } else { "BLOCKED" }) $null $demoManifest "Using caller-provided demo readiness manifest."
    }
}

$tokenJson = Read-JsonEvidence $tokenEvidence
$edgeJson = Read-JsonEvidence $edgeEvidence
$demoJson = Read-JsonEvidence $demoManifest

$tokenReady = $tokenJson -and $tokenJson.status -eq "READY_FOR_OPERATOR"
$edgeReady = $edgeJson -and $edgeJson.status -eq "P0_DESKTOP_EDGE_CLI_SMOKE_PASSED"
$demoReady = $demoJson -and $demoJson.status -eq "READY_FOR_APPROVAL"

[void](Copy-EvidenceFile $tokenEvidence "tokendance-id-readiness.json")
[void](Copy-EvidenceFile $edgeEvidence "desktop-edge-cli-smoke.json")
[void](Copy-EvidenceFile $demoManifest "demo-readiness-redacted-manifest.json")

Get-ChildItem -LiteralPath $EvidenceDir -File -Recurse | ForEach-Object { Add-ManifestFile $_.FullName }

$blockedReasons = @()
if (-not $tokenReady) { $blockedReasons += "TokenDanceID readiness is not READY_FOR_OPERATOR" }
if (-not $edgeReady) { $blockedReasons += "Desktop target -> Local Edge -> CLI no-spend smoke is not proven" }
if (-not $demoReady) { $blockedReasons += "Hub replay -> Web display -> redacted manifest is not READY_FOR_APPROVAL" }
if ($Failures.Count -gt 0) { $blockedReasons += @($Failures) }

$ready = ($blockedReasons.Count -eq 0)
$status = if ($ready) { "READY_FOR_APPROVAL" } else { "BLOCKED_WITH_EVIDENCE" }
$manifest = [ordered]@{
    schema = "agenthub-redacted-evidence-manifest-v1"
    status = $status
    generated_at = (Get-Date).ToString("o")
    repo_root = "<repo>"
    artifact_root = $ArtifactRoot
    evidence_boundary = [ordered]@{
        label = "approved-real"
        real_tested = $false
        readiness_only = $true
        no_secret = $true
        note = "P0 gold-path harness composes no-secret readiness gates; it is not proof of real login or paid model/API execution."
    }
    redaction = [ordered]@{
        status = "passed"
        policy = "all copied text evidence is redacted for secret-like values"
    }
    chain = @(
        "TokenDanceID readiness",
        "Hub session evidence",
        "Desktop execution target",
        "Local Edge",
        "CLI no-spend or separately approved safe run",
        "Hub replay",
        "Web display",
        "redacted manifest"
    )
    gates = [ordered]@{
        tokendance_id_readiness = if ($tokenReady) { "READY_FOR_OPERATOR" } else { "BLOCKED" }
        desktop_edge_cli_no_spend = if ($edgeReady) { "PASS" } else { "BLOCKED" }
        hub_replay_web_manifest = if ($demoReady) { "READY_FOR_APPROVAL" } else { "BLOCKED" }
    }
    claims = [ordered]@{
        real_tokendance_id_login = $false
        real_cli_or_model_invoked = $false
        real_api_budget_spend = $false
        public_deploy_used = $false
        signing_or_release_used = $false
        mobile_touched = $false
        token_dance_id_fixture_login_accepted_as_real = $false
        mock_adapter_used = if ($demoJson) { [bool]$demoJson.MockAdapterUsed } else { $true }
    }
    topology = [ordered]@{
        web = "Hub-only Web surface; no direct Local Edge calls"
        hub_session = if ($demoJson) { [string]$demoJson.HubSessionSource } else { "not-observed" }
        desktop_target = "Desktop local_edge target evidence required"
        local_edge = "Local Edge mock/no-spend smoke evidence required"
        cli = "Runtime=$Runtime; no model prompt submitted by this harness"
    }
    segment_summary = @($Segments)
    evidence_inputs = [ordered]@{
        tokendance_id_readiness = $(if (Test-Path -LiteralPath $tokenEvidence -PathType Leaf) { "evidence/tokendance-id-readiness.json" } else { "" })
        desktop_edge_cli_smoke = $(if (Test-Path -LiteralPath $edgeEvidence -PathType Leaf) { "evidence/desktop-edge-cli-smoke.json" } else { "" })
        demo_readiness_manifest = $(if (Test-Path -LiteralPath $demoManifest -PathType Leaf) { "evidence/demo-readiness-redacted-manifest.json" } else { "" })
    }
    files = @($Files)
    blockers = @($blockedReasons | Select-Object -Unique)
    failures = @($Failures)
    warnings = @($Warnings)
}

Write-Manifest $manifest
$script:Files = @()
Get-ChildItem -LiteralPath $EvidenceDir -File -Recurse | ForEach-Object { Add-ManifestFile $_.FullName }
$manifest["files"] = @($Files)
Write-Manifest $manifest

Write-Host "ManifestPath: $ManifestPath" -ForegroundColor White
Write-Host "RealLoginTested=false" -ForegroundColor White
Write-Host "RealCliOrModelInvoked=false" -ForegroundColor White
Write-Host "RealApiBudgetSpend=false" -ForegroundColor White
Write-Host "Status: $status" -ForegroundColor $(if ($status -eq "READY_FOR_APPROVAL") { "Green" } else { "Red" })

if ($status -eq "READY_FOR_APPROVAL") { exit 0 }
exit 1
