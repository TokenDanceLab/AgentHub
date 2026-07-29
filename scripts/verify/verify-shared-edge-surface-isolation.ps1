#!/usr/bin/env pwsh
<#
Verify that the Hub-only surfaces (Web + Mobile RN) stay free of Local Edge
client imports from the shared package.

The shared package carries Edge surfaces (eventClient.ts, transcript/edge*.ts,
edgeQueryKeys) that are meant for Desktop only. Web and Mobile RN are Hub-only
and must not import these Edge-specific shared modules.

This is a NON-BLOCKING lint per A-V3 §4.2 step 2. It reports violations but
always exits 0. Harden to -ErrorAction Stop + exit 1 after A-V3 sign-off
confirms gate strength and 15-layer index merge.

A-V3 建议：shared 不做全量三分，但对 edge 表面补一条隔离门禁——web/mobile-rn
不得 import @shared/eventClient、@shared/transcript/edge*、edgeQueryKeys。
本条门禁与 #1463 shared-boundary 互补：#1463 守 shared 内部 workbench/chatview/ui
不出现 Edge 客户端实现；本条守 shared 内已存在的 edge 表面不被 hub-only 消费者引入。
#>

[CmdletBinding()]
param()

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")

$Passed = 0
$Failed = 0

function Pass([string]$Text) {
    $script:Passed++
    Write-Host "  PASS  $Text" -ForegroundColor Green
}

function Warn([string]$Text) {
    $script:Failed++
    Write-Host "  WARN  $Text" -ForegroundColor Yellow
}

function Relative([string]$Path) {
    return [System.IO.Path]::GetRelativePath($RepoRoot, $Path).Replace("\", "/")
}

# ── Scan targets ───────────────────────────────────────
# Hub-only surfaces: Web browser client, Mobile React Native client
$ScanDirs = @(
    "app/web/src",
    "app/mobile-rn/src"
)

# ── Forbidden Edge surface import patterns ──────────────
# These patterns match import paths and symbol usage in .ts/.tsx/.js/.jsx files.
# Each pattern catches both the workspace package name (@agenthub/shared/...)
# and the path alias (@shared/...) that web/desktop use via tsconfig/vite.
$ForbiddenPatterns = @(
    @{
        Pattern = "@shared/eventClient|@agenthub/shared/eventClient";
        Label   = "Edge WS client import (@shared/eventClient)"
    },
    @{
        Pattern = "@shared/transcript/edge|@agenthub/shared/transcript/edge";
        Label   = "Edge transcript module import (@shared/transcript/edge*)"
    },
    @{
        Pattern = "edgeQueryKeys";
        Label   = "Edge query keys symbol (edgeQueryKeys)"
    }
)

Write-Host "`n=== Shared Edge surface isolation (non-blocking lint, A-V3 §4.2 step 2) ===" -ForegroundColor Cyan
Write-Host "Policy: app/web/src and app/mobile-rn/src (Hub-only clients) must not"
Write-Host "import @shared/eventClient, @shared/transcript/edge*, or edgeQueryKeys."
Write-Host ""

# ── Collect target files ────────────────────────────────
$Files = @()
foreach ($dir in $ScanDirs) {
    $full = Join-Path $RepoRoot $dir
    if (Test-Path -LiteralPath $full) {
        $Files += Get-ChildItem -LiteralPath $full -Recurse -File |
            Where-Object { $_.Extension -in @(".ts", ".tsx", ".js", ".jsx") }
    } else {
        Warn "scan directory missing: $dir"
    }
}

Write-Host "Scanning $($Files.Count) .ts/.tsx/.js/.jsx file(s) across $($ScanDirs.Count) Hub-only surface(s)."
Write-Host ""

# ── Scan ────────────────────────────────────────────────
$TotalHits = 0

foreach ($entry in $ForbiddenPatterns) {
    $matches = $Files | Select-String -Pattern $entry.Pattern
    if ($matches) {
        foreach ($match in $matches) {
            $TotalHits++
            Warn "$($entry.Label) found in $(Relative $match.Path):$($match.LineNumber)"
        }
    } else {
        Pass "$($entry.Label) absent from Hub-only surfaces"
    }
}

# ── Summary ─────────────────────────────────────────────
Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  Passed: $Passed  |  Warnings: $Failed" -ForegroundColor $(if ($Failed -eq 0) { "Green" } else { "Yellow" })
Write-Host "========================================" -ForegroundColor Cyan

if ($Failed -eq 0) {
    Write-Host "`nNo Edge surface isolation violations detected. Hub-only surfaces are clean." -ForegroundColor Green
} else {
    Write-Host "`n$Failed violation(s) found — review above warnings." -ForegroundColor Yellow
    Write-Host "This is a NON-BLOCKING lint (A-V3 §4.2 step 2). Violations are reported"
    Write-Host "but do not fail the build. Harden after A-V3 sign-off." -ForegroundColor Yellow
}

# Always exit 0 — non-blocking lint per A-V3 §4.2 step 2.
# Harden to exit 1 after sign-off confirms gate strength and 15-layer index merge.
exit 0
