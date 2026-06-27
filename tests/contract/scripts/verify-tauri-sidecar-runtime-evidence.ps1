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
        if ($Details) { Write-Host $Details }
        exit 1
    }

    Write-Host "PASS: $Message" -ForegroundColor Green
}

function Read-Text([string]$RelativePath) {
    Get-Content (Join-Path $RepoRoot $RelativePath) -Raw -Encoding UTF8
}

function Invoke-Gate {
    param(
        [string[]]$Arguments,
        [string]$WorkingDirectory = $RepoRoot
    )

    $scriptPath = Join-Path $RepoRoot "scripts\verify-tauri-sidecar-runtime-evidence.ps1"
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

function Copy-FixtureFile {
    param(
        [string]$RelativePath,
        [string]$TempRoot
    )

    $source = Join-Path $RepoRoot $RelativePath
    $target = Join-Path $TempRoot $RelativePath
    New-Item -ItemType Directory (Split-Path $target -Parent) -Force | Out-Null
    Copy-Item -LiteralPath $source -Destination $target -Force
}

function New-MinimalRepoFixture {
    $tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) "agenthub-tauri-sidecar-runtime-$([Guid]::NewGuid().ToString('N'))"
    New-Item -ItemType Directory $tempRoot -Force | Out-Null

    foreach ($relativePath in @(
        ".gitignore",
        "app\desktop\package.json",
        "app\desktop\src-tauri\tauri.conf.json",
        "app\desktop\src-tauri\src\edge_manager.rs",
        "app\desktop\src-tauri\src\commands.rs",
        "app\desktop\src-tauri\src\lib.rs",
        "app\desktop\src\platform\desktopPlatform.ts",
        "app\desktop\src\platform\desktopPlatform.test.ts",
        "scripts\verify-tauri-package-readiness.ps1",
        "scripts\verify-tauri-package-dry.ps1",
        "scripts\release\verify-tauri-package-readiness.ps1",
        "scripts\release\verify-tauri-package-dry.ps1",
        "docs\audit\p1-tauri-build-package-evidence.md"
    )) {
        Copy-FixtureFile $relativePath $tempRoot
    }

    & git -C $tempRoot init -q
    return $tempRoot
}

function New-ArtifactRoot {
    param(
        [string]$Version,
        [switch]$OmitPortableSidecar,
        [switch]$BadManifestHash
    )

    $root = Join-Path ([System.IO.Path]::GetTempPath()) "agenthub-tauri-sidecar-artifacts-$([Guid]::NewGuid().ToString('N'))"
    New-Item -ItemType Directory $root -Force | Out-Null

    $setup = Join-Path $root "AgentHub_${Version}_x64-setup.exe"
    [System.IO.File]::WriteAllBytes($setup, [byte[]](1..32))
    [System.IO.File]::WriteAllBytes((Join-Path $root "agenthub-edge-windows-amd64.exe"), [byte[]](33..64))

    $portableDir = Join-Path $root "portable-src"
    New-Item -ItemType Directory $portableDir -Force | Out-Null
    "desktop" | Out-File (Join-Path $portableDir "AgentHub.exe") -Encoding UTF8
    if (-not $OmitPortableSidecar) {
        "edge" | Out-File (Join-Path $portableDir "agenthub-edge.exe") -Encoding UTF8
    }
    "Internal dry-run artifact only. This is not a signed public release." | Out-File (Join-Path $portableDir "README.txt") -Encoding UTF8
    Compress-Archive -Path (Join-Path $portableDir "*") -DestinationPath (Join-Path $root "AgentHub_${Version}_x64-portable.zip") -Force
    Remove-Item -LiteralPath $portableDir -Recurse -Force

    $report = [ordered]@{
        signing = "out-of-scope"
        notarization = "out-of-scope"
        releaseUpload = "out-of-scope"
        stages = [ordered]@{
            sidecar = "passed"
            macosUnsignedDry = "policy_only"
        }
    }
    $report | ConvertTo-Json -Depth 8 | Out-File (Join-Path $root "package-dry-report.json") -Encoding UTF8

    $manifest = Get-ChildItem $root -File |
        Sort-Object Name |
        ForEach-Object {
            [pscustomobject]@{
                name = $_.Name
                bytes = $_.Length
                sha256 = (Get-FileHash $_.FullName -Algorithm SHA256).Hash
            }
        }
    if ($BadManifestHash) {
        $manifest[0].sha256 = "0000000000000000000000000000000000000000000000000000000000000000"
    }
    $manifest | ConvertTo-Json -Depth 4 | Out-File (Join-Path $root "artifact-manifest.json") -Encoding UTF8

    return $root
}

$scriptPath = Join-Path $RepoRoot "scripts\verify-tauri-sidecar-runtime-evidence.ps1"
$scriptImplementationPath = Join-Path $RepoRoot "scripts\release\verify-tauri-sidecar-runtime-evidence.ps1"
Assert-True (Test-Path -LiteralPath $scriptPath) "Tauri sidecar runtime evidence gate exists"
Assert-True (Test-Path -LiteralPath $scriptImplementationPath) "Tauri sidecar runtime evidence gate implementation exists"

