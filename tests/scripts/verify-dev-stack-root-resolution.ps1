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

function Invoke-PowerShellFile {
    param(
        [string]$ScriptPath,
        [string[]]$Arguments
    )

    $psi = [System.Diagnostics.ProcessStartInfo]::new()
    $psi.FileName = "powershell"
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.WorkingDirectory = $RepoRoot
    $nativeArgs = @($ScriptPath) + @($Arguments)
    $psi.Arguments = "-NoProfile -ExecutionPolicy Bypass -File " + (Join-NativeArguments $nativeArgs)

    $proc = [System.Diagnostics.Process]::Start($psi)
    $stdout = $proc.StandardOutput.ReadToEnd()
    $stderr = $proc.StandardError.ReadToEnd()
    $proc.WaitForExit()

    [pscustomobject]@{
        ExitCode = $proc.ExitCode
        Output = ($stdout + "`n" + $stderr)
    }
}

function Invoke-InstrumentedScenario {
    param(
        [string]$HarnessPath,
        [string]$ScriptPath,
        [string]$ExpectedRepoRoot,
        [string]$Scenario
    )

    $run = Invoke-PowerShellFile -ScriptPath $HarnessPath -Arguments @(
        "-ScriptPath", $ScriptPath,
        "-ExpectedRepoRoot", $ExpectedRepoRoot,
        "-Scenario", $Scenario
    )

    $jsonLine = ($run.Output -split "`r?`n" | Where-Object { $_ -like "__RESULT__*" } | Select-Object -Last 1)
    $details = if ([string]::IsNullOrWhiteSpace($jsonLine)) { $run.Output } else { $jsonLine.Substring("__RESULT__".Length) }
    $parsed = $null
    if (-not [string]::IsNullOrWhiteSpace($jsonLine)) {
        $parsed = $jsonLine.Substring("__RESULT__".Length) | ConvertFrom-Json
    }

    [pscustomobject]@{
        ExitCode = $run.ExitCode
        Output = $run.Output
        Result = $parsed
        Details = $details
    }
}

$devStartPath = Join-Path $RepoRoot "scripts\dev-start.ps1"
$devDownPath = Join-Path $RepoRoot "scripts\dev-down.ps1"
$devUpPath = Join-Path $RepoRoot "scripts\dev-up.ps1"

Assert-True (Test-Path -LiteralPath $devStartPath) "dev-start script exists"
Assert-True (Test-Path -LiteralPath $devDownPath) "dev-down script exists"
Assert-True (Test-Path -LiteralPath $devUpPath) "dev-up script exists"

try {
    $tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) "agenthub-dev-stack-root-$PID-$([Guid]::NewGuid().ToString('N'))"
    New-Item -ItemType Directory -Force -Path $tempRoot | Out-Null
    $TempRoots += $tempRoot

    $fakeRepoRoot = Join-Path $tempRoot "AgentHub"
    $fakeScriptsRoot = Join-Path $fakeRepoRoot "scripts"
    $fakeDesktopRoot = Join-Path $fakeRepoRoot "app\desktop\node_modules"
    $fakeEdgeRoot = Join-Path $fakeRepoRoot "edge-server"
    $fakeHubRoot = Join-Path $fakeRepoRoot "hub-server"
    foreach ($dir in @($fakeScriptsRoot, $fakeDesktopRoot, $fakeEdgeRoot, $fakeHubRoot)) {
        New-Item -ItemType Directory -Force -Path $dir | Out-Null
    }

    Copy-Item -LiteralPath $devStartPath -Destination (Join-Path $fakeScriptsRoot "dev-start.ps1")
    Copy-Item -LiteralPath $devDownPath -Destination (Join-Path $fakeScriptsRoot "dev-down.ps1")
    Copy-Item -LiteralPath $devUpPath -Destination (Join-Path $fakeScriptsRoot "dev-up.ps1")

    $harnessPath = Join-Path $tempRoot "instrument-dev-stack-root.ps1"
    $harnessSource = @'
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ScriptPath,
    [Parameter(Mandatory = $true)]
    [string]$ExpectedRepoRoot,
    [Parameter(Mandatory = $true)]
    [ValidateSet("dev-start", "dev-down", "dev-up")]
    [string]$Scenario
)

$ErrorActionPreference = "Stop"
$observed = [ordered]@{
    scenario = $Scenario
    processCalls = @()
    dockerCalls = @()
    goCalls = @()
    pnpmInstallCalls = @()
    getCommandCalls = @()
    harnessStopped = $false
    failed = $false
    error = ""
}
$listeners = @()
$sleepCount = 0

