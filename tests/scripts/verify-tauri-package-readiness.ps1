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
    return Get-Content (Join-Path $RepoRoot $RelativePath) -Raw -Encoding UTF8
}

function Get-ScriptHosts {
    $hosts = [ordered]@{}
    foreach ($command in @("powershell", "pwsh")) {
        $resolved = Get-Command $command -ErrorAction SilentlyContinue
        if ($resolved) {
            $hosts[$command] = [pscustomobject]@{
                Name = $command
                Path = $resolved.Source
            }
        }
    }

    return @($hosts.Values)
}

function Invoke-Script {
    param(
        [pscustomobject]$HostShell,
        [string[]]$Arguments,
        [string]$WorkingDirectory = $RepoRoot
    )

    $scriptPath = Join-Path $RepoRoot "scripts\verify-tauri-package-readiness.ps1"
    Push-Location $WorkingDirectory
    try {
        $output = & $HostShell.Path -NoProfile -ExecutionPolicy Bypass -File $scriptPath @Arguments 2>&1 | Out-String
        $exitCode = $LASTEXITCODE
    }
    finally {
        Pop-Location
    }

    return [pscustomobject]@{
        ExitCode = $exitCode
        Output = $output
        Host = $HostShell.Name
    }
}

function Copy-FixtureFile([string]$RelativePath, [string]$TempRoot) {
    $source = Join-Path $RepoRoot $RelativePath
    $target = Join-Path $TempRoot $RelativePath
    New-Item -ItemType Directory (Split-Path $target -Parent) -Force | Out-Null
    Copy-Item $source $target
}

function New-RogueTauriBuildFixture {
    $tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) "agenthub-tauri-readiness-$(New-Guid)"
    New-Item -ItemType Directory $tempRoot -Force | Out-Null

    foreach ($relativePath in @(
        ".gitignore",
        ".github\workflows\release.yml",
        ".github\workflows\release-readiness.yml",
        "app\desktop\package.json",
        "app\desktop\src-tauri\Cargo.toml",
        "app\desktop\src-tauri\Cargo.lock",
        "app\desktop\src-tauri\tauri.conf.json",
        "docs\backend-integration-governance.md"
    )) {
        Copy-FixtureFile $relativePath $tempRoot
    }

    $workflowPath = Join-Path $tempRoot ".github\workflows\release-readiness.yml"
    $workflowText = Get-Content $workflowPath -Raw -Encoding UTF8
    $rogueJob = @'

  rogue-tauri-build:
    name: Rogue Tauri build
    needs: readiness-policy
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - name: Rogue full build
        working-directory: app/desktop
        run: pnpm tauri build
'@
    Set-Content $workflowPath ($workflowText + $rogueJob) -Encoding UTF8

    & git -C $tempRoot init -q
    return $tempRoot
}

function New-RogueMacOSCommandFixture {
    param(
        [string]$Command
    )

    $tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) "agenthub-tauri-readiness-$(New-Guid)"
    New-Item -ItemType Directory $tempRoot -Force | Out-Null

    foreach ($relativePath in @(
        ".gitignore",
        ".github\workflows\release.yml",
        ".github\workflows\release-readiness.yml",
        "app\desktop\package.json",
        "app\desktop\src-tauri\Cargo.toml",
        "app\desktop\src-tauri\Cargo.lock",
        "app\desktop\src-tauri\tauri.conf.json",
        "docs\backend-integration-governance.md"
    )) {
        Copy-FixtureFile $relativePath $tempRoot
    }

    $workflowPath = Join-Path $tempRoot ".github\workflows\release-readiness.yml"
    $workflowText = Get-Content $workflowPath -Raw -Encoding UTF8
    $injected = $workflowText -replace '(?m)^          Write-Host "Apple Developer ID signing, notarization, stapling, release asset upload, and production updater metadata are a later approval slice\."\s*$', "`$0`r`n          $Command"
    Set-Content $workflowPath $injected -Encoding UTF8

    & git -C $tempRoot init -q
    return $tempRoot
}

