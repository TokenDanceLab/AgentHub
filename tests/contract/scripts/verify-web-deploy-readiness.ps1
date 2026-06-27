[CmdletBinding()]
param(
    [string]$RepoRoot = "."
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path $RepoRoot).ProviderPath
$Failed = 0

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

function Read-RepoText {
    param([string]$RelativePath)

    $path = Join-Path $RepoRoot $RelativePath
    Assert-True (Test-Path -LiteralPath $path) "$RelativePath exists"
    if (-not (Test-Path -LiteralPath $path)) {
        return ""
    }
    return Get-Content -Raw -LiteralPath $path -Encoding UTF8
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

function Invoke-ReadinessScript {
    param([string[]]$Arguments)

    $psi = [System.Diagnostics.ProcessStartInfo]::new()
    $psi.FileName = "pwsh"
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.WorkingDirectory = $RepoRoot
    $psi.Arguments = Join-NativeArguments $Arguments

    $proc = [System.Diagnostics.Process]::Start($psi)
    $stdout = $proc.StandardOutput.ReadToEnd()
    $stderr = $proc.StandardError.ReadToEnd()
    $proc.WaitForExit()

    [pscustomobject]@{
        ExitCode = $proc.ExitCode
        Output = ($stdout + "`n" + $stderr)
    }
}

$scriptPath = Join-Path $RepoRoot "scripts\verify-web-deploy-readiness.ps1"
$scriptText = Read-RepoText "scripts\verify-web-deploy-readiness.ps1"
$devEnvText = Read-RepoText "hub-server\.env.example"
$rootComposeText = Read-RepoText "docker-compose.yml"
$prodEnvText = Read-RepoText "hub-server\deployments\.env.production.example"
$prodComposeText = Read-RepoText "hub-server\deployments\docker-compose.prod.yml"

Assert-True ($scriptText -match 'docker-compose\.yml') "main readiness gate checks root docker-compose.yml"
Assert-True ($scriptText -match '5173/auth/tokendance/callback') "main readiness gate blocks stale Web 5173 callback"

foreach ($entry in @(
    @{ Text = $devEnvText; Name = "dev env"; Want = "http://localhost:5174/auth/tokendance/callback" },
    @{ Text = $rootComposeText; Name = "root compose"; Want = "http://localhost:5174/auth/tokendance/callback" },
    @{ Text = $devEnvText; Name = "dev env"; Want = "http://127.0.0.1:5174/auth/tokendance/callback" },
    @{ Text = $rootComposeText; Name = "root compose"; Want = "http://127.0.0.1:5174/auth/tokendance/callback" }
)) {
    Assert-True ($entry.Text -match [regex]::Escape($entry.Want)) "$($entry.Name) includes Web dev callback $($entry.Want)"
}

Assert-True ($devEnvText -notmatch '5173/auth/tokendance/callback') "dev env does not use Desktop 5173 as Web callback"
Assert-True ($rootComposeText -notmatch '5173/auth/tokendance/callback') "root compose does not use Desktop 5173 as Web callback"
Assert-True ($devEnvText -match [regex]::Escape("http://127.0.0.1/callback")) "dev env keeps Desktop/native loopback policy separate"
Assert-True ($rootComposeText -match [regex]::Escape("http://127.0.0.1/callback")) "root compose keeps Desktop/native loopback policy separate"

foreach ($entry in @(
    @{ Text = $prodEnvText; Name = "production env example" },
    @{ Text = $prodComposeText; Name = "production compose" }
)) {
    Assert-True ($entry.Text -match [regex]::Escape("https://hub.vectorcontrol.tech/auth/tokendance/callback")) "$($entry.Name) includes production Web browser callback"
    Assert-True ($entry.Text -match 'POST /client/auth/oidc/callback') "$($entry.Name) documents Hub OIDC exchange endpoint"
    Assert-True ($entry.Text -match [regex]::Escape("http://127.0.0.1/callback")) "$($entry.Name) keeps Desktop/native loopback policy separate"
}

$mainRun = Invoke-ReadinessScript @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", $scriptPath,
    "-RepoRoot", $RepoRoot
)
Assert-True ($mainRun.ExitCode -eq 0) "main Web deploy readiness script passes" $mainRun.Output

if ($Failed -gt 0) {
    exit 1
}
exit 0
