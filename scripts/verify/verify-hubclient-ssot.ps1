#!/usr/bin/env pwsh
<#
Verify that platform hubClient.ts files stay thin shells over the shared SSOT.

A7 architecture gate candidate #3: hubClient thin-shell SSOT.

Each platform client (app/{web,desktop,mobile-rn}/src/api/hubClient.ts) must:
  1. Delegate to the shared SSOT by calling createSharedHubClient(...) — the
     aliased import of @shared/hubClient's createHubClient. New Hub REST
     methods belong in app/shared/src/hubClient.ts, not the thin shells.
  2. Stay under a line budget so platform glue cannot quietly grow back into
     a copy of the SSOT surface:
       web     <= 120
       desktop <= 300
       mobile  <= 500
  3. Not introduce NEW /client/ or /web/ path literals. Hub REST paths are
     owned by the shared SSOT; the thin shells may only carry platform glue
     (Tauri proxy on desktop, SecureStore token cache + WS URL builder on
     mobile). Pre-existing legitimate literals are on the allow-list below.

The shared SSOT source (app/shared/src/hubClient*.ts) is intentionally NOT
scanned — it owns the method/DTO surface and may declare Hub REST paths.
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

# ── Targets + line budgets ─────────────────────────────────────────
# Current measured sizes: web 59 / desktop 212 / mobile 378.
# Budgets absorb legitimate platform glue (desktop Tauri proxy fallback,
# mobile SecureStore token cache + WS URL builder) while keeping the shells
# from silently regrowing into a parallel SSOT copy.
$Targets = @(
    @{ Rel = "app/web/src/api/hubClient.ts";       MaxLines = 120 },
    @{ Rel = "app/desktop/src/api/hubClient.ts";   MaxLines = 300 },
    @{ Rel = "app/mobile-rn/src/api/hubClient.ts"; MaxLines = 500 }
)

# ── Allow-list for pre-existing platform glue literals ────────────
# A line is exempted when its trimmed form matches one of these entries.
# These are platform-specific glue, not new Hub REST methods:
#   - mobile-rn createHubWsUrl: WebSocket upgrade path negotiated with
#     hub-server middleware.WSBearerSubprotocol. The WS URL builder is
#     React-Native-only glue; the REST surface is owned by shared SSOT.
$AllowedLiterals = @(
    "url.pathname = '/client/ws';"
)

function Test-AllowedLiteral([string]$Line) {
    $trimmed = $Line.Trim()
    foreach ($allow in $AllowedLiterals) {
        if ($trimmed -eq $allow.Trim()) { return $true }
    }
    return $false
}

Write-Host "`n=== hubClient thin-shell SSOT gate ===" -ForegroundColor Cyan

foreach ($target in $Targets) {
    $full = Join-Path $RepoRoot $target.Rel
    Write-Host "`n[$($target.Rel)]" -ForegroundColor Cyan
    if (-not (Test-Path -LiteralPath $full)) {
        Fail "$($target.Rel) missing"
        continue
    }

    $lines = @(Get-Content -LiteralPath $full)
    $lineCount = $lines.Count

    # 1. Delegates to shared SSOT via createSharedHubClient(...)
    $hasSharedCall = $false
    foreach ($line in $lines) {
        if ($line -match 'createSharedHubClient\s*\(') {
            $hasSharedCall = $true
            break
        }
    }
    if ($hasSharedCall) {
        Pass "delegates to shared createHubClient (createSharedHubClient(...))"
    } else {
        Fail "must call shared createHubClient (createSharedHubClient(...)) - new Hub REST methods belong in app/shared/src/hubClient.ts"
    }

    # 2. Line budget
    if ($lineCount -le $target.MaxLines) {
        Pass "line count $lineCount <= $($target.MaxLines)"
    } else {
        Fail "line count $lineCount > $($target.MaxLines) - thin shell growing past budget"
    }

    # 3. No NEW /client/ or /web/ path literals outside the allow-list.
    # Strip // line comments first so doc comments mentioning paths
    # (e.g. "/client/ws" in a header) never false-positive.
    foreach ($i in 0..($lines.Count - 1)) {
        $raw = $lines[$i]
        $code = $raw -replace '//.*$', ''
        if ($code -match '/client/' -or $code -match '/web/') {
            if (Test-AllowedLiteral $raw) { continue }
            Fail "$($target.Rel):$($i + 1) path literal /client/ or /web/ - Hub REST paths belong in shared SSOT, not thin shell"
        }
    }
}

# 3b. Allow-list staleness guard: every allow-listed literal must still exist
# in its file. Otherwise a removed line could hide behind a stale allow entry
# and a future reintroduction of the same shape would slip through.
$mobilePath = Join-Path $RepoRoot "app/mobile-rn/src/api/hubClient.ts"
if (Test-Path -LiteralPath $mobilePath) {
    $mobileContent = Get-Content -Raw -LiteralPath $mobilePath
    $foundAllow = $false
    foreach ($allow in $AllowedLiterals) {
        if ($mobileContent -match ([regex]::Escape($allow.Trim()))) {
            $foundAllow = $true
            break
        }
    }
    if ($foundAllow) {
        Pass "mobile-rn /client/ws allow-list literal still present (not stale)"
    } else {
        Fail "mobile-rn allow-list literal missing - update allow-list or restore glue"
    }
}

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  Passed: $Passed  |  Failed: $Failed" -ForegroundColor $(if ($Failed -eq 0) { "Green" } else { "Red" })
Write-Host "========================================" -ForegroundColor Cyan

if ($Failed -ne 0) {
    exit 1
}
