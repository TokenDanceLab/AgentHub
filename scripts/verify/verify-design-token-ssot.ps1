#!/usr/bin/env pwsh
<#
Verify that desktop/web surface style CSS files stay thin re-exports of the
shared design-token SSOT (A7 architecture gate candidate #7).

Per docs/architecture/07-design-system-ssot.md:
  - app/{desktop,web}/src/styles/{tokens,themes,presets}.css must be thin
    @import re-exports of @shared/styles/{tokens-base,themes,presets-base}.css
  - Only a small bounded set of platform-override declarations is allowed
    (e.g. desktop opaque borders vs web glass borders under
    [data-preset="tokendance"] — see rule §3 "Legitimate surface glue").
  - Full token-table forks (redeclaring --space-*, --radius-*, --font-* … under
    bare :root) are forbidden; they create a second value SSOT and drift.

Gate logic (all three must hold for each of the 6 surface files):
  1. Thin import present  — at least one @import line resolves @shared/styles/
  2. Override count bounded — total --* custom-property declarations per file
     ≤ $MaxOverrideLines (set from current-state baseline + modest headroom)
  3. Override scope scoped — every --* declaration block's selector carries a
     [data-… attribute selector, i.e. it is platform-scoped glue, not a bare
     :root/html full-table fork

Scope: surface styles layer only. Hardcoded rgba in component CSS (e.g.
ModelDropdown.module.css, IM panels — see rule §4 "Known forks / residual")
lives outside app/{desktop,web}/src/styles/ and is NOT scanned here.
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

# ── Targets ─────────────────────────────────────────
# The six surface re-export files that must stay thin. Each is a thin @import
# of the shared SSOT plus at most a few platform-override declarations.
$SurfaceFiles = @(
    "app/desktop/src/styles/tokens.css",
    "app/desktop/src/styles/themes.css",
    "app/desktop/src/styles/presets.css",
    "app/web/src/styles/tokens.css",
    "app/web/src/styles/themes.css",
    "app/web/src/styles/presets.css"
)

# ── Threshold ───────────────────────────────────────
# Per-file ceiling on --* custom-property re-declarations. Baseline measured
# on master (f17e3b99): desktop/presets 3, web/presets 6, others 0 → max 6.
# 10 gives modest headroom for legitimate platform border glue while catching
# full-table forks (tokens-base.css alone declares 200+ --* values under
# :root; any fork blows past 10 within the first selector block).
$MaxOverrideLines = 10

Write-Host "`n=== Design token SSOT thin re-export gate ===" -ForegroundColor Cyan
Write-Host "Surface files: $($SurfaceFiles.Count) | override ceiling: $MaxOverrideLines --* per file"

# ── Per-file checks ─────────────────────────────────
foreach ($rel in $SurfaceFiles) {
    $path = Join-Path $RepoRoot $rel
    Write-Host "`n--- $rel ---" -ForegroundColor DarkGray

    if (-not (Test-Path -LiteralPath $path)) {
        Fail "$rel missing — surface re-export file must exist"
        continue
    }

    $content = Get-Content -Raw -LiteralPath $path

    # Strip /* … */ comments so commented-out tokens never count as overrides.
    $stripped = [regex]::Replace($content, '(?s)/\*.*?\*/', '')

    # ── Gate 1: thin @import of @shared/styles/ required ──
    $importMatches = [regex]::Matches($stripped, "(?m)^\s*@import\s+['""]@shared/styles/")
    if ($importMatches.Count -ge 1) {
        Pass "$(Relative $path): thin @import @shared/styles/ present ($($importMatches.Count) line(s))"
    } else {
        Fail "$(Relative $path): missing thin @import of @shared/styles/ — surface file must re-export shared SSOT"
    }

    # ── Parse non-nested CSS blocks into (selector, body) pairs ──
    # These surface files contain only @import + flat [selector] { --x: v; }
    # rules (no @media nesting, no nested rules), so a brace-pair regex is
    # sufficient and does not need a full CSS parser.
    $blocks = [regex]::Matches($stripped, '(?ms)(?<selector>[^{}]*?)\{(?<body>[^{}]*)\}')

    $overrideCount = 0
    $scopeViolations = [System.Collections.ArrayList]::new()

    # A custom-property declaration line: --name: <value>;
    $declPattern = '(?m)^[ \t]*--[A-Za-z][\w-]*\s*:'

    foreach ($block in $blocks) {
        $selector = $block.Groups['selector'].Value.Trim()
        $body = $block.Groups['body'].Value

        $decls = [regex]::Matches($body, $declPattern)
        if ($decls.Count -eq 0) { continue }

        $overrideCount += $decls.Count

        # ── Gate 3: overrides must be platform-scoped ──
        # Bare :root / html selectors redeclaring --* are the full-table fork
        # signature (shared SSOT declares tokens under :root). Legitimate
        # surface glue scopes under [data-preset=…] / [data-theme=…] per rule §3.
        if ($selector -notmatch '\[data-') {
            [void]$scopeViolations.Add(@{
                Selector = $selector
                Count    = $decls.Count
            })
        }
    }

    # ── Gate 2: override count bounded ──
    if ($overrideCount -le $MaxOverrideLines) {
        Pass "$(Relative $path): $overrideCount --* override(s) ≤ $MaxOverrideLines ceiling"
    } else {
        Fail "$(Relative $path): $overrideCount --* override(s) exceed $MaxOverrideLines ceiling — likely full token-table fork"
    }

    # Report scope violations (Gate 3)
    if ($scopeViolations.Count -eq 0) {
        if ($overrideCount -gt 0) {
            Pass "$(Relative $path): all $overrideCount override(s) scoped under [data-…] attribute selector"
        }
    } else {
        foreach ($v in $scopeViolations) {
            $selPreview = $v.Selector
            if ($selPreview.Length -gt 60) { $selPreview = $selPreview.Substring(0, 60) + "…" }
            Fail "$(Relative $path): $($v.Count) --* override(s) under unscoped selector '$selPreview' — must be [data-…] platform glue, not bare :root fork"
        }
    }
}

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  Passed: $Passed  |  Failed: $Failed" -ForegroundColor $(if ($Failed -eq 0) { "Green" } else { "Red" })
Write-Host "========================================" -ForegroundColor Cyan

if ($Failed -ne 0) {
    exit 1
}
