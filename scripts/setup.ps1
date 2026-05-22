# AgentHub local setup for Windows / PowerShell.

[CmdletBinding()]
param(
    [ValidateSet("none", "core", "all")]
    [string]$Reference = "none"
)

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")

Push-Location $Root
try {
    git config core.hooksPath scripts/git-hooks
    Write-Host "Git hooks enabled: scripts/git-hooks"

    if ($Reference -ne "none") {
        & (Join-Path $PSScriptRoot "sync-reference.ps1") -Tier $Reference
    }

    Write-Host "Setup complete."
}
finally {
    Pop-Location
}