function New-RogueMacOSReleaseActionFixture {
    param(
        [string]$Action
    )

    $tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) "agenthub-tauri-readiness-$(New-Guid)"
    New-Item -ItemType Directory $tempRoot -Force | Out-Null

    foreach ($relativePath in @(
        ".gitignore",
        ".github\workflows\release.yml",
        ".github\workflows\release-readiness.yml",
        "app\desktop\package.json",
        "app\desktop\src-tauri\Cargo.toml",
        "app\desktop\src-tauri\Cargo.lock",
        "app\desktop\src-tauri\tauri.conf.json",
        "docs\backend-integration-governance.md"
    )) {
        Copy-FixtureFile $relativePath $tempRoot
    }

    $workflowPath = Join-Path $tempRoot ".github\workflows\release-readiness.yml"
    $workflowText = Get-Content $workflowPath -Raw -Encoding UTF8

    if ($Action -match "uses:") {
        $injected = $workflowText -replace '(?m)^      - name: Upload macOS unsigned dry policy artifact\s*$', "      - name: Rogue GitHub Release upload`r`n        $Action`r`n`$0"
    } else {
        $injected = $workflowText -replace '(?m)^          Write-Host "Apple Developer ID signing, notarization, stapling, release asset upload, and production updater metadata are a later approval slice\."\s*$', "`$0`r`n          $Action"
    }

    Set-Content $workflowPath $injected -Encoding UTF8

    & git -C $tempRoot init -q
    return $tempRoot
}

function New-FixedStableReleaseFixture {
    $tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) "agenthub-tauri-readiness-$(New-Guid)"
    New-Item -ItemType Directory $tempRoot -Force | Out-Null

    foreach ($relativePath in @(
        ".gitignore",
        ".github\workflows\release.yml",
        ".github\workflows\release-readiness.yml",
        "app\desktop\package.json",
        "app\desktop\src-tauri\Cargo.toml",
        "app\desktop\src-tauri\Cargo.lock",
        "app\desktop\src-tauri\tauri.conf.json",
        "docs\backend-integration-governance.md"
    )) {
        Copy-FixtureFile $relativePath $tempRoot
    }

    $workflowPath = Join-Path $tempRoot ".github\workflows\release.yml"
    $workflowText = Get-Content $workflowPath -Raw -Encoding UTF8
    $workflowText = [regex]::Replace($workflowText, '(?m)^          prerelease:\s*.*$', '          prerelease: false', 1)
    Set-Content $workflowPath $workflowText -Encoding UTF8

    & git -C $tempRoot init -q
    return $tempRoot
}

