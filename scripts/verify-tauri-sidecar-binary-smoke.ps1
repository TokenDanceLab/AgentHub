param(
    [string]$RepoRoot = ".",
    [string]$TargetTriple = "x86_64-pc-windows-msvc",
    [switch]$SkipExecutableProbe
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path $RepoRoot).Path

function Step([string]$Message) {
    Write-Host "`n>>> $Message" -ForegroundColor Cyan
}

function Pass([string]$Message) {
    Write-Host "PASS: $Message" -ForegroundColor Green
}

function Fail([string]$Message) {
    Write-Host "FAIL: $Message" -ForegroundColor Red
    exit 1
}

function Assert-True {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) {
        Fail $Message
    }
    Pass $Message
}

function Read-Json([string]$RelativePath) {
    Get-Content (Join-Path $RepoRoot $RelativePath) -Raw -Encoding UTF8 | ConvertFrom-Json
}

function Convert-ToRepoRelativePath([string]$Path) {
    $full = [System.IO.Path]::GetFullPath($Path)
    $repoFull = [System.IO.Path]::GetFullPath($RepoRoot).TrimEnd([char[]]@('\', '/'))
    $prefix = $repoFull + [System.IO.Path]::DirectorySeparatorChar
    if (-not $full.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        Fail "Path is outside repo worktree: $Path"
    }
    return $full.Substring($prefix.Length)
}

function Assert-GitIgnored([string]$Path, [string]$Label) {
    $relative = Convert-ToRepoRelativePath $Path
    & git -C $RepoRoot check-ignore -q -- $relative
    if ($LASTEXITCODE -ne 0) {
        Fail "$Label is not ignored by Git: $relative"
    }
    Pass "$Label is ignored by Git ($relative)"
}

function Get-TauriSidecarTarget {
    $tauri = Read-Json "app\desktop\src-tauri\tauri.conf.json"
    $externalBins = @($tauri.bundle.externalBin)
    $edgeBin = $externalBins | Where-Object { [string]$_ -eq "binaries/agenthub-edge" } | Select-Object -First 1
    if (-not $edgeBin) {
        Fail "Tauri config must declare bundle.externalBin entry binaries/agenthub-edge"
    }

    $binRelative = [string]$edgeBin
    $binDir = Split-Path $binRelative -Parent
    $binBase = Split-Path $binRelative -Leaf
    $targetName = "$binBase-$TargetTriple.exe"
    $targetPath = Join-Path (Join-Path (Join-Path $RepoRoot "app\desktop\src-tauri") $binDir) $targetName

    return [pscustomobject]@{
        ExternalBin = $binRelative
        BaseName = $binBase
        TargetName = $targetName
        TargetPath = $targetPath
        RelativeTargetPath = "app/desktop/src-tauri/$binDir/$targetName"
    }
}

function Test-PackageReadinessPrerequisites {
    $required = @(
        "scripts\verify-tauri-package-readiness.ps1",
        ".github\workflows\release.yml",
        ".github\workflows\release-readiness.yml",
        "app\desktop\package.json",
        "app\desktop\src-tauri\Cargo.toml",
        "app\desktop\src-tauri\Cargo.lock",
        "docs\governance\governance-execution.md"
    )

    foreach ($relative in $required) {
        if (-not (Test-Path -LiteralPath (Join-Path $RepoRoot $relative))) {
            return $false
        }
    }

    return $true
}

function Invoke-PackageReadinessGate {
    if (-not (Test-PackageReadinessPrerequisites)) {
        Write-Host "INFO: full package readiness prerequisites are absent; direct sidecar gate remains strict." -ForegroundColor Yellow
        return
    }

    Step "Strict package readiness sidecar gate"
    & (Join-Path $RepoRoot "scripts\verify-tauri-package-readiness.ps1") -RepoRoot $RepoRoot -RequireBundledSidecar
    if ($LASTEXITCODE -ne 0) {
        Fail "verify-tauri-package-readiness.ps1 -RequireBundledSidecar failed"
    }
}

function Invoke-ExecutableProbe([string]$Path) {
    if ($SkipExecutableProbe) {
        Pass "executable probe skipped by caller"
        return
    }

    Step "Sidecar executable information probe"
    $oldErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $output = & $Path --help 2>&1 | Out-String
        $exitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $oldErrorActionPreference
    }
    $looksLikeHelp = $output -match "Usage of agenthub-edge|agenthub-edge|listen address|runner profile"
    Assert-True (($exitCode -eq 0 -or $exitCode -eq 2) -and $looksLikeHelp) "sidecar --help returns executable information without starting Edge"
}

$target = Get-TauriSidecarTarget

Step "Tauri sidecar binary placement"
Assert-True ($target.ExternalBin -eq "binaries/agenthub-edge") "Tauri config uses the Local Edge sidecar basename binaries/agenthub-edge"
Assert-True ($target.TargetName -eq "agenthub-edge-x86_64-pc-windows-msvc.exe") "Windows sidecar filename matches Tauri target triple"
Assert-GitIgnored $target.TargetPath "Windows bundled Local Edge sidecar"

if (-not (Test-Path -LiteralPath $target.TargetPath -PathType Leaf)) {
    Fail "Windows bundled Local Edge sidecar blocker: required file is missing ($($target.RelativeTargetPath))"
}

Assert-True ((Get-Item -LiteralPath $target.TargetPath).Length -gt 0) "Windows bundled Local Edge sidecar is non-empty"
Invoke-ExecutableProbe $target.TargetPath
Invoke-PackageReadinessGate

Write-Host "`nTauri sidecar binary smoke OK" -ForegroundColor Green
