#!/usr/bin/env pwsh
<#
Verify that the Hub-only surfaces (Web + Mobile RN) stay free of Local Edge
client imports from the shared package.

The shared package carries Edge surfaces (eventClient.ts, transcript/edge*.ts,
edgeQueryKeys) that are meant for Desktop only. Web and Mobile RN are Hub-only
and must not import these Edge-specific shared modules.

HARD GATE since 2026-08-03 (#1525): violations exit 1; missing scan
directories fail; internal errors fail. Self-tests live in
scripts/verify/tests/verify-shared-edge-surface-isolation.Tests.ps1.

A-V3 裁决（2026-08-03）：shared 不做全量三分，edge 表面补硬门禁——web/mobile-rn
不得 import @shared/eventClient、@shared/transcript/edge*、edgeQueryKeys。
本条门禁与 #1463 shared-boundary 互补：#1463 守 shared 内部 workbench/chatview/ui
不出现 Edge 客户端实现；本条守 shared 内已存在的 edge 表面不被 hub-only 消费者引入。
#>

[CmdletBinding()]
param(
    # 测试注入点：用临时 fixture 根替代仓库根（默认从脚本位置推导）
    [string]$RepoRootOverride = ""
)

$ErrorActionPreference = "Stop"

if ($RepoRootOverride) {
    $RepoRoot = Resolve-Path -LiteralPath $RepoRootOverride
} else {
    $RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
}

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

Write-Host "`n=== Shared Edge surface isolation (HARD GATE, A-V3 裁决 2026-08-03) ===" -ForegroundColor Cyan
Write-Host "Policy: app/web/src and app/mobile-rn/src (Hub-only clients) must not"
Write-Host "import @shared/eventClient, @shared/transcript/edge*, or edgeQueryKeys."
Write-Host ""

# ── Collect target files ────────────────────────────────
$Files = @()
foreach ($dir in $ScanDirs) {
    $full = Join-Path $RepoRoot $dir
    if (-not (Test-Path -LiteralPath $full)) {
        Fail "scan directory missing: $dir — Hub-only surface gate cannot prove anything; treat as violation"
        continue
    }
    try {
        $Files += Get-ChildItem -LiteralPath $full -Recurse -File |
            Where-Object { $_.Extension -in @(".ts", ".tsx", ".js", ".jsx") }
    } catch {
        Fail "scan error in $dir : $($_.Exception.Message)"
    }
}

Write-Host "Scanning $($Files.Count) .ts/.tsx/.js/.jsx file(s) across $($ScanDirs.Count) Hub-only surface(s)."
Write-Host ""

# ── Scan ────────────────────────────────────────────────
$TotalHits = 0

foreach ($entry in $ForbiddenPatterns) {
    try {
        $matches = $Files | Select-String -Pattern $entry.Pattern
    } catch {
        Fail "$($entry.Label): scan error — $($_.Exception.Message)"
        continue
    }
    if ($matches) {
        foreach ($match in $matches) {
            $TotalHits++
            Fail "$($entry.Label) found in $(Relative $match.Path):$($match.LineNumber)"
        }
    } else {
        Pass "$($entry.Label) absent from Hub-only surfaces"
    }
}

# ── Summary ─────────────────────────────────────────────
Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  Passed: $Passed  |  Failed: $Failed" -ForegroundColor $(if ($Failed -eq 0) { "Green" } else { "Red" })
Write-Host "========================================" -ForegroundColor Cyan

if ($Failed -eq 0) {
    Write-Host "`nNo Edge surface isolation violations detected. Hub-only surfaces are clean." -ForegroundColor Green
    exit 0
} else {
    Write-Host "`n$Failed violation(s) found — HARD GATE (A-V3 裁决 2026-08-03, #1525)." -ForegroundColor Red
    Write-Host "Web/Mobile must not import Edge-only shared surfaces; fix imports or escalate." -ForegroundColor Red
    exit 1
}
