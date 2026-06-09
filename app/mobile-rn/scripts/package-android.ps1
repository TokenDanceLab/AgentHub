param(
    [string]$RepoRoot = "",
    [ValidateSet("Release", "Debug")]
    [string]$BuildType = "Release",
    [string]$Version = "",
    [string]$ShortRepoRoot = "D:\ah\agenthub-mobile",
    [string]$VirtualStoreDir = "D:\p\agenthub-mobile",
    [string]$ArtifactsRoot = ".tmp\android-package",
    [string]$InstallSerial = "",
    [switch]$SkipInstall,
    [switch]$SkipPrebuild,
    [switch]$Launch
)

$ErrorActionPreference = "Stop"

function Step([string]$Message) {
    Write-Host "`n>>> $Message" -ForegroundColor Cyan
}

function Fail([string]$Message) {
    Write-Host "FAIL: $Message" -ForegroundColor Red
    exit 1
}

function Pass([string]$Message) {
    Write-Host "PASS: $Message" -ForegroundColor Green
}

function Resolve-RepoRoot {
    if ($RepoRoot) {
        return (Resolve-Path -LiteralPath $RepoRoot).Path
    }

    $scriptDir = Split-Path -Parent $PSCommandPath
    return (Resolve-Path -LiteralPath (Join-Path $scriptDir "..\..\..")).Path
}

