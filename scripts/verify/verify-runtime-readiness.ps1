#!/usr/bin/env pwsh
<#
AgentHub runtime readiness wrapper.

This command is kept for compatibility with older local workflows. It now
delegates to the current maintained gates and remains proposal-only: no real
CLI prompt, model/API call, production access, secret read, or package build.
#>

[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).ProviderPath

function Invoke-Gate([string]$Name, [string]$ScriptPath, [string[]]$Arguments = @()) {
    Write-Host "`n=== $Name ===" -ForegroundColor Cyan
    & pwsh -NoProfile -ExecutionPolicy Bypass -File (Join-Path $RepoRoot $ScriptPath) @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Name failed with exit code $LASTEXITCODE"
    }
}

Write-Host "AgentHub runtime readiness wrapper"
Write-Host "Evidence level: proposal-only / structural"
Write-Host "No real CLI prompt, model/API call, production access, secret read, or package build is executed."

Invoke-Gate "Doc SSOT" "scripts/verify-doc-ssot.ps1"
Invoke-Gate "Web Hub-only boundary" "scripts/verify-web-hub-boundary.ps1"
Invoke-Gate "Edge CLI real-readiness proposal" "scripts/verify-edge-cli-real-readiness.ps1" @("-Mode", "ProposalOnly")

Write-Host "`nruntime readiness wrapper ok" -ForegroundColor Green
