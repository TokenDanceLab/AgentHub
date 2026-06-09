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

function Invoke-RepoScript {
    param([string[]]$Arguments)

    $powershell = Get-Command pwsh -ErrorAction SilentlyContinue
    if (-not $powershell) {
        $powershell = Get-Command powershell -ErrorAction Stop
    }

    $psi = [System.Diagnostics.ProcessStartInfo]::new()
    $psi.FileName = if (-not [string]::IsNullOrWhiteSpace($powershell.Source)) {
        $powershell.Source
    } elseif (-not [string]::IsNullOrWhiteSpace($powershell.Path)) {
        $powershell.Path
    } else {
        $powershell.Name
    }
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.WorkingDirectory = $RepoRoot
    $allArguments = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File") + $Arguments
    $quoted = foreach ($arg in $allArguments) {
        if ($null -eq $arg) {
            '""'
            continue
        }
        if ($arg.Length -gt 0 -and $arg -notmatch '[\s"]') {
            $arg
            continue
        }
        '"' + ($arg -replace '"', '\"') + '"'
    }
    $psi.Arguments = $quoted -join " "

    $proc = [System.Diagnostics.Process]::Start($psi)
    $stdout = $proc.StandardOutput.ReadToEnd()
    $stderr = $proc.StandardError.ReadToEnd()
    $proc.WaitForExit()

    [pscustomobject]@{
        ExitCode = $proc.ExitCode
        Output = ($stdout + "`n" + $stderr)
    }
}

$scriptPath = Join-Path $RepoRoot "scripts\verify-e2e-smoke-matrix.ps1"
$appPackagePath = Join-Path $RepoRoot "app\package.json"
$webPackagePath = Join-Path $RepoRoot "app\web\package.json"
$desktopPackagePath = Join-Path $RepoRoot "app\desktop\package.json"
$taskContractSpecPath = Join-Path $RepoRoot "app\web\src\__e2e__\task-contract.spec.ts"

Assert-True (Test-Path -LiteralPath $scriptPath) "E2E smoke matrix script exists"
Assert-True (Test-Path -LiteralPath $appPackagePath) "app package exists"
Assert-True (Test-Path -LiteralPath $webPackagePath) "web package exists"
Assert-True (Test-Path -LiteralPath $desktopPackagePath) "desktop package exists"

