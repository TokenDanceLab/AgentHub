param(
    [string]$RepoRoot = ".",
    [string]$SourceBinary = "",
    [string]$TargetTriple = "x86_64-pc-windows-msvc",
    [switch]$NoBuild,
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path $RepoRoot).Path
$ExpectedWindowsSidecarName = "agenthub-edge-x86_64-pc-windows-msvc.exe"

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
    if ($TargetTriple -eq "x86_64-pc-windows-msvc" -and $targetName -ne $ExpectedWindowsSidecarName) {
        Fail "Unexpected Windows sidecar name: $targetName"
    }
    $targetDir = Join-Path (Join-Path $RepoRoot "app\desktop\src-tauri") $binDir
    $targetPath = Join-Path $targetDir $targetName

    return [pscustomobject]@{
        ExternalBin = $binRelative
        BaseName = $binBase
        TargetName = $targetName
        TargetDir = $targetDir
        TargetPath = $targetPath
        RelativeTargetPath = "app/desktop/src-tauri/$binDir/$targetName"
    }
}

function Invoke-CheckedBuild {
    param([string]$OutputPath)

    Step "Build Windows Local Edge sidecar"
    $oldEnv = @{
        GOOS = [Environment]::GetEnvironmentVariable("GOOS", "Process")
        GOARCH = [Environment]::GetEnvironmentVariable("GOARCH", "Process")
        CGO_ENABLED = [Environment]::GetEnvironmentVariable("CGO_ENABLED", "Process")
    }

    [Environment]::SetEnvironmentVariable("GOOS", "windows", "Process")
    [Environment]::SetEnvironmentVariable("GOARCH", "amd64", "Process")
    [Environment]::SetEnvironmentVariable("CGO_ENABLED", "0", "Process")

    Push-Location (Join-Path $RepoRoot "edge-server")
    try {
        & go build -ldflags="-s -w" -o $OutputPath .\cmd\agenthub-edge\
        $exitCode = $LASTEXITCODE
    }
    finally {
        Pop-Location
        foreach ($key in $oldEnv.Keys) {
            [Environment]::SetEnvironmentVariable($key, $oldEnv[$key], "Process")
        }
    }

    if ($exitCode -ne 0) {
        Fail "go build for Windows Local Edge sidecar failed with exit code $exitCode"
    }
    Pass "Windows Local Edge sidecar build completed"
}

$target = Get-TauriSidecarTarget
$defaultSource = Join-Path $RepoRoot "dist\agenthub-edge-windows-amd64.exe"
$sourcePath = if ([string]::IsNullOrWhiteSpace($SourceBinary)) { $defaultSource } else {
    if ([System.IO.Path]::IsPathRooted($SourceBinary)) {
        $SourceBinary
    } else {
        Join-Path $RepoRoot $SourceBinary
    }
}
$sourcePath = [System.IO.Path]::GetFullPath($sourcePath)

Step "Tauri sidecar placement plan"
Write-Host "externalBin: $($target.ExternalBin)"
Write-Host "source:      $sourcePath"
Write-Host "target:      $($target.TargetPath)"
Write-Host "target name: $($target.TargetName)"

Assert-GitIgnored $target.TargetPath "Tauri Windows sidecar binary"
Assert-GitIgnored $sourcePath "Windows sidecar intermediate"

if ($DryRun) {
    Write-Host "`nTauri sidecar local prepare dry-run OK" -ForegroundColor Green
    return
}

if (-not $NoBuild) {
    New-Item -ItemType Directory (Split-Path $sourcePath -Parent) -Force | Out-Null
    Invoke-CheckedBuild $sourcePath
} else {
    Assert-True (Test-Path -LiteralPath $sourcePath -PathType Leaf) "NoBuild source sidecar exists"
}

Assert-True ((Get-Item -LiteralPath $sourcePath).Length -gt 0) "Windows sidecar source is non-empty"

Step "Place Tauri external sidecar"
New-Item -ItemType Directory $target.TargetDir -Force | Out-Null
Copy-Item -LiteralPath $sourcePath -Destination $target.TargetPath -Force
Assert-True (Test-Path -LiteralPath $target.TargetPath -PathType Leaf) "Tauri external sidecar exists at Windows target triple path"
Assert-True ((Get-Item -LiteralPath $target.TargetPath).Length -gt 0) "Tauri external sidecar is non-empty"

Write-Host "`nTauri sidecar local prepare OK" -ForegroundColor Green
