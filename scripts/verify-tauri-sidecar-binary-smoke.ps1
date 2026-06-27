$ErrorActionPreference = "Stop"
$target = Join-Path $PSScriptRoot "release\verify-tauri-sidecar-binary-smoke.ps1"
$global:LASTEXITCODE = 0
& $target @args
$wrapperSuccess = $?
$wrapperExitCode = $LASTEXITCODE
if (-not $wrapperSuccess -and $wrapperExitCode -eq 0) { exit 1 }
exit $wrapperExitCode
