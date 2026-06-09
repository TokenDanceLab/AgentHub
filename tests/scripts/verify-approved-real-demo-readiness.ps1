[CmdletBinding()]
param(
    [string]$RepoRoot = "."
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path $RepoRoot).ProviderPath
$Failed = 0
$TempRoots = @()

function Assert-True {
    param(
        [bool]$Condition,
        [string]$Message,
        [string]$Details = ""
    )

    if ($Condition) {
        Write-Host "PASS: $Message" -ForegroundColor Green
        return
    }

    $script:Failed++
    Write-Host "FAIL: $Message" -ForegroundColor Red
    if (-not [string]::IsNullOrWhiteSpace($Details)) {
        Write-Host $Details
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

function Invoke-RepoScript {
    param([string[]]$Arguments)

    $psi = [System.Diagnostics.ProcessStartInfo]::new()
    $psi.FileName = "powershell"
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.WorkingDirectory = $RepoRoot
    $psi.Arguments = "-NoProfile -ExecutionPolicy Bypass -File " + (Join-NativeArguments $Arguments)

    $proc = [System.Diagnostics.Process]::Start($psi)
    $stdout = $proc.StandardOutput.ReadToEnd()
    $stderr = $proc.StandardError.ReadToEnd()
    $proc.WaitForExit()

    [pscustomobject]@{
        ExitCode = $proc.ExitCode
        Output = ($stdout + "`n" + $stderr)
    }
}

$scriptPath = Join-Path $RepoRoot "scripts\verify-approved-real-demo-readiness.ps1"
$webSmokePath = Join-Path $RepoRoot "app\web\src\__e2e__\web-hub-real-mode-smoke.spec.ts"

try {
    Assert-True (Test-Path -LiteralPath $scriptPath -PathType Leaf) "approved-real demo readiness runner exists"
    Assert-True (Test-Path -LiteralPath $webSmokePath -PathType Leaf) "Web real-mode smoke spec exists"

    if (Test-Path -LiteralPath $scriptPath -PathType Leaf) {
        $scriptText = Get-Content -Raw -LiteralPath $scriptPath
        Assert-True ($scriptText -match "verify-localhost-observed-loop\.ps1") "runner composes localhost observed fixture replay"
        Assert-True ($scriptText -match "verify-localhost-real-stack-smoke\.ps1") "runner can compose localhost real-stack smoke"
        Assert-True ($scriptText -match "verify-approved-real-preflight\.ps1") "runner reads approved-real preflight gate"
        Assert-True ($scriptText -match "agenthub-redacted-evidence-manifest-v1") "runner emits redacted manifest schema"
        Assert-True ($scriptText -match "RealLoginTested" -and $scriptText -match "RealCliTested") "runner emits real login and CLI fields"
        Assert-True ($scriptText -match "MockAdapterUsed" -and $scriptText -match "HubSessionSource" -and $scriptText -match "WebReplayObserved") "runner emits demo readiness fields"
        Assert-True ($scriptText -match 'mobile_touched = \$false') "runner records Mobile untouched"
        Assert-True ($scriptText -notmatch '(?m)^\s*(?:&\s*)?(?:codex|claude|opencode)\b') "runner has no direct real CLI command pattern"
        Assert-True ($scriptText -notmatch 'api\.vectorcontrol\.tech|Invoke-RestMethod\s+-Uri\s+https?://') "runner has no model/API spend primitive"
    }

    if (Test-Path -LiteralPath $webSmokePath -PathType Leaf) {
        $webText = Get-Content -Raw -LiteralPath $webSmokePath
        Assert-True ($webText -match "RealLoginTested") "Web smoke manifest records RealLoginTested"
        Assert-True ($webText -match "RealCliTested") "Web smoke manifest records RealCliTested"
        Assert-True ($webText -match "MockAdapterUsed") "Web smoke manifest records MockAdapterUsed"
        Assert-True ($webText -match "HubSessionSource") "Web smoke manifest records HubSessionSource"
        Assert-True ($webText -match "WebReplayObserved") "Web smoke manifest records WebReplayObserved"
    }

    $artifactRoot = Join-Path $RepoRoot ".tmp\approved-real-demo-readiness\script-test-$PID"
    Remove-Item -LiteralPath $artifactRoot -Recurse -Force -ErrorAction SilentlyContinue
    $TempRoots += $artifactRoot
    $manifestPath = Join-Path $artifactRoot "redacted-manifest.json"

    $run = Invoke-RepoScript @(
        $scriptPath,
        "-RepoRoot", $RepoRoot,
        "-ArtifactRoot", $artifactRoot,
        "-ManifestPath", $manifestPath,
        "-TimeoutSec", "8"
    )
    Assert-True ($run.ExitCode -eq 0) "default no-secret runner reaches READY_FOR_APPROVAL" $run.Output
    Assert-True ($run.Output -match "Status: READY_FOR_APPROVAL") "runner prints READY_FOR_APPROVAL" $run.Output
    Assert-True ($run.Output -match "RealLoginTested=false") "runner output keeps RealLoginTested false" $run.Output
    Assert-True ($run.Output -match "RealCliTested=false") "runner output keeps RealCliTested false" $run.Output
    Assert-True ($run.Output -match "MockAdapterUsed=true") "runner output records mock adapter" $run.Output
    Assert-True (Test-Path -LiteralPath $manifestPath -PathType Leaf) "runner writes redacted manifest"

    $manifestText = Get-Content -Raw -LiteralPath $manifestPath
    $manifest = $manifestText | ConvertFrom-Json
    Assert-True ($manifest.schema -eq "agenthub-redacted-evidence-manifest-v1") "manifest schema is redacted evidence v1"
    Assert-True ($manifest.status -eq "READY_FOR_APPROVAL") "manifest status is READY_FOR_APPROVAL"
    Assert-True ($manifest.RealLoginTested -eq $false) "manifest RealLoginTested=false"
    Assert-True ($manifest.RealCliTested -eq $false) "manifest RealCliTested=false"
    Assert-True ($manifest.MockAdapterUsed -eq $true) "manifest MockAdapterUsed=true"
    Assert-True ($manifest.HubSessionSource -eq "fixture-observed-hub-replay") "manifest records Hub session source"
    Assert-True ($manifest.WebReplayObserved -eq $true) "manifest WebReplayObserved=true"
    Assert-True ($manifest.claims.mobile_touched -eq $false) "manifest records Mobile untouched"
    Assert-True ($manifest.gates.approved_real_preflight -eq "NOT_PROVIDED") "manifest does not fake approved-real preflight"
    Assert-True (@($manifest.files).Count -ge 2) "manifest lists copied evidence files"
    Assert-True ($manifestText -notmatch '(?i)(sk-[a-z0-9_-]{8,}|Authorization:\s*Bearer\s+(?!<redacted)[^\s,;}]+)') "manifest has no unredacted secret-like values"

    $verify = Invoke-RepoScript @(
        (Join-Path $RepoRoot "scripts\evidence\verify-redacted-manifest.ps1"),
        "-ManifestPath", $manifestPath
    )
    Assert-True ($verify.ExitCode -eq 0) "redacted manifest verifier accepts runner output" $verify.Output

    $blockedRoot = Join-Path $RepoRoot ".tmp\approved-real-demo-readiness\script-blocked-test-$PID"
    $TempRoots += $blockedRoot
    $blockedManifest = Join-Path $blockedRoot "redacted-manifest.json"
    $blockedRun = Invoke-RepoScript @(
        $scriptPath,
        "-RepoRoot", $RepoRoot,
        "-ArtifactRoot", $blockedRoot,
        "-ManifestPath", $blockedManifest,
        "-SkipObservedFixture"
    )
    Assert-True ($blockedRun.ExitCode -ne 0) "runner fails closed when replay evidence is skipped" $blockedRun.Output
    Assert-True ($blockedRun.Output -match "Status: BLOCKED") "blocked runner prints BLOCKED" $blockedRun.Output
    $blockedJson = Get-Content -Raw -LiteralPath $blockedManifest | ConvertFrom-Json
    Assert-True ($blockedJson.status -eq "BLOCKED") "blocked manifest status is BLOCKED"
    Assert-True ($blockedJson.WebReplayObserved -eq $false) "blocked manifest does not claim Web replay"
}
finally {
    foreach ($path in $TempRoots) {
        Remove-Item -LiteralPath $path -Recurse -Force -ErrorAction SilentlyContinue
    }
}

if ($Failed -gt 0) {
    exit 1
}
exit 0
