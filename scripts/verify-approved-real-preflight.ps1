$ErrorActionPreference = "Stop"
$target = Join-Path $PSScriptRoot "verify\verify-approved-real-preflight.ps1"
$global:LASTEXITCODE = 0
& $target @args
$wrapperSuccess = $?
$wrapperExitCode = $LASTEXITCODE
if (-not $wrapperSuccess -and $wrapperExitCode -eq 0) { exit 1 }
exit $wrapperExitCode