function Assert-UnderRepo {
    param(
        [string]$Path,
        [string]$Label
    )

    $full = [System.IO.Path]::GetFullPath($Path).TrimEnd([char[]]@('\', '/'))
    $repoFull = [System.IO.Path]::GetFullPath($script:RepoRootResolved).TrimEnd([char[]]@('\', '/'))
    $repoChildPrefix = $repoFull + [System.IO.Path]::DirectorySeparatorChar
    if (-not ($full.Equals($repoFull, [System.StringComparison]::OrdinalIgnoreCase) -or $full.StartsWith($repoChildPrefix, [System.StringComparison]::OrdinalIgnoreCase))) {
        Fail "$Label must stay inside repo worktree: $full"
    }

    return $full
}

function Invoke-CmdChecked {
    param(
        [string]$Label,
        [string]$WorkingDirectory,
        [string]$Command
    )

    Step $Label
    $escapedWorkingDirectory = $WorkingDirectory.TrimEnd('\')
    $fullCommand = "cd /d `"$escapedWorkingDirectory`" && $Command"
    & cmd.exe /d /s /c $fullCommand
    if ($LASTEXITCODE -ne 0) {
        Fail "$Label failed with exit code $LASTEXITCODE"
    }
    Pass $Label
}

function Ensure-ShortRepoRoot {
    param(
        [string]$Path,
        [string]$Target
    )

    $shortFull = [System.IO.Path]::GetFullPath($Path).TrimEnd('\')
    $targetFull = [System.IO.Path]::GetFullPath($Target).TrimEnd('\')
    if (Test-Path -LiteralPath $shortFull) {
        $item = Get-Item -LiteralPath $shortFull -Force
        $existingTarget = if ($item.LinkType -eq "Junction") { [string]$item.Target } else { "" }
        $existingFull = if ($existingTarget) { [System.IO.Path]::GetFullPath($existingTarget).TrimEnd('\') } else { "" }
        $targetFull = [System.IO.Path]::GetFullPath($Target).TrimEnd('\')
        if ($item.LinkType -ne "Junction" -or -not $existingFull.Equals($targetFull, [System.StringComparison]::OrdinalIgnoreCase)) {
            Fail "$shortFull exists and is not the expected junction to $targetFull"
        }

        Pass "$shortFull already points to repo worktree"
        return $shortFull
    }

    Step "Create short repo junction"
    New-Item -ItemType Directory -Path (Split-Path $shortFull) -Force | Out-Null
    & cmd.exe /d /s /c "mklink /J `"$shortFull`" `"$targetFull`"" | Out-Host
    if ($LASTEXITCODE -ne 0) {
        Fail "mklink /J failed for $shortFull => $targetFull"
    }
    Pass "$shortFull points to $targetFull"
    return $shortFull
}

function Read-PackageVersion {
    $pkgPath = Join-Path $script:MobileRoot "package.json"
    $pkg = Get-Content -LiteralPath $pkgPath -Raw -Encoding UTF8 | ConvertFrom-Json
    return [string]$pkg.version
}

function Get-Sha256Hash {
    param([string]$Path)

    if (Get-Command Get-FileHash -ErrorAction SilentlyContinue) {
        return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
    }

    $stream = [System.IO.File]::OpenRead($Path)
    try {
        $sha256 = [System.Security.Cryptography.SHA256]::Create()
        try {
            $bytes = $sha256.ComputeHash($stream)
            return (($bytes | ForEach-Object { $_.ToString("x2") }) -join "").ToUpperInvariant()
        } finally {
            $sha256.Dispose()
        }
    } finally {
        $stream.Dispose()
    }
}

$script:RepoRootResolved = Resolve-RepoRoot
$script:MobileRoot = Join-Path $script:RepoRootResolved "app\mobile-rn"
$appRoot = Join-Path $script:RepoRootResolved "app"
$androidRoot = Join-Path $script:MobileRoot "android"

if (-not (Test-Path -LiteralPath (Join-Path $script:MobileRoot "package.json") -PathType Leaf)) {
    Fail "AgentHub Mobile package.json not found under $script:MobileRoot"
}

$resolvedArtifactsRoot = if ([System.IO.Path]::IsPathRooted($ArtifactsRoot)) {
    $ArtifactsRoot
} else {
    Join-Path $script:RepoRootResolved $ArtifactsRoot
}
$resolvedArtifactsRoot = Assert-UnderRepo $resolvedArtifactsRoot "Android artifact root"

if (Test-Path -LiteralPath $resolvedArtifactsRoot) {
    Remove-Item -LiteralPath $resolvedArtifactsRoot -Recurse -Force
}
New-Item -ItemType Directory -Path $resolvedArtifactsRoot -Force | Out-Null

$packageVersion = Read-PackageVersion
if (-not $Version) {
    $Version = $packageVersion
}

$shortRepoRoot = Ensure-ShortRepoRoot $ShortRepoRoot $script:RepoRootResolved
$shortAppRoot = Join-Path $shortRepoRoot "app"
$shortMobileRoot = Join-Path $shortRepoRoot "app\mobile-rn"
$shortAndroidRoot = Join-Path $shortRepoRoot "app\mobile-rn\android"

if (-not [System.IO.Path]::IsPathRooted($VirtualStoreDir)) {
    $VirtualStoreDir = Join-Path (Split-Path $shortRepoRoot -Qualifier) $VirtualStoreDir
}

$virtualStoreRoot = [System.IO.Path]::GetPathRoot([System.IO.Path]::GetFullPath($VirtualStoreDir)).TrimEnd('\')
$shortRepoRootDrive = [System.IO.Path]::GetPathRoot($shortRepoRoot).TrimEnd('\')
if ($BuildType -eq "Release" -and -not $virtualStoreRoot.Equals($shortRepoRootDrive, [System.StringComparison]::OrdinalIgnoreCase)) {
    Fail "Release bundling requires pnpm virtual store and short repo root on the same drive. Got repo=$shortRepoRoot store=$VirtualStoreDir"
}
New-Item -ItemType Directory -Path $VirtualStoreDir -Force | Out-Null

$gradleTask = if ($BuildType -eq "Release") { "assembleRelease" } else { "assembleDebug" }
$apkRelative = if ($BuildType -eq "Release") {
    "app\build\outputs\apk\release\app-release.apk"
} else {
    "app\build\outputs\apk\debug\app-debug.apk"
}

Step "Android package settings"
Write-Host "RepoRoot: $script:RepoRootResolved"
Write-Host "ShortRepoRoot: $shortRepoRoot => $script:RepoRootResolved"
Write-Host "VirtualStoreDir: $VirtualStoreDir"
Write-Host "BuildType: $BuildType"
Write-Host "ArtifactsRoot: $resolvedArtifactsRoot"

if (-not $SkipInstall) {
    Invoke-CmdChecked "Install app dependencies with short pnpm virtual store" $shortAppRoot "set CI=true&& corepack.cmd pnpm install --frozen-lockfile --config.virtual-store-dir=`"$VirtualStoreDir`""
}

if (-not $SkipPrebuild) {
    Invoke-CmdChecked "Regenerate Android native project from Expo config" $shortMobileRoot "set NODE_ENV=production&& corepack.cmd pnpm exec expo prebuild --platform android --clean"
}

if (-not (Test-Path -LiteralPath $androidRoot -PathType Container)) {
    Fail "Android native project is missing after prebuild: $androidRoot"
}

Invoke-CmdChecked "Build Android $BuildType APK with embedded JS bundle" $shortAndroidRoot "set NODE_ENV=production&& gradlew.bat $gradleTask --stacktrace --no-daemon"

$apkPath = Join-Path $androidRoot $apkRelative
if (-not (Test-Path -LiteralPath $apkPath -PathType Leaf)) {
    Fail "APK was not produced: $apkPath"
}

$safeBuildType = $BuildType.ToLowerInvariant()
$assetName = "AgentHub-Mobile_${Version}_android-$safeBuildType.apk"
$artifactApk = Join-Path $resolvedArtifactsRoot $assetName
Copy-Item -LiteralPath $apkPath -Destination $artifactApk -Force
$apkHash = Get-Sha256Hash $artifactApk
$apkItem = Get-Item -LiteralPath $artifactApk

$manifest = [ordered]@{
    mode = "android-mobile-package"
    package = "tech.vectorcontrol.agenthub.mobile"
    appLabel = "AgentHub"
    version = $Version
    packageVersion = $packageVersion
    buildType = $BuildType
    repoRoot = $script:RepoRootResolved
    shortRepoRoot = $shortRepoRoot
    virtualStoreDir = $VirtualStoreDir
    sourceApk = $apkPath
    artifact = [ordered]@{
        name = $apkItem.Name
        path = $apkItem.FullName
        bytes = $apkItem.Length
        sha256 = $apkHash
    }
    stages = [ordered]@{
        install = if ($SkipInstall) { "skipped" } else { "passed" }
        prebuild = if ($SkipPrebuild) { "skipped" } else { "passed" }
        gradle = "passed"
    }
    device = $null
}

if ($InstallSerial) {
    Step "Install APK on Android device $InstallSerial"
    & adb.exe -s $InstallSerial install -r -d -g $artifactApk
    if ($LASTEXITCODE -ne 0) {
        Fail "adb install failed with exit code $LASTEXITCODE"
    }
    Pass "adb install completed"
    $deviceInfo = & adb.exe -s $InstallSerial shell getprop ro.product.model
    $manifest.device = [ordered]@{
        serial = $InstallSerial
        model = ($deviceInfo | Select-Object -First 1)
        installed = $true
        launched = $false
        pid = $null
        focus = $null
    }

    if ($Launch) {
        Step "Launch AgentHub on Android device"
        & adb.exe -s $InstallSerial shell monkey -p tech.vectorcontrol.agenthub.mobile -c android.intent.category.LAUNCHER 1 | Out-Host
        if ($LASTEXITCODE -ne 0) {
            Fail "adb launch failed with exit code $LASTEXITCODE"
        }
        Start-Sleep -Seconds 3
        $pid = (& adb.exe -s $InstallSerial shell pidof tech.vectorcontrol.agenthub.mobile | Select-Object -First 1)
        $focus = (& adb.exe -s $InstallSerial shell dumpsys window | Select-String -Pattern "mCurrentFocus|mFocusedApp" | ForEach-Object { $_.Line })
        $manifest.device.launched = $true
        $manifest.device.pid = $pid
        $manifest.device.focus = @($focus)
        Pass "AgentHub launch command completed"
    }
}

$manifestPath = Join-Path $resolvedArtifactsRoot "android-package-manifest.json"
$manifest | ConvertTo-Json -Depth 8 | Out-File -LiteralPath $manifestPath -Encoding UTF8

Step "Android package complete"
Get-ChildItem -LiteralPath $resolvedArtifactsRoot -File | Sort-Object Name | ForEach-Object {
    $sizeMb = [math]::Round($_.Length / 1MB, 2)
    Write-Host "  $($_.Name) ($sizeMb MB)"
}
