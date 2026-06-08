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

function Invoke-GitQuiet {
    param([string[]]$Arguments)

    $oldErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $output = & git -C $RepoRoot @Arguments 2>$null
        $exitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $oldErrorActionPreference
    }

    return [pscustomobject]@{
        ExitCode = $exitCode
        Output = $output
    }
}

function Get-HeadReleaseTags {
    $headProbe = Invoke-GitQuiet @("rev-parse", "--verify", "HEAD")
    if ($headProbe.ExitCode -ne 0) {
        return @()
    }

    $tagProbe = Invoke-GitQuiet @("tag", "--points-at", "HEAD")
    if ($tagProbe.ExitCode -ne 0) {
        return @()
    }

    $tags = @()
    foreach ($line in ($tagProbe.Output -split "\r?\n")) {
        $tag = $line.Trim()
        if ($tag -match '^v?(?<version>\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$') {
            $tags += [pscustomobject]@{
                Name = $tag
                Version = $Matches["version"]
                IsPrerelease = $Matches["version"] -match '-'
            }
        }
    }

    return $tags
}

function Assert-ReleaseTagVersionAlignment {
    param([string]$DesktopVersion)

    Step "Release tag version alignment"
    $releaseTags = @(Get-HeadReleaseTags)
    if ($releaseTags.Count -eq 0) {
        Pass "No semver release tag points at HEAD; package metadata version is $DesktopVersion"
        return
    }

    foreach ($tag in $releaseTags) {
        $tagKind = if ($tag.IsPrerelease) { "pre-release" } else { "stable release" }
        Assert-True ($tag.Version -eq $DesktopVersion) "$tagKind tag $($tag.Name) expects desktop metadata version $($tag.Version); found $DesktopVersion"
    }
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
    return $item
}

function Assert-ArtifactMinBytes([System.IO.FileInfo]$Item, [int64]$MinBytes, [string]$Label) {
    Assert-True ($Item.Length -ge $MinBytes) "$Label artifact is non-empty ($($Item.Length) bytes)"
}

function Assert-ArtifactManifest {
    param(
        [System.IO.FileInfo]$ManifestArtifact,
        [System.IO.FileInfo[]]$ExpectedArtifacts
    )

    $manifestJson = Get-Content $ManifestArtifact.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
    $manifest = @()
    foreach ($entry in $manifestJson) {
        $manifest += $entry
    }
    Assert-True ($manifest.Count -gt 0) "artifact-manifest.json has entries"

    foreach ($artifact in $ExpectedArtifacts) {
        $entry = $manifest | Where-Object { [string]$_.name -eq $artifact.Name } | Select-Object -First 1
        Assert-True ($null -ne $entry) "artifact-manifest.json includes $($artifact.Name)"

        $manifestBytes = [int64]$entry.bytes
        Assert-True ($manifestBytes -eq $artifact.Length) "artifact-manifest.json bytes match $($artifact.Name) ($manifestBytes)"

        $expectedHash = (Get-FileHash $artifact.FullName -Algorithm SHA256).Hash
        Assert-True ([string]$entry.sha256 -eq $expectedHash) "artifact-manifest.json sha256 matches $($artifact.Name)"
    }

    Pass "artifact-manifest.json verifies dry artifact hashes and sizes"
}

