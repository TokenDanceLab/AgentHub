[CmdletBinding()]
param(
    [switch]$Help,
    [switch]$SkipBuild,
    [ValidateSet("claude-code", "codex", "opencode")]
    [Alias("Agent")]
    [string]$Runtime = "claude-code",
    [string]$CliPath = "",
    [switch]$RealCli,
    [switch]$AllowMissingCli,
    [switch]$SkipCli,
    [string]$Prompt = "reply with just the word ok",
    [int]$TimeoutSec = 60,
    [string]$EdgeUrl = "",
    [string]$EdgeHost = "127.0.0.1",
    [int]$Port = 3299,
    [string]$EdgeBinary = (Join-Path ([System.IO.Path]::GetTempPath()) "agenthub-edge-runtime-smoke.exe"),
    [string]$LogDir = "",
    [string]$OutputJson = "",
    [switch]$IncludeLocalPaths
)

$target = Join-Path $PSScriptRoot "edge-runtime-smoke.ps1"
if (-not (Test-Path $target)) {
    Write-Error "missing forwarded script: $target"
    exit 2
}

Write-Warning "scripts/integration-e2e.ps1 is deprecated and now forwards to scripts/edge-runtime-smoke.ps1. This is an Edge runtime smoke gate, not a full Hub/PG/Redis/OIDC E2E gate."

$forward = @{}
foreach ($key in $PSBoundParameters.Keys) {
    $forward[$key] = $PSBoundParameters[$key]
}

if (-not $forward.ContainsKey("Runtime")) {
    $forward["Runtime"] = $Runtime
}

$psi = [System.Diagnostics.ProcessStartInfo]::new()
$psi.FileName = "pwsh"
$psi.UseShellExecute = $false
$psi.ArgumentList.Add("-NoProfile") | Out-Null
$psi.ArgumentList.Add("-ExecutionPolicy") | Out-Null
$psi.ArgumentList.Add("Bypass") | Out-Null
$psi.ArgumentList.Add("-File") | Out-Null
$psi.ArgumentList.Add($target) | Out-Null
foreach ($key in $forward.Keys) {
    $value = $forward[$key]
    if ($value -is [System.Management.Automation.SwitchParameter]) {
        if ($value.IsPresent) {
            $psi.ArgumentList.Add("-$key") | Out-Null
        }
        continue
    }
    if ($null -eq $value) {
        continue
    }
    foreach ($item in @($value)) {
        $psi.ArgumentList.Add("-$key") | Out-Null
        $psi.ArgumentList.Add([string]$item) | Out-Null
    }
}

$proc = [System.Diagnostics.Process]::Start($psi)
$proc.WaitForExit()
exit $proc.ExitCode
