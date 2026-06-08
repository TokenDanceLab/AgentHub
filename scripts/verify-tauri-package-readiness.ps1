param(
    [string]$RepoRoot = ".",
    [string]$BuiltArtifactsRoot = "",
    [switch]$RequireBuiltArtifacts
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
    param(
        [bool]$Condition,
        [string]$Message
    )

    if (-not $Condition) {
        Fail $Message
    }
    Pass $Message
}

function Assert-GitIgnored {
    param(
        [string]$RelativePath,
        [string]$Label
    )

    & git -C $RepoRoot check-ignore -q -- $RelativePath
    if ($LASTEXITCODE -ne 0) {
        Fail "$Label is not ignored by Git: $RelativePath"
    }
    Pass "$Label is ignored by Git ($RelativePath)"
}

function Read-Json([string]$RelativePath) {
    $path = Join-Path $RepoRoot $RelativePath
    return Get-Content $path -Raw -Encoding UTF8 | ConvertFrom-Json
}

function Read-Text([string]$RelativePath) {
    return Get-Content (Join-Path $RepoRoot $RelativePath) -Raw -Encoding UTF8
}

function Get-CargoVersion([string]$RelativePath) {
    $text = Read-Text $RelativePath
    $match = [regex]::Match($text, '(?m)^version\s*=\s*"(?<version>[^"]+)"')
    if (-not $match.Success) {
        Fail "Cargo.toml package version is missing"
    }
    return $match.Groups["version"].Value
}

