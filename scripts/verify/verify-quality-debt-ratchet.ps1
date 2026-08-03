#!/usr/bin/env pwsh
<#
Quality-debt ratchet verifier — bidirectional (#1536 Phase 1).

Every soft gate and golangci exclusion in the repo must be registered in
quality-debt-baseline.json with accurate metadata, and the registered
complexity budgets must not be exceeded.

Checks:
  1. every `continue-on-error: true` in checks.yml is registered in the
     baseline (matched by job: step name);
  2. every golangci `path:` exclusion rule (non-test) in hub-server and
     edge-server .golangci.yml is registered (matched by file+path);
  3. every baseline soft_gate entry has a matching continue-on-error in
     checks.yml (zombie check);
  4. every baseline exclusion entry has a matching rule in the .golangci.yml
     (zombie check);
  5. baseline linter list matches the .golangci.yml linter list for each path;
  6. actual complexity (gocognit, gocyclo) is ≤ baseline budget;
  7. schema completeness: reason, issue, owner, introduced_at, review_by all present;
  8. date format: introduced_at and review_by are ISO-8601 dates, and
     introduced_at <= review_by;
  9. no runtime dependency mutation in checks.yml;
 10. exclusion patterns resolve to exactly one existing Go source file;
 11. existing complexity budgets cannot increase and review deadlines cannot
     be extended without an explicit extension_reason;
 12. failures expose stable QDR-* identifiers for behavior-level self-tests.

Negative proofs:
  - adding an unregistered soft gate → FAIL
  - widening an exclusion to a directory → FAIL
  - adding a linter to an existing path without updating baseline → FAIL
  - raising an existing complexity budget relative to the base baseline → FAIL
  - removing introduced_at → FAIL
  - removing review_by → FAIL
  - baseline contains a zombie entry (no matching config rule) → FAIL
  - runtime dependency mutation → FAIL
#>

[CmdletBinding()]
param(
    [switch]$SkipComplexity,
    [switch]$SkipZombieCheck,
    [switch]$SkipHistoricalRatchet,
    [string]$RepoRootPath,
    [string]$BaselinePath,
    [string]$BaseBaselinePath,
    [string]$BaseRef
)

$ErrorActionPreference = "Stop"
$RepoRoot = if ($RepoRootPath) { Resolve-Path $RepoRootPath } else { Resolve-Path (Join-Path $PSScriptRoot "..\..") }
if (-not $BaselinePath) { $BaselinePath = Join-Path $RepoRoot "scripts/verify/quality-debt-baseline.json" }
$GocognitModule = "github.com/uudashr/gocognit/cmd/gocognit@v1.2.0"
$GocycloModule = "github.com/fzipp/gocyclo/cmd/gocyclo@v0.6.0"

$Passed = 0
$Failed = 0

function Pass([string]$Text) {
    $script:Passed++
    Write-Host "  PASS  $Text" -ForegroundColor Green
}

function Fail([string]$Code, [string]$Text) {
    if ($Code -notmatch '^QDR-[A-Z0-9-]+$') {
        throw "invalid quality-debt failure code: $Code"
    }
    $script:Failed++
    Write-Host "  FAIL  [$Code] $Text" -ForegroundColor Red
}

# ── ISO date validator ────────────────────────────────────────────────────
$ISODateRegex = '^\d{4}-\d{2}-\d{2}$'
function Test-ISODate([string]$DateStr) {
    if ($DateStr -notmatch $ISODateRegex) { return $false }
    try {
        $null = [DateTime]::ParseExact($DateStr, "yyyy-MM-dd", [cultureinfo]::InvariantCulture)
        return $true
    } catch {
        return $false
    }
}

function Test-PositiveInteger([object]$Value) {
    $integerTypes = @(
        [byte], [sbyte], [int16], [uint16], [int32], [uint32], [int64], [uint64]
    )
    foreach ($type in $integerTypes) {
        if ($Value -is $type) { return [decimal]$Value -gt 0 }
    }
    return $false
}

function Convert-ExactGoPatternToPath([string]$Pattern) {
    # Only literal relative Go-file paths are permitted. Regex wildcards,
    # directory patterns, anchors, groups and character classes are rejected.
    if ($Pattern -notmatch '^(?:[A-Za-z0-9_.-]+/)*[A-Za-z0-9_.-]+\\\.go$') {
        return $null
    }
    $segments = $Pattern -split '/'
    if (@($segments | Where-Object { $_ -eq '.' -or $_ -eq '..' }).Count -gt 0) {
        return $null
    }
    return ($Pattern -replace '\\\.', '.')
}

function Get-EntryMap([object[]]$Entries, [scriptblock]$KeySelector) {
    $map = @{}
    foreach ($entry in @($Entries)) {
        $key = & $KeySelector $entry
        $map[$key] = $entry
    }
    return $map
}

function Format-NativeOutput([object[]]$Output) {
    return (@($Output) | ForEach-Object { $_.ToString() }) -join ' | '
}

function Read-BaseBaseline {
    if ($BaseBaselinePath) {
        if (-not (Test-Path -LiteralPath $BaseBaselinePath)) {
            Fail "QDR-BASELINE-REF" "base baseline path not found: $BaseBaselinePath"
            return $null
        }
        return Get-Content -Raw -LiteralPath $BaseBaselinePath | ConvertFrom-Json -AsHashtable
    }

    $candidateRef = $BaseRef
    if (-not $candidateRef -and $env:GITHUB_BASE_REF) {
        $candidateRef = "origin/$($env:GITHUB_BASE_REF)"
    }
    # Pull requests compare with the actual base branch. Push runs compare
    # with the previous main commit. Local multi-commit PR work must pass
    # -BaseRef explicitly; HEAD^ may be an earlier bootstrap commit and is not
    # a trustworthy policy baseline.
    if (-not $candidateRef -and $env:GITHUB_EVENT_NAME -eq 'push') {
        & git -C $RepoRoot rev-parse --verify HEAD^ *> $null
        if ($LASTEXITCODE -eq 0) { $candidateRef = 'HEAD^' }
    }
    if (-not $candidateRef) { return $null }

    $repoRelative = 'scripts/verify/quality-debt-baseline.json'
    $raw = & git -C $RepoRoot show "${candidateRef}:$repoRelative" 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $raw) { return $null }
    return ($raw -join "`n") | ConvertFrom-Json -AsHashtable
}

