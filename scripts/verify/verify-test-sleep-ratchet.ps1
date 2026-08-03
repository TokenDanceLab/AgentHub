#!/usr/bin/env pwsh
<#
Test-sleep ratchet verifier (#1550).

Fixed time.Sleep in tests is flaky (too short under load) or slow (too long),
and unbounded polling hides stuck components. This verifier enforces that the
per-file `time.Sleep(` count in *_test.go never exceeds the committed
baseline (scripts/verify/test-sleep-baseline.json). The baseline only shrinks;
adding a sleep requires updating the baseline explicitly, which is the
tracked approval step.

Scope: *_test.go under hub-server/internal/ and edge-server/internal/.
time.Sleep inside handler/mock bodies (simulating slow behavior) counts too —
a new sleep of any kind must be justified by a baseline update.

Usage:
  pwsh scripts/verify/verify-test-sleep-ratchet.ps1              # check
  pwsh scripts/verify/verify-test-sleep-ratchet.ps1 -UpdateBaseline  # approve new baseline
#>

[CmdletBinding()]
param(
    [switch]$UpdateBaseline
)

$ErrorActionPreference = "Stop"
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$BaselinePath = Join-Path $PSScriptRoot "test-sleep-baseline.json"

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

# ── Collect current counts ──────────────────────────────────────────────
$current = @{}
foreach ($module in @("hub-server", "edge-server")) {
    $dir = Join-Path $RepoRoot $module
    if (-not (Test-Path -LiteralPath $dir)) { continue }
    Get-ChildItem -LiteralPath $dir -Recurse -Filter "*_test.go" | ForEach-Object {
        $rel = ($_.FullName.Substring($RepoRoot.Path.Length + 1) -replace '\\', '/')
        $count = 0
        foreach ($l in (Get-Content -LiteralPath $_.FullName)) {
            if ($l -match "time\.Sleep\(") { $count++ }
        }
        if ($count -gt 0) { $current[$rel] = $count }
    }
}

# ── Load baseline ───────────────────────────────────────────────────────
if (-not (Test-Path -LiteralPath $BaselinePath)) {
    Fail "baseline missing: $BaselinePath"
    exit 1
}
$baseline = Get-Content -Raw -LiteralPath $BaselinePath | ConvertFrom-Json -AsHashtable

if ($UpdateBaseline) {
    $baseline.GetEnumerator() | Sort-Object Name | ForEach-Object {
        $rel = $_.Key
        $oldN = $_.Value
        $newN = if ($current.ContainsKey($rel)) { $current[$rel] } else { 0 }
        if ($newN -ne $oldN) {
            Write-Host "  CHG  $rel : $oldN -> $newN" -ForegroundColor Cyan
        }
    }
    foreach ($rel in ($current.Keys | Where-Object { -not $baseline.ContainsKey($_) } | Sort-Object)) {
        Write-Host "  NEW  $rel : $($current[$rel])" -ForegroundColor Cyan
    }
    $current.GetEnumerator() | Sort-Object Name | ForEach-Object {
        $baseline[$_.Key] = $_.Value
    }
    # drop keys whose count fell to zero
    foreach ($k in @($baseline.Keys | Where-Object { -not $current.ContainsKey($_) })) {
        if ($current[$k] -le 0) { $baseline.Remove($k) }
    }
    ($baseline.GetEnumerator() | Sort-Object Name | ForEach-Object {
        "  `"$($_.Key)`": $($_.Value)"
    }) -join "`n" | Out-Null
    $lines = @("{")
    foreach ($k in ($baseline.Keys | Sort-Object)) {
        $lines += " `"$k`": $($baseline[$k]),"
    }
    $lines += "}"
    $lines -join "`n" | Set-Content -LiteralPath $BaselinePath -Encoding UTF8
    Pass "baseline updated"
    exit 0
}

# ── Compare ─────────────────────────────────────────────────────────────
$violations = @()
foreach ($rel in ($current.Keys | Sort-Object)) {
    $cur = $current[$rel]
    $old = if ($baseline.ContainsKey($rel)) { [int]$baseline[$rel] } else { 0 }
    if ($cur -gt $old) {
        $violations += "{0}: {1} sleeps, baseline {2}" -f $rel, $cur, $old
    }
}
# files in baseline that no longer have sleeps are fine (ratchet only goes down)
foreach ($rel in ($baseline.Keys | Where-Object { -not $current.ContainsKey($_) })) {
    Pass "sleeps removed in $rel"
}

if ($violations.Count -eq 0) {
    $total = ($current.Values | Measure-Object -Sum).Sum
    Pass "test-sleep ratchet holds ($total sleeps across $($current.Count) files, baseline $($baseline.Count) files)"
} else {
    foreach ($v in $violations) {
        Fail "sleep ratchet exceeded: $v"
    }
    Write-Host "  #1550: replace the sleep with an event wait / deadline poll (testkit.Eventually)," -ForegroundColor Yellow
    Write-Host "        or approve explicitly via -UpdateBaseline (tracked, only-shrinks)." -ForegroundColor Yellow
    exit 1
}
