#!/usr/bin/env pwsh
<#
Verifies a diff proposal evidence manifest without running apply/revert, CLIs,
model APIs, services, uploads, or packaging.
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ManifestPath
)

$ErrorActionPreference = "Stop"
$Passed = 0
$Failed = 0
$AllowedReviewStatus = @("approved", "rejected")

function Pass([string]$Text) {
    $script:Passed++
    Write-Host "  PASS  $Text" -ForegroundColor Green
}

function Fail([string]$Text) {
    $script:Failed++
    Write-Host "  FAIL  $Text" -ForegroundColor Red
}

function Test-NonEmptyString($Value) {
    return -not [string]::IsNullOrWhiteSpace([string]$Value)
}

$resolvedManifest = if ([System.IO.Path]::IsPathRooted($ManifestPath)) {
    [System.IO.Path]::GetFullPath($ManifestPath)
} else {
    [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $ManifestPath))
}

if (-not (Test-Path -LiteralPath $resolvedManifest)) {
    Fail "diff proposal manifest exists"
    Write-Host "`nDiff proposal manifest verification: $Passed passed, $Failed failed"
    exit 1
}
Pass "diff proposal manifest exists"

$manifest = $null
try {
    $manifest = Get-Content -Raw -LiteralPath $resolvedManifest | ConvertFrom-Json
    Pass "diff proposal manifest parses"
} catch {
    Fail "diff proposal manifest parses"
}

if ($manifest) {
    if ($manifest.schema -eq "agenthub-diff-proposal-evidence-manifest-v1") {
        Pass "diff proposal manifest schema is supported"
    } else {
        Fail "diff proposal manifest schema is supported"
    }

    if (Test-NonEmptyString $manifest.generatedAt) {
        Pass "manifest has generatedAt"
    } else {
        Fail "manifest has generatedAt"
    }

    if ($manifest.export_mode -eq "review-only") {
        Pass "manifest export_mode is review-only"
    } else {
        Fail "manifest export_mode is review-only"
    }

    if ($false -eq $manifest.real_apply_supported) {
        Pass "manifest real_apply_supported is false"
    } else {
        Fail "manifest real_apply_supported is false"
    }

    $proposals = @($manifest.proposals)
    if ($proposals.Count -gt 0) {
        Pass "manifest lists diff proposals"
    } else {
        Fail "manifest lists diff proposals"
    }

    foreach ($proposal in $proposals) {
        $filePath = [string]$proposal.file_path
        if (Test-NonEmptyString $filePath) {
            Pass "proposal has file path: $filePath"
        } else {
            Fail "proposal has file path"
        }

        if ($AllowedReviewStatus -contains ([string]$proposal.review_status)) {
            Pass "proposal review_status is supported: $filePath"
        } else {
            Fail "proposal review_status is supported: $filePath"
        }

        foreach ($field in @("hash", "artifact_id", "approval_id", "correlation_id", "edit_id")) {
            if (Test-NonEmptyString $proposal.$field) {
                Pass "proposal has ${field}: $filePath"
            } else {
                Fail "proposal has ${field}: $filePath"
            }
        }

        if ($null -ne $proposal.can_apply -and $proposal.can_apply.GetType().Name -eq "Boolean") {
            Pass "proposal can_apply is boolean: $filePath"
        } else {
            Fail "proposal can_apply is boolean: $filePath"
        }

        if ($false -eq $proposal.can_apply) {
            Pass "proposal can_apply is false: $filePath"
        } else {
            Fail "proposal can_apply is false: $filePath"
        }

        if ($null -ne $proposal.can_revert -and $proposal.can_revert.GetType().Name -eq "Boolean") {
            Pass "proposal can_revert is boolean: $filePath"
        } else {
            Fail "proposal can_revert is boolean: $filePath"
        }

        if ($false -eq $proposal.can_revert) {
            Pass "proposal can_revert is false: $filePath"
        } else {
            Fail "proposal can_revert is false: $filePath"
        }
    }
}

Write-Host "`nDiff proposal manifest verification: $Passed passed, $Failed failed"
if ($Failed -gt 0) {
    exit 1
}
