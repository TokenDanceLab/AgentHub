#!/usr/bin/env pwsh
<#
Verify that the shared UI/presentation layer does not import the Hub client
(hubClient) at the value/runtime level.

Policy (audit-A A-V2 / A7#4 "shared UI no hubClient"): the shared presentation
modules (ui, components, workbench, chatview) must not pull in the hubClient
transport/binding directly — they should go through a domain/hook layer. A
direct value import of hubClient into the shared UI layer is a layering
violation (policy conflict with the workbench route design).

Type-only imports (`import type { HubClient }` / `import { type HubClient }`)
are permitted: they carry no runtime coupling and are used legitimately for
typing workbench route handlers. Only VALUE (runtime) imports are forbidden.

Empirical baseline (current master): the only hubClient references in the
shared UI layer are 4 `import type { HubClient }` in workbench/* — i.e. zero
value imports. The gate passes clean today; its value is preventing future
runtime-coupling regressions.
#>

[CmdletBinding()]
param(
    [string]$SharedSrcDir = "app/shared/src",
    [string[]]$ScopeDirs = @("ui", "components", "workbench", "chatview")
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

# ── Collect presentation-layer source files (exclude tests) ─────────────────────
$Files = @()
foreach ($dir in $ScopeDirs) {
    $full = Join-Path $RepoRoot (Join-Path $SharedSrcDir $dir)
    if (-not (Test-Path -LiteralPath $full)) { Fail "scope directory missing: $SharedSrcDir/$dir"; continue }
    $Files += Get-ChildItem -LiteralPath $full -Recurse -File |
        Where-Object { $_.Extension -in @(".ts", ".tsx") -and $_.Name -notlike "*.test.ts" }
}

Write-Host "`n=== Shared UI hubClient gate (no value import of hubClient) ===" -ForegroundColor Cyan
Write-Host "Scanning $($Files.Count) .ts/.tsx file(s) in shared/$($ScopeDirs -join ', ')."

$ForbiddenPattern = 'hubClient'

# Known-defect allowlist (relative paths that may value-import hubClient). Empty
# on master — every current workbench reference is type-only and excluded below.
$KnownDefects = @()

function Test-TypeOnly([string]$Line) {
    # Leading `import type` OR inline `import { type X }` / `import { x, type Y }`.
    if ($Line -match '^\s*import\s+type\s') { return $true }
    if ($Line -match 'import\s+\{[^\}]*\btype\s') { return $true }
    return $false
}

$violations = 0
foreach ($file in $Files) {
    $rel = Relative $file.FullName
    $lines = @(Get-Content -LiteralPath $file.FullName)
    for ($i = 0; $i -lt $lines.Count; $i++) {
        $line = $lines[$i]
        # value import with `from`: import ... from '<spec>'
        foreach ($m in [regex]::Matches($line, "from\s*['\""]([^'""]*)$ForbiddenPattern([^'""]*)['\""]")) {
            if (Test-TypeOnly $line) { continue }
            $spec = $m.Value -replace "^from\s*", ""
            $allowed = $false
            foreach ($d in $KnownDefects) { if ($rel -eq $d) { $allowed = $true; break } }
            if ($allowed) {
                Write-Host "  KNOWN DEFECT  value import of hubClient allowed (${rel}:$($i+1))" -ForegroundColor Yellow
            } else {
                Fail "shared UI value-imports hubClient: ${rel}:$($i+1) -> $spec"
                $violations++
            }
        }
        # bare side-effect import: import '<spec>'  (no `from`)
        foreach ($m in [regex]::Matches($line, "^\s*import\s+['\""]([^'""]*)$ForbiddenPattern([^'""]*)['\""]")) {
            if (Test-TypeOnly $line) { continue }
            $allowed = $false
            foreach ($d in $KnownDefects) { if ($rel -eq $d) { $allowed = $true; break } }
            if ($allowed) {
                Write-Host "  KNOWN DEFECT  value import of hubClient allowed (${rel}:$($i+1))" -ForegroundColor Yellow
            } else {
                Fail "shared UI value-imports hubClient (side-effect): ${rel}:$($i+1)"
                $violations++
            }
        }
    }
}

if ($Failed -eq 0) {
    if ($violations -eq 0) {
        Pass "no shared UI value-imports of hubClient ($($Files.Count) file(s) scanned)"
    } else {
        Pass "no new shared UI hubClient value-imports ($violations known-defect note(s) in allowlist)"
    }
}

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  Passed: $Passed  |  Failed: $Failed" -ForegroundColor $(if ($Failed -eq 0) { "Green" } else { "Red" })
Write-Host "========================================" -ForegroundColor Cyan

if ($Failed -ne 0) { exit 1 }