# ── Load baseline ─────────────────────────────────────────────────────────
if (-not (Test-Path -LiteralPath $BaselinePath)) {
    Fail "QDR-BASELINE-MISSING" "baseline missing: $BaselinePath"
    exit 1
}
$baseline = Get-Content -Raw -LiteralPath $BaselinePath | ConvertFrom-Json -AsHashtable

# ── 7. Schema completeness ────────────────────────────────────────────────
$badEntries = @()
foreach ($gate in @($baseline.soft_gates)) {
    if (-not $gate.issue -or -not $gate.owner -or -not $gate.reason -or -not $gate.introduced_at -or -not $gate.review_by) {
        $missing = @()
        if (-not $gate.issue) { $missing += "issue" }
        if (-not $gate.owner) { $missing += "owner" }
        if (-not $gate.reason) { $missing += "reason" }
        if (-not $gate.introduced_at) { $missing += "introduced_at" }
        if (-not $gate.review_by) { $missing += "review_by" }
        $badEntries += "soft_gate $($gate.location): missing $($missing -join ', ')"
    }
    if (-not (Test-PositiveInteger $gate.issue)) {
        $badEntries += "soft_gate $($gate.location): issue '$($gate.issue)' must be a positive JSON integer"
    }
    if ($gate.introduced_at -and -not (Test-ISODate $gate.introduced_at)) {
        $badEntries += "soft_gate $($gate.location): introduced_at '$($gate.introduced_at)' is not a valid ISO date (YYYY-MM-DD)"
    }
    if ($gate.review_by -and -not (Test-ISODate $gate.review_by)) {
        $badEntries += "soft_gate $($gate.location): review_by '$($gate.review_by)' is not a valid ISO date (YYYY-MM-DD)"
    }
    if ($gate.introduced_at -and $gate.review_by -and (Test-ISODate $gate.introduced_at) -and (Test-ISODate $gate.review_by)) {
        if ($gate.introduced_at -gt $gate.review_by) {
            $badEntries += "soft_gate $($gate.location): introduced_at ($($gate.introduced_at)) is after review_by ($($gate.review_by))"
        }
    }
}
foreach ($exc in @($baseline.golangci_exclusions)) {
    if (-not $exc.issue -or -not $exc.owner -or -not $exc.reason -or -not $exc.introduced_at -or -not $exc.review_by) {
        $missing = @()
        if (-not $exc.issue) { $missing += "issue" }
        if (-not $exc.owner) { $missing += "owner" }
        if (-not $exc.reason) { $missing += "reason" }
        if (-not $exc.introduced_at) { $missing += "introduced_at" }
        if (-not $exc.review_by) { $missing += "review_by" }
        $badEntries += "exclusion $($exc.file) $($exc.path): missing $($missing -join ', ')"
    }
    if (-not (Test-PositiveInteger $exc.issue)) {
        $badEntries += "exclusion $($exc.file) $($exc.path): issue '$($exc.issue)' must be a positive JSON integer"
    }
    if ($exc.introduced_at -and -not (Test-ISODate $exc.introduced_at)) {
        $badEntries += "exclusion $($exc.file) $($exc.path): introduced_at '$($exc.introduced_at)' is not a valid ISO date (YYYY-MM-DD)"
    }
    if ($exc.review_by -and -not (Test-ISODate $exc.review_by)) {
        $badEntries += "exclusion $($exc.file) $($exc.path): review_by '$($exc.review_by)' is not a valid ISO date (YYYY-MM-DD)"
    }
    if ($exc.introduced_at -and $exc.review_by -and (Test-ISODate $exc.introduced_at) -and (Test-ISODate $exc.review_by)) {
        if ($exc.introduced_at -gt $exc.review_by) {
            $badEntries += "exclusion $($exc.file) $($exc.path): introduced_at ($($exc.introduced_at)) is after review_by ($($exc.review_by))"
        }
    }
    if ($exc.file -notin @('hub-server/.golangci.yml', 'edge-server/.golangci.yml')) {
        $badEntries += "exclusion $($exc.file) $($exc.path): file must be one supported golangci config"
    }
    $relativeGoPath = Convert-ExactGoPatternToPath $exc.path
    if (-not $relativeGoPath) {
        $badEntries += "exclusion $($exc.file) $($exc.path): path must be one exact escaped .go file, not a regex/directory pattern"
    } else {
        $module = if ($exc.file -match '^hub-server') { 'hub-server' } else { 'edge-server' }
        $sourcePath = Join-Path $RepoRoot $module $relativeGoPath
        if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
            $badEntries += "exclusion $($exc.file) $($exc.path): exact source file does not exist: $module/$relativeGoPath"
        }
    }
    foreach ($requiredMetric in @('gocognit', 'gocyclo')) {
        if (@($exc.linters) -contains $requiredMetric -and (-not $exc.complexity -or -not $exc.complexity.ContainsKey($requiredMetric))) {
            $badEntries += "exclusion $($exc.file) $($exc.path): enabled $requiredMetric exclusion requires complexity.$requiredMetric budget"
        }
    }
    # check complexity fields if present
    if ($exc.complexity) {
        foreach ($k in $exc.complexity.Keys) {
            $v = $exc.complexity[$k]
            if ($v -is [string]) {
                $badEntries += "exclusion $($exc.file) $($exc.path): complexity.$k is a string ('$v'), must be a number"
            }
        }
    }
}
if ($badEntries.Count -eq 0) {
    Pass "baseline entries complete (reason/issue/owner/introduced_at/review_by)"
} else {
    foreach ($b in $badEntries) { Fail "QDR-SCHEMA" $b }
}