try {
    $tmpRoot = Join-Path $RepoRoot ".tmp\e2e-smoke-matrix\script-test-$PID"
    Remove-Item -LiteralPath $tmpRoot -Recurse -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Force -Path $tmpRoot | Out-Null
    $TempRoots += $tmpRoot

    if (Test-Path -LiteralPath $scriptPath) {
        $scriptText = Get-Content -Raw -LiteralPath $scriptPath
        Assert-True ($scriptText -match "agenthub-e2e-smoke-matrix-v1") "matrix writes stable schema"
        Assert-True ($scriptText -match "web-real-mode-playwright") "matrix includes Web real-mode Playwright row"
        Assert-True ($scriptText -match "desktop-renderer-playwright") "matrix includes Desktop renderer Playwright row"
        Assert-True ($scriptText -match "localhost-services-smoke") "matrix includes local services smoke row"
        Assert-True ($scriptText -match "edge-client-smoke") "matrix includes Edge client smoke row"
        Assert-True ($scriptText -match "login-real-readiness-gate") "matrix includes real login readiness row"
        Assert-True ($scriptText -match "desktop-tauri-dry-smoke") "matrix includes Tauri dry smoke row"
        Assert-True ($scriptText -match "blocked_with_evidence") "matrix records blocked-with-evidence rows"
        Assert-True ($scriptText -match 'secrets_handled = \$false') "matrix records no secret handling"
        Assert-True ($scriptText -match 'real_tokendance_id_login_executed = \$false') "matrix records no real login execution"

        $outputPath = Join-Path $tmpRoot "matrix.json"
        $run = Invoke-RepoScript @(
            $scriptPath,
            "-RepoRoot", $RepoRoot,
            "-ArtifactRoot", $tmpRoot,
            "-OutputPath", $outputPath,
            "-SkipWebE2E",
            "-SkipDesktopE2E",
            "-SkipLocalStack",
            "-SkipEdgeClientSmoke",
            "-SkipTauriDry",
            "-CommandTimeoutSec", "60"
        )
        Assert-True ($run.ExitCode -eq 0) "matrix treats proposal-only real login gate as blocked evidence, not failure" $run.Output
        Assert-True ($run.Output -match "passed_with_blockers") "matrix reports passed_with_blockers for skipped plus blocked readiness" $run.Output
        Assert-True ($run.Output -match "BlockedWithEvidence: 1") "matrix reports one blocked readiness row" $run.Output
        Assert-True (Test-Path -LiteralPath $outputPath) "matrix output manifest is written"

        if (Test-Path -LiteralPath $outputPath) {
            $jsonText = Get-Content -Raw -LiteralPath $outputPath
            $json = $jsonText | ConvertFrom-Json
            Assert-True ($json.schema -eq "agenthub-e2e-smoke-matrix-v1") "manifest schema is explicit"
            Assert-True ($json.status -eq "passed_with_blockers") "manifest status preserves blocker state"
            Assert-True ($json.blocked_count -eq 1) "manifest counts blocked readiness row"
            Assert-True ($json.boundaries.secrets_handled -eq $false) "manifest records no secret handling"
            Assert-True ($json.boundaries.real_tokendance_id_login_executed -eq $false) "manifest records no real login"
            Assert-True (@($json.rows | Where-Object { $_.name -eq "login-real-readiness-gate" -and $_.status -eq "blocked_with_evidence" }).Count -eq 1) "login readiness row is blocked with evidence"
            Assert-True ($jsonText -notmatch "sk-[A-Za-z0-9]|client_secret|Authorization:\s*Bearer") "manifest is redacted"
        }
    }

    $appPackage = Get-Content -Raw -LiteralPath $appPackagePath | ConvertFrom-Json
    $webPackage = Get-Content -Raw -LiteralPath $webPackagePath | ConvertFrom-Json
    $desktopPackage = Get-Content -Raw -LiteralPath $desktopPackagePath | ConvertFrom-Json
    Assert-True ([string]$appPackage.scripts."test:smoke:matrix" -match "verify-e2e-smoke-matrix\.ps1") "app package exposes matrix script"
    Assert-True ([string]$appPackage.scripts."test:e2e:web" -match "agenthub-web") "app package exposes Web E2E script"
    Assert-True ([string]$appPackage.scripts."test:e2e:desktop" -match "agenthub-desktop") "app package exposes Desktop E2E script"
    Assert-True ([string]$webPackage.scripts."test:e2e:real-mode" -match "web-hub-real-mode-smoke\.spec\.ts" -and [string]$webPackage.scripts."test:e2e:real-mode" -match "task-contract\.spec\.ts") "web package exposes real-mode and replay E2E"
    Assert-True ([string]$desktopPackage.scripts."test:e2e:smoke" -match "smoke\.spec\.ts") "desktop package exposes renderer smoke E2E"

    if (Test-Path -LiteralPath $taskContractSpecPath) {
        $taskSpecText = Get-Content -Raw -LiteralPath $taskContractSpecPath
        Assert-True ($taskSpecText -match "agenthub\.web_task_contract_replay\.v1") "task contract writes replay manifest schema"
        Assert-True ($taskSpecText -match "approvalReplayObserved") "task contract records approval replay"
        Assert-True ($taskSpecText -match "artifactReplayObserved") "task contract records artifact replay"
        Assert-True ($taskSpecText -match "directLocalEdge:\s*false") "task contract records no direct Local Edge path"
    }
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
