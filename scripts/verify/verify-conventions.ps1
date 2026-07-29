#!/usr/bin/env pwsh
<#
Verify that every HTTP method used in the Hub router is documented in
api/conventions.md (docs <-> impl SSOT).

The Hub router (hub-server/internal/router/router.go) registers routes with
gin's method helpers: r.GET(...), web.PUT(...), client.POST(...), etc. Every
HTTP verb used there must appear in the conventions.md HTTP methods table so
the API contract doc stays in sync with the implementation.

Audit-A Scope 5.1: conventions.md listed only GET/POST/PATCH/DELETE, but the
router uses PUT for 10+ routes (profile update, group info, custom-agent
update, skill update, etc.). This PR adds PUT to the doc.

Check: router method set must be a subset of the conventions.md method set.
If the router uses a method not documented in conventions.md -> FAIL.

Conventions documenting a method the router does not yet use is a NOTICE only
(not a failure) — conventions.md says "新增 API 时先更新契约，再补实现" so
documenting ahead of implementation is the intended workflow.
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

# ── Router method extraction ────────────────────────
$RouterPath = Join-Path $RepoRoot "hub-server/internal/router/router.go"
if (-not (Test-Path -LiteralPath $RouterPath)) {
    Fail "router file missing: hub-server/internal/router/router.go"
    exit 1
}

$routerContent = Get-Content -Raw -LiteralPath $RouterPath

# Strip // comments to avoid matching method names in comments.
$routerLines = $routerContent -split "`n" | ForEach-Object { ($_ -replace '//.*$', '') }

# Match gin method calls: <group>.METHOD(  e.g. r.GET(, web.PUT(, client.POST(
$routerMethods = [System.Collections.Generic.HashSet[string]]::new()
foreach ($line in $routerLines) {
    $matches = [regex]::Matches($line, '\.(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD|CONNECT|TRACE)\s*\(')
    foreach ($m in $matches) {
        [void]$routerMethods.Add($m.Groups[1].Value)
    }
}

# ── Conventions.md method extraction ─────────────────
$ConventionsPath = Join-Path $RepoRoot "api/conventions.md"
if (-not (Test-Path -LiteralPath $ConventionsPath)) {
    Fail "conventions doc missing: api/conventions.md"
    exit 1
}

$conventionsContent = Get-Content -Raw -LiteralPath $ConventionsPath

# Match table rows: | `METHOD` | description |
$conventionsMethods = [System.Collections.Generic.HashSet[string]]::new()
$convMatches = [regex]::Matches($conventionsContent, '\|\s*`([A-Z]+)`\s*\|')
foreach ($m in $convMatches) {
    [void]$conventionsMethods.Add($m.Groups[1].Value)
}

Write-Host "`n=== Conventions method SSOT (router vs conventions.md) ===" -ForegroundColor Cyan
Write-Host "Router methods:        $(($routerMethods | Sort-Object) -join ', ')"
Write-Host "Conventions.md methods: $(($conventionsMethods | Sort-Object) -join ', ')"

# ── Check: router methods must be subset of conventions ──
$undocumented = [System.Collections.Generic.HashSet[string]]::new()
foreach ($method in $routerMethods) {
    if (-not $conventionsMethods.Contains($method)) {
        [void]$undocumented.Add($method)
    }
}

if ($undocumented.Count -gt 0) {
    foreach ($method in ($undocumented | Sort-Object)) {
        Fail "router uses $method but conventions.md does not document it"
    }
} else {
    Pass "all $($routerMethods.Count) router method(s) documented in conventions.md"
}

# ── Notice: conventions methods not in router (planned) ──
$planned = [System.Collections.Generic.HashSet[string]]::new()
foreach ($method in $conventionsMethods) {
    if (-not $routerMethods.Contains($method)) {
        [void]$planned.Add($method)
    }
}

if ($planned.Count -gt 0) {
    foreach ($method in ($planned | Sort-Object)) {
        Write-Host "  NOTICE  conventions.md documents $method but router does not use it yet (planned?)" -ForegroundColor DarkGray
    }
}

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  Passed: $Passed  |  Failed: $Failed" -ForegroundColor $(if ($Failed -eq 0) { "Green" } else { "Red" })
Write-Host "========================================" -ForegroundColor Cyan

if ($Failed -ne 0) {
    exit 1
}