function Get-CargoLockPackageVersion([string]$RelativePath, [string]$PackageName) {
    $text = Read-Text $RelativePath
    $escapedName = [regex]::Escape($PackageName)
    $pattern = "(?ms)^\[\[package\]\]\s*\r?\nname\s*=\s*`"$escapedName`"\s*\r?\nversion\s*=\s*`"(?<version>[^`"]+)`""
    $match = [regex]::Match($text, $pattern)
    if (-not $match.Success) {
        Fail "Cargo.lock package version is missing for $PackageName"
    }
    return $match.Groups["version"].Value
}

function Has-Target($Targets, [string]$Expected) {
    if ($Targets -is [string]) {
        return $Targets -eq $Expected
    }

    foreach ($target in @($Targets)) {
        if ([string]$target -eq $Expected) {
            return $true
        }
    }

    return $false
}

function Assert-Artifact([string]$Root, [string]$Pattern, [string]$Label) {
    $item = Get-ChildItem $Root -Filter $Pattern -Recurse -File -ErrorAction SilentlyContinue | Select-Object -First 1
    Assert-True ($null -ne $item) "$Label artifact exists ($Pattern)"
}

function Get-WorkflowJobBlock([string]$WorkflowText, [string]$JobName) {
    $escapedJobName = [regex]::Escape($JobName)
    $match = [regex]::Match($WorkflowText, "(?ms)^\s{2}$escapedJobName\s*:.*?(?=^\s{2}[A-Za-z0-9_-]+\s*:|\z)")
    if (-not $match.Success) {
        Fail "release readiness workflow is missing job: $JobName"
    }
    return $match.Value
}

function Get-WorkflowJobBlocks([string]$WorkflowText) {
    $jobsMatch = [regex]::Match($WorkflowText, "(?ms)^jobs:\s*\r?\n(?<jobs>.*)\z")
    if (-not $jobsMatch.Success) {
        Fail "release readiness workflow is missing jobs section"
    }

    $jobsText = $jobsMatch.Groups["jobs"].Value
    $blocks = @()
    foreach ($match in [regex]::Matches($jobsText, "(?ms)^\s{2}(?<name>[A-Za-z0-9_-]+)\s*:.*?(?=^\s{2}[A-Za-z0-9_-]+\s*:|\z)")) {
        $blocks += [pscustomobject]@{
            Name = $match.Groups["name"].Value
            Text = $match.Value
        }
    }

    if ($blocks.Count -eq 0) {
        Fail "release readiness workflow has no jobs"
    }

    return $blocks
}

function Test-WorkflowJobHasManualOptIn {
    param(
        [string]$JobBlock,
        [string]$InputName
    )

    return [regex]::IsMatch($JobBlock, "github\.event_name\s*==\s*'workflow_dispatch'\s*&&\s*inputs\.$([regex]::Escape($InputName))\s*==\s*true")
}

function Assert-WorkflowCommandExplicitOptIn {
    param(
        [string]$WorkflowText,
        [string]$CommandPattern,
        [string]$InputName,
        [string]$JobName,
        [string]$Label
    )

    if (-not [regex]::IsMatch($WorkflowText, $CommandPattern)) {
        Pass "$Label command is absent"
        return
    }

    $jobBlock = Get-WorkflowJobBlock $WorkflowText $JobName
    Assert-True ([regex]::IsMatch($WorkflowText, "(?ms)workflow_dispatch:\s*\r?\n\s*inputs:.*?^\s{6}$([regex]::Escape($InputName))\s*:")) "$Label opt-in input is declared"
    Assert-True (Test-WorkflowJobHasManualOptIn $jobBlock $InputName) "$Label job is gated by explicit workflow_dispatch input"

    $workflowCommandCount = [regex]::Matches($WorkflowText, $CommandPattern).Count
    $jobCommandCount = 0
    $jobsWithCommand = @()
    foreach ($job in Get-WorkflowJobBlocks $WorkflowText) {
        $matches = [regex]::Matches($job.Text, $CommandPattern)
        if ($matches.Count -eq 0) {
            continue
        }

        $jobCommandCount += $matches.Count
        $jobsWithCommand += $job.Name
        Assert-True ($job.Name -eq $JobName -and (Test-WorkflowJobHasManualOptIn $job.Text $InputName)) "$Label command in job '$($job.Name)' is isolated to manual opt-in"
    }

    Assert-True ($jobCommandCount -eq $workflowCommandCount) "$Label command occurrences are all inside workflow jobs"
    Assert-True ($jobsWithCommand.Count -gt 0) "$Label command occurrences were enumerated"
    Pass "$Label command is isolated to manual opt-in job"
}

function Get-ForbiddenMacOSUnsignedDryCommands {
    param(
        [string]$JobBlock
    )

    $commandPattern = "(?i)(^|[\s;&|(``])(?:xcrun\s+)?(?:codesign|notarytool|stapler)(?:\s|$)"
    $offending = @()

    foreach ($line in ($JobBlock -split "\r?\n")) {
        $candidate = $line.Trim()
        if ([string]::IsNullOrWhiteSpace($candidate)) {
            continue
        }

        if ($candidate -match $commandPattern) {
            $offending += $candidate
        }
    }

    return $offending
}

function Assert-NoMacOSUnsignedDryCommands {
    param(
        [string]$JobBlock,
        [string]$JobName
    )

    $offending = @(Get-ForbiddenMacOSUnsignedDryCommands $JobBlock)
    if ($offending.Count -gt 0) {
        Fail "macOS unsigned dry policy job '$JobName' contains forbidden command: $($offending[0])"
    }

    Pass "macOS unsigned dry policy job '$JobName' has no codesign, notarytool, or stapler commands"
}

Step "Desktop version metadata"
$package = Read-Json "app\desktop\package.json"
$tauri = Read-Json "app\desktop\src-tauri\tauri.conf.json"
$cargoVersion = Get-CargoVersion "app\desktop\src-tauri\Cargo.toml"
$cargoLockVersion = Get-CargoLockPackageVersion "app\desktop\src-tauri\Cargo.lock" "agenthub-desktop"

Assert-True ($package.version -eq $tauri.version) "package.json and tauri.conf.json versions match ($($package.version))"
Assert-True ($cargoVersion -eq $tauri.version) "Cargo.toml and tauri.conf.json versions match ($cargoVersion)"
Assert-True ($cargoLockVersion -eq $tauri.version) "Cargo.lock and tauri.conf.json versions match ($cargoLockVersion)"
Assert-True ($tauri.identifier -eq "com.agenthub.desktop") "Desktop Tauri identifier is stable"
Assert-True ($tauri.productName -eq "AgentHub") "Desktop product name is stable"

Step "Windows package policy"
Assert-True ($tauri.bundle.active -eq $true) "Tauri bundle is active"
Assert-True (Has-Target $tauri.bundle.targets "nsis") "Tauri bundle targets Windows NSIS"
Assert-True (-not (Has-Target $tauri.bundle.targets "all")) "Tauri bundle does not use broad all targets for internal package readiness"
Assert-True (@($tauri.bundle.externalBin) -contains "binaries/agenthub-edge") "Tauri config declares edge-server sidecar basename"
Assert-True ($tauri.bundle.windows.nsis.installMode -eq "currentUser") "NSIS installer uses currentUser install mode"

$releaseWorkflowText = Read-Text ".github\workflows\release.yml"
$readinessWorkflowText = Read-Text ".github\workflows\release-readiness.yml"
$governanceText = Read-Text "docs\backend-integration-governance.md"
Assert-True ($readinessWorkflowText -match "agenthub-edge-x86_64-pc-windows-msvc\.exe") "release readiness workflow prepares Windows sidecar agenthub-edge-x86_64-pc-windows-msvc.exe"
Assert-True ($readinessWorkflowText -match "AgentHub_\$\{ver\}_x64-portable\.zip" -or $readinessWorkflowText -match "portable\.zip") "release readiness workflow names portable.zip artifact"
Assert-True ($readinessWorkflowText -match "setup\.exe") "release readiness workflow collects NSIS setup.exe"

Step "Updater metadata policy"
Assert-True ($tauri.plugins.updater.active -eq $true) "Tauri updater plugin is active"
$updaterLatestEndpoints = @($tauri.plugins.updater.endpoints) -match "latest\.json"
Assert-True ($updaterLatestEndpoints.Count -gt 0) "Updater endpoint points at latest.json metadata"
Assert-True (-not [string]::IsNullOrWhiteSpace([string]$tauri.plugins.updater.pubkey)) "Updater public key is configured"
Assert-True ($readinessWorkflowText -match "latest\.json") "release readiness workflow checks latest.json"
Assert-True ($readinessWorkflowText -match "\.sig") "release readiness workflow checks updater signature .sig"

Step "Tag release policy"
Assert-True ($releaseWorkflowText -match "(?ms)on:\s*\r?\n\s*push:\s*\r?\n\s*tags:") "release workflow keeps tag push trigger"
Assert-True ($releaseWorkflowText -match "softprops/action-gh-release") "release workflow keeps GitHub Release creation"
Assert-True ($releaseWorkflowText -match "TAURI_SIGNING_PRIVATE_KEY") "release workflow keeps production Tauri signing secret boundary"

Step "Dry release policy"
Assert-True ($readinessWorkflowText -match "workflow_dispatch") "release readiness workflow is manually runnable"
Assert-True ($readinessWorkflowText -match "\.github/workflows/release\.yml") "release readiness workflow watches release.yml"
Assert-True ($readinessWorkflowText -match "app/desktop/src-tauri/Cargo\.lock") "release readiness workflow watches Cargo.lock"
Assert-True ($readinessWorkflowText -notmatch "softprops/action-gh-release") "release readiness workflow does not create GitHub releases"
Assert-True ($readinessWorkflowText -notmatch "gh release upload") "release readiness workflow does not upload release assets"
Assert-True ($readinessWorkflowText -notmatch "TAURI_SIGNING_PRIVATE_KEY") "release readiness workflow does not require production signing secrets"
Assert-True ($readinessWorkflowText -match "verify-tauri-package-readiness\.ps1") "release readiness workflow runs this checker"
$readinessPolicyBlock = Get-WorkflowJobBlock $readinessWorkflowText "readiness-policy"
$installerSmokeBlock = Get-WorkflowJobBlock $readinessWorkflowText "windows-installer-smoke-preflight"
Assert-True ($readinessPolicyBlock -notmatch "pnpm\s+tauri\s+build") "static readiness policy does not run full Tauri build"
Assert-True ($installerSmokeBlock -notmatch "pnpm\s+tauri\s+build") "installer smoke preflight does not run full Tauri build"
Assert-WorkflowCommandExplicitOptIn $readinessWorkflowText "pnpm\s+tauri\s+build" "run_windows_package_dry" "windows-package-dry" "Full Tauri build"

Step "Generated artifact ignore policy"
$desktopVersion = [string]$package.version
Assert-GitIgnored "dist/AgentHub_${desktopVersion}_x64-setup.exe" "Windows setup.exe dry artifact"
Assert-GitIgnored "dist/AgentHub_${desktopVersion}_x64-portable.zip" "Windows portable.zip dry artifact"
Assert-GitIgnored "dist/latest.json" "Updater latest.json dry artifact"
Assert-GitIgnored "dist/AgentHub_${desktopVersion}_x64-setup.exe.sig" "Updater signature dry artifact"
Assert-GitIgnored "dist/agenthub-edge-windows-amd64.exe" "Windows sidecar dry intermediate"
Assert-GitIgnored "app/desktop/src-tauri/target/release/bundle/nsis/AgentHub_${desktopVersion}_x64-setup.exe" "Tauri NSIS bundle output"
Assert-GitIgnored "app/desktop/src-tauri/binaries/agenthub-edge-x86_64-pc-windows-msvc.exe" "Windows sidecar binary"
Assert-GitIgnored "app/desktop/src-tauri/binaries/agenthub-edge-aarch64-apple-darwin" "macOS arm64 sidecar binary"

Step "macOS unsigned dry policy boundary"
Assert-True ($readinessWorkflowText -match "run_macos_unsigned_dry_policy") "release readiness workflow declares explicit macOS unsigned dry policy input"
$macosUnsignedDryBlock = Get-WorkflowJobBlock $readinessWorkflowText "macos-unsigned-dry-policy"
Assert-True (Test-WorkflowJobHasManualOptIn $macosUnsignedDryBlock "run_macos_unsigned_dry_policy") "macOS unsigned dry policy job is gated by explicit workflow_dispatch input"
Assert-True ($macosUnsignedDryBlock -match "macOS unsigned dry") "release readiness workflow names macOS step as unsigned dry policy"
Assert-True ($macosUnsignedDryBlock -match "agenthub-edge-aarch64-apple-darwin") "release readiness workflow documents the future macOS arm64 sidecar boundary"
Assert-True ($macosUnsignedDryBlock -match "AgentHub\.app" -and $macosUnsignedDryBlock -match "AgentHub\.dmg") "release readiness workflow documents future macOS app and DMG bundle boundaries"
Assert-True ($macosUnsignedDryBlock -match "workflow artifacts only") "release readiness workflow scopes future macOS unsigned outputs to workflow artifacts only"
Assert-True ($macosUnsignedDryBlock -match "later approval slice") "release readiness workflow keeps signing and notarization as later approval slice"
Assert-True ($macosUnsignedDryBlock -notmatch "pnpm\s+tauri\s+build|softprops/action-gh-release|gh release upload|TAURI_SIGNING_PRIVATE_KEY") "macOS unsigned dry policy job does not run build, release upload, or production signing secret commands"
Assert-NoMacOSUnsignedDryCommands $macosUnsignedDryBlock "macos-unsigned-dry-policy"

Step "Release dry topology documentation"
Assert-True ($governanceText -match "D2b\. Release dry build topology") "governance doc records release dry build topology"
Assert-True ($governanceText -match "topology/preflight only|拓扑/预检") "governance doc keeps release dry topology to topology/preflight scope"
Assert-True ($governanceText -match "full Tauri build|pnpm tauri build") "governance doc names full Tauri build as separate opt-in scope"
Assert-True ($governanceText -notmatch "产出未签名 NSIS|produces unsigned NSIS") "governance doc does not claim dry topology produces installer artifacts"
Assert-True ($governanceText -match "Windows unsigned NSIS/portable|未签名 NSIS") "governance doc keeps Windows unsigned NSIS/portable as future opt-in artifact scope"
Assert-True ($governanceText -match "agenthub-edge-x86_64-pc-windows-msvc\.exe") "governance doc records Windows Tauri sidecar name"
Assert-True ($governanceText -match "latest\.json.*\.sig|\.sig.*latest\.json") "governance doc records updater metadata artifacts"
Assert-True ($governanceText -match "agenthub-edge-aarch64-apple-darwin") "governance doc records macOS arm64 sidecar name"
Assert-True ($governanceText -match "macOS.*unsigned|arm64 unsigned") "governance doc keeps macOS validation unsigned"
Assert-True ($governanceText -match "AgentHub\.app" -and $governanceText -match "AgentHub\.dmg") "governance doc records future macOS app and DMG bundle boundaries"
Assert-True ($governanceText -match "notarytool|notarization") "governance doc names notarization as out of scope"
Assert-True ($governanceText -match "approval slice|审批") "governance doc keeps signing and notarization behind later approval"
Assert-True ($governanceText -match "workflow artifact") "governance doc keeps dry artifacts scoped to workflow artifact upload"
Assert-True ($governanceText -match "GitHub Release|release asset|updater 生产 metadata") "governance doc keeps release creation/upload out of dry topology"

if ($RequireBuiltArtifacts) {
    Step "Built artifact gate"
    if ([string]::IsNullOrWhiteSpace($BuiltArtifactsRoot)) {
        Fail "BuiltArtifactsRoot is required when -RequireBuiltArtifacts is set"
    }
    if (-not (Test-Path $BuiltArtifactsRoot)) {
        Fail "Built artifacts root not found: $BuiltArtifactsRoot; expected latest.json, setup.exe, portable.zip, and .sig"
    }

    $artifactRoot = (Resolve-Path $BuiltArtifactsRoot).Path
    Assert-Artifact $artifactRoot "*setup.exe" "NSIS setup.exe"
    Assert-Artifact $artifactRoot "*portable.zip" "Windows portable.zip"
    Assert-Artifact $artifactRoot "latest.json" "Updater latest.json"
    Assert-Artifact $artifactRoot "*.sig" "Updater signature .sig"
}

Write-Host "`nTauri package readiness policy OK" -ForegroundColor Green
