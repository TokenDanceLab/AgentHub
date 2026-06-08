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
    $injected = $workflowText -replace '(?m)^          echo "Signing, notarization, stapling, release asset upload, and production updater metadata are a later approval slice\."\s*$', "`$0`r`n          $Command"
    Set-Content $workflowPath $injected -Encoding UTF8

    & git -C $tempRoot init -q
    return $tempRoot
}

function New-TestArtifactRoot {
    param(
        [string]$Name,
        [switch]$OmitLatestVersion,
        [switch]$OmitPortableSidecar,
        [switch]$BadManifestHash
    )

    $root = Join-Path ([System.IO.Path]::GetTempPath()) "agenthub-tauri-artifacts-$Name-$(New-Guid)"
    New-Item -ItemType Directory $root -Force | Out-Null

    $setupPath = Join-Path $root "AgentHub_0.2.0_x64-setup.exe"
    [System.IO.File]::WriteAllBytes($setupPath, [byte[]](1..32))
    "signature-for-test" | Out-File (Join-Path $root "AgentHub_0.2.0_x64-setup.exe.sig") -Encoding UTF8

    $portableDir = Join-Path $root "portable-src"
    New-Item -ItemType Directory $portableDir -Force | Out-Null
    "desktop" | Out-File (Join-Path $portableDir "AgentHub.exe") -Encoding UTF8
    if (-not $OmitPortableSidecar) {
        "edge" | Out-File (Join-Path $portableDir "agenthub-edge.exe") -Encoding UTF8
    }
    "readme" | Out-File (Join-Path $portableDir "README.txt") -Encoding UTF8
    Compress-Archive -Path (Join-Path $portableDir "*") -DestinationPath (Join-Path $root "AgentHub_0.2.0_x64-portable.zip") -Force
    Remove-Item $portableDir -Recurse -Force

    $latest = [ordered]@{
        notes = "Internal dry-run package."
        pub_date = "2026-06-08T00:00:00Z"
        platforms = [ordered]@{
            "windows-x86_64" = [ordered]@{
                signature = "signature-for-test"
                url = "https://github.com/TokenDanceLab/AgentHub/releases/download/v0.2.0/AgentHub_0.2.0_x64-setup.exe"
            }
        }
    }
    if (-not $OmitLatestVersion) {
        $latest.version = "0.2.0"
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

Assert-True ($scriptText -match "package\.json" -and $scriptText -match "Cargo\.toml" -and $scriptText -match "Cargo\.lock" -and $scriptText -match "tauri\.conf\.json") "checker compares desktop package, Cargo, Cargo.lock, and Tauri versions"
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
Assert-True ($scriptText -match "agenthub-edge-aarch64-apple-darwin" -and $scriptText -match "AgentHub\\.app" -and $scriptText -match "AgentHub\\.dmg") "checker records future macOS arm64 sidecar and bundle boundaries"
Assert-True ($scriptText -match "later approval slice|approval slice|审批") "checker keeps macOS signing and notarization behind later approval"
Assert-True ($smokeScriptText -match "StrictToolchain" -and $smokeScriptText -match "GOOS=windows" -and $smokeScriptText -match "GOARCH=amd64") "installer smoke records Windows sidecar toolchain preflight"
Assert-True ($smokeScriptText -match "installer-header\.bmp" -and $smokeScriptText -match "installer-sidebar\.bmp") "installer smoke verifies NSIS installer image assets"
Assert-True ($smokeScriptText -match "AgentHub-portable/AgentHub\.exe" -and $smokeScriptText -match "AgentHub-portable/agenthub-edge\.exe") "installer smoke verifies portable staging outputs stay ignored"
Assert-True ($smokeScriptText -match "notarization" -and $smokeScriptText -match "stapling" -and $smokeScriptText -match "policy note only") "installer smoke keeps macOS compatibility as policy note only"
Assert-True ($smokeScriptText -notmatch "pnpm\s+tauri\s+build|softprops/action-gh-release|gh release upload|codesign\s+--sign|xcrun\s+notarytool|stapler\s+staple") "installer smoke does not run release, signing, notarization, or full Tauri build commands"

Assert-True ($workflowText -match "(?ms)on:\s*\r?\n\s*push:\s*\r?\n\s*tags:" -and $workflowText -match "softprops/action-gh-release") "release workflow keeps tag release semantics"
Assert-True ($workflowText -match "TAURI_SIGNING_PRIVATE_KEY") "release workflow keeps production signing secret boundary"
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
Assert-True ($readinessWorkflowText -match "AgentHub\.app" -and $readinessWorkflowText -match "AgentHub\.dmg" -and $readinessWorkflowText -match "workflow artifacts only") "release readiness workflow records future macOS bundle artifact-only boundary"
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

    $completeArtifacts = New-TestArtifactRoot "complete"
    try {
        $completeGate = Invoke-Script $hostShell @("-RepoRoot", $RepoRoot, "-BuiltArtifactsRoot", $completeArtifacts, "-RequireBuiltArtifacts")
        Assert-True ($completeGate.ExitCode -eq 0) "built artifact gate accepts inspected manifest, installer, portable package, updater metadata, and signature under $($completeGate.Host)" $completeGate.Output
        Assert-True ($completeGate.Output -match "artifact-manifest\.json verifies" -and $completeGate.Output -match "latest\.json version matches" -and $completeGate.Output -match "portable\.zip contains agenthub-edge\.exe") "artifact inspection reports manifest, metadata, and portable sidecar checks under $($completeGate.Host)" $completeGate.Output
    }
    finally {
        Remove-Item -Recurse -Force $completeArtifacts -ErrorAction SilentlyContinue
    }

    $badLatest = New-TestArtifactRoot "bad-latest" -OmitLatestVersion
    try {
        $badLatestGate = Invoke-Script $hostShell @("-RepoRoot", $RepoRoot, "-BuiltArtifactsRoot", $badLatest, "-RequireBuiltArtifacts")
        Assert-True ($badLatestGate.ExitCode -ne 0) "built artifact gate rejects latest.json without version metadata under $($badLatestGate.Host)" $badLatestGate.Output
        Assert-True ($badLatestGate.Output -match "latest\.json version") "bad latest.json failure names version metadata under $($badLatestGate.Host)" $badLatestGate.Output
    }
    finally {
        Remove-Item -Recurse -Force $badLatest -ErrorAction SilentlyContinue
    }

    $badPortable = New-TestArtifactRoot "bad-portable" -OmitPortableSidecar
    try {
        $badPortableGate = Invoke-Script $hostShell @("-RepoRoot", $RepoRoot, "-BuiltArtifactsRoot", $badPortable, "-RequireBuiltArtifacts")
        Assert-True ($badPortableGate.ExitCode -ne 0) "built artifact gate rejects portable package without Edge sidecar under $($badPortableGate.Host)" $badPortableGate.Output
        Assert-True ($badPortableGate.Output -match "agenthub-edge\.exe") "bad portable failure names missing Edge sidecar under $($badPortableGate.Host)" $badPortableGate.Output
    }
    finally {
        Remove-Item -Recurse -Force $badPortable -ErrorAction SilentlyContinue
    }

    $badManifest = New-TestArtifactRoot "bad-manifest" -BadManifestHash
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
}
