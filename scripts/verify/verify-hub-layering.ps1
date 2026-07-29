#!/usr/bin/env pwsh
<#
Verify Hub handler layering: handler package must not import the repository
layer directly.

Unidirectional flow (audit-A Scope 2): handler -> service -> repository.
Handlers must go through the service layer for data access. A direct
handler -> repository import bypasses the service boundary.

Known defect allowlist:
  - health.go — imports repository.VerifyMigrations for migration-status
    health checks (line 13). Non-business health probe; acceptable but should
    route through a HealthService. Documented as known debt (audit-A 2.1).

New handler files importing repository -> FAIL.
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

# ── Target ──────────────────────────────────────────
$HandlerDir = "hub-server/internal/handler"

# ── Forbidden import ─────────────────────────────────
$ForbiddenPattern = '^github\.com/agenthub/hub-server/internal/repository(/|$)'
$ForbiddenLabel = "repository layer (handler must go through service)"

# ── Known defect allowlist ───────────────────────────
$KnownDefects = @(
    @{ File = "hub-server/internal/handler/health.go";
       Reason = "imports repository.VerifyMigrations for health-check migration status — non-business, route via HealthService (audit-A 2.1)" }
)

function Test-KnownDefect([string]$RelPath) {
    foreach ($defect in $KnownDefects) {
        if ($defect.File -eq $RelPath) { return $defect.Reason }
    }
    return $null
}

# ── Collect target files ────────────────────────────
$full = Join-Path $RepoRoot $HandlerDir
if (-not (Test-Path -LiteralPath $full)) {
    Fail "handler directory missing: $HandlerDir"
    exit 1
}
$Files = @(Get-ChildItem -LiteralPath $full -Filter '*.go' -File)

Write-Host "`n=== Hub handler layering (no repository import) ===" -ForegroundColor Cyan
Write-Host "Scanning $($Files.Count) .go file(s) in hub-server/internal/handler."

# ── Extract Go imports ──────────────────────────────
function Get-GoImports([string]$Content) {
    $paths = @()

    # Block imports: import ( ... )
    $blockMatches = [regex]::Matches($Content, '(?ms)import\s*\((?<body>.*?)\)')
    foreach ($m in $blockMatches) {
        foreach ($line in ($m.Groups['body'].Value -split "`n")) {
            $line = $line -replace '//.*$', ''
            $trimmed = $line.Trim()
            if ($trimmed -eq '') { continue }
            foreach ($q in [regex]::Matches($line, '"(?<path>[^"]+)"')) {
                $paths += $q.Groups['path'].Value
            }
        }
    }

    # Single imports: import "..." or import alias "..." or import . "..."
    $singleMatches = [regex]::Matches($Content, '(?m)^[ \t]*import[ \t]+(?:\S+[ \t]+)?"(?<path>[^"]+)"')
    foreach ($m in $singleMatches) {
        $paths += $m.Groups['path'].Value
    }

    return ($paths | Select-Object -Unique)
}

# ── Scan ─────────────────────────────────────────────
$DefectNotes = 0

foreach ($file in $Files) {
    $rel = Relative $file.FullName
    $content = Get-Content -Raw -LiteralPath $file.FullName
    $imports = Get-GoImports $content

    foreach ($path in $imports) {
        if ($path -match $ForbiddenPattern) {
            $reason = Test-KnownDefect $rel
            if ($null -ne $reason) {
                $DefectNotes++
                Write-Host "  KNOWN DEFECT  $ForbiddenLabel imported in ${rel}: $path — $reason" -ForegroundColor Yellow
            } else {
                Fail "$ForbiddenLabel imported in ${rel}: $path — handler must go through service"
            }
        }
    }
}

if ($Failed -eq 0 -and $Files.Count -gt 0) {
    if ($DefectNotes -gt 0) {
        Pass "no new handler->repository violations ($DefectNotes known-defect note(s) in allowlist)"
    } else {
        Pass "no handler->repository imports across $($Files.Count) .go file(s)"
    }
}

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  Passed: $Passed  |  Failed: $Failed" -ForegroundColor $(if ($Failed -eq 0) { "Green" } else { "Red" })
Write-Host "========================================" -ForegroundColor Cyan

if ($Failed -ne 0) {
    exit 1
}