function New-TaggedReleaseFixture {
    param(
        [string]$TagName
    )

    $metadataVersion = "0.2.0"
    $tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) "agenthub-tauri-readiness-$(New-Guid)"
    New-Item -ItemType Directory $tempRoot -Force | Out-Null

    foreach ($relativePath in @(
        ".gitignore",
        ".github\workflows\release.yml",
        ".github\workflows\release-readiness.yml",
        "app\desktop\package.json",
        "app\desktop\src-tauri\Cargo.toml",
        "app\desktop\src-tauri\Cargo.lock",
        "app\desktop\src-tauri\tauri.conf.json",
        "docs\backend-integration-governance.md"
    )) {
        Copy-FixtureFile $relativePath $tempRoot
    }

    $packageJsonPath = Join-Path $tempRoot "app\desktop\package.json"
    $packageJson = Get-Content $packageJsonPath -Raw -Encoding UTF8
    $packageJson = [regex]::Replace($packageJson, '(?m)^  "version": "[^"]+",', "  `"version`": `"$metadataVersion`",", 1)
    Set-Content $packageJsonPath $packageJson -Encoding UTF8

    $tauriConfPath = Join-Path $tempRoot "app\desktop\src-tauri\tauri.conf.json"
    $tauriConf = Get-Content $tauriConfPath -Raw -Encoding UTF8
    $tauriConf = [regex]::Replace($tauriConf, '(?m)^  "version": "[^"]+",', "  `"version`": `"$metadataVersion`",", 1)
    Set-Content $tauriConfPath $tauriConf -Encoding UTF8

    $cargoTomlPath = Join-Path $tempRoot "app\desktop\src-tauri\Cargo.toml"
    $cargoToml = Get-Content $cargoTomlPath -Raw -Encoding UTF8
    $cargoToml = [regex]::Replace($cargoToml, '(?m)^version = "[^"]+"', "version = `"$metadataVersion`"", 1)
    Set-Content $cargoTomlPath $cargoToml -Encoding UTF8

    $cargoLockPath = Join-Path $tempRoot "app\desktop\src-tauri\Cargo.lock"
    $cargoLock = Get-Content $cargoLockPath -Raw -Encoding UTF8
    $cargoLock = [regex]::Replace(
        $cargoLock,
        '(?ms)(\[\[package\]\]\s*\r?\nname\s*=\s*"agenthub-desktop"\s*\r?\nversion\s*=\s*")[^"]+(")',
        { param($match) $match.Groups[1].Value + $metadataVersion + $match.Groups[2].Value },
        1
    )
    Set-Content $cargoLockPath $cargoLock -Encoding UTF8

    & git -C $tempRoot init -q
    & git -C $tempRoot -c user.name="AgentHub Test" -c user.email="agenthub-test@example.invalid" add .
    & git -C $tempRoot -c user.name="AgentHub Test" -c user.email="agenthub-test@example.invalid" commit -q -m "fixture"
    & git -C $tempRoot tag $TagName
    return $tempRoot
}

function New-TestArtifactRoot {
    param(
        [string]$Name,
        [string]$Version,
        [switch]$OmitLatestVersion,
        [switch]$OmitPortableSidecar,
        [switch]$BadManifestHash
    )

    $root = Join-Path ([System.IO.Path]::GetTempPath()) "agenthub-tauri-artifacts-$Name-$(New-Guid)"
    New-Item -ItemType Directory $root -Force | Out-Null

    $setupPath = Join-Path $root "AgentHub_${Version}_x64-setup.exe"
    [System.IO.File]::WriteAllBytes($setupPath, [byte[]](1..32))
    "signature-for-test" | Out-File (Join-Path $root "AgentHub_${Version}_x64-setup.exe.sig") -Encoding UTF8

    $portableDir = Join-Path $root "portable-src"
    New-Item -ItemType Directory $portableDir -Force | Out-Null
    "desktop" | Out-File (Join-Path $portableDir "AgentHub.exe") -Encoding UTF8
    if (-not $OmitPortableSidecar) {
        "edge" | Out-File (Join-Path $portableDir "agenthub-edge.exe") -Encoding UTF8
    }
    "readme" | Out-File (Join-Path $portableDir "README.txt") -Encoding UTF8
    Compress-Archive -Path (Join-Path $portableDir "*") -DestinationPath (Join-Path $root "AgentHub_${Version}_x64-portable.zip") -Force
    Remove-Item $portableDir -Recurse -Force

    $latest = [ordered]@{
        notes = "Internal dry-run package."
        pub_date = "2026-06-08T00:00:00Z"
        platforms = [ordered]@{
            "windows-x86_64" = [ordered]@{
                signature = "signature-for-test"
                url = "https://github.com/TokenDanceLab/AgentHub/releases/download/v$Version/AgentHub_${Version}_x64-setup.exe"
            }
        }
    }
    if (-not $OmitLatestVersion) {
        $latest.version = $Version
    }
    $latest | ConvertTo-Json -Depth 8 | Out-File (Join-Path $root "latest.json") -Encoding UTF8

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

$scriptPath = Join-Path $RepoRoot "scripts\verify-tauri-package-readiness.ps1"
$smokeScriptPath = Join-Path $RepoRoot "scripts\verify-tauri-installer-smoke.ps1"
$workflowPath = Join-Path $RepoRoot ".github\workflows\release.yml"
$readinessWorkflowPath = Join-Path $RepoRoot ".github\workflows\release-readiness.yml"

Assert-True (Test-Path $scriptPath) "Tauri package readiness checker exists"
Assert-True (Test-Path $smokeScriptPath) "Tauri installer smoke preflight exists"
Assert-True (Test-Path $workflowPath) "release workflow exists"
Assert-True (Test-Path $readinessWorkflowPath) "release readiness workflow exists"

$scriptText = Read-Text "scripts\verify-tauri-package-readiness.ps1"
$smokeScriptText = Read-Text "scripts\verify-tauri-installer-smoke.ps1"
$workflowText = Read-Text ".github\workflows\release.yml"
$readinessWorkflowText = Read-Text ".github\workflows\release-readiness.yml"
$desktopPackage = Get-Content (Join-Path $RepoRoot "app\desktop\package.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$desktopVersion = [string]$desktopPackage.version

Assert-True ($scriptText -match "package\.json" -and $scriptText -match "Cargo\.toml" -and $scriptText -match "Cargo\.lock" -and $scriptText -match "tauri\.conf\.json") "checker compares desktop package, Cargo, Cargo.lock, and Tauri versions"
Assert-True ($scriptText -match "Release tag version alignment" -and $scriptText -match "prerelease|pre-release") "checker reports RC/pre-release tag version alignment"
Assert-True ($scriptText -match "agenthub-edge-x86_64-pc-windows-msvc\.exe") "checker enforces Windows sidecar binary name"
Assert-True ($scriptText -match "latest\.json" -and $scriptText -match "\.sig") "checker requires updater metadata and signature"
Assert-True ($scriptText -match "portable\.zip" -and $scriptText -match "setup\.exe") "checker requires installer and portable artifacts"
Assert-True ($scriptText -match "artifact-manifest\.json" -and $scriptText -match "Get-FileHash" -and $scriptText -match "sha256" -and $scriptText -match "bytes") "checker validates dry artifact manifest hashes and sizes"
Assert-True ($scriptText -match "ZipFile" -and $scriptText -match "AgentHub\.exe" -and $scriptText -match "agenthub-edge\.exe" -and $scriptText -match "README\.txt") "checker inspects portable zip contents"
Assert-True ($scriptText -match "check-ignore" -and $scriptText -match "Assert-GitIgnored") "checker verifies generated package artifacts stay ignored before dry builds"
foreach ($artifactPattern in @(
    'dist/AgentHub_${desktopVersion}_x64-setup.exe',
    'dist/AgentHub_${desktopVersion}_x64-portable.zip',
    "dist/latest.json",
    'dist/AgentHub_${desktopVersion}_x64-setup.exe.sig',
    "dist/agenthub-edge-windows-amd64.exe",
    'app/desktop/src-tauri/target/release/bundle/nsis/AgentHub_${desktopVersion}_x64-setup.exe',
    "app/desktop/src-tauri/binaries/agenthub-edge-x86_64-pc-windows-msvc.exe",
    "app/desktop/src-tauri/binaries/agenthub-edge-aarch64-apple-darwin"
)) {
    Assert-True ($scriptText -match [regex]::Escape($artifactPattern)) "checker covers ignored generated artifact path $artifactPattern"
}
Assert-True ($scriptText -match "run_macos_unsigned_dry_policy" -and $scriptText -match "macos-unsigned-dry-policy") "checker enforces explicit macOS unsigned dry workflow gate"
Assert-True ($scriptText -match "agenthub-edge-aarch64-apple-darwin" -and $scriptText -match "AgentHub\\.app" -and $scriptText -match "AgentHub_\\\$\\{version\\}_aarch64\\.dmg") "checker records future macOS arm64 sidecar and versioned bundle boundaries"
Assert-True ($scriptText -match "later approval slice|approval slice|审批") "checker keeps macOS signing and notarization behind later approval"
Assert-True ($scriptText -match "macos-unsigned-dry-policy\\.json" -and $scriptText -match "actions/upload-artifact@v4" -and $scriptText -match "workflow artifact") "checker enforces macOS workflow artifact-only policy manifest"
Assert-True ($scriptText -match "Assert-NoMacOSUnsignedDryReleaseActions" -and $scriptText -match "softprops/action-gh-release" -and $scriptText -match "latest\\.json") "checker forbids macOS release upload and updater metadata publication actions"
Assert-True ($smokeScriptText -match "StrictToolchain" -and $smokeScriptText -match "GOOS=windows" -and $smokeScriptText -match "GOARCH=amd64") "installer smoke records Windows sidecar toolchain preflight"
Assert-True ($smokeScriptText -match "installer-header\.bmp" -and $smokeScriptText -match "installer-sidebar\.bmp") "installer smoke verifies NSIS installer image assets"
Assert-True ($smokeScriptText -match "AgentHub-portable/AgentHub\.exe" -and $smokeScriptText -match "AgentHub-portable/agenthub-edge\.exe") "installer smoke verifies portable staging outputs stay ignored"
Assert-True ($smokeScriptText -match "notarization" -and $smokeScriptText -match "stapling" -and $smokeScriptText -match "policy note only") "installer smoke keeps macOS compatibility as policy note only"
Assert-True ($smokeScriptText -notmatch "pnpm\s+tauri\s+build|softprops/action-gh-release|gh release upload|codesign\s+--sign|xcrun\s+notarytool|stapler\s+staple") "installer smoke does not run release, signing, notarization, or full Tauri build commands"

Assert-True ($workflowText -match "(?ms)on:\s*\r?\n\s*push:\s*\r?\n\s*tags:" -and $workflowText -match "softprops/action-gh-release") "release workflow keeps tag release semantics"
Assert-True ($workflowText -match "TAURI_SIGNING_PRIVATE_KEY") "release workflow keeps production signing secret boundary"
Assert-True ($workflowText -match "prerelease:\s*\$\{\{\s*contains\(github\.ref_name,\s*'-'\)\s*\}\}") "release workflow marks hyphenated semver tags as GitHub prereleases"
Assert-True ($scriptText -match "Release workflow prerelease policy" -and $scriptText -match "fixed stable") "checker rejects fixed-stable release prerelease policy"
Assert-True ($readinessWorkflowText -match "workflow_dispatch") "release readiness workflow is manual/dry policy gated"
Assert-True ($readinessWorkflowText -match "\.github/workflows/release\.yml") "release readiness workflow watches release.yml"
Assert-True ($readinessWorkflowText -match "app/desktop/src-tauri/Cargo\.lock") "release readiness workflow watches Cargo.lock"
Assert-True ($readinessWorkflowText -match "verify-tauri-package-readiness\.ps1") "release readiness workflow runs readiness checker"
Assert-True ($readinessWorkflowText -match "verify-tauri-installer-smoke\.ps1") "release readiness workflow runs installer smoke preflight"
Assert-True ($readinessWorkflowText -match "windows-installer-smoke-preflight") "release readiness workflow has a Windows installer smoke preflight job"
Assert-True ($readinessWorkflowText -match "artifact-manifest\.json" -and $readinessWorkflowText -match "Get-FileHash" -and $readinessWorkflowText -match "Length") "release readiness workflow writes artifact manifest with hashes and sizes"
Assert-True ($readinessWorkflowText -match "missing latest\.json" -and $readinessWorkflowText -match "missing updater signature") "release readiness workflow fails collection when updater metadata or signature is missing"
Assert-True ($readinessWorkflowText -match "run_macos_unsigned_dry_policy") "release readiness workflow declares macOS unsigned dry policy input"
Assert-True ($readinessWorkflowText -match "macos-unsigned-dry-policy" -and $readinessWorkflowText -match "agenthub-edge-aarch64-apple-darwin") "release readiness workflow records future macOS arm64 unsigned dry sidecar boundary"
Assert-True ($readinessWorkflowText -match "AgentHub\.app" -and $readinessWorkflowText -match "AgentHub_\$\{version\}_aarch64\.dmg" -and $readinessWorkflowText -match "workflow artifacts only") "release readiness workflow records future macOS versioned bundle artifact-only boundary"
Assert-True ($readinessWorkflowText -match "macos-unsigned-dry-policy\.json" -and $readinessWorkflowText -match "actions/upload-artifact@v4") "release readiness workflow uploads a macOS policy manifest as a workflow artifact"
Assert-True ($readinessWorkflowText -match "later approval slice") "release readiness workflow keeps macOS signing/notarization as a later approval slice"
Assert-True ($readinessWorkflowText -notmatch "softprops/action-gh-release") "release readiness workflow does not create a GitHub Release"
Assert-True ($readinessWorkflowText -notmatch "TAURI_SIGNING_PRIVATE_KEY") "release readiness workflow does not require production signing secrets"

$scriptHosts = Get-ScriptHosts
Assert-True ($scriptHosts.Count -gt 0) "at least one PowerShell host is available for checker child process"

foreach ($hostShell in $scriptHosts) {
    $ok = Invoke-Script $hostShell @("-RepoRoot", $RepoRoot)
    Assert-True ($ok.ExitCode -eq 0) "readiness checker passes current repository policy under $($ok.Host)" $ok.Output

    $smokeOutput = & $hostShell.Path -NoProfile -ExecutionPolicy Bypass -File $smokeScriptPath -RepoRoot $RepoRoot 2>&1 | Out-String
    Assert-True ($LASTEXITCODE -eq 0) "installer smoke preflight passes without full build under $($hostShell.Name)" $smokeOutput

    $missingUpdater = Invoke-Script $hostShell @("-RepoRoot", $RepoRoot, "-BuiltArtifactsRoot", (Join-Path $RepoRoot "does-not-exist"), "-RequireBuiltArtifacts")
    Assert-True ($missingUpdater.ExitCode -ne 0) "built artifact gate fails when updater metadata is missing under $($missingUpdater.Host)" $missingUpdater.Output
    Assert-True ($missingUpdater.Output -match "latest\.json") "missing updater metadata failure names latest.json under $($missingUpdater.Host)" $missingUpdater.Output

    $completeArtifacts = New-TestArtifactRoot "complete" $desktopVersion
    try {
        $completeGate = Invoke-Script $hostShell @("-RepoRoot", $RepoRoot, "-BuiltArtifactsRoot", $completeArtifacts, "-RequireBuiltArtifacts")
        Assert-True ($completeGate.ExitCode -eq 0) "built artifact gate accepts inspected manifest, installer, portable package, updater metadata, and signature under $($completeGate.Host)" $completeGate.Output
        Assert-True ($completeGate.Output -match "artifact-manifest\.json verifies" -and $completeGate.Output -match "latest\.json version matches" -and $completeGate.Output -match "portable\.zip contains agenthub-edge\.exe") "artifact inspection reports manifest, metadata, and portable sidecar checks under $($completeGate.Host)" $completeGate.Output
    }
    finally {
        Remove-Item -Recurse -Force $completeArtifacts -ErrorAction SilentlyContinue
    }

    $badLatest = New-TestArtifactRoot "bad-latest" $desktopVersion -OmitLatestVersion
    try {
        $badLatestGate = Invoke-Script $hostShell @("-RepoRoot", $RepoRoot, "-BuiltArtifactsRoot", $badLatest, "-RequireBuiltArtifacts")
        Assert-True ($badLatestGate.ExitCode -ne 0) "built artifact gate rejects latest.json without version metadata under $($badLatestGate.Host)" $badLatestGate.Output
        Assert-True ($badLatestGate.Output -match "latest\.json version") "bad latest.json failure names version metadata under $($badLatestGate.Host)" $badLatestGate.Output
    }
    finally {
        Remove-Item -Recurse -Force $badLatest -ErrorAction SilentlyContinue
    }

    $badPortable = New-TestArtifactRoot "bad-portable" $desktopVersion -OmitPortableSidecar
    try {
        $badPortableGate = Invoke-Script $hostShell @("-RepoRoot", $RepoRoot, "-BuiltArtifactsRoot", $badPortable, "-RequireBuiltArtifacts")
        Assert-True ($badPortableGate.ExitCode -ne 0) "built artifact gate rejects portable package without Edge sidecar under $($badPortableGate.Host)" $badPortableGate.Output
        Assert-True ($badPortableGate.Output -match "agenthub-edge\.exe") "bad portable failure names missing Edge sidecar under $($badPortableGate.Host)" $badPortableGate.Output
    }
    finally {
        Remove-Item -Recurse -Force $badPortable -ErrorAction SilentlyContinue
    }

    $badManifest = New-TestArtifactRoot "bad-manifest" $desktopVersion -BadManifestHash
    try {
        $badManifestGate = Invoke-Script $hostShell @("-RepoRoot", $RepoRoot, "-BuiltArtifactsRoot", $badManifest, "-RequireBuiltArtifacts")
        Assert-True ($badManifestGate.ExitCode -ne 0) "built artifact gate rejects artifact-manifest hash mismatch under $($badManifestGate.Host)" $badManifestGate.Output
        Assert-True ($badManifestGate.Output -match "artifact-manifest\.json.*sha256") "bad manifest failure names sha256 mismatch under $($badManifestGate.Host)" $badManifestGate.Output
    }
    finally {
        Remove-Item -Recurse -Force $badManifest -ErrorAction SilentlyContinue
    }

    $rogueRoot = New-RogueTauriBuildFixture
    try {
        $rogue = Invoke-Script $hostShell @("-RepoRoot", $rogueRoot) $rogueRoot
        Assert-True ($rogue.ExitCode -ne 0) "readiness checker fails rogue non-opt-in Tauri build job under $($rogue.Host)" $rogue.Output
        Assert-True ($rogue.Output -match "rogue-tauri-build|manual opt-in|pnpm tauri build") "rogue Tauri build failure names the offending job under $($rogue.Host)" $rogue.Output
    }
    finally {
        Remove-Item -Recurse -Force $rogueRoot -ErrorAction SilentlyContinue
    }

    $rcMismatchRoot = New-TaggedReleaseFixture "v0.3.0-rc.5"
    try {
        $rcMismatch = Invoke-Script $hostShell @("-RepoRoot", $rcMismatchRoot) $rcMismatchRoot
        Assert-True ($rcMismatch.ExitCode -ne 0) "readiness checker rejects RC tag when desktop metadata has a different version under $($rcMismatch.Host)" $rcMismatch.Output
        Assert-True ($rcMismatch.Output -match "v0\.3\.0-rc\.5" -and $rcMismatch.Output -match "0\.3\.0-rc\.5" -and $rcMismatch.Output -match "0\.2\.0") "RC tag mismatch failure names tag, expected version, and actual desktop version under $($rcMismatch.Host)" $rcMismatch.Output
    }
    finally {
        Remove-Item -Recurse -Force $rcMismatchRoot -ErrorAction SilentlyContinue
    }

    $fixedStableRoot = New-FixedStableReleaseFixture
    try {
        $fixedStable = Invoke-Script $hostShell @("-RepoRoot", $fixedStableRoot) $fixedStableRoot
        Assert-True ($fixedStable.ExitCode -ne 0) "readiness checker rejects release workflow with fixed prerelease false under $($fixedStable.Host)" $fixedStable.Output
        Assert-True ($fixedStable.Output -match "prerelease" -and $fixedStable.Output -match "fixed stable|hyphenated") "fixed prerelease failure names the RC/stable release boundary under $($fixedStable.Host)" $fixedStable.Output
    }
    finally {
        Remove-Item -Recurse -Force $fixedStableRoot -ErrorAction SilentlyContinue
    }

    foreach ($rogueMacOSCommand in @(
        "codesign -s `"Developer ID Application: Example`" AgentHub.app",
        "notarytool submit AgentHub.dmg --keychain-profile example",
        "xcrun stapler staple AgentHub.dmg"
    )) {
        $rogueRoot = New-RogueMacOSCommandFixture $rogueMacOSCommand
        try {
            $rogue = Invoke-Script $hostShell @("-RepoRoot", $rogueRoot) $rogueRoot
            Assert-True ($rogue.ExitCode -ne 0) "readiness checker fails rogue macOS command '$rogueMacOSCommand' under $($rogue.Host)" $rogue.Output
            Assert-True ($rogue.Output -match "macos-unsigned-dry-policy" -and $rogue.Output -match [regex]::Escape($rogueMacOSCommand)) "rogue macOS command failure names the offending job and command under $($rogue.Host)" $rogue.Output
        }
        finally {
            Remove-Item -Recurse -Force $rogueRoot -ErrorAction SilentlyContinue
        }
    }

    foreach ($rogueMacOSReleaseAction in @(
        "gh release upload v0.2.0 dist/macos-unsigned-dry-policy.json",
        "uses: softprops/action-gh-release@v2",
        "aws s3 cp dist/latest.json s3://example-updater/latest.json"
    )) {
        $rogueRoot = New-RogueMacOSReleaseActionFixture $rogueMacOSReleaseAction
        try {
            $rogue = Invoke-Script $hostShell @("-RepoRoot", $rogueRoot) $rogueRoot
            Assert-True ($rogue.ExitCode -ne 0) "readiness checker fails rogue macOS release/updater action '$rogueMacOSReleaseAction' under $($rogue.Host)" $rogue.Output
            Assert-True ($rogue.Output -match "macos-unsigned-dry-policy|GitHub Release|release assets|release/updater publication|latest\.json") "rogue macOS release/updater action failure names a release or updater publication boundary under $($rogue.Host)" $rogue.Output
        }
        finally {
            Remove-Item -Recurse -Force $rogueRoot -ErrorAction SilentlyContinue
        }
    }
}