function Add-Observation {
    param(
        [string]$Name,
        $Value
    )

    $current = @($script:observed[$Name])
    $current += $Value
    $script:observed[$Name] = $current
}

function Start-Process {
    param(
        [string]$FilePath,
        [string[]]$ArgumentList,
        [string]$WorkingDirectory,
        [switch]$PassThru,
        [switch]$NoNewWindow
    )

    Add-Observation "processCalls" ([ordered]@{
        filePath = $FilePath
        args = @($ArgumentList)
        workingDirectory = $WorkingDirectory
    })

    [pscustomobject]@{
        Id = 2000 + @($script:observed.processCalls).Count
    }
}

function Get-Process {
    param([int]$Id)
    return $null
}

function Stop-Process {
    param([int]$Id, [switch]$Force)
}

function taskkill {
    param(
        [string[]]$Args
    )
}

function Get-Command {
    param(
        [Parameter(Mandatory = $true, Position = 0)]
        [string]$Name,
        [Parameter(ValueFromRemainingArguments = $true)]
        $Remaining
    )

    Add-Observation "getCommandCalls" $Name
    if ($Name -in @("go", "node", "pnpm")) {
        return [pscustomobject]@{
            Name = $Name
            Source = "$Name.exe"
            CommandType = "Application"
        }
    }

    Microsoft.PowerShell.Core\Get-Command -Name $Name @Remaining
}

function Start-Sleep {
    param(
        [int]$Seconds,
        [int]$Milliseconds
    )

    $script:sleepCount++
    if ($Scenario -eq "dev-start" -and $script:sleepCount -ge 1) {
        throw "HARNESS_STOP"
    }
}

function pnpm {
    param([Parameter(ValueFromRemainingArguments = $true)] [object[]]$Arguments)

    Add-Observation "pnpmInstallCalls" ([ordered]@{
        cwd = (Get-Location).Path
        args = @($Arguments | ForEach-Object { [string]$_ })
    })
    $global:LASTEXITCODE = 0
}

function docker {
    param([Parameter(ValueFromRemainingArguments = $true)] [object[]]$Arguments)

    $argList = @($Arguments | ForEach-Object { [string]$_ })
    Add-Observation "dockerCalls" ([ordered]@{
        cwd = (Get-Location).Path
        args = $argList
    })

    $global:LASTEXITCODE = 0
    if ($argList -contains "pg_isready") {
        return "accepting connections"
    }
    if ($argList -contains "ping") {
        return "PONG"
    }
    return ""
}

function go {
    param([Parameter(ValueFromRemainingArguments = $true)] [object[]]$Arguments)

    Add-Observation "goCalls" ([ordered]@{
        cwd = (Get-Location).Path
        args = @($Arguments | ForEach-Object { [string]$_ })
    })
    $global:LASTEXITCODE = 0
    throw "HARNESS_STOP"
}

if ($Scenario -eq "dev-start") {
    foreach ($port in @(3210, 8080, 5173)) {
        $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Parse("127.0.0.1"), $port)
        $listener.Start()
        $listeners += $listener
    }
}

try {
    . $ScriptPath
}
catch {
    if ($_.Exception.Message -eq "HARNESS_STOP") {
        $script:observed.harnessStopped = $true
    }
    else {
        $script:observed.failed = $true
        $script:observed.error = $_ | Out-String
    }
}
finally {
    foreach ($listener in $listeners) {
        $listener.Stop()
    }
}

