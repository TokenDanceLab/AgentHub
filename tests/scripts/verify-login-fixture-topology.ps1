#!/usr/bin/env pwsh

[CmdletBinding()]
param(
    [string]$RepoRoot = "."
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path $RepoRoot).ProviderPath

$Passed = 0
$Failed = 0

function Pass([string]$Text) {
    $script:Passed++
    Write-Host "  PASS  $Text" -ForegroundColor Green
}

function Fail([string]$Text, [string]$Detail = "") {
    $script:Failed++
    Write-Host "  FAIL  $Text" -ForegroundColor Red
    if ($Detail) {
        Write-Host "        $Detail" -ForegroundColor DarkRed
    }
}

function Assert-True([bool]$Condition, [string]$Text, [string]$Detail = "") {
    if ($Condition) {
        Pass $Text
    } else {
        Fail $Text $Detail
    }
}

function Invoke-CheckedScript([string]$RelativePath) {
    $scriptPath = Join-Path $RepoRoot $RelativePath
    if (-not (Test-Path -LiteralPath $scriptPath)) {
        return [pscustomobject]@{
            ExitCode = 1
            Output = "Missing script: $RelativePath"
        }
    }

    $output = & pwsh -NoProfile -ExecutionPolicy Bypass -File $scriptPath -RepoRoot $RepoRoot 2>&1 | Out-String
    return [pscustomobject]@{
        ExitCode = $LASTEXITCODE
        Output = $output
    }
}

Write-Host "AgentHub P0 remote-control auth/topology prerequisite gate tests" -ForegroundColor Magenta

$scriptPath = Join-Path $RepoRoot "scripts\verify-login-fixture-topology.ps1"
Assert-True (Test-Path -LiteralPath $scriptPath) "P0 auth/topology prerequisite script exists"

if (Test-Path -LiteralPath $scriptPath) {
    $scriptText = Get-Content -LiteralPath $scriptPath -Raw -Encoding UTF8
    Assert-True ($scriptText -match "No live Hub, TokenDance ID, browser, secret, Local Edge, or CLI/model calls were made") "script declares no-live-login boundary"
    Assert-True ($scriptText -match "Web authenticated Hub session to Desktop/Edge target") "script focuses Web authenticated Hub session to registered target"
    Assert-True ($scriptText -match "Packaged Desktop Edge") "script checks registered packaged Desktop Edge target fixture"
    Assert-True ($scriptText -match "app\\web\\src\\api\\hubAuth\.test\.ts") "script checks Web auth fixture"
    Assert-True ($scriptText -match "app\\web\\src\\hooks\\useWebAuth\.ts") "script checks existing Web auth hook wiring"
    Assert-True ($scriptText -match "app\\desktop\\src\\api\\hubAuth\.test\.ts") "script checks Desktop auth fixture"
    Assert-True ($scriptText -match "app\\desktop\\src\\platform\\desktopPlatform\.test\.ts") "script checks Desktop packaged host SQLite readiness"
    Assert-True ($scriptText -match "verify-oidc-flow\.ps1.*-LocalOnly") "script links existing local-only OIDC gate"
    Assert-True ($scriptText -match "verify-packaged-login-real-readiness\.ps1") "script links packaged real-readiness dry gate"
    Assert-True ($scriptText -match "verify-web-hub-boundary\.ps1") "script links Web Hub-only boundary gate"
    Assert-True ($scriptText -match "verify-tauri-package-readiness\.ps1") "script links Tauri package readiness and macOS dry policy"
}

$run = Invoke-CheckedScript "scripts\verify-login-fixture-topology.ps1"
Assert-True ($run.ExitCode -eq 0) "P0 auth/topology prerequisite script passes on current repo" $run.Output
Assert-True ($run.Output -match "Mock-only: fake OIDC callback") "script labels mock-only evidence" $run.Output
Assert-True ($run.Output -match "Real-mode ready: source gates") "script labels real-mode ready gates" $run.Output
Assert-True ($run.Output -match "future real TokenDanceID/OIDC login remains approval-gated") "script keeps real OIDC as approval gate" $run.Output
Assert-True ($run.Output -match "real Desktop dispatch -> Local Edge CLI adapter start remains outside this login/topology slice") "script keeps real dispatch and CLI start outside this slice" $run.Output
Assert-True ($run.Output -match "agenthub-web.*hubAuth\.test\.ts") "script prints Web focused fixture command" $run.Output
Assert-True ($run.Output -match "agenthub-desktop.*hubAuth\.test\.ts") "script prints Desktop focused fixture command" $run.Output

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  Passed: $Passed  |  Failed: $Failed" -ForegroundColor $(if ($Failed -eq 0) { "Green" } else { "Red" })
Write-Host "========================================" -ForegroundColor Cyan

exit $(if ($Failed -gt 0) { 1 } else { 0 })
