#!/usr/bin/env pwsh
<#
Self-tests for verify-shared-edge-surface-isolation.py (HARD GATE, #1525).

Positive: legal Hub imports (web/mobile) and Desktop Edge imports must pass.
Negative: each forbidden pattern in a Hub-only surface must fail the gate;
          a missing scan directory must fail the gate.

Self-contained (no Pester dependency): builds temporary fixtures under
$env:TEMP, invokes the gate with --repo-root-override, asserts exit codes.

Usage:
  pwsh ./scripts/verify/tests/verify-shared-edge-surface-isolation.Tests.ps1
#>

[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

$GateScript = Join-Path $PSScriptRoot "..\verify-shared-edge-surface-isolation.py"
if (-not (Test-Path -LiteralPath $GateScript)) {
    throw "gate script not found: $GateScript"
}

$TestCount = 0
$FailCount = 0

function Assert-ExitCode([string]$Name, [int]$Actual, [bool]$ExpectFail, [string]$Detail = "") {
    $script:TestCount++
    $ok = ($ExpectFail -and $Actual -ne 0) -or ((-not $ExpectFail) -and $Actual -eq 0)
    if ($ok) {
        Write-Host "  PASS  $Name (exit=$Actual, expected $($ExpectFail ? "!= 0" : "0"))" -ForegroundColor Green
    } else {
        $script:FailCount++
        Write-Host "  FAIL  $Name (exit=$Actual, expected $($ExpectFail ? "!= 0" : "0"))" -ForegroundColor Red
        if ($Detail) { Write-Host "        $Detail" -ForegroundColor Red }
    }
}

function New-Fixture([string[]]$Files) {
    $dir = Join-Path ([System.IO.Path]::GetTempPath()) ("edge-gate-fixture-" + [System.Guid]::NewGuid().ToString("N"))
    foreach ($rel in $Files) {
        $full = Join-Path $dir $rel
        New-Item -ItemType Directory -Force -Path (Split-Path $full -Parent) | Out-Null
        Set-Content -LiteralPath $full -Value "// fixture: $rel" -Encoding utf8
    }
    return $dir
}

function Remove-Fixture([string]$dir) {
    if (Test-Path -LiteralPath $dir) {
        Remove-Item -LiteralPath $dir -Recurse -Force -Confirm:$false
    }
}

function Run-Gate([string]$fixture) {
    python $GateScript --repo-root-override $fixture 2>&1 | Out-Null
    return $LASTEXITCODE
}

Write-Host "`n=== Self-tests: shared Edge surface isolation HARD GATE ===" -ForegroundColor Cyan
Write-Host ""

# ── Negative 1: web imports @shared/eventClient ─────────
$f = New-Fixture @(
    "app/web/src/pages/chat.tsx",
    "app/mobile-rn/src/screens/chat.ts"
)
Set-Content -LiteralPath (Join-Path $f "app/web/src/pages/chat.tsx") -Value @'
import { EventClient } from "@shared/eventClient";
export const client = new EventClient();
'@ -Encoding utf8
Assert-ExitCode "negative: web imports @shared/eventClient" (Run-Gate $f) $true
Remove-Fixture $f

# ── Negative 2: mobile imports @shared/transcript/edge ───
$f = New-Fixture @(
    "app/web/src/main.ts",
    "app/mobile-rn/src/screens/chat.ts"
)
Set-Content -LiteralPath (Join-Path $f "app/mobile-rn/src/screens/chat.ts") -Value @'
import { normalizeEdgeTranscript } from "@shared/transcript/edge";
export const t = normalizeEdgeTranscript;
'@ -Encoding utf8
Assert-ExitCode "negative: mobile imports @shared/transcript/edge" (Run-Gate $f) $true
Remove-Fixture $f

# ── Negative 3: web references edgeQueryKeys symbol ──────
$f = New-Fixture @(
    "app/web/src/queries.ts",
    "app/mobile-rn/src/screens/chat.ts"
)
Set-Content -LiteralPath (Join-Path $f "app/web/src/queries.ts") -Value @'
import { edgeQueryKeys } from "@agenthub/shared/stores/queryKeys";
export const keys = edgeQueryKeys;
'@ -Encoding utf8
Assert-ExitCode "negative: web references edgeQueryKeys" (Run-Gate $f) $true
Remove-Fixture $f

# ── Negative 4: scan directory missing ───────────────────
$f = New-Fixture @(
    "app/desktop/src/platform.ts"
)
Assert-ExitCode "negative: app/web/src missing fails gate" (Run-Gate $f) $true
Remove-Fixture $f

# ── Positive 1: legal Hub imports in web/mobile ──────────
$f = New-Fixture @(
    "app/web/src/main.ts",
    "app/mobile-rn/src/screens/chat.ts"
)
Set-Content -LiteralPath (Join-Path $f "app/web/src/main.ts") -Value @'
import { hubClient } from "@agenthub/shared/hubClient";
import { EventEnvelope } from "@shared/events";
import type { ChatBlock } from "@shared/types";
export const c = hubClient;
'@ -Encoding utf8
Set-Content -LiteralPath (Join-Path $f "app/mobile-rn/src/screens/chat.ts") -Value @'
import { hubClient } from "@agenthub/shared/hubClient";
import type { ChatBlock } from "@shared/types";
export const c = hubClient;
'@ -Encoding utf8
Assert-ExitCode "positive: legal Hub imports pass" (Run-Gate $f) $false
Remove-Fixture $f

# ── Positive 2: Desktop Edge imports are not scanned ─────
$f = New-Fixture @(
    "app/web/src/main.ts",
    "app/mobile-rn/src/screens/chat.ts",
    "app/desktop/src/platform/useDesktopEdgeEvents.ts"
)
Set-Content -LiteralPath (Join-Path $f "app/web/src/main.ts") -Value 'export const ok = true;' -Encoding utf8
Set-Content -LiteralPath (Join-Path $f "app/mobile-rn/src/screens/chat.ts") -Value 'export const ok = true;' -Encoding utf8
Set-Content -LiteralPath (Join-Path $f "app/desktop/src/platform/useDesktopEdgeEvents.ts") -Value @'
import { EventClient } from "@shared/eventClient";
import { edgeQueryKeys } from "@agenthub/shared/stores/queryKeys";
export const c = EventClient;
'@ -Encoding utf8
Assert-ExitCode "positive: Desktop Edge imports not scanned" (Run-Gate $f) $false
Remove-Fixture $f

# ── Summary ──────────────────────────────────────────────
Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  Tests: $TestCount  |  Failed: $FailCount" -ForegroundColor $(if ($FailCount -eq 0) { "Green" } else { "Red" })
Write-Host "========================================" -ForegroundColor Cyan

if ($FailCount -eq 0) {
    Write-Host "`nAll gate self-tests passed." -ForegroundColor Green
    exit 0
} else {
    Write-Host "`n$FailCount self-test(s) failed — gate behavior does not match policy." -ForegroundColor Red
    exit 1
}
