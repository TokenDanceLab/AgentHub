#!/usr/bin/env pwsh
<#
Outbound HTTP / runtime-config hygiene verifier (#1549 + #1564 phase 2).

The service/verifier/callback layers must not read process env or construct
bare http.Clients: config belongs to the bootstrap/composition root, transport
policy belongs to the few purpose-built clients (egress dialer, dispatch
client, OIDC/JWKS clients, Edge callback client). This verifier fails CI when
new violations appear, and the allowlist may only shrink.

Scopes (production .go files, *_test.go excluded):
  - hub-server/internal/service/**   service layer
  - hub-server/internal/jwtutil/**   JWKS verifier
  - edge-server/internal/hub/**      Edge→Hub callback client

Purpose-built policy packages (hub-server/internal/egress,
hub-server/internal/outboundhttp) are the sanctioned client construction
points and are intentionally out of scope; every other construction must be
allowlisted with an issue + reason.

Checks:
  1. os.Getenv — zero tolerance. Config is read once at startup and injected.
  2. bare `&http.Client{` — allowlist only; entries MUST carry issue + reason.
  3. `io.ReadAll(` without `io.LimitReader(` on the same line — external
     responses must be body-limited (fail-closed cap).
  4. `http.Get(` / `http.Post(` / `http.Head(` package helpers — implicit
     clients are forbidden.
  5. retry loops (`for attempt := 0;`) in files that perform HTTP and do not
     reference a retry budget (e.g. RetryBudget/retryBudget/budget) —
     unbudgeted retries fail.
  6. allowlist hygiene: anonymous entries (no #issue) and stale entries
     (allowlisted file has no violations) fail; the allowlist only shrinks.

Allowlist entry format: <relative/forward-slash/path>|<#issue>|<reason>
#>

[CmdletBinding()]
param(
    # Comma-separated scope roots relative to the repo root (self-tests can
    # narrow or extend the scan).
    [string]$Scopes = "hub-server/internal/service,hub-server/internal/jwtutil,edge-server/internal/hub",
    # Optional replacement allowlist (self-tests); default = the tracked
    # residual entries below. Entries must match path|#issue|reason.
    [string[]]$ClientAllowlist,
    # Skip the default residual allowlist entirely (isolated fixture runs).
    [switch]$NoDefaultAllowlist
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

# ── Allowlist (tracked residual; may only shrink) ─────────────────────────
# Empty since #1594: the Hub→Edge dispatch client is now built at the
# composition root (hub-server/internal/app/wiring.go) via outboundhttp.
if ($null -eq $ClientAllowlist -and -not $NoDefaultAllowlist) {
    $ClientAllowlist = @()
}

$Allowlist = @{}
$AllowlistErrors = @()
foreach ($entry in $ClientAllowlist) {
    $parts = $entry.Split("|")
    if ($parts.Count -ne 3 -or [string]::IsNullOrWhiteSpace($parts[0])) {
        $AllowlistErrors += "malformed allowlist entry: '$entry' (expected path|#issue|reason)"
        continue
    }
    $path = $parts[0].Trim()
    $issue = $parts[1].Trim()
    $reason = $parts[2].Trim()
    if ($issue -notmatch "^#\d+$") {
        $AllowlistErrors += "anonymous allowlist entry (no issue) for '$path': '$issue' — every entry must carry a tracking issue"
        continue
    }
    if ([string]::IsNullOrWhiteSpace($reason)) {
        $AllowlistErrors += "allowlist entry for '$path' has no reason"
        continue
    }
    $Allowlist[$path] = @{ Issue = $issue; Reason = $reason }
}

# ── Collect production Go files per scope ──────────────────────────────────
$ScopeDirs = $Scopes.Split(",") | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne "" }
$GoFiles = New-Object System.Collections.Generic.List[string]
foreach ($scope in $ScopeDirs) {
    $dir = Join-Path $RepoRoot $scope
    if (-not (Test-Path -LiteralPath $dir)) {
        Fail "scope dir missing: $scope"
        continue
    }
    Get-ChildItem -LiteralPath $dir -Recurse -Filter "*.go" |
        Where-Object { $_.Name -notmatch "_test\.go$" } |
        ForEach-Object {
            $rel = ($_.FullName.Substring($RepoRoot.Path.Length + 1) -replace '\\', '/')
            $GoFiles.Add($rel)
        }
}

# ── Per-file violation collection ──────────────────────────────────────────
# file → list of violation descriptions (for stale-allowlist detection)
$Violations = @{}
$Hits = New-Object System.Collections.Generic.List[string]

function Add-Hit([string]$Message) {
    $Hits.Add($Message)
}

function Add-Violation([string]$File, [string]$Description) {
    if (-not $Violations.ContainsKey($File)) {
        $Violations[$File] = New-Object System.Collections.Generic.List[string]
    }
    $Violations[$File].Add($Description)
}

foreach ($rel in $GoFiles) {
    $path = Join-Path $RepoRoot ($rel -replace '/', '\')
    $lines = Get-Content -LiteralPath $path
    $content = $lines -join "`n"

    # 1. os.Getenv — zero tolerance
    $line = 0
    foreach ($l in $lines) {
        $line++
        if ($l -match "os\.Getenv\(") {
            Add-Hit ("os.Getenv found: {0}:{1}: {2}" -f $rel, $line, $l.Trim())
            Add-Violation $rel "os.Getenv"
        }
    }

    # 2. bare &http.Client{ — allowlist only
    $line = 0
    foreach ($l in $lines) {
        $line++
        if ($l -match "&http\.Client\{") {
            Add-Violation $rel "bare &http.Client{"
            if (-not $Allowlist.ContainsKey($rel)) {
                Add-Hit ("bare &http.Client{{ found: {0}:{1}: {2}" -f $rel, $line, $l.Trim())
            }
        }
    }

    # 3. io.ReadAll( without io.LimitReader( on the same line — body cap
    $line = 0
    foreach ($l in $lines) {
        $line++
        if ($l -match "io\.ReadAll\(" -and $l -notmatch "io\.LimitReader\(") {
            Add-Violation $rel "io.ReadAll without io.LimitReader"
            if (-not $Allowlist.ContainsKey($rel)) {
                Add-Hit ("unbounded response read (no io.LimitReader): {0}:{1}: {2}" -f $rel, $line, $l.Trim())
            }
        }
    }

    # 4. http.Get/Post/Head package helpers — implicit clients
    $line = 0
    foreach ($l in $lines) {
        $line++
        if ($l -match "http\.(Get|Post|Head)\(") {
            Add-Violation $rel "http.Get/Post/Head"
            if (-not $Allowlist.ContainsKey($rel)) {
                Add-Hit ("implicit package-level client: {0}:{1}: {2}" -f $rel, $line, $l.Trim())
            }
        }
    }

    # 5. unbudgeted retry loops in HTTP-carrying files
    $filePerformsHTTP = $content -match "http\.(Client|NewRequest|Get|Post|Head)|\.Do\(req"
    $fileHasBudget = $content -match "udget"
    if ($filePerformsHTTP -and -not $fileHasBudget) {
        $line = 0
        foreach ($l in $lines) {
            $line++
            if ($l -match "for\s+attempt\s*:=\s*0;") {
                Add-Violation $rel "unbudgeted retry loop"
                if (-not $Allowlist.ContainsKey($rel)) {
                    Add-Hit ("retry loop without a retry budget: {0}:{1}: {2}" -f $rel, $line, $l.Trim())
                }
            }
        }
    }
}

# ── Emit findings ──────────────────────────────────────────────────────────
if ($Hits.Count -eq 0) {
    Pass "no outbound client / config hygiene violations in scan scope"
} else {
    foreach ($hit in $Hits) {
        Fail $hit
    }
    Write-Host "  #1549/#1564: config must be injected at the composition root; clients must come from purpose-built ports/packages. Add to the allowlist only as a tracked exception with an issue." -ForegroundColor Yellow
}

# ── Allowlist hygiene ──────────────────────────────────────────────────────
foreach ($err in $AllowlistErrors) {
    Fail $err
}

foreach ($entryPath in $Allowlist.Keys) {
    $abs = Join-Path $RepoRoot ($entryPath -replace '/', '\')
    if (-not (Test-Path -LiteralPath $abs)) {
        Fail "stale allowlist entry — file no longer exists: $entryPath"
        continue
    }
    $hasViolation = $Violations.ContainsKey($entryPath) -and $Violations[$entryPath].Count -gt 0
    if (-not $hasViolation) {
        Fail "stale allowlist entry — '$entryPath' has no violations; the allowlist may only shrink (remove it)"
    }
}

# ── Summary ────────────────────────────────────────────────────────────────
Write-Host ""
if ($Failed -gt 0) {
    Write-Host "Outbound client hygiene: $Failed FAIL, $Passed pass" -ForegroundColor Red
    exit 1
}
Write-Host "Outbound client hygiene: $Passed pass" -ForegroundColor Green
