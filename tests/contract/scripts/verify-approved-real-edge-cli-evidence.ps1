[CmdletBinding()]
param(
    [string]$RepoRoot = ""
)

$ErrorActionPreference = "Stop"
$Failed = 0

if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
    $scriptDir = if (-not [string]::IsNullOrWhiteSpace($PSScriptRoot)) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
    $RepoRoot = (Resolve-Path (Join-Path $scriptDir "..\..\..")).ProviderPath
}

function Assert-True {
    param(
        [bool]$Condition,
        [string]$Message,
        [string]$Details = ""
    )

    if ($Condition) {
        Write-Host "PASS $Message" -ForegroundColor Green
        return
    }

    $script:Failed++
    Write-Host "FAIL $Message" -ForegroundColor Red
    if (-not [string]::IsNullOrWhiteSpace($Details)) {
        Write-Host $Details -ForegroundColor DarkGray
    }
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

function Invoke-RealEvidenceVerifier {
    param([string[]]$Arguments)

    $psi = [System.Diagnostics.ProcessStartInfo]::new()
    $psi.FileName = "pwsh"
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.Arguments = Join-NativeArguments $Arguments

    $proc = [System.Diagnostics.Process]::Start($psi)
    $stdout = $proc.StandardOutput.ReadToEnd()
    $stderr = $proc.StandardError.ReadToEnd()
    $proc.WaitForExit()

    [pscustomobject]@{
        ExitCode = $proc.ExitCode
        Output = ($stdout + "`n" + $stderr)
    }
}

function Write-JsonFile {
    param(
        [string]$Path,
        [object]$Value,
        [int]$Depth = 12
    )

    $Value | ConvertTo-Json -Depth $Depth | Set-Content -LiteralPath $Path -Encoding UTF8
}

function Get-FileSha256 {
    param([string]$Path)
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

$scriptPath = Join-Path $RepoRoot "scripts\verify-approved-real-edge-cli-evidence.ps1"
$docPath = Join-Path $RepoRoot "docs\audit\p0-approved-real-evidence-verifier.md"

Assert-True (Test-Path -LiteralPath $scriptPath) "approved-real evidence verifier exists"
Assert-True (Test-Path -LiteralPath $docPath) "approved-real evidence verifier audit doc exists"

if (Test-Path -LiteralPath $scriptPath) {
    $scriptText = Get-Content -LiteralPath $scriptPath -Raw
    Assert-True ($scriptText -notmatch '(?m)^\s*(?:&\s*)?(?:codex|claude|opencode)\b') "verifier has no direct real CLI command pattern"
    Assert-True ($scriptText -match 'real_tested=true') "verifier can report real_tested=true only after dereference"
    Assert-True ($scriptText -match 'real_tested=false') "verifier can report real_tested=false"

    $tempDir = Join-Path ([System.IO.Path]::GetTempPath()) ("agenthub-approved-real-evidence-test-" + [System.Guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Path $tempDir | Out-Null
    try {
        $approvalMarker = Join-Path $tempDir "approval.marker"
        Set-Content -LiteralPath $approvalMarker -Value "approved real evidence verification only" -Encoding UTF8

        $baseManifest = [ordered]@{
            adapterId = "codex"
            approvalId = "approval-real-123"
            observedEvidenceRef = "event-log:edge-events.json"
            correlationId = "corr-real-123"
            invocationPlanEventId = "evt-plan"
            terminalEventId = "evt-finished"
            requestMapped = $true
            invocationPlanObserved = $true
            eventReplayObserved = $true
            realCliObserved = $true
            redacted = $true
            noSecrets = $true
            mockAdapterUsed = $false
            realCliTested = $true
            realModelTested = $false
            tokenDanceIdLogin = $false
            realCliTestedReason = "approved observed CLI process evidence was dereferenced by event id"
            realModelTestedReason = "no model API call is part of this evidence verifier"
            tokenDanceIdLoginReason = "TokenDanceID login is outside Edge CLI evidence verification"
            failureReason = "none"
            recordingEvidencePath = "redacted-recording-placeholder.json"
            terminalStatus = "finished"
            exitCode = 0
        }

        $manifestOnlyPath = Join-Path $tempDir "manifest-only.json"
        Write-JsonFile $manifestOnlyPath $baseManifest
        $manifestOnlyRun = Invoke-RealEvidenceVerifier @(
            "-NoProfile",
            "-ExecutionPolicy", "Bypass",
            "-File", $scriptPath,
            "-RepoRoot", $RepoRoot,
            "-ObservedManifest", $manifestOnlyPath,
            "-ApprovalMarker", $approvalMarker,
            "-ApproveRealEvidence"
        )
        Assert-True ($manifestOnlyRun.ExitCode -ne 0) "manifest-only evidence fails closed" $manifestOnlyRun.Output
        Assert-True ($manifestOnlyRun.Output -match "dereference|event log|artifact") "manifest-only failure names dereference/artifact requirement" $manifestOnlyRun.Output
        Assert-True ($manifestOnlyRun.Output -match "real_tested=false") "manifest-only evidence does not claim real tested" $manifestOnlyRun.Output

        $eventLogPath = Join-Path $tempDir "edge-events.json"
        $eventLog = [ordered]@{
            schema = "agenthub.edge_cli.real_evidence.v1"
            events = @(
                [ordered]@{
                    id = "evt-plan"
                    type = "run.agent.cli_invocation_plan"
                    correlationId = "corr-real-123"
                    adapterId = "codex"
                    redacted = $true
                    noSecrets = $true
                },
                [ordered]@{
                    id = "evt-finished"
                    type = "run.finished"
                    correlationId = "corr-real-123"
                    adapterId = "codex"
                    terminalStatus = "finished"
                    exitCode = 0
                    redacted = $true
                    noSecrets = $true
                }
            )
        }
        Write-JsonFile $eventLogPath $eventLog

        $matchedLogRun = Invoke-RealEvidenceVerifier @(
            "-NoProfile",
            "-ExecutionPolicy", "Bypass",
            "-File", $scriptPath,
            "-RepoRoot", $RepoRoot,
            "-ObservedManifest", $manifestOnlyPath,
            "-ApprovalMarker", $approvalMarker,
            "-ApproveRealEvidence"
        )
        Assert-True ($matchedLogRun.ExitCode -eq 0) "matched event log evidence passes" $matchedLogRun.Output
        Assert-True ($matchedLogRun.Output -match "real_tested=true") "matched event log evidence can claim real tested" $matchedLogRun.Output
        Assert-True ($matchedLogRun.Output -match "Status: APPROVED_REAL_EVIDENCE_VERIFIED") "matched event log evidence reports verified status" $matchedLogRun.Output

        $badEventLog = [ordered]@{
            schema = "agenthub.edge_cli.real_evidence.v1"
            events = @(
                [ordered]@{
                    id = "evt-plan"
                    type = "run.agent.cli_invocation_plan"
                    correlationId = "corr-real-123"
                    adapterId = "claude-code"
                    redacted = $true
                    noSecrets = $true
                },
                [ordered]@{
                    id = "evt-finished"
                    type = "run.finished"
                    correlationId = "corr-real-999"
                    adapterId = "codex"
                    terminalStatus = "finished"
                    exitCode = 0
                    redacted = $true
                    noSecrets = $true
                }
            )
        }
        Write-JsonFile $eventLogPath $badEventLog
        $mismatchRun = Invoke-RealEvidenceVerifier @(
            "-NoProfile",
            "-ExecutionPolicy", "Bypass",
            "-File", $scriptPath,
            "-RepoRoot", $RepoRoot,
            "-ObservedManifest", $manifestOnlyPath,
            "-ApprovalMarker", $approvalMarker,
            "-ApproveRealEvidence"
        )
        Assert-True ($mismatchRun.ExitCode -ne 0) "mismatched event ids/correlation/adapter fail closed" $mismatchRun.Output
        Assert-True ($mismatchRun.Output -match "correlationId|adapterId") "mismatch failure names correlation or adapter" $mismatchRun.Output
        Assert-True ($mismatchRun.Output -match "real_tested=false") "mismatched evidence does not claim real tested" $mismatchRun.Output

        Write-JsonFile $eventLogPath $eventLog
        $eventLogHash = Get-FileSha256 $eventLogPath
        $hashManifestPath = Join-Path $tempDir "artifact-manifest.json"
        Write-JsonFile $hashManifestPath @(
            [ordered]@{
                name = "edge-events.json"
                path = "edge-events.json"
                bytes = (Get-Item -LiteralPath $eventLogPath).Length
                sha256 = $eventLogHash
            }
        )
        $hashManifest = [ordered]@{}
        foreach ($entry in $baseManifest.GetEnumerator()) {
            $hashManifest[$entry.Key] = $entry.Value
        }
        $hashManifest["observedEvidenceRef"] = "sha256:$eventLogHash"
        $hashManifest["eventLogArtifact"] = "edge-events.json"
        $hashManifest["hashManifest"] = "artifact-manifest.json"
        $hashManifestPathObserved = Join-Path $tempDir "hash-observed.json"
        Write-JsonFile $hashManifestPathObserved $hashManifest

        $matchedHashRun = Invoke-RealEvidenceVerifier @(
            "-NoProfile",
            "-ExecutionPolicy", "Bypass",
            "-File", $scriptPath,
            "-RepoRoot", $RepoRoot,
            "-ObservedManifest", $hashManifestPathObserved,
            "-ApprovalMarker", $approvalMarker,
            "-ApproveRealEvidence"
        )
        Assert-True ($matchedHashRun.ExitCode -eq 0) "hash manifest plus matching event log passes" $matchedHashRun.Output
        Assert-True ($matchedHashRun.Output -match "hash_verified=true") "hash manifest reports hash verification" $matchedHashRun.Output
        Assert-True ($matchedHashRun.Output -match "real_tested=true") "hash manifest evidence can claim real tested" $matchedHashRun.Output

        $hashOnlyManifest = [ordered]@{}
        foreach ($entry in $baseManifest.GetEnumerator()) {
            $hashOnlyManifest[$entry.Key] = $entry.Value
        }
        $hashOnlyManifest["observedEvidenceRef"] = "sha256:$eventLogHash"
        $hashOnlyPath = Join-Path $tempDir "hash-only-observed.json"
        Write-JsonFile $hashOnlyPath $hashOnlyManifest
        $hashOnlyRun = Invoke-RealEvidenceVerifier @(
            "-NoProfile",
            "-ExecutionPolicy", "Bypass",
            "-File", $scriptPath,
            "-RepoRoot", $RepoRoot,
            "-ObservedManifest", $hashOnlyPath,
            "-ApprovalMarker", $approvalMarker,
            "-ApproveRealEvidence"
        )
        Assert-True ($hashOnlyRun.ExitCode -ne 0) "hash-only evidence without artifact schema fails closed" $hashOnlyRun.Output
        Assert-True ($hashOnlyRun.Output -match "eventLogArtifact|hashManifest|future artifact schema") "hash-only failure names future artifact schema" $hashOnlyRun.Output
        Assert-True ($hashOnlyRun.Output -match "real_tested=false") "hash-only evidence does not claim real tested" $hashOnlyRun.Output
    } finally {
        Remove-Item -LiteralPath $tempDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}

if (Test-Path -LiteralPath $docPath) {
    $docText = Get-Content -LiteralPath $docPath -Raw
    Assert-True ($docText -match "real_tested=true") "audit doc documents real_tested promotion rule"
    Assert-True ($docText -match "invocationPlanEventId") "audit doc documents invocation plan event id"
    Assert-True ($docText -match "terminalEventId") "audit doc documents terminal event id"
    Assert-True ($docText -match "correlationId") "audit doc documents correlation id"
    Assert-True ($docText -match "future artifact schema") "audit doc documents fail-closed future artifact schema"
}

if ($Failed -gt 0) {
    exit 1
}
exit 0
