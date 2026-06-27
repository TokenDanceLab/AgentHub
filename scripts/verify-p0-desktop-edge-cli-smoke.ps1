$ErrorActionPreference = "Stop"
$target = Join-Path $PSScriptRoot "smoke\verify-p0-desktop-edge-cli-smoke.ps1"
$global:LASTEXITCODE = 0
& $target @args
$wrapperSuccess = $?
$wrapperExitCode = $LASTEXITCODE
if (-not $wrapperSuccess -and $wrapperExitCode -eq 0) { exit 1 }
exit $wrapperExitCode