# ── Load checks.yml ───────────────────────────────────────────────────────
$WorkflowPath = Join-Path $RepoRoot ".github/workflows/checks.yml"
$wfLines = Get-Content -LiteralPath $WorkflowPath

# ── 1. continue-on-error registration (forward) ──────────────────────────
$registeredLocations = @($baseline.soft_gates | ForEach-Object { $_.location })
$foundContinueOnError = @()

$jobName = ""
$stepName = ""
for ($i = 0; $i -lt $wfLines.Count; $i++) {
    $line = $wfLines[$i]
    if ($line -match '^  ([a-zA-Z0-9_-]+):\s*$') {
        $jobName = $Matches[1].Trim()
    }
    if ($line -match '^\s+- name:\s*(.+)$') {
        $stepName = $Matches[1].Trim()
    }
    if ($line -match '^\s+continue-on-error:\s*true\s*(?:#.*)?$') {
        $loc = "${jobName}: ${stepName}"
        $foundContinueOnError += $loc
        $registered = $registeredLocations | Where-Object { $_ -eq $loc }
        if (-not $registered) {
            Fail "QDR-SOFT-GATE-UNREGISTERED" "unregistered continue-on-error: $loc"
        }
    }
}
if ($registeredLocations.Count -gt 0) { Pass "continue-on-error gates checked (forward)" }

