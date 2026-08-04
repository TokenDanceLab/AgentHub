#!/usr/bin/env pwsh
<#
Negative self-tests for verify-quality-debt-ratchet.ps1.

Each case runs against an isolated minimal repository fixture. A negative case
passes only when the verifier exits non-zero for the expected policy reason.
#>

$ErrorActionPreference = "Stop"
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..\..")
$VerifierRelative = "scripts/verify/verify-quality-debt-ratchet.ps1"
$BaselineRelative = "scripts/verify/quality-debt-baseline.json"
$Passed = 0

function Fail([string]$Message) {
    throw "quality-debt self-test failed: $Message"
}

function Pass([string]$Message) {
    $script:Passed++
    Write-Host "  PASS  $Message" -ForegroundColor Green
}

function Write-Utf8NoBom([string]$Path, [string]$Content) {
    [IO.File]::WriteAllText($Path, $Content, [Text.UTF8Encoding]::new($false))
}

function Copy-RepoFile([string]$FixtureRoot, [string]$RelativePath) {
    $source = Join-Path $RepoRoot $RelativePath
    $destination = Join-Path $FixtureRoot $RelativePath
    $parent = Split-Path -Parent $destination
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
    Copy-Item -LiteralPath $source -Destination $destination
}

$SyntheticExclusionPath = 'internal/adapters/parser_ndjson\.go'