function Assert-ZipContains([System.IO.FileInfo]$ZipItem, [string]$EntryName, [string]$Label) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction SilentlyContinue
    $zip = [System.IO.Compression.ZipFile]::OpenRead($ZipItem.FullName)
    try {
        $entry = $zip.Entries | Where-Object { $_.FullName.Replace("\", "/").EndsWith($EntryName, [System.StringComparison]::OrdinalIgnoreCase) } | Select-Object -First 1
        Assert-True ($null -ne $entry) "$Label portable.zip contains $EntryName"
    }
    finally {
        $zip.Dispose()
    }
}

function Assert-UpdaterLatestMetadata {
    param(
        [System.IO.FileInfo]$LatestJson,
        [System.IO.FileInfo]$SetupArtifact,
        [System.IO.FileInfo]$SignatureArtifact,
        [string]$ExpectedVersion
    )

    $latest = Get-Content $LatestJson.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
    Assert-True ($latest.version -eq $ExpectedVersion) "latest.json version matches desktop package version ($ExpectedVersion)"
    Assert-True (-not [string]::IsNullOrWhiteSpace([string]$latest.pub_date)) "latest.json includes pub_date"
    Assert-True ($null -ne $latest.platforms) "latest.json includes platforms metadata"

    $platforms = $latest.platforms.PSObject.Properties
    $windowsPlatform = $platforms | Where-Object { $_.Name -match "windows" -and $_.Name -match "x86_64" } | Select-Object -First 1
    Assert-True ($null -ne $windowsPlatform) "latest.json includes windows-x86_64 updater platform metadata"

    $platform = $windowsPlatform.Value
    $signature = [string]$platform.signature
    $url = [string]$platform.url
    Assert-True (-not [string]::IsNullOrWhiteSpace($signature)) "latest.json windows-x86_64 signature is present"
    Assert-True (-not [string]::IsNullOrWhiteSpace($url)) "latest.json windows-x86_64 URL is present"
    Assert-True ($url.EndsWith($SetupArtifact.Name, [System.StringComparison]::OrdinalIgnoreCase)) "latest.json windows-x86_64 URL points at setup.exe artifact"

    $signatureText = (Get-Content $SignatureArtifact.FullName -Raw -Encoding UTF8).Trim()
    Assert-True (-not [string]::IsNullOrWhiteSpace($signatureText)) "updater .sig artifact is non-empty"
    Assert-True ($signatureText -eq $signature) "updater .sig artifact matches latest.json signature"
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

function Get-ForbiddenMacOSUnsignedDryReleaseActions {
    param(
        [string]$JobBlock
    )

    $patterns = @(
        "(?i)\bsoftprops/action-gh-release\b",
        "(?i)\bactions/upload-release-asset\b",
        "(?i)(^|[\s;&|(``])gh\s+release\s+(?:create|upload)(?:\s|$)",
        "(?i)(^|[\s;&|(``])(?:aws\s+s3\s+cp|az\s+storage\s+blob\s+upload|gsutil\s+cp|rclone\s+copy|wrangler\s+r2\s+object\s+put)(?:\s|$)",
        "(?i)\blatest\.json\b.*\b(?:upload|publish|release|s3|blob|r2|gsutil|rclone)\b",
        "(?i)\bupdater\b.*\bmetadata\b.*\b(?:upload|publish|release)\b"
    )

    $offending = @()
    foreach ($line in ($JobBlock -split "\r?\n")) {
        $candidate = $line.Trim()
        if ([string]::IsNullOrWhiteSpace($candidate)) {
            continue
        }

        foreach ($pattern in $patterns) {
            if ($candidate -match $pattern) {
                $offending += $candidate
                break
            }
        }
    }

    return $offending
}

function Assert-NoMacOSUnsignedDryReleaseActions {
    param(
        [string]$JobBlock,
        [string]$JobName
    )

    $offending = @(Get-ForbiddenMacOSUnsignedDryReleaseActions $JobBlock)
    if ($offending.Count -gt 0) {
        Fail "macOS unsigned dry policy job '$JobName' contains forbidden release/updater publication action: $($offending[0])"
    }

    Pass "macOS unsigned dry policy job '$JobName' has no GitHub Release upload or updater metadata publication actions"
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
Assert-ReleaseTagVersionAlignment ([string]$tauri.version)

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
Assert-True ($macosUnsignedDryBlock -match "AgentHub\.app" -and $macosUnsignedDryBlock -match "AgentHub_\$\{version\}_aarch64\.dmg") "release readiness workflow documents future macOS app and versioned arm64 DMG bundle boundaries"
Assert-True ($macosUnsignedDryBlock -match "workflow artifacts only") "release readiness workflow scopes future macOS unsigned outputs to workflow artifacts only"
Assert-True ($macosUnsignedDryBlock -match "macos-unsigned-dry-policy\.json") "release readiness workflow writes a macOS unsigned dry policy manifest"
Assert-True ($macosUnsignedDryBlock -match "actions/upload-artifact@v4" -and $macosUnsignedDryBlock -match "name:\s*macos-unsigned-package-dry" -and $macosUnsignedDryBlock -match "path:\s*dist/macos-unsigned-dry-policy\.json") "release readiness workflow uploads only the macOS policy manifest as a workflow artifact"
Assert-True ($macosUnsignedDryBlock -match "Apple Developer ID signing" -and $macosUnsignedDryBlock -match "notarytool notarization" -and $macosUnsignedDryBlock -match "stapler staple") "release readiness workflow records Apple signing, notarization, and stapling as explicit approval gates"
Assert-True ($macosUnsignedDryBlock -match "GitHub Release upload" -and $macosUnsignedDryBlock -match "production updater metadata publication") "release readiness workflow records release upload and updater production metadata as explicit approval gates"
Assert-True ($macosUnsignedDryBlock -match "later approval slice") "release readiness workflow keeps signing, notarization, release upload, and updater metadata as later approval slice"
Assert-True ($macosUnsignedDryBlock -notmatch "pnpm\s+tauri\s+build|softprops/action-gh-release|gh release upload|TAURI_SIGNING_PRIVATE_KEY") "macOS unsigned dry policy job does not run build, release upload, or production signing secret commands"
Assert-NoMacOSUnsignedDryCommands $macosUnsignedDryBlock "macos-unsigned-dry-policy"
Assert-NoMacOSUnsignedDryReleaseActions $macosUnsignedDryBlock "macos-unsigned-dry-policy"

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
Assert-True ($governanceText -match "AgentHub\.app" -and $governanceText -match "AgentHub_\$\{version\}_aarch64\.dmg") "governance doc records future macOS app and versioned arm64 DMG bundle boundaries"
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
    $setupArtifact = Assert-Artifact $artifactRoot "*setup.exe" "NSIS setup.exe"
    $portableArtifact = Assert-Artifact $artifactRoot "*portable.zip" "Windows portable.zip"
    $latestJson = Assert-Artifact $artifactRoot "latest.json" "Updater latest.json"
    $signatureArtifact = Assert-Artifact $artifactRoot "*.sig" "Updater signature .sig"
    $manifestArtifact = Assert-Artifact $artifactRoot "artifact-manifest.json" "Dry artifact manifest"

    Assert-ArtifactMinBytes $setupArtifact 1 "NSIS setup.exe"
    Assert-ArtifactMinBytes $portableArtifact 1 "Windows portable.zip"
    Assert-ArtifactManifest $manifestArtifact @($setupArtifact, $portableArtifact, $latestJson, $signatureArtifact)
    Assert-ZipContains $portableArtifact "AgentHub.exe" "Windows"
    Assert-ZipContains $portableArtifact "agenthub-edge.exe" "Windows"
    Assert-ZipContains $portableArtifact "README.txt" "Windows"
    Assert-UpdaterLatestMetadata $latestJson $setupArtifact $signatureArtifact $package.version
}

Write-Host "`nTauri package readiness policy OK" -ForegroundColor Green