# ── 3. Zombie check: baseline soft_gates with no matching gate ───────────
if (-not $SkipZombieCheck) {
    $zombies = @()
    foreach ($gate in @($baseline.soft_gates)) {
        if ($foundContinueOnError -notcontains $gate.location) {
            $zombies += "baseline soft_gate '$($gate.location)' has no matching continue-on-error in checks.yml"
        }
    }
    if ($zombies.Count -eq 0) {
        Pass "no zombie soft_gates in baseline"
    } else {
        foreach ($z in $zombies) { Fail "QDR-SOFT-GATE-ZOMBIE" $z }
    }
} else {
    Pass "zombie gate check skipped (--SkipZombieCheck)"
}

# ── 9. Runtime dependency mutation ───────────────────────────────────────
$mutationPatterns = @(
    '(?i)\bpnpm\s+(?:add|remove|update|up)\b',
    '(?i)\bgo\s+get\b',
    '(?i)\bnpm\s+(?:add|install|uninstall|update)\b'
)
$mutations = @()
foreach ($line in $wfLines) {
    if ($line -match '^\s*#') { continue }
    foreach ($pat in $mutationPatterns) {
        if ($line -match $pat) {
            $mutations += $line.Trim()
        }
    }
}
if ($mutations.Count -eq 0) {
    Pass "no runtime dependency mutation in checks.yml"
} else {
    foreach ($m in $mutations) { Fail "QDR-RUNTIME-MUTATION" "runtime dependency mutation: $m" }
}

# ── Helper: read linter set for one exclusion path ───────────────────────
function Get-LintersForPath([string]$ConfigFile, [string]$TargetPath) {
    $path = Join-Path $RepoRoot $ConfigFile
    $inRules = $false
    $currentLinters = @()
    $currentPath = $null
    foreach ($l in (Get-Content -LiteralPath $path)) {
        if ($l -match '^\s*rules:\s*$') { $inRules = $true; continue }
        if (-not $inRules) { continue }
        if ($l -match '^\s*path:\s*(.+)$') {
            $currentPath = $Matches[1].Trim().Trim('"')
            # Store linters for previous path
            if ($currentPath -eq $TargetPath -and $currentLinters.Count -gt 0) {
                return $currentLinters
            }
            $currentLinters = @()
        }
        elseif ($l -match '^\s*-\s+(\w+)$') {
            $currentLinters += $Matches[1]
        }
    }
    # Check last entry
    if ($currentPath -eq $TargetPath -and $currentLinters.Count -gt 0) {
        return $currentLinters
    }
    return @()
}

# ── 2. exclusion registration (forward) ──────────────────────────────────
$registeredExc = @{}
foreach ($e in @($baseline.golangci_exclusions)) {
    $key = "$($e.file)|$($e.path)"
    $registeredExc[$key] = $e
}

$unregistered = @()
$actualExclusions = @{}
foreach ($gcfg in @("hub-server/.golangci.yml", "edge-server/.golangci.yml")) {
    $cfgPath = Join-Path $RepoRoot $gcfg
    if (-not (Test-Path -LiteralPath $cfgPath)) { continue }
    $inRules = $false
    foreach ($l in (Get-Content -LiteralPath $cfgPath)) {
        if ($l -match '^\s*rules:\s*$') { $inRules = $true; continue }
        if ($inRules -and $l -match '^\s*path:\s*(.+)$') {
            $p = $Matches[1].Trim().Trim('"')
            if ($p -eq '_test\.go') { continue }
            $key = "$gcfg|$p"
            $actualExclusions[$key] = $true
            if (-not $registeredExc.ContainsKey($key)) {
                $unregistered += "$key"
            }
        }
    }
}
if ($unregistered.Count -eq 0) {
    Pass "all golangci exclusions registered (forward)"
} else {
    foreach ($u in $unregistered) { Fail "QDR-EXCLUSION-UNREGISTERED" "unregistered exclusion: $u" }
}