function New-QualityDebtFixture {
    $fixture = Join-Path ([IO.Path]::GetTempPath()) ("agenthub-quality-debt-" + [guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Force -Path $fixture | Out-Null

    foreach ($relative in @(
        ".github/workflows/checks.yml",
        "hub-server/.golangci.yml",
        "edge-server/.golangci.yml",
        $VerifierRelative,
        $BaselineRelative
    )) {
        Copy-RepoFile $fixture $relative
    }

    $baseline = Get-Content -Raw -LiteralPath (Join-Path $fixture $BaselineRelative) | ConvertFrom-Json -AsHashtable

    if (@($baseline.golangci_exclusions).Count -eq 0) {
        # The repository baseline no longer carries any golangci exclusions
        # (all complexity debt repaid). Negative cases below mutate the first
        # exclusion row, so inject a self-consistent synthetic entry: the
        # baseline row, the matching .golangci.yml rule, and the real Go
        # source file must all exist for the verifier to accept the fixture.
        $baseline.golangci_exclusions = @([ordered]@{
            file = 'edge-server/.golangci.yml'
            path = $SyntheticExclusionPath
            linters = @('cyclop', 'gocognit', 'gocyclo')
            complexity = [ordered]@{ gocognit = 99; gocyclo = 99 }
            issue = 1569
            owner = 'test-owner'
            introduced_at = '2026-08-04'
            review_by = '2026-10-01'
            reason = 'synthetic fixture entry for negative self-tests; not a real repository gate'
        })
        Write-Utf8NoBom (Join-Path $fixture $BaselineRelative) ($baseline | ConvertTo-Json -Depth 20)

        $configPath = Join-Path $fixture "edge-server/.golangci.yml"
        $config = Get-Content -Raw -LiteralPath $configPath
        $config = $config.Replace(
            "    rules:`n",
            "    rules:`n      - linters:`n          - cyclop`n          - gocognit`n          - gocyclo`n        path: $SyntheticExclusionPath`n"
        )
        Write-Utf8NoBom $configPath $config
    }

    foreach ($entry in @($baseline.golangci_exclusions)) {
        $module = if ($entry.file -match '^hub-server') { "hub-server" } else { "edge-server" }
        $relativeGoPath = $entry.path.Replace('\.', '.')
        Copy-RepoFile $fixture (Join-Path $module $relativeGoPath)
    }

    return $fixture
}

function Invoke-FixtureVerifier(
    [string]$FixtureRoot,
    [string]$BaseBaselinePath = "",
    [switch]$RunComplexity
) {
    $arguments = @(
        "-NoProfile",
        "-File", (Join-Path $FixtureRoot $VerifierRelative),
        "-RepoRootPath", $FixtureRoot,
        "-BaselinePath", (Join-Path $FixtureRoot $BaselineRelative)
    )
    if (-not $RunComplexity) {
        $arguments += "-SkipComplexity"
    }
    if ($BaseBaselinePath) {
        $arguments += @("-BaseBaselinePath", $BaseBaselinePath)
    } else {
        $arguments += "-SkipHistoricalRatchet"
    }

    $output = & pwsh @arguments 2>&1
    return [pscustomobject]@{
        ExitCode = $LASTEXITCODE
        Output = ($output -join "`n")
    }
}

function Invoke-PositiveCase {
    $fixture = New-QualityDebtFixture
    try {
        $result = Invoke-FixtureVerifier $fixture
        if ($result.ExitCode -ne 0) {
            Fail "positive fixture unexpectedly failed:`n$($result.Output)"
        }
        Pass "positive fixture"
    } finally {
        Remove-Item -LiteralPath $fixture -Recurse -Force -ErrorAction SilentlyContinue
    }
}

function Invoke-ComplexityExecutionCases {
    $fixture = New-QualityDebtFixture
    try {
        $result = Invoke-FixtureVerifier -FixtureRoot $fixture -RunComplexity
        if ($result.ExitCode -ne 0) {
            Fail "in-budget complexity fixture unexpectedly failed:`n$($result.Output)"
        }
        Pass "real complexity tools accept in-budget fixture"

        $baselinePath = Join-Path $fixture $BaselineRelative
        $baseline = Get-Content -Raw -LiteralPath $baselinePath | ConvertFrom-Json -AsHashtable
        $baseline.golangci_exclusions[0].complexity.gocognit = 0
        Write-Utf8NoBom $baselinePath ($baseline | ConvertTo-Json -Depth 20)

        $result = Invoke-FixtureVerifier -FixtureRoot $fixture -RunComplexity
        if ($result.ExitCode -eq 0) {
            Fail "exceeded complexity fixture unexpectedly passed"
        }
        if ($result.Output -notmatch '\[QDR-COMPLEXITY\]') {
            Fail "exceeded complexity fixture did not emit QDR-COMPLEXITY:`n$($result.Output)"
        }
        Pass "real complexity tools reject exceeded budget"
    } finally {
        Remove-Item -LiteralPath $fixture -Recurse -Force -ErrorAction SilentlyContinue
    }
}

function Invoke-NegativeCase(
    [string]$Name,
    [scriptblock]$Mutate,
    [string]$ExpectedCode,
    [switch]$CompareWithBase
) {
    $fixture = New-QualityDebtFixture
    try {
        $baseBaselinePath = ""
        if ($CompareWithBase) {
            $baseBaselinePath = Join-Path $fixture "base-quality-debt-baseline.json"
            Copy-Item -LiteralPath (Join-Path $fixture $BaselineRelative) -Destination $baseBaselinePath
        }

        & $Mutate $fixture
        $result = Invoke-FixtureVerifier $fixture $baseBaselinePath
        if ($result.ExitCode -eq 0) {
            Fail "$Name unexpectedly passed"
        }
        $codePattern = '\[' + [regex]::Escape($ExpectedCode) + '\]'
        if ($result.Output -notmatch $codePattern) {
            Fail "$Name failed with the wrong behavior code; expected ${ExpectedCode}:`n$($result.Output)"
        }
        Pass $Name
    } finally {
        Remove-Item -LiteralPath $fixture -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Invoke-PositiveCase
Invoke-ComplexityExecutionCases

Invoke-NegativeCase "unregistered soft gate" {
    param($fixture)
    $path = Join-Path $fixture ".github/workflows/checks.yml"
    $text = Get-Content -Raw -LiteralPath $path
    $text = [regex]::Replace(
        $text,
        '(?m)^      - name: Build\r?\n',
        "      - name: Build`n        continue-on-error: true`n",
        1
    )
    Write-Utf8NoBom $path $text
} 'QDR-SOFT-GATE-UNREGISTERED'

Invoke-NegativeCase "directory exclusion widening" {
    param($fixture)
    $configPath = Join-Path $fixture "edge-server/.golangci.yml"
    $config = Get-Content -Raw -LiteralPath $configPath
    $config = $config.Replace('path: internal/adapters/parser_ndjson\.go', 'path: internal/adapters/.*\.go')
    Write-Utf8NoBom $configPath $config

    $baselinePath = Join-Path $fixture $BaselineRelative
    $baseline = Get-Content -Raw -LiteralPath $baselinePath | ConvertFrom-Json -AsHashtable
    $baseline.golangci_exclusions[0].path = 'internal/adapters/.*\.go'
    Write-Utf8NoBom $baselinePath ($baseline | ConvertTo-Json -Depth 20)
} 'QDR-SCHEMA'

Invoke-NegativeCase "linter-set drift" {
    param($fixture)
    $path = Join-Path $fixture "edge-server/.golangci.yml"
    $text = Get-Content -Raw -LiteralPath $path
    $pattern = '(?ms)(      - linters:\r?\n          - cyclop\r?\n          - gocognit\r?\n          - gocyclo\r?\n)(        path: internal/adapters/parser_ndjson\\\.go)'
    $text = [regex]::Replace($text, $pattern, {
        param($match)
        return $match.Groups[1].Value + "          - errcheck`n" + $match.Groups[2].Value
    }, 1)
    Write-Utf8NoBom $path $text
} 'QDR-LINTER-MISMATCH'

Invoke-NegativeCase "missing introduced_at" {
    param($fixture)
    $path = Join-Path $fixture $BaselineRelative
    $baseline = Get-Content -Raw -LiteralPath $path | ConvertFrom-Json -AsHashtable
    $baseline.soft_gates[0].Remove('introduced_at')
    Write-Utf8NoBom $path ($baseline | ConvertTo-Json -Depth 20)
} 'QDR-SCHEMA'

Invoke-NegativeCase "missing review_by" {
    param($fixture)
    $path = Join-Path $fixture $BaselineRelative
    $baseline = Get-Content -Raw -LiteralPath $path | ConvertFrom-Json -AsHashtable
    $baseline.soft_gates[0].Remove('review_by')
    Write-Utf8NoBom $path ($baseline | ConvertTo-Json -Depth 20)
} 'QDR-SCHEMA'

Invoke-NegativeCase "path traversal exclusion" {
    param($fixture)
    $configPath = Join-Path $fixture "edge-server/.golangci.yml"
    $config = Get-Content -Raw -LiteralPath $configPath
    $config = $config.Replace('path: internal/adapters/parser_ndjson\.go', 'path: ../hub-server/internal/app/events\.go')
    Write-Utf8NoBom $configPath $config

    $baselinePath = Join-Path $fixture $BaselineRelative
    $baseline = Get-Content -Raw -LiteralPath $baselinePath | ConvertFrom-Json -AsHashtable
    $baseline.golangci_exclusions[0].path = '../hub-server/internal/app/events\.go'
    Write-Utf8NoBom $baselinePath ($baseline | ConvertTo-Json -Depth 20)
} 'QDR-SCHEMA'

Invoke-NegativeCase "non-numeric issue owner" {
    param($fixture)
    $path = Join-Path $fixture $BaselineRelative
    $baseline = Get-Content -Raw -LiteralPath $path | ConvertFrom-Json -AsHashtable
    $baseline.soft_gates[0].issue = '1571'
    Write-Utf8NoBom $path ($baseline | ConvertTo-Json -Depth 20)
} 'QDR-SCHEMA'

Invoke-NegativeCase "zombie baseline entry" {
    param($fixture)
    $path = Join-Path $fixture $BaselineRelative
    $baseline = Get-Content -Raw -LiteralPath $path | ConvertFrom-Json -AsHashtable
    $baseline.soft_gates += [ordered]@{
        location = 'fake-job: Fake step'
        kind = 'continue-on-error'
        reason = 'negative fixture'
        issue = 1536
        owner = 'test-owner'
        introduced_at = '2026-08-03'
        review_by = '2026-08-04'
    }
    Write-Utf8NoBom $path ($baseline | ConvertTo-Json -Depth 20)
} 'QDR-SOFT-GATE-ZOMBIE'

Invoke-NegativeCase "runtime dependency mutation" {
    param($fixture)
    $path = Join-Path $fixture ".github/workflows/checks.yml"
    Add-Content -LiteralPath $path -Value @"

  dependency-mutation-fixture:
    runs-on: ubuntu-latest
    steps:
      - run: go get example.com/forbidden
"@
} 'QDR-RUNTIME-MUTATION'

Invoke-NegativeCase "complexity budget increase" {
    param($fixture)
    $path = Join-Path $fixture $BaselineRelative
    $baseline = Get-Content -Raw -LiteralPath $path | ConvertFrom-Json -AsHashtable
    $baseline.golangci_exclusions[0].complexity.gocognit = [int]$baseline.golangci_exclusions[0].complexity.gocognit + 1
    Write-Utf8NoBom $path ($baseline | ConvertTo-Json -Depth 20)
} 'QDR-HISTORY-REGRESSION' -CompareWithBase

Invoke-NegativeCase "complexity metric removal" {
    param($fixture)
    $path = Join-Path $fixture $BaselineRelative
    $baseline = Get-Content -Raw -LiteralPath $path | ConvertFrom-Json -AsHashtable
    $baseline.golangci_exclusions[0].complexity.Remove('gocognit')
    Write-Utf8NoBom $path ($baseline | ConvertTo-Json -Depth 20)
} 'QDR-SCHEMA' -CompareWithBase

Invoke-NegativeCase "review deadline extension without reason" {
    param($fixture)
    $path = Join-Path $fixture $BaselineRelative
    $baseline = Get-Content -Raw -LiteralPath $path | ConvertFrom-Json -AsHashtable
    $baseline.soft_gates[0].review_by = '2099-01-01'
    $baseline.soft_gates[0].Remove('extension_reason')
    Write-Utf8NoBom $path ($baseline | ConvertTo-Json -Depth 20)
} 'QDR-HISTORY-REGRESSION' -CompareWithBase

Write-Host ""
Write-Host "Quality-debt ratchet self-test: $Passed pass" -ForegroundColor Green
exit 0
