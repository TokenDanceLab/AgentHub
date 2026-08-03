#!/usr/bin/env pwsh
<#
Behavior-level self-tests for the root Agent/progress entrypoint contract (#1577).
All mutations happen in an isolated detached Git worktree. The caller worktree
status is snapshotted before and after the suite.
#>

$ErrorActionPreference = "Stop"
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..\..")
$FixtureRoot = Join-Path ([IO.Path]::GetTempPath()) ("agenthub-doc-entrypoints-" + [guid]::NewGuid().ToString("N"))
$SourceVerifier = Join-Path $RepoRoot "scripts/verify/verify-doc-ssot.ps1"
$FixtureVerifier = Join-Path $FixtureRoot "scripts/verify/verify-doc-ssot.ps1"
$InitialStatus = @(& git -C $RepoRoot status --porcelain=v1 --untracked-files=all)
$Passed = 0

function Pass([string]$Message) {
    $script:Passed++
    Write-Host "  PASS  $Message" -ForegroundColor Green
}

function Fail([string]$Message) {
    throw "doc entrypoint self-test failed: $Message"
}

function Invoke-DocVerifier {
    Push-Location $FixtureRoot
    try {
        $output = @(& pwsh -NoProfile -File $FixtureVerifier 2>&1)
        return @{
            ExitCode = $LASTEXITCODE
            Output = ($output -join "`n")
        }
    } finally {
        Pop-Location
    }
}

function Assert-FailureCode([hashtable]$Result, [string]$ExpectedCode, [string]$CaseName) {
    if ($Result.ExitCode -eq 0) {
        Fail "$CaseName was accepted"
    }
    $pattern = '\[' + [regex]::Escape($ExpectedCode) + '\]'
    if ($Result.Output -notmatch $pattern) {
        Fail "$CaseName emitted the wrong behavior code; expected ${ExpectedCode}:`n$($Result.Output)"
    }
}

function Assert-ForbiddenRootFile([string]$RelativePath) {
    $path = Join-Path $FixtureRoot $RelativePath
    if (Test-Path -LiteralPath $path) {
        Fail "precondition failed: fixture path already exists: $RelativePath"
    }
    try {
        [IO.File]::WriteAllText($path, "temporary negative fixture`n", [Text.UTF8Encoding]::new($false))
        $result = Invoke-DocVerifier
        Assert-FailureCode $result "DOC-ROOT-ENTRYPOINT" $RelativePath
        Pass "$RelativePath is rejected as a parallel root entrypoint"
    } finally {
        Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
    }
}

function Assert-ReadmeOwnerLinkRequired {
    $path = Join-Path $FixtureRoot "README.md"
    $originalBytes = [IO.File]::ReadAllBytes($path)
    $originalText = [Text.Encoding]::UTF8.GetString($originalBytes)
    $requiredPattern = '\[[^\]]+\]\(AGENTS\.md\)'
    if ($originalText -notmatch $requiredPattern) {
        Fail "README fixture precondition missing AGENTS.md link"
    }

    try {
        $mutated = [regex]::Replace($originalText, $requiredPattern, 'AGENTS.md (link removed)', 1)
        [IO.File]::WriteAllText($path, $mutated, [Text.UTF8Encoding]::new($false))
        $result = Invoke-DocVerifier
        Assert-FailureCode $result "DOC-README-ENTRYPOINT" "README without AGENTS.md owner link"
        Pass "README must retain the AGENTS.md owner link"
    } finally {
        [IO.File]::WriteAllBytes($path, $originalBytes)
    }

    $restoredBytes = [IO.File]::ReadAllBytes($path)
    $beforeHash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($originalBytes))
    $afterHash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($restoredBytes))
    if ($beforeHash -ne $afterHash) {
        Fail "README fixture bytes were not restored exactly"
    }
}

try {
    & git -C $RepoRoot worktree add --quiet --detach $FixtureRoot HEAD
    if ($LASTEXITCODE -ne 0) {
        Fail "could not create isolated worktree fixture"
    }

    # Local pre-commit runs may have the #1577 changes unstaged. Overlay only
    # the entrypoint source files needed by this behavior suite. In CI, HEAD
    # already contains the same bytes.
    Copy-Item -LiteralPath $SourceVerifier -Destination $FixtureVerifier -Force
    Copy-Item -LiteralPath (Join-Path $RepoRoot "AGENTS.md") -Destination (Join-Path $FixtureRoot "AGENTS.md") -Force
    Copy-Item -LiteralPath (Join-Path $RepoRoot "README.md") -Destination (Join-Path $FixtureRoot "README.md") -Force
    if (-not (Test-Path -LiteralPath (Join-Path $RepoRoot "PROGRESS.md"))) {
        Remove-Item -LiteralPath (Join-Path $FixtureRoot "PROGRESS.md") -Force -ErrorAction SilentlyContinue
    }

    $positive = Invoke-DocVerifier
    if ($positive.ExitCode -ne 0) {
        Fail "positive isolated fixture failed:`n$($positive.Output)"
    }
    Pass "positive isolated entrypoint fixture"

    Assert-ForbiddenRootFile "PROGRESS.md"
    Assert-ForbiddenRootFile "CODEX.md"
    Assert-ReadmeOwnerLinkRequired

    $final = Invoke-DocVerifier
    if ($final.ExitCode -ne 0) {
        Fail "verifier did not recover after fixture cleanup:`n$($final.Output)"
    }
    Pass "isolated doc SSOT verifier recovers after fixture cleanup"
} finally {
    # Remove only this suite's fixture. Never prune unrelated repository
    # worktrees from a focused verifier self-test.
    & git -C $RepoRoot worktree remove --force $FixtureRoot 2>$null
    if (Test-Path -LiteralPath $FixtureRoot) {
        Remove-Item -LiteralPath $FixtureRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}

$FinalStatus = @(& git -C $RepoRoot status --porcelain=v1 --untracked-files=all)
if (($InitialStatus -join "`n") -ne ($FinalStatus -join "`n")) {
    Fail "caller worktree status changed during self-test"
}
Pass "caller worktree remains unchanged"

Write-Host "Doc entrypoint self-tests: $Passed pass" -ForegroundColor Green
exit 0