# ── 4. Zombie check: baseline entries with no matching config rule ───────
if (-not $SkipZombieCheck) {
    $zombieExc = @()
    foreach ($e in @($baseline.golangci_exclusions)) {
        $key = "$($e.file)|$($e.path)"
        if (-not $actualExclusions.ContainsKey($key)) {
            $zombieExc += "baseline exclusion '$key' has no matching rule in $($e.file)"
        }
    }
    if ($zombieExc.Count -eq 0) {
        Pass "no zombie exclusions in baseline"
    } else {
        foreach ($z in $zombieExc) { Fail "QDR-EXCLUSION-ZOMBIE" $z }
    }
} else {
    Pass "zombie exclusion check skipped (--SkipZombieCheck)"
}

# ── 5. Linter set match ──────────────────────────────────────────────────
$linterMismatches = @()
foreach ($e in @($baseline.golangci_exclusions)) {
    $configLinters = Get-LintersForPath $e.file $e.path
    $baselineLinters = @($e.linters | Sort-Object)
    $configSorted = @($configLinters | Sort-Object)
    $diff = Compare-Object $baselineLinters $configSorted
    if ($diff) {
        $extra = $diff | Where-Object { $_.SideIndicator -eq '=>' } | ForEach-Object { $_.InputObject }
        $missing = $diff | Where-Object { $_.SideIndicator -eq '<=' } | ForEach-Object { $_.InputObject }
        $parts = @()
        if ($missing) { $parts += "baseline has extra linters that config doesn't: $($missing -join ',')" }
        if ($extra) { $parts += "config has linters not in baseline: $($extra -join ',')" }
        $linterMismatches += "$($e.file) $($e.path): $($parts -join '; ')"
    }
}
if ($linterMismatches.Count -eq 0) {
    Pass "all baseline linter sets match .golangci.yml"
} else {
    foreach ($m in $linterMismatches) { Fail "QDR-LINTER-MISMATCH" $m }
}

# ── 10. Historical baseline ratchet ───────────────────────────────────────
if (-not $SkipHistoricalRatchet) {
    $baseBaseline = Read-BaseBaseline
    if ($baseBaseline) {
        $historyFails = @()
        $baseGates = Get-EntryMap @($baseBaseline.soft_gates) { param($e) $e.location }
        $baseExclusions = Get-EntryMap @($baseBaseline.golangci_exclusions) { param($e) "$($e.file)|$($e.path)" }

        foreach ($gate in @($baseline.soft_gates)) {
            if (-not $baseGates.ContainsKey($gate.location)) { continue }
            $old = $baseGates[$gate.location]
            if ($gate.introduced_at -ne $old.introduced_at) {
                $historyFails += "soft_gate $($gate.location): introduced_at is immutable ($($old.introduced_at) -> $($gate.introduced_at))"
            }
            if ($gate.review_by -gt $old.review_by -and -not $gate.extension_reason) {
                $historyFails += "soft_gate $($gate.location): review_by extended ($($old.review_by) -> $($gate.review_by)) without extension_reason"
            }
        }

        foreach ($exc in @($baseline.golangci_exclusions)) {
            $key = "$($exc.file)|$($exc.path)"
            if (-not $baseExclusions.ContainsKey($key)) { continue }
            $old = $baseExclusions[$key]
            if ($exc.introduced_at -ne $old.introduced_at) {
                $historyFails += "exclusion ${key}: introduced_at is immutable ($($old.introduced_at) -> $($exc.introduced_at))"
            }
            if ($exc.review_by -gt $old.review_by -and -not $exc.extension_reason) {
                $historyFails += "exclusion ${key}: review_by extended ($($old.review_by) -> $($exc.review_by)) without extension_reason"
            }
            foreach ($oldMetric in @($old.complexity.Keys)) {
                if (-not $exc.complexity -or -not $exc.complexity.ContainsKey($oldMetric)) {
                    $historyFails += "exclusion ${key}: existing $oldMetric budget was removed"
                }
            }
            foreach ($metric in @($exc.complexity.Keys)) {
                if (-not $old.complexity -or -not $old.complexity.ContainsKey($metric)) { continue }
                if ([int]$exc.complexity[$metric] -gt [int]$old.complexity[$metric]) {
                    $historyFails += "exclusion ${key}: $metric budget increased ($($old.complexity[$metric]) -> $($exc.complexity[$metric]))"
                }
            }
        }

        if ($historyFails.Count -eq 0) {
            Pass "existing budgets and review deadlines did not regress versus base baseline"
        } else {
            foreach ($h in $historyFails) { Fail "QDR-HISTORY-REGRESSION" $h }
        }
    } else {
        Pass "base baseline absent; bootstrap comparison skipped"
    }
} else {
    Pass "historical baseline comparison skipped (--SkipHistoricalRatchet)"
}

