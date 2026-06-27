#!/usr/bin/env pwsh
<#
AgentHub localhost real stack smoke.

Starts or probes the safe local-service subset for the observed product loop:
Web dev server, Desktop/Tauri renderer bridge, Hub health, and Local Edge.

The only service this script always tries to start is Local Edge with the
built-in mock runner and a temporary SQLite store. Web/Desktop start only when
the app workspace dependencies are already present. Hub is probe-only because
the current server entrypoint requires external database and Redis services.

RealTested remains false. The script does not perform TokenDanceID login,
real CLI/model/API execution, deploy, signing, package build, or Mobile work.
#>

[CmdletBinding()]
param(
    [string]$RepoRoot = ".",
    [string]$ArtifactRoot = "",
    [string]$EvidencePath = "",
    [int]$TimeoutSec = 60,
    [switch]$SkipWeb,
    [switch]$SkipDesktop,
    [switch]$SkipEdge,
    [switch]$ProbeHub,
    [switch]$RequireWeb,
    [switch]$RequireDesktop,
    [switch]$RequireHub,
    [switch]$KeepServices,
    [string]$WebUrl = "http://127.0.0.1:5174",
    [string]$DesktopBridgeUrl = "http://127.0.0.1:5173",
    [string]$HubUrl = "http://127.0.0.1:8080",
    [string]$LocalEdgeUrl = "http://127.0.0.1:3210",
    [string]$WebHealthPath = "/",
    [string]$DesktopHealthPath = "/",
    [string]$HubHealthPath = "/health/live",
    [string]$EdgeHealthPath = "/v1/health"
)

$ErrorActionPreference = "Stop"

if ($TimeoutSec -le 0) {
    Write-Host "FAIL: -TimeoutSec must be greater than zero." -ForegroundColor Red
    exit 2
}

$RepoRoot = (Resolve-Path $RepoRoot).ProviderPath
if ([string]::IsNullOrWhiteSpace($ArtifactRoot)) {
    $ArtifactRoot = Join-Path $RepoRoot ".tmp\localhost-real-stack-smoke\run-$PID"
}
if ([System.IO.Path]::IsPathRooted($ArtifactRoot)) {
    $ArtifactRoot = [System.IO.Path]::GetFullPath($ArtifactRoot)
} else {
    $ArtifactRoot = [System.IO.Path]::GetFullPath((Join-Path $RepoRoot $ArtifactRoot))
}
if ([string]::IsNullOrWhiteSpace($EvidencePath)) {
    $EvidencePath = Join-Path $ArtifactRoot "localhost-real-stack-smoke.json"
}
if ([System.IO.Path]::IsPathRooted($EvidencePath)) {
    $EvidencePath = [System.IO.Path]::GetFullPath($EvidencePath)
} else {
    $EvidencePath = [System.IO.Path]::GetFullPath((Join-Path $RepoRoot $EvidencePath))
}

$StartedProcesses = @()
$Services = @()
$Failures = @()
$Warnings = @()
$StartedAt = Get-Date
$LogRoot = Join-Path $ArtifactRoot "logs"
$EdgeDbPath = Join-Path $ArtifactRoot "edge\agenthub-edge.sqlite"
$CleanupStatus = "not_started"
$real_cli_or_model_invoked = $false

function Add-Failure([string]$Text) {
    $script:Failures += $Text
    Write-Host "FAIL: $Text" -ForegroundColor Red
}

function Add-Warning([string]$Text) {
    $script:Warnings += $Text
    Write-Host "WARN: $Text" -ForegroundColor Yellow
}

function Pass([string]$Text) {
    Write-Host "PASS: $Text" -ForegroundColor Green
}