$scriptText = Read-Text "scripts\release\verify-tauri-sidecar-runtime-evidence.ps1"
Assert-True ($scriptText -match "EDGE_SIDECAR_NAME" -and $scriptText -match "agenthub-edge") "gate checks sidecar name"
Assert-True ($scriptText -match "app_data_dir" -and $scriptText -match "agenthub-edge") "gate checks app-data SQLite policy"
Assert-True ($scriptText -match "stdout" -and $scriptText -match "stderr" -and $scriptText -match "log") "gate checks Local Edge log paths"
Assert-True ($scriptText -match "CommandEvent::Stdout" -and $scriptText -match "CommandEvent::Stderr") "gate checks sidecar log capture"
Assert-True ($scriptText -match "direct_cli_spawn:\s\*false" -or $scriptText -match "direct_cli_spawn") "gate checks renderer no direct CLI spawn"
Assert-True ($scriptText -match "currentUser") "gate checks current-user installer scope"
Assert-True ($scriptText -match "No allowed workspace directories configured") "gate checks workspace permission fail-closed"
Assert-True ($scriptText -match "run_macos_unsigned_dry_policy" -and $scriptText -match "notarytool" -and $scriptText -match "stapler") "gate checks macOS unsigned/signing boundary"
Assert-True ($scriptText -match "RequireBuiltArtifacts" -and $scriptText -match "agenthub-edge\.exe") "gate can inspect unsigned package artifacts"

$ok = Invoke-Gate @("-RepoRoot", $RepoRoot)
Assert-True ($ok.ExitCode -eq 0) "sidecar runtime evidence gate passes current repository" $ok.Output
Assert-True ($ok.Output -match "Tauri sidecar runtime evidence gate OK") "sidecar runtime evidence gate prints success footer" $ok.Output

$desktopVersion = [string]((Get-Content (Join-Path $RepoRoot "app\desktop\package.json") -Raw -Encoding UTF8 | ConvertFrom-Json).version)
$completeArtifacts = New-ArtifactRoot $desktopVersion
try {
    $complete = Invoke-Gate @("-RepoRoot", $RepoRoot, "-BuiltArtifactsRoot", $completeArtifacts, "-RequireBuiltArtifacts")
    Assert-True ($complete.ExitCode -eq 0) "artifact gate accepts unsigned setup, portable package, sidecar, report, and manifest" $complete.Output
    Assert-True ($complete.Output -match "Portable package contains agenthub-edge\.exe" -and $complete.Output -match "signing out of scope") "artifact gate reports portable sidecar and non-goals" $complete.Output
}
finally {
    Remove-Item -LiteralPath $completeArtifacts -Recurse -Force -ErrorAction SilentlyContinue
}

$badPortable = New-ArtifactRoot $desktopVersion -OmitPortableSidecar
try {
    $bad = Invoke-Gate @("-RepoRoot", $RepoRoot, "-BuiltArtifactsRoot", $badPortable, "-RequireBuiltArtifacts")
    Assert-True ($bad.ExitCode -ne 0) "artifact gate rejects portable package without Local Edge sidecar" $bad.Output
    Assert-True ($bad.Output -match "agenthub-edge\.exe") "bad portable failure names missing sidecar" $bad.Output
}
finally {
    Remove-Item -LiteralPath $badPortable -Recurse -Force -ErrorAction SilentlyContinue
}

$badManifest = New-ArtifactRoot $desktopVersion -BadManifestHash
try {
    $bad = Invoke-Gate @("-RepoRoot", $RepoRoot, "-BuiltArtifactsRoot", $badManifest, "-RequireBuiltArtifacts")
    Assert-True ($bad.ExitCode -ne 0) "artifact gate rejects manifest hash mismatch" $bad.Output
    Assert-True ($bad.Output -match "sha256") "bad manifest failure names sha256 mismatch" $bad.Output
}
finally {
    Remove-Item -LiteralPath $badManifest -Recurse -Force -ErrorAction SilentlyContinue
}

$fixtureRoot = New-MinimalRepoFixture
try {
    $edgeManagerPath = Join-Path $fixtureRoot "app\desktop\src-tauri\src\edge_manager.rs"
    $edgeManager = Get-Content $edgeManagerPath -Raw -Encoding UTF8
    $edgeManager = $edgeManager -replace 'EDGE_SIDECAR_NAME:\s*&str\s*=\s*"agenthub-edge"', 'EDGE_SIDECAR_NAME: &str = "rogue-edge"'
    Set-Content $edgeManagerPath $edgeManager -Encoding UTF8

    $rogue = Invoke-Gate @("-RepoRoot", $fixtureRoot) $fixtureRoot
    Assert-True ($rogue.ExitCode -ne 0) "sidecar runtime evidence gate rejects sidecar rename drift" $rogue.Output
    Assert-True ($rogue.Output -match "agenthub-edge|sidecar") "sidecar rename failure names sidecar boundary" $rogue.Output
}
finally {
    Remove-Item -LiteralPath $fixtureRoot -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host "`nTauri sidecar runtime evidence script tests OK" -ForegroundColor Green