# ── 6. Complexity ratchet ─────────────────────────────────────────────────
if (-not $SkipComplexity) {
    # Some developer hosts intentionally leave GOPATH/GOMODCACHE unset. Give
    # pinned verifier tools an isolated cache outside the repository; never
    # mutate go.mod/go.sum or the source tree.
    $goModCache = (& go env GOMODCACHE 2>$null | Select-Object -First 1).Trim()
    if (-not $goModCache) {
        $isolatedGoPath = Join-Path ([IO.Path]::GetTempPath()) 'agenthub-quality-debt-go'
        $env:GOPATH = $isolatedGoPath
        $env:GOMODCACHE = Join-Path $isolatedGoPath 'pkg/mod'
        New-Item -ItemType Directory -Force -Path $env:GOMODCACHE | Out-Null
    }
    $goBuildCache = (& go env GOCACHE 2>$null | Select-Object -First 1).Trim()
    if (-not $goBuildCache -or $goBuildCache -eq 'off') {
        $env:GOCACHE = Join-Path ([IO.Path]::GetTempPath()) 'agenthub-quality-debt-go-build'
        New-Item -ItemType Directory -Force -Path $env:GOCACHE | Out-Null
    }
    $complexityFails = @()
    foreach ($e in @($baseline.golangci_exclusions)) {
        if (-not $e.complexity) { continue }
        $module = if ($e.file -match '^hub-server') { "hub-server" } else { "edge-server" }
        $relativeGoPath = Convert-ExactGoPatternToPath $e.path
        if (-not $relativeGoPath) { continue }
        $filePath = Join-Path $RepoRoot $module $relativeGoPath

        # gocognit
        if ($e.complexity.ContainsKey('gocognit')) {
            $baselineVal = [int]$e.complexity['gocognit']
            $result = & go run $GocognitModule -over -1 $filePath 2>&1
            if ($LASTEXITCODE -ne 0) {
                $complexityFails += "$($e.file) $($e.path): gocognit tool failed (pinned $GocognitModule): $(Format-NativeOutput $result)"
                continue
            }
            $actualMax = 0
            foreach ($line in $result) {
                if ($line -match '^(\d+)') {
                    $val = [int]$Matches[1]
                    if ($val -gt $actualMax) { $actualMax = $val }
                }
            }
            if ($actualMax -gt $baselineVal) {
                $complexityFails += "$($e.file) $($e.path): gocognit actual=$actualMax, baseline=$baselineVal (budget exceeded)"
            }
        }

        # gocyclo
        if ($e.complexity.ContainsKey('gocyclo')) {
            $baselineVal = [int]$e.complexity['gocyclo']
            $result = & go run $GocycloModule -over -1 $filePath 2>&1
            if ($LASTEXITCODE -ne 0) {
                $complexityFails += "$($e.file) $($e.path): gocyclo tool failed (pinned $GocycloModule): $(Format-NativeOutput $result)"
                continue
            }
            $actualMax = 0
            foreach ($line in $result) {
                if ($line -match '^(\d+)') {
                    $val = [int]$Matches[1]
                    if ($val -gt $actualMax) { $actualMax = $val }
                }
            }
            if ($actualMax -gt $baselineVal) {
                $complexityFails += "$($e.file) $($e.path): gocyclo actual=$actualMax, baseline=$baselineVal (budget exceeded)"
            }
        }
    }
    if ($complexityFails.Count -eq 0) {
        Pass "all complexity budgets respected"
    } else {
        foreach ($f in $complexityFails) { Fail "QDR-COMPLEXITY" $f }
    }
} else {
    Pass "complexity check skipped (--SkipComplexity)"
}

# ── Summary ───────────────────────────────────────────────────────────────
Write-Host ""
if ($Failed -gt 0) {
    Write-Host "Quality-debt ratchet: $Failed FAIL, $Passed pass" -ForegroundColor Red
    exit 1
}
Write-Host "Quality-debt ratchet: $Passed pass" -ForegroundColor Green