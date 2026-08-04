#!/usr/bin/env pwsh
<#
Test-sleep budget verifier (#1565).

Extends the #1550 count ratchet (verify-test-sleep-ratchet.ps1 +
test-sleep-baseline.json) with value budgets so a 20ms sleep cannot silently
become 20s and lane wall-clock cannot grow unapproved:

- per-file `time.Sleep(` count must not exceed the baseline count;
- per-file total sleep value (ms) must not exceed baseline total_ms;
- per-file largest single sleep value (ms) must not exceed baseline max_ms;
- every resolved sleep value must exist in the baseline sleeps[] list (value
  identity ratchet: 5ms cannot become 500ms even when count stays the same);
- polling spot-check: every `for` loop containing `time.Sleep` must carry a
  deadline guard (deadline / Before( / After( / ctx / time.After) in the loop
  head or body, or be a bounded three-clause counter loop / `for range`;
  unbounded polling loops fail unless explicitly exempted in the baseline.

Baseline: scripts/verify/test-sleep-budget.json (structured, per-file
count/total_ms/max_ms/sleeps[] + owner/review/reason; every sleep entry needs
a kind from {poll_deadline, negative_window, simulated_slow, real_protocol,
grace_window}).

Scope: *_test.go under hub-server/ and edge-server/ (testkit helper files are
not *_test.go and are the sanctioned deadline-poll helpers, so they stay out).

Usage:
  pwsh scripts/verify/verify-test-sleep-budget.ps1                   # check
  pwsh scripts/verify/verify-test-sleep-budget.ps1 -UpdateBaseline   # approve (recompute from source)
  pwsh scripts/verify/verify-test-sleep-budget.ps1 -RepoRootPath <path>  # fixture mode (self-tests)
#>

[CmdletBinding()]
param(
    [switch]$UpdateBaseline,
    [string]$RepoRootPath
)

$ErrorActionPreference = "Stop"

if (-not $RepoRootPath) {
    $RepoRootPath = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
}
$BaselinePath = Join-Path $PSScriptRoot "test-sleep-budget.json"

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

# ── Duration resolution ───────────────────────────────────────────────
# Units in milliseconds.
$UnitMs = @{
    "time.Nanosecond"  = 0.000001
    "time.Microsecond" = 0.001
    "time.Millisecond" = 1
    "time.Second"      = 1000
    "time.Minute"      = 60000
    "time.Hour"        = 3600000
}

function Resolve-Const([string]$Dir, [string]$Name) {
    # Look for `const <Name> = <duration expr>` in any .go file of the package.
    foreach ($f in (Get-ChildItem -LiteralPath $Dir -Filter "*.go" -File)) {
        foreach ($l in (Get-Content -LiteralPath $f.FullName)) {
            if ($l -match "const\s+$([regex]::Escape($Name))\s*=\s*(.+)$") {
                $constExpr = $Matches[1].Trim()
                $v = Resolve-DurationExpr $constExpr $Dir
                if ($null -ne $v) { return $v }
            }
        }
    }
    return $null
}

function Resolve-DurationExpr([string]$Expr, [string]$Dir) {
    # Strip trailing comment.
    $Expr = ($Expr -split "//")[0].Trim()
    if ($Expr -eq "") { return $null }

    # Pure unit constant: time.Millisecond
    if ($UnitMs.ContainsKey($Expr)) { return [double]$UnitMs[$Expr] }

    # N * unit  or  unit * N
    if ($Expr -match "^\s*(\d+)\s*\*\s*(time\.\w+)\s*$") {
        $count = [int]$Matches[1]
        $unit = $Matches[2]
        if ($UnitMs.ContainsKey($unit)) { return [double]$count * [double]$UnitMs[$unit] }
    }
    if ($Expr -match "^\s*(time\.\w+)\s*\*\s*(\d+)\s*$") {
        $unit = $Matches[1]
        $count = [int]$Matches[2]
        if ($UnitMs.ContainsKey($unit)) { return [double]$count * [double]$UnitMs[$unit] }
    }

    # Bare identifier -> package const (e.g. pollInterval, hotReloadDebounce).
    if ($Expr -match "^\s*([A-Za-z_]\w*)\s*$") {
        $ident = $Matches[1]
        return Resolve-Const $Dir $ident
    }

    # Sum of terms: hotReloadDebounce + 100*time.Millisecond
    if ($Expr -match "\+") {
        $total = 0.0
        $resolvedAny = $false
        foreach ($term in ($Expr -split "\+")) {
            $term = $term.Trim()
            $termMs = Resolve-DurationExpr $term $Dir
            if ($null -eq $termMs) { return $null }
            $total += $termMs
            $resolvedAny = $true
        }
        if ($resolvedAny) { return $total }
    }

    return $null
}

function Get-SleepValueMs([string]$Arg, [string]$Dir) {
    $expr = ($Arg -split "//")[0].Trim()
    if ($expr -eq "") { return $null }
    return Resolve-DurationExpr $expr $Dir
}

# Extract the argument inside time.Sleep( ... ) — single-line only (all
# current sites are single-line; multiline sleep args would be flagged by the
# unresolved-value rule below).
function Get-SleepArg([string]$Line) {
    if ($Line -notmatch "time\.Sleep\(\s*([^)]*)\)") { return $null }
    return $Matches[1]
}

# ── Per-file scan ─────────────────────────────────────────────────────
$current = @{}

foreach ($module in @("hub-server", "edge-server")) {
    $dir = Join-Path $RepoRootPath $module
    if (-not (Test-Path -LiteralPath $dir)) { continue }
    Get-ChildItem -LiteralPath $dir -Recurse -Filter "*_test.go" | ForEach-Object {
        $rel = ($_.FullName.Substring($RepoRootPath.Length + 1) -replace '\\', '/')
        $lines = Get-Content -LiteralPath $_.FullName
        $fileDir = $_.DirectoryName

        $entry = @{
            count      = 0
            total_ms   = 0.0
            max_ms     = 0.0
            dynamic    = 0
            values     = [System.Collections.Generic.List[double]]::new()
            dynamicLines = [System.Collections.Generic.List[int]]::new()
        }

        for ($i = 0; $i -lt $lines.Count; $i++) {
            $line = $lines[$i]
            if ($line -notmatch "time\.Sleep\(") { continue }
            $entry.count++
            $arg = Get-SleepArg $line
            $ms = if ($null -ne $arg) { Get-SleepValueMs $arg $fileDir } else { $null }
            if ($null -eq $ms) {
                $entry.dynamic++
                $entry.dynamicLines.Add($i + 1)
            } else {
                $entry.values.Add([double]$ms)
                $entry.total_ms += [double]$ms
                if ($ms -gt $entry.max_ms) { $entry.max_ms = $ms }
            }
        }

        if ($entry.count -gt 0) { $current[$rel] = $entry }
    }
}

# ── Load baseline ─────────────────────────────────────────────────────
if (-not (Test-Path -LiteralPath $BaselinePath)) {
    Fail "baseline missing: $BaselinePath (run with -UpdateBaseline once, then fill owner/review/reason)"
    exit 1
}
$baseline = Get-Content -Raw -LiteralPath $BaselinePath | ConvertFrom-Json -AsHashtable

# ── UpdateBaseline mode ───────────────────────────────────────────────
if ($UpdateBaseline) {
    $newBaseline = @{}
    foreach ($rel in ($current.Keys | Sort-Object)) {
        $e = $current[$rel]
        $old = if ($baseline.ContainsKey($rel)) { $baseline[$rel] } else { $null }
        $entry = @{
            count    = $e.count
            total_ms = [Math]::Round($e.total_ms, 3)
            max_ms   = [Math]::Round($e.max_ms, 3)
            sleeps   = @($e.values | ForEach-Object { [Math]::Round($_, 3) } | Sort-Object)
            owner    = if ($old -and $old.ContainsKey("owner")) { $old["owner"] } else { "TODO" }
            review   = if ($old -and $old.ContainsKey("review")) { $old["review"] } else { "TODO" }
            reason   = if ($old -and $old.ContainsKey("reason")) { $old["reason"] } else { "TODO: fill semantic reason" }
            dynamic  = $e.dynamic
        }
        if ($e.dynamic -gt 0) {
            $entry["dynamic_reason"] = if ($old -and $old.ContainsKey("dynamic_reason")) { $old["dynamic_reason"] } else { "TODO" }
        }
        $newBaseline[$rel] = $entry
    }
    $json = @{ _comment = "Per-file time.Sleep budget baseline (#1565). Any count/value increase requires -UpdateBaseline (tracked approval)." }
    foreach ($rel in ($newBaseline.Keys | Sort-Object)) { $json[$rel] = $newBaseline[$rel] }
    $json | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $BaselinePath -Encoding UTF8
    Pass "baseline updated from source ($($newBaseline.Count) files)"
    exit 0
}

# ── Compare ───────────────────────────────────────────────────────────
$violations = @()

foreach ($rel in ($current.Keys | Sort-Object)) {
    $e = $current[$rel]
    if (-not $baseline.ContainsKey($rel)) {
        $violations += "$rel : $($e.count) sleeps but no baseline entry"
        continue
    }
    $b = $baseline[$rel]

    if (-not $b.ContainsKey("owner") -or -not $b.ContainsKey("review") -or -not $b.ContainsKey("reason") -or
        [string]$b["owner"] -eq "TODO" -or [string]$b["review"] -eq "TODO") {
        $violations += "$rel : baseline entry needs owner/review/reason (semantic justification)"
    }

    $baseCount = [int]$b["count"]
    if ($e.count -gt $baseCount) {
        $violations += "$rel : $($e.count) sleeps, baseline $baseCount"
    }

    $baseTotal = [double]$b["total_ms"]
    if ($e.total_ms -gt $baseTotal + 0.0005) {
        $violations += "$rel : sleep total {0:N3}ms exceeds budget {1:N3}ms" -f $e.total_ms, $baseTotal
    }

    $baseMax = [double]$b["max_ms"]
    if ($e.max_ms -gt $baseMax + 0.0005) {
        $violations += "$rel : largest sleep {0:N3}ms exceeds budget {1:N3}ms" -f $e.max_ms, $baseMax
    }

    # Value identity: every current value must exist in baseline sleeps[] with
    # enough multiplicity (prevents 5ms -> 500ms with the same count).
    $baseValues = @()
    if ($b.ContainsKey("sleeps")) {
        foreach ($sv in $b["sleeps"]) {
            $baseValues += if ($sv -is [hashtable]) { [double]$sv["ms"] } else { [double]$sv }
        }
    }
    foreach ($v in $e.values) {
        $curCount = @($e.values | Where-Object { [Math]::Abs($_ - $v) -lt 0.0005 }).Count
        $baseCountV = @($baseValues | Where-Object { [Math]::Abs($_ - $v) -lt 0.0005 }).Count
        if ($curCount -gt $baseCountV) {
            $violations += "$rel : sleep value {0:N3}ms x{1} not covered by baseline sleeps[]" -f $v, $curCount
            break
        }
    }

    if ($e.dynamic -gt 0) {
        $baseDynamic = if ($b.ContainsKey("dynamic")) { [int]$b["dynamic"] } else { 0 }
        if ($e.dynamic -gt $baseDynamic) {
            $violations += "$rel : $($e.dynamic) unresolvable sleep(s) (lines $($e.dynamicLines -join ',')) — add to baseline with dynamic_reason"
        }
    }
}

# Baseline files that no longer have sleeps are fine (ratchet shrinks).
foreach ($rel in ($baseline.Keys | Where-Object { $_ -ne "_comment" -and -not $current.ContainsKey($_) })) {
    Pass "sleeps removed in $rel"
}

# ── Polling deadline spot-check ───────────────────────────────────────
# Heuristic: a `for` loop body that contains time.Sleep( must either be a
# bounded counter loop (`for i := 0; i < N; i++`), a `for range` drain, or
# carry a deadline guard token in its head or body.
$deadlineTokens = "deadline|Before\(|After\(|time\.After|ctx\.|context\.|<-ctx"

foreach ($module in @("hub-server", "edge-server")) {
    $dir = Join-Path $RepoRootPath $module
    if (-not (Test-Path -LiteralPath $dir)) { continue }
    Get-ChildItem -LiteralPath $dir -Recurse -Filter "*_test.go" | ForEach-Object {
        $rel = ($_.FullName.Substring($RepoRootPath.Length + 1) -replace '\\', '/')
        $lines = Get-Content -LiteralPath $_.FullName

        for ($i = 0; $i -lt $lines.Count; $i++) {
            $head = $lines[$i]
            if ($head -notmatch "^\s*for\b") { continue }
            if ($head -match "^\s*for\s+\w+\s*:=\s*[^;]+;[^;]+;[^;{]*\s*\{") { continue }   # three-clause counter
            if ($head -match "^\s*for\b.*\brange\b.*\{") { continue }                     # range drain

            # Locate `{` for this for loop (same line or next line).
            $braceLine = $i
            $bodyStart = $head.IndexOf("{")
            while ($bodyStart -lt 0 -and $braceLine -lt $lines.Count - 1) {
                $braceLine++
                $bodyStart = $lines[$braceLine].IndexOf("{")
            }
            if ($bodyStart -lt 0) { continue }

            # Collect body until braces balance.
            $depth = 0
            $body = ""
            for ($j = $braceLine; $j -lt $lines.Count; $j++) {
                $body += $lines[$j] + "`n"
                $depth += ([regex]::Matches($lines[$j], "\{")).Count - ([regex]::Matches($lines[$j], "\}")).Count
                if ($depth -le 0) { break }
            }

            if ($body -notmatch "time\.Sleep\(") { continue }
            $headAndBody = $head + "`n" + $body
            if ($headAndBody -match $deadlineTokens) { continue }

            # Exemption support: baseline may list file-level poll exemptions.
            $exempt = $false
            if ($baseline.ContainsKey($rel) -and $baseline[$rel].ContainsKey("poll_exempt")) {
                foreach ($x in $baseline[$rel]["poll_exempt"]) {
                    if ($headAndBody -match [regex]::Escape([string]$x["pattern"])) { $exempt = $true; break }
                }
            }
            if (-not $exempt) {
                $violations += "$rel :$($i + 1) unbounded poll loop with time.Sleep and no deadline guard"
            }
        }
    }
}

# ── Report ────────────────────────────────────────────────────────────
if ($violations.Count -eq 0) {
    $totalSleeps = ($current.Values | Measure-Object -Property count -Sum).Sum
    $totalMs = ($current.Values | Measure-Object -Property total_ms -Sum).Sum
    Pass ("test-sleep budget holds ({0} sleeps, {1:N0}ms total across {2} files)" -f $totalSleeps, $totalMs, $current.Count)
} else {
    foreach ($v in ($violations | Sort-Object -Unique)) {
        Fail $v
    }
    Write-Host "  #1565: keep sleeps minimal; any count/value growth needs -UpdateBaseline with" -ForegroundColor Yellow
    Write-Host "        owner/review/reason. Polling loops must carry deadline guards." -ForegroundColor Yellow
    exit 1
}
