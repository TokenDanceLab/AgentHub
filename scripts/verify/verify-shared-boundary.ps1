#!/usr/bin/env pwsh
<#
Verify that the shared frontend package's workbench, chatview, and ui
sub-trees stay free of Local Edge client dependencies.

The shared package is consumed by all three platforms (Web, Desktop, Mobile).
Web and Mobile are Hub-only — they have no Local Edge. Edge clients (apiClient
for REST, EventClient for WS, edgeClient, /v1/runs and /v1/events paths) must
not leak into shared workbench/chatview/ui source, because that carries a hard
Edge dependency into Hub-only surfaces.

The existing web/mobile boundary gates (verify-web-hub-boundary.ps1,
verify-mobile-hub-boundary.ps1) scan only platform src/ — they do NOT cover
app/shared/src/. This gate closes that gap (audit-A Scope 4 NEW finding).

Known defects allowlist (current violations accepted as documented debt):
  - FilePreviewRouter.tsx — declares local Edge REST helpers (applyRunDiff /
    applyAllRunDiffs) that call /v1/runs. apiClient.ts removed per RFC A-V3 §4.1;
    local helpers kept for compilability until PreviewPort migration (audit-A P).
  - RuntimeEvidenceHelpers.ts — constructs Edge content paths /v1/runs/.../content
    for artifact/preview URL building. Known Edge-path coupling.
  - RuntimeEvidenceHelpers.test.ts — test data with Edge content paths.
  - DiffReviewPanelTypes.ts — comment mentions Edge POST /v1/runs/:id/apply.

Clean (policy-accepted, NOT an Edge client):
  - useWorkbenchProjectsRoute.ts — imports HubClient (type-only) and calls Hub
    REST directly. Legitimate per A7 #4 workbench route policy (A-V2 ruling).
    HubClient is a Hub client — does not match any forbidden Edge pattern.

New Edge client references in non-allowlisted files (or new patterns in
allowlisted files beyond their exemptions) -> FAIL.
#>

[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")

$Passed = 0
$Failed = 0

function Pass([string]$Text) {
    $script:Passed++
    Write-Host "  PASS  $Text" -ForegroundColor Green
}

function Fail([string]$Text) {
    $script:Failed++
    Write-Host "  FAIL  $Text" -ForegroundColor Red
}

function Relative([string]$Path) {
    return [System.IO.Path]::GetRelativePath($RepoRoot, $Path).Replace("\", "/")
}

# ── Scan targets ─────────────────────────────────────
# shared sub-trees consumed by all platforms; must stay Edge-free.
$ScanDirs = @(
    "app/shared/src/workbench",
    "app/shared/src/chatview",
    "app/shared/src/ui"
)

# ── Forbidden Edge client patterns ───────────────────
$ForbiddenPatterns = @(
    @{ Pattern = "apiClient";   Label = "Edge REST client (apiClient)" },
    @{ Pattern = "EventClient"; Label = "Edge WS client (EventClient)" },
    @{ Pattern = "edgeClient";  Label = "Edge client (edgeClient)" },
    @{ Pattern = "/v1/runs";    Label = "Edge REST run API path (/v1/runs)" },
    @{ Pattern = "/v1/events";  Label = "Edge WS event API path (/v1/events)" }
)

# ── Known defects allowlist ──────────────────────────
# Each entry exempts a specific file from specific patterns. A match is
# downgraded to a KNOWN DEFECT note when the file+pattern pair is listed here.
# Adding a NEW Edge reference to an allowlisted file for a NON-exempted pattern
# still fails. Adding an Edge reference to any other file always fails.
$KnownDefects = @(
    @{ File = "app/shared/src/workbench/inspector/FilePreviewRouter.tsx";
       Exempt = @("/v1/runs");
       Reason = "local Edge REST helpers + comment /v1/runs — drift, route via PreviewPort (audit-A P)" },
    @{ File = "app/shared/src/workbench/inspector/RuntimeEvidenceHelpers.ts";
       Exempt = @("/v1/runs");
       Reason = "constructs Edge content paths /v1/runs/.../content — known Edge-path coupling" },
    @{ File = "app/shared/src/workbench/inspector/RuntimeEvidenceHelpers.test.ts";
       Exempt = @("/v1/runs");
       Reason = "test data with Edge content paths" },
    @{ File = "app/shared/src/ui/DiffReviewPanelTypes.ts";
       Exempt = @("/v1/runs");
       Reason = "comment mentions Edge POST /v1/runs/:id/apply (doc only)" }
)

function Test-KnownDefect([string]$RelPath, [string]$Pattern) {
    foreach ($defect in $KnownDefects) {
        if ($defect.File -eq $RelPath) {
            if ($defect.Exempt -contains $Pattern) { return $defect.Reason }
        }
    }
    return $null
}

# ── Collect target files ────────────────────────────
$Files = @()
foreach ($dir in $ScanDirs) {
    $full = Join-Path $RepoRoot $dir
    if (Test-Path -LiteralPath $full) {
        $Files += Get-ChildItem -LiteralPath $full -Recurse -File |
            Where-Object { $_.Extension -in @(".ts", ".tsx") }
    } else {
        Fail "scan directory missing: $dir"
    }
}

Write-Host "`n=== Shared Edge-free boundary (workbench/chatview/ui) ===" -ForegroundColor Cyan
Write-Host "Scanning $($Files.Count) .ts/.tsx file(s) across shared sub-trees."

# ── Scan ─────────────────────────────────────────────
$DefectNotes = 0

foreach ($file in $Files) {
    $rel = Relative $file.FullName
    $lines = @(Get-Content -LiteralPath $file.FullName)

    for ($i = 0; $i -lt $lines.Count; $i++) {
        $line = $lines[$i]
        foreach ($entry in $ForbiddenPatterns) {
            if ($line -match $entry.Pattern) {
                $reason = Test-KnownDefect $rel $entry.Pattern
                if ($null -ne $reason) {
                    $DefectNotes++
                    Write-Host "  KNOWN DEFECT  $($entry.Label) in ${rel}:$($i+1) — $reason" -ForegroundColor Yellow
                } else {
                    Fail "$($entry.Label) found in ${rel}:$($i+1) — Edge client must not leak into shared $(($rel -replace '^app/shared/src/','') -replace '/.*$','')"
                }
            }
        }
    }
}

if ($Failed -eq 0 -and $Files.Count -gt 0) {
    if ($DefectNotes -gt 0) {
        Pass "no new Edge client violations ($DefectNotes known-defect note(s) in allowlist)"
    } else {
        Pass "no Edge client violations across $($Files.Count) shared file(s)"
    }
}

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  Passed: $Passed  |  Failed: $Failed" -ForegroundColor $(if ($Failed -eq 0) { "Green" } else { "Red" })
Write-Host "========================================" -ForegroundColor Cyan

if ($Failed -ne 0) {
    exit 1
}
