$ErrorActionPreference = "Stop"
$target = Join-Path $PSScriptRoot "release\verify-agenthub-brand-assets.ps1"
$global:LASTEXITCODE = 0
& $target @args
$wrapperSuccess = $?
$wrapperExitCode = $LASTEXITCODE
if (-not $wrapperSuccess -and $wrapperExitCode -eq 0) { exit 1 }
exit $wrapperExitCode
