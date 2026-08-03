#!/usr/bin/env pwsh
<#
Outbound HTTP / runtime-config hygiene verifier (#1549).

The service layer must not read process env or construct bare http.Clients:
config belongs to the bootstrap/composition root, transport policy belongs to
the few purpose-built clients (egress, dispatch client). This verifier fails
CI when new violations appear.

Checks (production .go files under hub-server/internal/service/):
  1. os.Getenv — zero tolerance. Config is read once at startup and injected.
  2. bare `&http.Client{` — allowlist only (currently the OIDC token-exchange
     client, tracked for removal in the #1549 follow-up). New clients must
     come from a purpose-built port/client instead.
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

# ── Collect production Go files under internal/service ─────────────────
$ServiceDir = Join-Path $RepoRoot "hub-server/internal/service"
if (-not (Test-Path -LiteralPath $ServiceDir)) {
    Fail "service dir missing: $ServiceDir"
    exit 1
}
$GoFiles = Get-ChildItem -LiteralPath $ServiceDir -Recurse -Filter "*.go" |
    Where-Object { $_.Name -notmatch "_test\.go$" }

# ── 1. os.Getenv — zero tolerance ─────────────────────────────────────
$getenvHits = @()
foreach ($f in $GoFiles) {
    $line = 0
    foreach ($l in (Get-Content -LiteralPath $f.FullName)) {
        $line++
        if ($l -match "os\.Getenv\(") {
            $getenvHits += "{0}:{1}: {2}" -f $f.FullName.Substring($RepoRoot.Path.Length + 1), $line, $l.Trim()
        }
    }
}
if ($getenvHits.Count -eq 0) {
    Pass "no os.Getenv in hub-server/internal/service (config injected at composition root)"
} else {
    foreach ($hit in $getenvHits) {
        Fail "os.Getenv found: $hit"
    }
    Write-Host "  #1549: env reads must move to config/bootstrap and be injected." -ForegroundColor Yellow
}

# ── 2. bare &http.Client{ — allowlist, shrinking to zero ────────────────
# Relative repo paths (forward-slash) of files allowed to construct clients.
$ClientAllowlist = @(
    # OIDC token-exchange client (#1549 follow-up)
    "hub-server/internal/service/oidc/oidc.go",
    # DispatchService's single shared Hub→Edge client, built once in the
    # constructor from the injected edgeCfg (replaces a fresh client per
    # dispatch); tracked for a later move to the composition root.
    "hub-server/internal/service/agent_dispatch_ports.go"
)

$clientHits = @()
foreach ($f in $GoFiles) {
    $rel = ($f.FullName.Substring($RepoRoot.Path.Length + 1) -replace '\\', '/')
    if ($ClientAllowlist -contains $rel) {
        continue
    }
    $line = 0
    foreach ($l in (Get-Content -LiteralPath $f.FullName)) {
        $line++
        if ($l -match "&http\.Client\{") {
            $clientHits += "{0}:{1}: {2}" -f $rel, $line, $l.Trim()
        }
    }
}
if ($clientHits.Count -eq 0) {
    Pass "no bare &http.Client{ outside the allowlist in hub-server/internal/service"
} else {
    foreach ($hit in $clientHits) {
        Fail "bare &http.Client{ found: $hit"
    }
    Write-Host "  #1549: use a purpose-built client/port; add to the allowlist only as a tracked exception." -ForegroundColor Yellow
}

# ── Summary ─────────────────────────────────────────────────────────────
Write-Host ""
if ($Failed -gt 0) {
    Write-Host "Outbound client hygiene: $Failed FAIL, $Passed pass" -ForegroundColor Red
    exit 1
}
Write-Host "Outbound client hygiene: $Passed pass" -ForegroundColor Green
