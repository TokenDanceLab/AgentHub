[CmdletBinding()]
param(
    [string]$RepoRoot = "."
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path $RepoRoot).ProviderPath
$Failed = 0
$TempRoots = @()

function Assert-True {
    param(
        [bool]$Condition,
        [string]$Message,
        [string]$Details = ""
    )

    if ($Condition) {
        Write-Host "PASS: $Message" -ForegroundColor Green
        return
    }

    $script:Failed++
    Write-Host "FAIL: $Message" -ForegroundColor Red
    if (-not [string]::IsNullOrWhiteSpace($Details)) {
        Write-Host $Details
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

function Invoke-RepoScript {
    param([string[]]$Arguments)

    $powershell = Get-Command powershell -ErrorAction SilentlyContinue
    if (-not $powershell) {
        $powershell = Get-Command pwsh -ErrorAction Stop
    }

    $psi = [System.Diagnostics.ProcessStartInfo]::new()
    $psi.FileName = $powershell.Source
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.WorkingDirectory = $RepoRoot
    $psi.Arguments = "-NoProfile -ExecutionPolicy Bypass -File " + (Join-NativeArguments $Arguments)

    $proc = [System.Diagnostics.Process]::Start($psi)
    $stdout = $proc.StandardOutput.ReadToEnd()
    $stderr = $proc.StandardError.ReadToEnd()
    $proc.WaitForExit()

    [pscustomobject]@{
        ExitCode = $proc.ExitCode
        Output = ($stdout + "`n" + $stderr)
    }
}

function Get-FreePort {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Parse("127.0.0.1"), 0)
    $listener.Start()
    try {
        return $listener.LocalEndpoint.Port
    }
    finally {
        $listener.Stop()
    }
}

function Test-PortListening {
    param([int]$Port)

    $client = [System.Net.Sockets.TcpClient]::new()
    try {
        $async = $client.BeginConnect("127.0.0.1", $Port, $null, $null)
        if (-not $async.AsyncWaitHandle.WaitOne(500)) {
            return $false
        }
        $client.EndConnect($async)
        return $true
    }
    catch {
        return $false
    }
    finally {
        $client.Close()
    }
}

$scriptPath = Join-Path $RepoRoot "scripts\smoke\verify-localhost-real-stack-smoke.ps1"
$scriptImplementationPath = Join-Path $RepoRoot "scripts\smoke\verify-localhost-real-stack-smoke.ps1"
$docPath = Join-Path $RepoRoot "docs\audit\p1-localhost-real-stack-smoke.md"

Assert-True (Test-Path -LiteralPath $scriptPath) "real local stack smoke script exists"
Assert-True (Test-Path -LiteralPath $scriptImplementationPath) "real local stack smoke script implementation exists"

try {
    $tmpRoot = Join-Path $RepoRoot ".tmp\localhost-real-stack-smoke\script-test-$PID"
    Remove-Item -LiteralPath $tmpRoot -Recurse -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Force -Path $tmpRoot | Out-Null
    $TempRoots += $tmpRoot

    if (Test-Path -LiteralPath $scriptImplementationPath) {
        $scriptText = Get-Content -Raw -LiteralPath $scriptImplementationPath
        Assert-True ($scriptText -match "agenthub-localhost-real-stack-smoke-v1") "script writes a stable manifest schema"
        Assert-True ($scriptText -match "agenthub-runner-mock") "script starts Local Edge with mock runner only"
        Assert-True ($scriptText -match "--store-backend" -and $scriptText -match "sqlite" -and $scriptText -match "--store-db") "script starts Local Edge with SQLite store"
        Assert-True ($scriptText -match 'real_cli_or_model_invoked\s*=\s*\$false') "script keeps real CLI/model invocation false"
        Assert-True ($scriptText -notmatch "claude-code|codex|opencode") "script does not start real CLI runtime profiles"
        $mobileRnPathPattern = ("app" + "\\mobile-rn|app" + "/mobile-rn")
        Assert-True ($scriptText -notmatch $mobileRnPathPattern) "script does not touch Mobile RN"

        $edgePort = Get-FreePort
        $hubPort = Get-FreePort
        $evidencePath = Join-Path $tmpRoot "real-stack-smoke.json"
        $run = Invoke-RepoScript @(
            $scriptPath,
            "-RepoRoot", $RepoRoot,
            "-ArtifactRoot", $tmpRoot,
            "-EvidencePath", $evidencePath,
            "-SkipWeb",
            "-SkipDesktop",
            "-ProbeHub",
            "-HubUrl", "http://127.0.0.1:$hubPort",
            "-LocalEdgeUrl", "http://127.0.0.1:$edgePort",
            "-TimeoutSec", "45"
        )

        Assert-True ($run.ExitCode -eq 0) "smoke starts or probes Local Edge mock+SQLite without Web/Desktop" $run.Output
        Assert-True ($run.Output -match "LOCAL_STACK_SMOKE_PARTIAL_PASSED") "smoke reports partial local stack pass" $run.Output
        Assert-True ($run.Output -match "RealTested=false") "smoke output keeps RealTested false" $run.Output
        Assert-True (Test-Path -LiteralPath $evidencePath) "smoke evidence file is written"

        if (Test-Path -LiteralPath $evidencePath) {
            $jsonText = Get-Content -Raw -LiteralPath $evidencePath
            $json = $jsonText | ConvertFrom-Json
            Assert-True ($json.schema -eq "agenthub-localhost-real-stack-smoke-v1") "manifest schema is explicit"
            Assert-True ($json.real_tested -eq $false) "manifest keeps RealTested false"
            Assert-True ($json.claims.real_cli_or_model_invoked -eq $false) "manifest records no real CLI/model invocation"
            Assert-True ($json.claims.real_api_budget_spend -eq $false) "manifest records no API-budget spend"
            Assert-True ($json.claims.mobile_touched -eq $false) "manifest records Mobile untouched"
            Assert-True ($json.local_edge.runner_profile -eq "agenthub-runner-mock") "manifest records mock runner profile"
            Assert-True ($json.local_edge.store_backend -eq "sqlite") "manifest records SQLite store backend"
            Assert-True ($json.local_edge.url -eq "http://127.0.0.1:$edgePort") "manifest records overridden Local Edge URL"
            Assert-True (@($json.services | Where-Object { $_.name -eq "local-edge" -and $_.status -eq "healthy" }).Count -eq 1) "Local Edge service is healthy"
            Assert-True (@($json.services | Where-Object { $_.name -eq "web" -and $_.status -eq "skipped" }).Count -eq 1) "Web service can be intentionally skipped"
            Assert-True (@($json.services | Where-Object { $_.name -eq "desktop" -and $_.status -eq "skipped" }).Count -eq 1) "Desktop service can be intentionally skipped"
            Assert-True (@($json.services | Where-Object { $_.name -eq "hub" }).Count -eq 1) "Hub probe status is recorded"
            Assert-True (-not (Test-PortListening -Port $edgePort)) "harness stops Local Edge process tree after smoke"
            Assert-True ($jsonText -notmatch "Authorization:\s*Bearer|sk-[A-Za-z0-9]|client_secret|password") "manifest is redacted"
        }
    }

    Assert-True (Test-Path -LiteralPath $docPath) "real local stack smoke doc exists"
    if (Test-Path -LiteralPath $docPath) {
        $docText = Get-Content -Raw -LiteralPath $docPath
        Assert-True ($docText -match "verify-localhost-real-stack-smoke\.ps1") "doc names the smoke command"
        Assert-True ($docText -match "agenthub-runner-mock") "doc names mock Local Edge runner"
        Assert-True ($docText -match "SQLite") "doc names SQLite store evidence"
        Assert-True ($docText -match "RealTested=false") "doc states RealTested=false"
        Assert-True ($docText -match "Hub") "doc states Hub is probe-only unless already running"
    }
}
finally {
    foreach ($path in $TempRoots) {
        Remove-Item -LiteralPath $path -Recurse -Force -ErrorAction SilentlyContinue
    }
}

if ($Failed -gt 0) {
    exit 1
}
exit 0
