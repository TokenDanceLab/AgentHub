#!/usr/bin/env pwsh

[CmdletBinding()]
param(
    [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path -LiteralPath $RepoRoot).Path
$scriptPath = Join-Path $RepoRoot "scripts/verify-live-chain-topology.ps1"

if (-not (Test-Path -LiteralPath $scriptPath -PathType Leaf)) {
    Write-Error "Missing verifier: $scriptPath"
}

& $scriptPath -RepoRoot $RepoRoot
exit $LASTEXITCODE
