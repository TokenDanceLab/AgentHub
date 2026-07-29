#!/usr/bin/env pwsh
<#
Verify the Hub-frontend client (app/shared hubClient module) REST contract.

The Hub server's declared REST surface is statically registered in
hub-server/internal/router/router.go. The Hub-frontend client builds its
call paths in app/shared/src (hubClient*.ts, notably hubClientPayloadPaths.ts)
via pure path builders. Every client call path MUST resolve to a route the Hub
server actually serves — otherwise the client calls an endpoint that does not
exist (contract drift / 404 at runtime). This gate catches that drift.

Normalization (both sides compared on route *shape*, not literal text):
  - Router gin params  :id / :user_id  -> {param}
  - Client path params ${encodeURIComponent(x)} / ${id} -> {param}
  - Client query builders ${qs(...)} are stripped (appended, not a route segment)
  - Query strings (?...) are stripped
  - Client RPC-style :action (e.g. :read-all, :cancel, :register) is rewritten
    to /action. The client uses requestWithFallback(colon, slash); the Hub
    server registers the slash form, so the contract that must hold is the
    slash form. A truly missing route still fails (no slash form exists).

Known-defect allowlist: empty on master. The gate is clean today (0 drift);
its value is preventing future client<->server contract regressions.

Scope note: this gate covers the Hub-frontend hubClient module against the Hub
server surface. The Edge-facing apiClient (edge /v1 surface, served by
edge-server via a net/http mux with wildcard sub-paths and gateway rewriting)
is a separate, higher-effort contract check and is intentionally out of scope
here (see PR body / leader report for the recommendation).
#>

[CmdletBinding()]
param(
    [string]$ClientSrcDir = "app/shared/src",
    [string]$RouterPath = "hub-server/internal/router/router.go"
)

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

# ── Declared Hub REST surface (from router.go) ────────────────────────────────
$routerPath = Join-Path $RepoRoot $RouterPath
if (-not (Test-Path -LiteralPath $routerPath)) { Fail "router source not found: $RouterPath"; exit 1 }
$routerSrc = Get-Content -LiteralPath $routerPath -Raw
$routerLines = $routerSrc -split "`r?`n"

# Resolve group prefixes iteratively (public := r.Group(...), child := parent.Group(...))
$prefix = @{}
$changed = $true
while ($changed) {
    $changed = $false
    foreach ($ln in $routerLines) {
        if ($ln -match '^\s*//') { continue }
        if ($ln -match '(\w+)\s*:=\s*(\w+)\.Group\("([^"]*)"') {
            $var = $Matches[1]; $parent = $Matches[2]; $seg = $Matches[3]
            if ($prefix.ContainsKey($var)) { continue }
            if ($parent -eq 'r') { $prefix[$var] = $seg; $changed = $true }
            elseif ($prefix.ContainsKey($parent)) { $prefix[$var] = $prefix[$parent] + $seg; $changed = $true }
        }
    }
}

$hubRoutes = @{}
foreach ($ln in $routerLines) {
    if ($ln -match '^\s*//') { continue }
    foreach ($m in [regex]::Matches($ln, '(\w+)\.(GET|POST|PUT|DELETE|PATCH)\("([^"]*)"')) {
        $var = $m.Groups[1].Value; $path = $m.Groups[3].Value
        $base = if ($var -eq 'r') { '' } elseif ($prefix.ContainsKey($var)) { $prefix[$var] } else { continue }
        $full = ($base + $path) -replace ':(\w+)', '{param}'
        $hubRoutes[$full] = $true
    }
}

# ── Client call paths (Hub-frontend hubClient module) ──────────────────────────
$clientDir = Join-Path $RepoRoot $ClientSrcDir
if (-not (Test-Path -LiteralPath $clientDir)) { Fail "client source dir missing: $ClientSrcDir"; exit 1 }
$clientFiles = @(Get-ChildItem -LiteralPath $clientDir -File |
    Where-Object { $_.Name -like "hubClient*.ts" -and $_.Name -notlike "*.test.ts" })

function Normalize-ClientPath([string]$p) {
    # Only consider relative API paths; ignore full-URL builds (${baseUrl}...) and log strings.
    if ($p -notmatch '^(/client|/web|/edge|/api|/cloud|/v1)/') { return $null }
    $p = $p -replace '\$\{encodeURIComponent\([^)]*\)\}', '{param}'
    $p = $p -replace '\$\{qs.*', ''                 # drop ${qs(...)} query builder
    $p = $p -replace '\$\{[^}]*\}', '{param}'       # any other ${...} -> param
    $p = ($p -split '\?')[0]                        # drop ?query
    $p = $p -replace ':([a-zA-Z0-9_-]+)', '/$1'     # RPC :action -> /action
    $p = $p -replace '/{2,}', '/'
    return $p
}

$rawPaths = @()
foreach ($f in $clientFiles) {
    $src = Get-Content -Raw -LiteralPath $f.FullName
    # single + double + backtick returns
    foreach ($m in [regex]::Matches($src, "return\s+`[`'``]([^`'``]*)`[`'``]")) {
        $rawPaths += $m.Groups[1].Value
    }
    # array returns: return [ 'a', 'b' ] or [ `a`, `b` ]
    foreach ($m in [regex]::Matches($src, "return\s+\[([^\]]*)\]")) {
        foreach ($p in [regex]::Matches($m.Groups[1].Value, "`[`'``]([^`'``]*)`[`'``]")) {
            $rawPaths += $p.Groups[1].Value
        }
    }
}

$normPaths = @{}
foreach ($c in $rawPaths) {
    $n = Normalize-ClientPath $c
    if ($null -ne $n) { $normPaths[$n] = $true }
}

# ── Known-defect allowlist (legit client paths with no hub route today) ────────
$KnownDefects = @()

Write-Host "`n=== Shared REST contract (Hub client <-> Hub router) ===" -ForegroundColor Cyan
Write-Host "Hub routes: $($hubRoutes.Count) | client path(s) scanned: $($rawPaths.Count) | normalized unique: $($normPaths.Count)"

$drift = 0
foreach ($k in ($normPaths.Keys | Sort-Object)) {
    if ($hubRoutes.ContainsKey($k)) { continue }
    $allowed = $false
    foreach ($d in $KnownDefects) { if ($d -eq $k) { $allowed = $true; break } }
    if ($allowed) {
        Write-Host "  KNOWN DEFECT  client path has no hub route: $k (allowlisted)" -ForegroundColor Yellow
    } else {
        $sample = ($rawPaths | Where-Object { (Normalize-ClientPath $_) -eq $k } | Select-Object -First 1) -join ""
        Fail "client path has no matching hub route: $k (from '$sample')"
        $drift++
    }
}

if ($Failed -eq 0) {
    if ($drift -eq 0) {
        Pass "all Hub-client call paths resolve to a registered hub route ($($normPaths.Count) unique path(s))"
    } else {
        Pass "no new client<->hub contract drift ($drift known-defect note(s) in allowlist)"
    }
}

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  Passed: $Passed  |  Failed: $Failed" -ForegroundColor $(if ($Failed -eq 0) { "Green" } else { "Red" })
Write-Host "========================================" -ForegroundColor Cyan

if ($Failed -ne 0) { exit 1 }
