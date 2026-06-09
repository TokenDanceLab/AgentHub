param(
    [string]$RepoRoot = "."
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path $RepoRoot).Path

function Assert-True {
    param(
        [bool]$Condition,
        [string]$Message,
        [string]$Details = ""
    )

    if (-not $Condition) {
        Write-Host "FAIL: $Message" -ForegroundColor Red
        if ($Details) {
            Write-Host $Details
        }
        exit 1
    }

    Write-Host "PASS: $Message" -ForegroundColor Green
}

function Read-Text([string]$RelativePath) {
    Get-Content (Join-Path $RepoRoot $RelativePath) -Raw -Encoding UTF8
}

function Invoke-Smoke {
    param(
        [string[]]$Arguments,
        [string]$WorkingDirectory = $RepoRoot
    )

    $scriptPath = Join-Path $RepoRoot "scripts\verify-tauri-sidecar-binary-smoke.ps1"
    Push-Location $WorkingDirectory
    try {
        $output = & powershell -NoProfile -ExecutionPolicy Bypass -File $scriptPath @Arguments 2>&1 | Out-String
        $exitCode = $LASTEXITCODE
    }
    finally {
        Pop-Location
    }

    return [pscustomobject]@{
        ExitCode = $exitCode
        Output = $output
    }
}

function Invoke-Prepare {
    param(
        [string[]]$Arguments,
        [string]$WorkingDirectory = $RepoRoot
    )

    $scriptPath = Join-Path $RepoRoot "scripts\prepare-tauri-sidecar-local.ps1"
    Push-Location $WorkingDirectory
    try {
        $output = & powershell -NoProfile -ExecutionPolicy Bypass -File $scriptPath @Arguments 2>&1 | Out-String
        $exitCode = $LASTEXITCODE
    }
    finally {
        Pop-Location
    }

    return [pscustomobject]@{
        ExitCode = $exitCode
        Output = $output
    }
}

function Copy-FixtureFile([string]$RelativePath, [string]$TempRoot) {
    $source = Join-Path $RepoRoot $RelativePath
    $target = Join-Path $TempRoot $RelativePath
    New-Item -ItemType Directory (Split-Path $target -Parent) -Force | Out-Null
    Copy-Item -LiteralPath $source -Destination $target -Force
}

function New-SidecarFixtureRepo {
    $tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) "agenthub-tauri-sidecar-binary-$(New-Guid)"
    New-Item -ItemType Directory $tempRoot -Force | Out-Null

    foreach ($relativePath in @(
        ".gitignore",
        "app\desktop\src-tauri\tauri.conf.json",
        "edge-server\cmd\agenthub-edge\main.go"
    )) {
        Copy-FixtureFile $relativePath $tempRoot
    }

    & git -C $tempRoot init -q
    & git -C $tempRoot -c user.name="AgentHub Test" -c user.email="agenthub-test@example.invalid" add .
    & git -C $tempRoot -c user.name="AgentHub Test" -c user.email="agenthub-test@example.invalid" commit -q -m "fixture"
    return $tempRoot
}

function Get-HostExecutable {
    $command = Get-Command powershell -ErrorAction SilentlyContinue
    if ($command -and (Test-Path -LiteralPath $command.Source -PathType Leaf)) {
        return $command.Source
    }

    $pwsh = Get-Command pwsh -ErrorAction SilentlyContinue
    if ($pwsh -and (Test-Path -LiteralPath $pwsh.Source -PathType Leaf)) {
        return $pwsh.Source
    }

    throw "No PowerShell executable fixture is available"
}

$preparePath = Join-Path $RepoRoot "scripts\prepare-tauri-sidecar-local.ps1"
$smokePath = Join-Path $RepoRoot "scripts\verify-tauri-sidecar-binary-smoke.ps1"
Assert-True (Test-Path $preparePath) "local sidecar prepare script exists"
Assert-True (Test-Path $smokePath) "sidecar binary smoke script exists"

$prepareText = Read-Text "scripts\prepare-tauri-sidecar-local.ps1"
$smokeText = Read-Text "scripts\verify-tauri-sidecar-binary-smoke.ps1"
Assert-True ($prepareText -match "NoBuild" -and $prepareText -match "DryRun" -and $prepareText -match "go build") "prepare script supports NoBuild, DryRun, and Go build placement"
Assert-True ($prepareText -match "agenthub-edge-x86_64-pc-windows-msvc\.exe" -and $prepareText -match "binaries/agenthub-edge") "prepare script derives the Windows Tauri sidecar placement"
Assert-True ($prepareText -match "check-ignore" -and $smokeText -match "check-ignore") "prepare and smoke scripts verify sidecar binary stays ignored"
Assert-True ($smokeText -match "RequireBundledSidecar" -and $smokeText -match "verify-tauri-package-readiness\.ps1") "smoke script preserves strict package readiness semantics"
Assert-True ($smokeText -notmatch "TAURI_SIGNING_PRIVATE_KEY|softprops/action-gh-release|gh release upload|notarytool|stapler") "smoke script does not sign, notarize, or upload release artifacts"

$fixture = New-SidecarFixtureRepo
try {
    $missing = Invoke-Smoke @("-RepoRoot", $fixture, "-SkipExecutableProbe") $fixture
    Assert-True ($missing.ExitCode -ne 0) "sidecar smoke fails when the Tauri sidecar binary is missing" $missing.Output
    Assert-True ($missing.Output -match "Windows bundled Local Edge sidecar|missing|blocker") "missing sidecar failure names the strict sidecar blocker" $missing.Output

    $sourceExe = Join-Path $fixture "dist\agenthub-edge-windows-amd64.exe"
    New-Item -ItemType Directory (Split-Path $sourceExe -Parent) -Force | Out-Null
    Copy-Item -LiteralPath (Get-HostExecutable) -Destination $sourceExe -Force

    $dryRun = Invoke-Prepare @("-RepoRoot", $fixture, "-NoBuild", "-DryRun") $fixture
    Assert-True ($dryRun.ExitCode -eq 0) "prepare dry-run succeeds without copying a binary" $dryRun.Output
    Assert-True (-not (Test-Path (Join-Path $fixture "app\desktop\src-tauri\binaries\agenthub-edge-x86_64-pc-windows-msvc.exe"))) "prepare dry-run does not create the Tauri sidecar binary"

    $prepare = Invoke-Prepare @("-RepoRoot", $fixture, "-NoBuild") $fixture
    Assert-True ($prepare.ExitCode -eq 0) "prepare script copies a prebuilt sidecar in NoBuild mode" $prepare.Output

    $targetExe = Join-Path $fixture "app\desktop\src-tauri\binaries\agenthub-edge-x86_64-pc-windows-msvc.exe"
    Assert-True (Test-Path $targetExe) "prepared sidecar exists at the Tauri Windows target triple path"
    Assert-True ((Get-Item $targetExe).Length -gt 0) "prepared sidecar is non-empty"

    $prepared = Invoke-Smoke @("-RepoRoot", $fixture, "-SkipExecutableProbe") $fixture
    Assert-True ($prepared.ExitCode -eq 0) "sidecar smoke passes after prepare places the binary" $prepared.Output
    Assert-True ($prepared.Output -match "Tauri sidecar binary smoke OK") "positive smoke reports success" $prepared.Output
}
finally {
    Remove-Item -Recurse -Force $fixture -ErrorAction SilentlyContinue
}

Write-Host "`nTauri sidecar binary smoke tests OK" -ForegroundColor Green