Write-Output ("__RESULT__" + ($observed | ConvertTo-Json -Depth 8 -Compress))
'@
    Set-Content -LiteralPath $harnessPath -Value $harnessSource -Encoding UTF8

    $devStartRun = Invoke-InstrumentedScenario -HarnessPath $harnessPath -ScriptPath (Join-Path $fakeScriptsRoot "dev-start.ps1") -ExpectedRepoRoot $fakeRepoRoot -Scenario "dev-start"
    Assert-True ($devStartRun.ExitCode -eq 0) "dev-start harness exits cleanly" $devStartRun.Output
    Assert-True ($null -ne $devStartRun.Result) "dev-start harness returns structured result" $devStartRun.Output
    if ($null -ne $devStartRun.Result) {
        Assert-True (-not $devStartRun.Result.failed) "dev-start script runs under harness without unexpected errors" $devStartRun.Details
        Assert-True ($devStartRun.Result.harnessStopped) "dev-start harness stops after readiness loop without real long-running services" $devStartRun.Details
        $expectedStartDirs = @(
            (Join-Path $fakeRepoRoot "edge-server"),
            (Join-Path $fakeRepoRoot "hub-server"),
            (Join-Path $fakeRepoRoot "app\desktop")
        )
        $actualStartDirs = @($devStartRun.Result.processCalls | ForEach-Object { $_.workingDirectory })
        Assert-True (($actualStartDirs.Count -eq 3)) "dev-start launches exactly Edge, Hub, and Desktop under harness" $devStartRun.Details
        Assert-True ((Compare-Object -ReferenceObject $expectedStartDirs -DifferenceObject $actualStartDirs).Count -eq 0) "dev-start resolves working directories from AgentHub repo root" ($devStartRun.Result.processCalls | ConvertTo-Json -Depth 6)
        Assert-True (@($devStartRun.Result.pnpmInstallCalls).Count -eq 0) "dev-start does not reinstall desktop deps when node_modules exists under repo root" ($devStartRun.Result.pnpmInstallCalls | ConvertTo-Json -Depth 6)
    }

    $devDownRun = Invoke-InstrumentedScenario -HarnessPath $harnessPath -ScriptPath (Join-Path $fakeScriptsRoot "dev-down.ps1") -ExpectedRepoRoot $fakeRepoRoot -Scenario "dev-down"
    Assert-True ($devDownRun.ExitCode -eq 0) "dev-down harness exits cleanly" $devDownRun.Output
    Assert-True ($null -ne $devDownRun.Result) "dev-down harness returns structured result" $devDownRun.Output
    if ($null -ne $devDownRun.Result) {
        Assert-True (-not $devDownRun.Result.failed) "dev-down script runs under harness without unexpected errors" $devDownRun.Details
        Assert-True (@($devDownRun.Result.dockerCalls).Count -ge 1) "dev-down reaches docker compose down under harness" $devDownRun.Details
        $downCwd = if (@($devDownRun.Result.dockerCalls).Count -gt 0) { $devDownRun.Result.dockerCalls[0].cwd } else { "" }
        Assert-True ($downCwd -eq $fakeRepoRoot) "dev-down pushes to AgentHub repo root before docker compose down" ($devDownRun.Result.dockerCalls | ConvertTo-Json -Depth 6)
    }

    $devUpRun = Invoke-InstrumentedScenario -HarnessPath $harnessPath -ScriptPath (Join-Path $fakeScriptsRoot "dev-up.ps1") -ExpectedRepoRoot $fakeRepoRoot -Scenario "dev-up"
    Assert-True ($devUpRun.ExitCode -eq 0) "dev-up harness exits cleanly" $devUpRun.Output
    Assert-True ($null -ne $devUpRun.Result) "dev-up harness returns structured result" $devUpRun.Output
    if ($null -ne $devUpRun.Result) {
        Assert-True (-not $devUpRun.Result.failed) "dev-up script runs under harness without unexpected errors" $devUpRun.Details
        Assert-True ($devUpRun.Result.harnessStopped) "dev-up harness stops at the fake go run boundary without starting Hub" $devUpRun.Details
        Assert-True (@($devUpRun.Result.dockerCalls).Count -ge 3) "dev-up reaches docker compose and readiness probes under harness" $devUpRun.Details
        $upDockerCwd = if (@($devUpRun.Result.dockerCalls).Count -gt 0) { $devUpRun.Result.dockerCalls[0].cwd } else { "" }
        Assert-True ($upDockerCwd -eq $fakeRepoRoot) "dev-up keeps docker compose anchored at AgentHub repo root" ($devUpRun.Result.dockerCalls | ConvertTo-Json -Depth 6)
        $goCwd = if (@($devUpRun.Result.goCalls).Count -gt 0) { $devUpRun.Result.goCalls[0].cwd } else { "" }
        Assert-True ($goCwd -eq $fakeRepoRoot) "dev-up keeps go run anchored at AgentHub repo root" ($devUpRun.Result.goCalls | ConvertTo-Json -Depth 6)
    }
}
finally {
    foreach ($path in $TempRoots) {
        Remove-Item -LiteralPath $path -Recurse -Force -ErrorAction SilentlyContinue
    }
}

if ($Failed -gt 0) {
    Write-Host "verify-dev-stack-root-resolution: $Failed assertion(s) failed." -ForegroundColor Red
    exit 1
}

Write-Host "verify-dev-stack-root-resolution: all assertions passed." -ForegroundColor Green
