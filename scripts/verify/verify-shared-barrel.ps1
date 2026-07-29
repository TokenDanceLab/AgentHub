#!/usr/bin/env pwsh
<#
Verify that platform apps (Web, Desktop, Mobile) do not import Local Edge
client exports from the @agenthub/shared barrel.

The shared barrel (app/shared/src/index.ts) re-exports both Hub clients
(hubClient.ts) and Edge clients (apiClient.ts REST + eventClient.ts WS).
This is a latent leak: the barrel makes Edge clients available to Hub-only
platforms (Web, Mobile) that have no Local Edge. The leak is not active
today — no platform imports Edge exports — but there is no gate preventing
it (audit-A Scope 1 E finding).

This gate has two checks:
  1. Sub-path ban — platform src must not import Edge client modules
     directly (e.g. @shared/apiClient, @agenthub/shared/eventClient).
  2. Barrel name ban — platform src must not import Edge export names
     (apiClient functions, EventClient) from the root barrel
     (@shared or @agenthub/shared without a sub-path).

Desktop owns the Local Edge bridge, but it should still route through its
own apiClient/eventClient wrappers — not pull Edge clients from the shared
barrel. All three platforms are scanned.

Current state: clean — no platform imports Edge exports. This gate prevents
future regression.
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

# ── Platform app source directories ─────────────────
$PlatformDirs = @(
    "app/web/src",
    "app/desktop/src",
    "app/mobile-rn/src"
)

# ── Edge client module names (sub-path ban) ──────────
# Importing these sub-paths from the shared package pulls in Edge clients.
$EdgeSubPaths = @(
    "apiClient",
    "eventClient",
    "edgeClient"
)

# ── Edge export names (barrel name ban) ──────────────
# Names re-exported from the shared barrel (index.ts) that originate from
# apiClient.ts (Edge REST) or eventClient.ts (Edge WS). If any of these
# appear in a barrel import (@shared or @agenthub/shared root), it is a
# platform pulling Edge clients through the shared barrel.
$EdgeExportNames = @(
    # apiClient.ts exports (Edge REST)
    "setBaseUrl", "getBaseUrl", "getHealth", "listProjects", "getProject",
    "createProject", "getProjectMemory", "listThreads", "getThread",
    "createThread", "updateThread", "archiveThread", "listThreadItems",
    "createThreadMessage", "listRunners", "getRunner", "pingRunner",
    "listRuns", "getRun", "startRun", "cancelRun", "listRunItems",
    "getRunLogs", "getRunDiff", "listApprovals", "getApproval",
    "decideApproval", "listArtifacts", "getArtifact", "getArtifactContent",
    "applyArtifact", "discardArtifact", "listPreviews", "getPreview",
    "createPreview", "getWorkspace", "listWorkspaceFiles", "readWorkspaceFile",
    # eventClient.ts exports (Edge WS)
    "EventClient", "EventClientOptions", "EventConnectionListener",
    "EventConnectionStatus", "EventListener"
)

# ── Collect platform source files ────────────────────
$Files = @()
foreach ($dir in $PlatformDirs) {
    $full = Join-Path $RepoRoot $dir
    if (Test-Path -LiteralPath $full) {
        $Files += Get-ChildItem -LiteralPath $full -Recurse -File |
            Where-Object { $_.Extension -in @(".ts", ".tsx") }
    } else {
        Fail "platform source directory missing: $dir"
    }
}

Write-Host "`n=== Shared barrel Edge-export ban (platform apps) ===" -ForegroundColor Cyan
Write-Host "Scanning $($Files.Count) .ts/.tsx file(s) across platform src."

# ── Check 1: Sub-path Edge module import ban ──────────
# Catches: import { foo } from '@shared/apiClient'
#          import { bar } from '@agenthub/shared/eventClient'
$subPathViolations = 0
foreach ($file in $Files) {
    $rel = Relative $file.FullName
    $lines = @(Get-Content -LiteralPath $file.FullName)

    for ($i = 0; $i -lt $lines.Count; $i++) {
        $line = $lines[$i]
        foreach ($mod in $EdgeSubPaths) {
            # Match import from '@shared/<mod>' or '@agenthub/shared/<mod>'
            if ($line -match ('from\s+[''"'']@(agenthub/)?shared/' + $mod + '[''"'']')) {
                Fail "Edge client sub-path import '@shared/$mod' in ${rel}:$($i+1)"
                $subPathViolations++
            }
        }
    }
}

if ($subPathViolations -eq 0) {
    Pass "no Edge client sub-path imports (@shared/apiClient, @agenthub/shared/eventClient, etc.)"
}

# ── Check 2: Barrel Edge export name ban ─────────────
# Catches: import { EventClient, listRunners } from '@shared'
#          import { startRun } from '@agenthub/shared'
# Only matches root barrel imports (no sub-path after @shared/@agenthub/shared).
$barrelViolations = 0
foreach ($file in $Files) {
    $rel = Relative $file.FullName
    $lines = @(Get-Content -LiteralPath $file.FullName)

    for ($i = 0; $i -lt $lines.Count; $i++) {
        $line = $lines[$i]
        # Match root barrel import: from '@shared' or from '@agenthub/shared'
        # (no trailing / — sub-paths are handled by Check 1).
        if ($line -match 'from\s+[''"'']@(agenthub/)?shared[''"'']') {
            foreach ($name in $EdgeExportNames) {
                # Word-boundary match so 'getRun' doesn't match 'getRunner'.
                if ($line -match "\b$name\b") {
                    Fail "Edge barrel export '$name' imported from root barrel in ${rel}:$($i+1)"
                    $barrelViolations++
                }
            }
        }
    }
}

if ($barrelViolations -eq 0) {
    Pass "no Edge export names imported from root barrel (@shared / @agenthub/shared)"
}

if ($Failed -eq 0 -and $Files.Count -gt 0) {
    Pass "platform apps free of shared Edge exports ($($Files.Count) file(s) scanned)"
}

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  Passed: $Passed  |  Failed: $Failed" -ForegroundColor $(if ($Failed -eq 0) { "Green" } else { "Red" })
Write-Host "========================================" -ForegroundColor Cyan

if ($Failed -ne 0) {
    exit 1
}