function Redact-SecretLike {
    param([string]$Value)

    if ([string]::IsNullOrEmpty($Value)) {
        return $Value
    }

    $safe = $Value
    $safe = $safe -replace '(?i)(Authorization:\s*Bearer\s+)[^"''\s,}]+', '${1}<redacted-token>'
    $safe = $safe -replace '(?i)(bearer\s+)[a-z0-9._-]{12,}', '${1}<redacted-token>'
    $safe = $safe -replace '(?i)(sk|ghp|gho|ghu|ghs|glpat|xox[baprs])-[-_A-Za-z0-9]{8,}', '<redacted-token>'
    $safe = $safe -replace '(?i)((?:access[_-]?token|refresh[_-]?token|id[_-]?token|client_secret|password)\s*[=:]\s*)[^"''\s,}]+', '${1}<redacted-secret>'
    $safe = $safe -replace '(?i)("?(?:access[_-]?token|refresh[_-]?token|id[_-]?token|client_secret|password)"?\s*:\s*")[^"]+', '${1}<redacted-secret>'
    return $safe
}

function Test-PathUnderRoot {
    param(
        [string]$Path,
        [string]$Root
    )

    $normalized = [System.IO.Path]::GetFullPath($Path).TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
    $normalizedRoot = [System.IO.Path]::GetFullPath($Root).TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
    if ($normalized.Equals($normalizedRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        return $true
    }
    $prefix = $normalizedRoot + [System.IO.Path]::DirectorySeparatorChar
    return $normalized.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)
}

function Test-AllowedArtifactRoot([string]$Path) {
    $candidate = [System.IO.Path]::GetFullPath($Path)
    $tempBase = if (-not [string]::IsNullOrWhiteSpace($env:TEMP)) { $env:TEMP } else { [System.IO.Path]::GetTempPath() }
    $allowedRoots = @(
        (Join-Path $RepoRoot ".tmp\localhost-real-stack-smoke"),
        (Join-Path $RepoRoot "tmp\localhost-real-stack-smoke"),
        (Join-Path $tempBase "AgentHub\localhost-real-stack-smoke")
    )
    foreach ($root in $allowedRoots) {
        if (Test-PathUnderRoot -Path $candidate -Root $root) {
            return $true
        }
    }
    return $false
}

function Test-LoopbackHttpUrl([string]$Url) {
    try {
        $uri = [System.Uri]::new($Url)
        if ($uri.Scheme -ne "http") {
            return $false
        }
        return @("127.0.0.1", "localhost", "::1", "[::1]") -contains $uri.Host.ToLowerInvariant()
    }
    catch {
        return $false
    }
}

function Join-UrlPath {
    param(
        [string]$BaseUrl,
        [string]$Path
    )

    if ([string]::IsNullOrWhiteSpace($Path)) {
        return $BaseUrl
    }
    if ($Path.StartsWith("/")) {
        return $BaseUrl.TrimEnd("/") + $Path
    }
    return $BaseUrl.TrimEnd("/") + "/" + $Path
}

function Get-UrlPort([string]$Url) {
    try {
        return [System.Uri]::new($Url).Port
    }
    catch {
        return $null
    }
}

