#!/usr/bin/env pwsh
<#
Verify that Hub "pure" Go helper packages stay free of DB / WS / cache /
concrete *Service orchestration imports.

Pure targets (per A7 architecture gate candidate #5):
  - hub-server/internal/service/dispatch        (all .go files)
  - hub-server/internal/service/deliveryoutbox  (all .go files)
  - hub-server/internal/service/im              (all .go files)
  - hub-server/internal/service/agentevent      (all .go files)
  - hub-server/internal/service/agentteam/route_helpers.go  (single file)

These helpers must not import:
  - gorm.io/*                                   (GORM ORM)
  - database/sql                                (raw SQL driver)
  - github.com/agenthub/hub-server/internal/cache (cache layer)
  - github.com/agenthub/hub-server/internal/ws    (websocket layer)
  - github.com/agenthub/hub-server/internal/service
      and any sub-package that defines a concrete *Service orchestration
      struct (parent + siblings: agentteam, attachment, contact, message,
      messagereaction, session, workspace).

FP defense — allow-list: the broad internal/service deny rule exempts the
pure sub-packages themselves (dispatch, deliveryoutbox, im, agentevent) so
they may import each other. Known-good non-service imports (internal/errcode,
internal/model, github.com/google/uuid, stretchr/testify) do not match any
deny rule and pass by default.

Scans import lines only — comments mentioning forbidden terms are stripped
before matching, so doc comments never cause false positives.
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
# Four pure package directories (all .go files, tests included) plus the
# single route_helpers.go file from the otherwise-orchestration agentteam pkg.
$PureDirs = @(
    "hub-server/internal/service/dispatch",
    "hub-server/internal/service/deliveryoutbox",
    "hub-server/internal/service/im",
    "hub-server/internal/service/agentevent"
)
$PureFiles = @(
    "hub-server/internal/service/agentteam/route_helpers.go"
)

# ── Deny rules ──────────────────────────────────────
# Anchored on the import path. The internal/service rule is intentionally
# broad (prefix match) so it catches the parent package AND every orchestration
# sibling sub-package (message, session, ...). The pure sub-packages are
# exempted via $AllowPrefixes below.
$ForbiddenPatterns = @(
    @{ Pattern = '^gorm\.io/';                                          Label = 'GORM ORM (gorm.io)' },
    @{ Pattern = '^database/sql(/|$)';                                   Label = 'database/sql (raw SQL)' },
    @{ Pattern = '^github\.com/agenthub/hub-server/internal/cache(/|$)'; Label = 'internal/cache layer' },
    @{ Pattern = '^github\.com/agenthub/hub-server/internal/ws(/|$)';    Label = 'internal/ws layer' },
    @{ Pattern = '^github\.com/agenthub/hub-server/internal/service(/|$)'; Label = 'concrete *Service orchestration (internal/service tree)' }
)

# ── Allow-list (FP defense / exemption) ─────────────
# A forbidden match is downgraded to PASS when the import path equals or is a
# sub-path of one of these pure package prefixes. This is what keeps the broad
# internal/service deny rule from flagging the pure sub-packages themselves.
# Path equality + "/" boundary prevents "internal/service/im" from exempting
# a hypothetical "internal/service/image".
$AllowPrefixes = @(
    'github.com/agenthub/hub-server/internal/service/dispatch',
    'github.com/agenthub/hub-server/internal/service/deliveryoutbox',
    'github.com/agenthub/hub-server/internal/service/im',
    'github.com/agenthub/hub-server/internal/service/agentevent'
)

function Test-Allowed([string]$Path) {
    foreach ($prefix in $AllowPrefixes) {
        if ($Path -eq $prefix) { return $true }
        if ($Path.StartsWith($prefix + "/")) { return $true }
    }
    return $false
}

# ── Collect target files ────────────────────────────
$Files = @()
foreach ($dir in $PureDirs) {
    $full = Join-Path $RepoRoot $dir
    if (Test-Path -LiteralPath $full) {
        $Files += Get-ChildItem -LiteralPath $full -Filter '*.go' -File
    } else {
        Fail "pure package directory missing: $dir"
    }
}
foreach ($rel in $PureFiles) {
    $full = Join-Path $RepoRoot $rel
    if (Test-Path -LiteralPath $full) {
        $Files += Get-Item -LiteralPath $full
    } else {
        Fail "pure package file missing: $rel"
    }
}

Write-Host "`n=== Hub pure package import gate ===" -ForegroundColor Cyan
Write-Host "Scanning $($Files.Count) .go file(s) across pure helper packages."

# ── Extract & check imports ─────────────────────────
function Get-GoImports([string]$Content) {
    $paths = @()

    # Block imports: import ( ... )
    $blockMatches = [regex]::Matches($Content, '(?ms)import\s*\((?<body>.*?)\)')
    foreach ($m in $blockMatches) {
        foreach ($line in ($m.Groups['body'].Value -split "`n")) {
            # Strip trailing // comments so quoted strings inside comments
            # (e.g. // see "internal/cache" for alt) never false-positive.
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

foreach ($file in $Files) {
    $rel = Relative $file.FullName
    $content = Get-Content -Raw -LiteralPath $file.FullName
    $imports = Get-GoImports $content

    foreach ($path in $imports) {
        foreach ($entry in $ForbiddenPatterns) {
            if ($path -match $entry.Pattern) {
                if (Test-Allowed $path) { continue }
                Fail "$($entry.Label) imported in ${rel}: $path"
            }
        }
    }
}

if ($Failed -eq 0 -and $Files.Count -gt 0) {
    Pass "no forbidden imports across $($Files.Count) .go file(s) in pure packages"
}

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  Passed: $Passed  |  Failed: $Failed" -ForegroundColor $(if ($Failed -eq 0) { "Green" } else { "Red" })
Write-Host "========================================" -ForegroundColor Cyan

if ($Failed -ne 0) {
    exit 1
}
