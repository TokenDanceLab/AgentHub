#!/usr/bin/env pwsh
<#
Verify that the browser Web app stays Hub-only.

The Web client may use Hub REST/WS and Hub-issued sessions. It must not open
Local Edge event streams or invoke Edge run-control APIs directly; Desktop owns
the Local Edge bridge.
#>

[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$WebSrc = Join-Path $RepoRoot "app/web/src"

$Passed = 0
$Failed = 0

function Pass([string]$Text) {
    $script:Passed++
    Write-Host "  PASS  $Text" -ForegroundColor Green
}

function Fail([string]$Text) {
    $script:Failed++
    Write-Host "  FAIL  $Text" -ForegroundColor Red
}

function Relative([string]$Path) {
    return [System.IO.Path]::GetRelativePath($RepoRoot, $Path).Replace("\", "/")
}

Write-Host "`n=== Web Hub-only boundary ===" -ForegroundColor Cyan

$RemovedEdgeFiles = @(
    "app/web/src/api/edgeAuth.ts",
    "app/web/src/api/eventClient.ts",
    "app/web/src/hooks/useChatMessages.ts",
    "app/web/src/hooks/useEdgeStatus.ts",
    "app/web/src/hooks/useEventStream.ts",
    "app/web/src/hooks/useHubIntegration.ts",
    "app/web/src/hooks/useRunners.ts"
)

foreach ($relativePath in $RemovedEdgeFiles) {
    $path = Join-Path $RepoRoot $relativePath
    if (Test-Path -LiteralPath $path) {
        Fail "$relativePath should not exist in browser Web"
    } else {
        Pass "$relativePath remains removed"
    }
}

$SourceFiles = Get-ChildItem -LiteralPath $WebSrc -Recurse -File |
    Where-Object { $_.Extension -in @(".ts", ".tsx", ".js", ".jsx") }

$BoundaryFiles = Get-ChildItem -LiteralPath $WebSrc -Recurse -File |
    Where-Object { $_.Extension -in @(".ts", ".tsx", ".js", ".jsx", ".json") }

$JsonFiles = Get-ChildItem -LiteralPath $WebSrc -Recurse -File |
    Where-Object { $_.Extension -eq ".json" }

$ForbiddenPatterns = @(
    @{ Pattern = "127\.0\.0\.1:3210|localhost:3210"; Label = "Local Edge loopback URL" },
    @{ Pattern = "/v1/events|/v1/runs"; Label = "Local Edge event/run API" },
    @{ Pattern = "edgeBaseUrl|edgeAuthHeaders|withEdgeAuthQuery|createEventStream"; Label = "legacy Edge bridge helper" },
    @{ Pattern = "@tauri-apps/|app/desktop/|src-tauri|desktopHost|localEdgeRuntime"; Label = "Desktop/Tauri import or runtime reference" }
)

foreach ($entry in $ForbiddenPatterns) {
    $matches = $BoundaryFiles | Select-String -Pattern $entry.Pattern
    if ($matches) {
        foreach ($match in $matches) {
            Fail "$($entry.Label) found in $(Relative $match.Path):$($match.LineNumber)"
        }
    } else {
        Pass "$($entry.Label) absent from app/web/src"
    }
}

$ForbiddenJsonCopyPatterns = @(
    @{ Pattern = "Local Edge|本地 Edge|Workbench Edge|工作台 Edge|Edge unavailable/error|Edge 不可用/错误|Edge API did not respond"; Label = "Local Edge user-facing copy" }
)

foreach ($entry in $ForbiddenJsonCopyPatterns) {
    $matches = $JsonFiles | Select-String -Pattern $entry.Pattern
    if ($matches) {
        foreach ($match in $matches) {
            Fail "$($entry.Label) found in $(Relative $match.Path):$($match.LineNumber)"
        }
    } else {
        Pass "$($entry.Label) absent from app/web/src JSON"
    }
}

$EdgeClientPath = Join-Path $RepoRoot "app/web/src/api/edgeClient.ts"
if (-not (Test-Path -LiteralPath $EdgeClientPath)) {
    Fail "app/web/src/api/edgeClient.ts missing Hub-only compatibility stub"
} else {
    $edgeClient = Get-Content -Raw -LiteralPath $EdgeClientPath
    if ($edgeClient.Contains("fetch(") -or $edgeClient.Contains("new WebSocket")) {
        Fail "app/web/src/api/edgeClient.ts must stay a Hub-only stub without network calls"
    } else {
        Pass "app/web/src/api/edgeClient.ts has no direct network call"
    }

    if ($edgeClient.Contains("status: 'hub-only'") -and $edgeClient.Contains("stubbed")) {
        Pass "app/web/src/api/edgeClient.ts labels runtime inventory as Hub-only stubbed"
    } else {
        Fail "app/web/src/api/edgeClient.ts must label runtime inventory as Hub-only stubbed"
    }
}

$WebPlatformPath = Join-Path $RepoRoot "app/web/src/platform/webPlatform.ts"
if (-not (Test-Path -LiteralPath $WebPlatformPath)) {
    Fail "app/web/src/platform/webPlatform.ts missing"
} else {
    $webPlatform = Get-Content -Raw -LiteralPath $WebPlatformPath
    if ($webPlatform.Contains("localEdge: false") -and $webPlatform.Contains("localFiles: false")) {
        Pass "app/web/src/platform/webPlatform.ts declares no Local Edge or local file capability"
    } else {
        Fail "app/web/src/platform/webPlatform.ts must declare localEdge: false and localFiles: false"
    }
}

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  Passed: $Passed  |  Failed: $Failed" -ForegroundColor $(if ($Failed -eq 0) { "Green" } else { "Red" })
Write-Host "========================================" -ForegroundColor Cyan

if ($Failed -ne 0) {
    exit 1
}