function Join-NativeArguments {
    param([string[]]$Arguments)

    $quoted = foreach ($arg in $Arguments) {
        if ($null -eq $arg) {
            '""'
            continue
        }
        if ($arg -notmatch '[\s"]' -and $arg.Length -gt 0) {
            $arg
            continue
        }

        $builder = [System.Text.StringBuilder]::new()
        [void]$builder.Append('"')
        $slashes = 0
        foreach ($char in $arg.ToCharArray()) {
            if ($char -eq '\') {
                $slashes++
                continue
            }
            if ($char -eq '"') {
                [void]$builder.Append(('\' * (($slashes * 2) + 1)))
                [void]$builder.Append('"')
                $slashes = 0
                continue
            }
            if ($slashes -gt 0) {
                [void]$builder.Append(('\' * $slashes))
                $slashes = 0
            }
            [void]$builder.Append($char)
        }
        if ($slashes -gt 0) {
            [void]$builder.Append(('\' * ($slashes * 2)))
        }
        [void]$builder.Append('"')
        $builder.ToString()
    }

    return ($quoted -join " ")
}

function Add-Service {
    param([object]$Service)

    $script:Services += [pscustomobject]$Service
}

function Invoke-HealthProbe {
    param(
        [string]$Name,
        [string]$BaseUrl,
        [string]$HealthPath,
        [string]$ExpectedPattern = "",
        [int]$Timeout = $TimeoutSec
    )

    $healthUrl = Join-UrlPath $BaseUrl $HealthPath
    $deadline = (Get-Date).AddSeconds($Timeout)
    $lastError = ""
    do {
        try {
            $response = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 2
            $body = [string]$response.Content
            $matched = if ([string]::IsNullOrWhiteSpace($ExpectedPattern)) { $true } else { $body -match $ExpectedPattern }
            return [pscustomobject][ordered]@{
                name = $Name
                url = $BaseUrl
                health_url = $healthUrl
                status_code = [int]$response.StatusCode
                status = if ($matched) { "healthy" } else { "wrong_marker" }
                expected_pattern = $ExpectedPattern
                marker_matched = $matched
                body_excerpt = Redact-SecretLike $(if ($body.Length -gt 240) { $body.Substring(0, 240) } else { $body })
            }
        }
        catch {
            $lastError = $_.Exception.Message
            Start-Sleep -Milliseconds 350
        }
    } while ((Get-Date) -lt $deadline)

    return [pscustomobject][ordered]@{
        name = $Name
        url = $BaseUrl
        health_url = $healthUrl
        status_code = $null
        status = "missing"
        error = Redact-SecretLike $lastError
    }
}

function Start-ManagedProcess {
    param(
        [string]$Name,
        [string]$FileName,
        [string[]]$Arguments,
        [string]$WorkingDirectory
    )

    $psi = [System.Diagnostics.ProcessStartInfo]::new()
    $psi.FileName = $FileName
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.WorkingDirectory = $WorkingDirectory
    $psi.Arguments = Join-NativeArguments $Arguments
    $psi.Environment["BROWSER"] = "none"
    $psi.Environment["AGENTHUB_LOCALHOST_SMOKE"] = "1"

    $proc = [System.Diagnostics.Process]::Start($psi)
    $script:StartedProcesses += [pscustomobject]@{
        name = $Name
        process = $proc
        file_name = $FileName
        arguments = $Arguments
        working_directory = $WorkingDirectory
    }
    return $proc
}

function Test-AppDependencies {
    $viteRoot = Join-Path $RepoRoot "app\node_modules\.bin\vite.cmd"
    $vitePs1 = Join-Path $RepoRoot "app\node_modules\.bin\vite.ps1"
    return ((Test-Path -LiteralPath $viteRoot -PathType Leaf) -or (Test-Path -LiteralPath $vitePs1 -PathType Leaf))
}

function Start-ViteService {
    param(
        [string]$Name,
        [string]$AppDir,
        [string]$BaseUrl,
        [string]$HealthPath,
        [string]$ExpectedPattern
    )

    $pre = Invoke-HealthProbe -Name $Name -BaseUrl $BaseUrl -HealthPath $HealthPath -ExpectedPattern $ExpectedPattern -Timeout 2
    if ($pre.status -eq "healthy") {
        $pre | Add-Member -NotePropertyName started_by_harness -NotePropertyValue $false
        $pre | Add-Member -NotePropertyName start_mode -NotePropertyValue "preexisting"
        Add-Service $pre
        Pass "$Name already healthy"
        return
    }

    if (-not (Test-AppDependencies)) {
        Add-Service ([ordered]@{
            name = $Name
            url = $BaseUrl
            health_url = Join-UrlPath $BaseUrl $HealthPath
            status = "blocked"
            started_by_harness = $false
            blocker = "app workspace dependencies missing; run cd app; corepack.cmd pnpm install --frozen-lockfile"
        })
        Add-Warning "$Name not started because app dependencies are missing"
        return
    }

    $corepack = Get-Command corepack.cmd -ErrorAction SilentlyContinue
    if (-not $corepack) {
        Add-Service ([ordered]@{
            name = $Name
            url = $BaseUrl
            health_url = Join-UrlPath $BaseUrl $HealthPath
            status = "blocked"
            started_by_harness = $false
            blocker = "corepack.cmd is unavailable"
        })
        Add-Warning "$Name not started because corepack.cmd is unavailable"
        return
    }

    $port = Get-UrlPort $BaseUrl
    Start-ManagedProcess -Name $Name -FileName $corepack.Source -Arguments @("pnpm", "--dir", $AppDir, "exec", "vite", "--host", "127.0.0.1", "--port", ([string]$port), "--strictPort") -WorkingDirectory $AppDir | Out-Null
    $probe = Invoke-HealthProbe -Name $Name -BaseUrl $BaseUrl -HealthPath $HealthPath -ExpectedPattern $ExpectedPattern
    $probe | Add-Member -NotePropertyName started_by_harness -NotePropertyValue $true
    $probe | Add-Member -NotePropertyName start_mode -NotePropertyValue "vite"
    Add-Service $probe
    if ($probe.status -eq "healthy") {
        Pass "$Name started and probed"
    } else {
        Add-Failure "$Name failed to become healthy"
    }
}

function Start-EdgeService {
    $name = "local-edge"
    $pre = Invoke-HealthProbe -Name $name -BaseUrl $LocalEdgeUrl -HealthPath $EdgeHealthPath -ExpectedPattern '"version"\s*:\s*"v1"' -Timeout 2
    if ($pre.status -eq "healthy") {
        $pre | Add-Member -NotePropertyName started_by_harness -NotePropertyValue $false
        $pre | Add-Member -NotePropertyName start_mode -NotePropertyValue "preexisting"
        Add-Service $pre
        Pass "Local Edge already healthy"
        return
    }

    $go = Get-Command go -ErrorAction SilentlyContinue
    if (-not $go) {
        Add-Service ([ordered]@{
            name = $name
            url = $LocalEdgeUrl
            health_url = Join-UrlPath $LocalEdgeUrl $EdgeHealthPath
            status = "blocked"
            started_by_harness = $false
            blocker = "go executable is unavailable"
        })
        Add-Failure "Local Edge cannot start because go is unavailable"
        return
    }

    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $EdgeDbPath) | Out-Null
    $port = Get-UrlPort $LocalEdgeUrl
    $addr = "127.0.0.1:$port"
    Start-ManagedProcess -Name $name -FileName $go.Source -Arguments @(
        "run",
        ".\cmd\agenthub-edge",
        "--addr", $addr,
        "--store-backend", "sqlite",
        "--store-db", $EdgeDbPath,
        "--runner-profile", "agenthub-runner-mock"
    ) -WorkingDirectory (Join-Path $RepoRoot "edge-server") | Out-Null

    $probe = Invoke-HealthProbe -Name $name -BaseUrl $LocalEdgeUrl -HealthPath $EdgeHealthPath -ExpectedPattern '"version"\s*:\s*"v1"'
    $probe | Add-Member -NotePropertyName started_by_harness -NotePropertyValue $true
    $probe | Add-Member -NotePropertyName start_mode -NotePropertyValue "go-run"
    $probe | Add-Member -NotePropertyName store_backend -NotePropertyValue "sqlite"
    $probe | Add-Member -NotePropertyName runner_profile -NotePropertyValue "agenthub-runner-mock"
    Add-Service $probe
    if ($probe.status -eq "healthy") {
        Pass "Local Edge mock+SQLite started and probed"
    } else {
        Add-Failure "Local Edge failed to become healthy"
    }
}

function Write-Evidence {
    $started = foreach ($entry in $StartedProcesses) {
        [ordered]@{
            name = $entry.name
            pid = $entry.process.Id
            file_name = Split-Path -Leaf $entry.file_name
            working_directory = $entry.working_directory
            started = -not $entry.process.HasExited
        }
    }

    $hasHealthyEdge = @($Services | Where-Object { $_.name -eq "local-edge" -and $_.status -eq "healthy" }).Count -gt 0
    $status = if ($Failures.Count -eq 0 -and $hasHealthyEdge) { "LOCAL_STACK_SMOKE_PARTIAL_PASSED" } else { "LOCAL_STACK_SMOKE_FAILED" }

    $evidence = [ordered]@{
        schema = "agenthub-localhost-real-stack-smoke-v1"
        status = $status
        generated_at = (Get-Date).ToString("o")
        started_at = $StartedAt.ToString("o")
        real_tested = $false
        readiness_only = $true
        repo_root = $RepoRoot
        artifact_root = $ArtifactRoot
        evidence_path = $EvidencePath
        claims = [ordered]@{
            real_tokendance_id_login = $false
            real_cli_or_model_invoked = $real_cli_or_model_invoked
            real_api_budget_spend = $false
            public_deploy_used = $false
            signing_or_release_used = $false
            mobile_touched = $false
        }
        topology = [ordered]@{
            web = [ordered]@{ url = $WebUrl; mode = if ($SkipWeb) { "skipped" } else { "start_or_probe" }; allowed_upstream = "hub" }
            hub = [ordered]@{ url = $HubUrl; mode = if ($ProbeHub) { "probe_only" } else { "not_requested" }; start_blocker = "server-hub requires external database and Redis services" }
            desktop_bridge = [ordered]@{ url = $DesktopBridgeUrl; mode = if ($SkipDesktop) { "skipped" } else { "start_or_probe" }; allowed_upstream = "local-edge" }
            local_edge = [ordered]@{ url = $LocalEdgeUrl; mode = if ($SkipEdge) { "skipped" } else { "mock_sqlite_start_or_probe" } }
        }
        local_edge = [ordered]@{
            url = $LocalEdgeUrl
            runner_profile = "agenthub-runner-mock"
            store_backend = "sqlite"
            store_db = $EdgeDbPath
            real_cli_or_model_invoked = $false
        }
        services = @($Services)
        started_processes = @($started)
        cleanup = [ordered]@{
            keep_services = [bool]$KeepServices
            status = $CleanupStatus
            strategy = if ($KeepServices) { "caller keeps harness-started services and must stop them manually" } else { "harness stops started processes before exit" }
        }
        logs = [ordered]@{
            root = $LogRoot
        }
        failures = @($Failures)
        warnings = @($Warnings)
        blockers = @(
            "Hub real startup still requires local database and Redis setup; this script probes Hub only",
            "Web/Desktop Vite startup requires app workspace dependencies to be installed",
            "Real CLI/model/API execution remains blocked by no-spend boundary",
            "Real TokenDanceID login, deploy, signing, release upload, and Mobile remain out of scope"
        )
    }

    $dir = Split-Path -Parent $EvidencePath
    if (-not [string]::IsNullOrWhiteSpace($dir)) {
        New-Item -ItemType Directory -Force -Path $dir | Out-Null
    }
    $json = $evidence | ConvertTo-Json -Depth 14
    $json = Redact-SecretLike $json
    $json | Set-Content -LiteralPath $EvidencePath -Encoding UTF8
    return $status
}

function Stop-StartedProcesses {
    if ($KeepServices) {
        $script:CleanupStatus = "kept_running"
        return
    }
    foreach ($entry in $StartedProcesses) {
        $proc = $entry.process
        if (-not $proc) {
            continue
        }

        $children = @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$($proc.Id)" -ErrorAction SilentlyContinue)
        foreach ($child in $children) {
            Stop-Process -Id $child.ProcessId -Force -ErrorAction SilentlyContinue
        }

        if (-not $proc.HasExited) {
            Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
        }
    }
    $script:CleanupStatus = "stopped_harness_processes"
}

Write-Host "AgentHub localhost real stack smoke" -ForegroundColor Magenta
Write-Host "Boundary: RealTested=false, RealCli=false, no API/model spend, no deploy/signing/release, no Mobile." -ForegroundColor Magenta

if (-not (Test-AllowedArtifactRoot $ArtifactRoot)) {
    Add-Failure "ArtifactRoot must stay under .tmp\localhost-real-stack-smoke, tmp\localhost-real-stack-smoke, or `$env:TEMP\AgentHub\localhost-real-stack-smoke"
}
if (-not (Test-PathUnderRoot -Path $EvidencePath -Root $ArtifactRoot)) {
    Add-Failure "EvidencePath must stay under ArtifactRoot"
}
foreach ($pair in @(
    @{ Name = "WebUrl"; Value = $WebUrl },
    @{ Name = "DesktopBridgeUrl"; Value = $DesktopBridgeUrl },
    @{ Name = "HubUrl"; Value = $HubUrl },
    @{ Name = "LocalEdgeUrl"; Value = $LocalEdgeUrl }
)) {
    if (-not (Test-LoopbackHttpUrl $pair.Value)) {
        Add-Failure "$($pair.Name) must be loopback HTTP"
    }
}

New-Item -ItemType Directory -Force -Path $ArtifactRoot, $LogRoot | Out-Null

try {
    if ($Failures.Count -eq 0) {
        if ($SkipWeb) {
            Add-Service ([ordered]@{ name = "web"; url = $WebUrl; health_url = Join-UrlPath $WebUrl $WebHealthPath; status = "skipped"; started_by_harness = $false })
        } else {
            Start-ViteService -Name "web" -AppDir (Join-Path $RepoRoot "app\web") -BaseUrl $WebUrl -HealthPath $WebHealthPath -ExpectedPattern '<div id="root"|AgentHub|agenthub'
        }

        if ($ProbeHub) {
            $hub = Invoke-HealthProbe -Name "hub" -BaseUrl $HubUrl -HealthPath $HubHealthPath -ExpectedPattern '"status"\s*:\s*"ok"|healthy|live'
            $hub | Add-Member -NotePropertyName started_by_harness -NotePropertyValue $false
            $hub | Add-Member -NotePropertyName start_mode -NotePropertyValue "probe_only"
            Add-Service $hub
            if ($hub.status -eq "healthy") {
                Pass "Hub probe is healthy"
            } elseif ($RequireHub) {
                Add-Failure "Hub probe failed and -RequireHub was set"
            } else {
                Add-Warning "Hub probe did not pass; recorded as blocker"
            }
        } else {
            Add-Service ([ordered]@{ name = "hub"; url = $HubUrl; health_url = Join-UrlPath $HubUrl $HubHealthPath; status = "not_requested"; started_by_harness = $false; blocker = "probe not requested" })
        }

        if ($SkipDesktop) {
            Add-Service ([ordered]@{ name = "desktop"; url = $DesktopBridgeUrl; health_url = Join-UrlPath $DesktopBridgeUrl $DesktopHealthPath; status = "skipped"; started_by_harness = $false })
        } else {
            Start-ViteService -Name "desktop" -AppDir (Join-Path $RepoRoot "app\desktop") -BaseUrl $DesktopBridgeUrl -HealthPath $DesktopHealthPath -ExpectedPattern '<div id="root"|AgentHub|agenthub'
        }

        if ($SkipEdge) {
            Add-Service ([ordered]@{ name = "local-edge"; url = $LocalEdgeUrl; health_url = Join-UrlPath $LocalEdgeUrl $EdgeHealthPath; status = "skipped"; started_by_harness = $false })
        } else {
            Start-EdgeService
        }

        if ($RequireWeb -and @($Services | Where-Object { $_.name -eq "web" -and $_.status -eq "healthy" }).Count -eq 0) {
            Add-Failure "Web was required but is not healthy"
        }
        if ($RequireDesktop -and @($Services | Where-Object { $_.name -eq "desktop" -and $_.status -eq "healthy" }).Count -eq 0) {
            Add-Failure "Desktop was required but is not healthy"
        }
    }
}
finally {
    Stop-StartedProcesses
    $status = Write-Evidence
}

Write-Host "EvidencePath: $EvidencePath" -ForegroundColor White
Write-Host "RealTested=false" -ForegroundColor White
Write-Host "RealCli=false" -ForegroundColor White

if ($status -eq "LOCAL_STACK_SMOKE_PARTIAL_PASSED") {
    Write-Host "Status: LOCAL_STACK_SMOKE_PARTIAL_PASSED" -ForegroundColor Green
    exit 0
}

Write-Host "Status: LOCAL_STACK_SMOKE_FAILED" -ForegroundColor Red
exit 1
