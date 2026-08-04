#!/usr/bin/env pwsh
<#
Verify that the shared UI/presentation layer neither value-imports the Hub
client (hubClient) nor references the concrete HubClient type.

Policy (audit-A A-V2 / A7#4 "shared UI no hubClient", hardened by #1546):
the shared presentation modules (ui, components, workbench, chatview) must
not pull in the hubClient transport/binding — not even as a type. They
consume narrow domain ports (e.g. WorkbenchProjectsPort) injected by the
platform composition roots. A direct value import of hubClient into the
shared UI layer is a layering violation; a type-only import is also a
violation since it couples the presentation contract to the concrete client's
method surface (the exact coupling #1546 removed).

Empirical baseline: before #1546 there were 4 `import type { HubClient }` in
workbench/*; after #1546 shared workbench references the domain port only.
This gate's value is preventing both runtime-coupling and type-coupling
regressions in the future.
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

Write-Host "`n=== Shared UI hubClient gate (no value/type reference to hubClient) ===" -ForegroundColor Cyan
Write-Host "Scanning $($Files.Count) .ts/.tsx file(s) in shared/$($ScopeDirs -join ', ')."

$ForbiddenSpecPattern = 'hubClient'
$ForbiddenTypeName = 'HubClient'

# Known-defect allowlist (relative paths that may reference hubClient). Empty on
# master — the shared presentation layer is fully decoupled after #1546.
$KnownDefects = @()

function Strip-Comments([string]$Line) {
    $code = [regex]::Replace($Line, '/\*.*?\*/', ' ', 'Singleline')
    $code = [regex]::Replace($code, '//.*$', ' ')
    return $code
}

$violations = 0
foreach ($file in $Files) {
    $rel = Relative $file.FullName
    $lines = @(Get-Content -LiteralPath $file.FullName)
    for ($i = 0; $i -lt $lines.Count; $i++) {
        $line = $lines[$i]
        # any import from a hubClient specifier: import ... from '<spec>' (value OR type-only)
        foreach ($m in [regex]::Matches($line, "from\s*['\""]([^'""]*)$ForbiddenSpecPattern([^'""]*)['\""]")) {
            $spec = $m.Value -replace "^from\s*", ""
            $allowed = $false
            foreach ($d in $KnownDefects) { if ($rel -eq $d) { $allowed = $true; break } }
            if ($allowed) {
                Write-Host "  KNOWN DEFECT  import of hubClient allowed (${rel}:$($i+1))" -ForegroundColor Yellow
            } else {
                Fail "shared UI imports hubClient (value or type): ${rel}:$($i+1) -> $spec"
                $violations++
            }
        }
        # bare side-effect import: import '<spec>'  (no `from`)
        foreach ($m in [regex]::Matches($line, "^\s*import\s+['\""]([^'""]*)$ForbiddenSpecPattern([^'""]*)['\""]")) {
            $allowed = $false
            foreach ($d in $KnownDefects) { if ($rel -eq $d) { $allowed = $true; break } }
            if ($allowed) {
                Write-Host "  KNOWN DEFECT  side-effect import of hubClient allowed (${rel}:$($i+1))" -ForegroundColor Yellow
            } else {
                Fail "shared UI side-effect imports hubClient: ${rel}:$($i+1)"
                $violations++
            }
        }
        # direct type reference to the concrete HubClient type name (comments excluded)
        $codeLine = Strip-Comments $line
        foreach ($m in [regex]::Matches($codeLine, "\b$ForbiddenTypeName\b")) {
            $allowed = $false
            foreach ($d in $KnownDefects) { if ($rel -eq $d) { $allowed = $true; break } }
            if ($allowed) {
                Write-Host "  KNOWN DEFECT  HubClient type reference allowed (${rel}:$($i+1))" -ForegroundColor Yellow
            } else {
                Fail "shared UI references concrete HubClient type: ${rel}:$($i+1)"
                $violations++
            }
        }
    }
}

if ($Failed -eq 0) {
    if ($violations -eq 0) {
        Pass "no shared UI value/type references to hubClient ($($Files.Count) file(s) scanned)"
    } else {
        Pass "no new shared UI hubClient references ($violations known-defect note(s) in allowlist)"
    }
}

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  Passed: $Passed  |  Failed: $Failed" -ForegroundColor $(if ($Failed -eq 0) { "Green" } else { "Red" })
Write-Host "========================================" -ForegroundColor Cyan

if ($Failed -ne 0) { exit 1 }
