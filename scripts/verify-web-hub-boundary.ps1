#!/usr/bin/env pwsh
<#
AgentHub Web Hub-boundary checks.

This script is intentionally secret-free and structural. It prevents the
browser Web app from drifting back into direct Local Edge control. Production
Web must go through Hub sessions/messages/tasks; Desktop owns Local Edge
`/v1/runs` and `/v1/events`.
#>

[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")

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

function Step([string]$Text) {
    Write-Host "`n=== $Text ===" -ForegroundColor Cyan
}

function Read-RepoFile([string]$RelativePath) {
    $path = Join-Path $RepoRoot $RelativePath
    if (-not (Test-Path -LiteralPath $path)) {
        Fail "missing $RelativePath"
        return ""
    }
    return Get-Content -Raw -LiteralPath $path
}

function Assert-Contains([string]$RelativePath, [string]$Pattern, [string]$Label) {
    $content = Read-RepoFile $RelativePath
    if ($content -match $Pattern) {
        Pass $Label
    } else {
        Fail "$Label ($RelativePath missing pattern: $Pattern)"
    }
}

function Assert-NotContains([string]$RelativePath, [string]$Pattern, [string]$Label) {
    $content = Read-RepoFile $RelativePath
    if ($content -notmatch $Pattern) {
        Pass $Label
    } else {
        Fail "$Label ($RelativePath contains pattern: $Pattern)"
    }
}

function Assert-PathMissing([string]$RelativePath, [string]$Label) {
    $path = Join-Path $RepoRoot $RelativePath
    if (-not (Test-Path -LiteralPath $path)) {
        Pass $Label
    } else {
        Fail "$Label ($RelativePath should not exist)"
    }
}

function Assert-NoSourceMatches([string]$RootRelativePath, [string]$Pattern, [string]$Label) {
    $root = Join-Path $RepoRoot $RootRelativePath
    $matches = @(
        Get-ChildItem -LiteralPath $root -Recurse -File -Include *.ts,*.tsx,*.js,*.jsx |
            Select-String -Pattern $Pattern
    )
    if ($matches.Count -eq 0) {
        Pass $Label
        return
    }

    Fail $Label
    foreach ($match in $matches | Select-Object -First 20) {
        $relative = Resolve-Path -LiteralPath $match.Path -Relative
        Write-Host "    ${relative}:$($match.LineNumber): $($match.Line.Trim())" -ForegroundColor DarkYellow
    }
}

Step "Web app must not own Local Edge transport"
Assert-PathMissing "app/web/src/hooks/useHubIntegration.ts" "Web legacy Hub-to-Edge bridge hook is removed"
Assert-PathMissing "app/web/src/api/eventClient.ts" "Web direct Edge event client is removed"
Assert-PathMissing "app/web/src/hooks/useEventStream.ts" "Web direct Edge event hook is removed"
Assert-PathMissing "app/web/src/hooks/useChatMessages.ts" "Web direct Edge chat reducer is removed"
Assert-PathMissing "app/web/src/hooks/useRunners.ts" "Web direct runner polling hook is removed"

Step "Web preview APIs are explicit stubs"
Assert-Contains "app/web/src/api/edgeClient.ts" "status: 'hub-only'" "Web health is explicitly Hub-only"
Assert-Contains "app/web/src/api/edgeClient.ts" "browser code does not probe Local Edge" "Web health explains Local Edge is not probed"
Assert-Contains "app/web/src/config.ts" "WS_URL = ''" "Web Edge WebSocket URL is empty"
Assert-NotContains "app/web/src/api/edgeClient.ts" "127\\.0\\.0\\.1:3210" "Web edgeClient does not target Local Edge"
Assert-NotContains "app/web/src/api/edgeClient.ts" "/v1/events" "Web edgeClient does not open Edge events"
Assert-NotContains "app/web/src/api/edgeClient.ts" "/v1/runs" "Web edgeClient does not post Edge runs"

Step "Web source has no direct Edge control calls"
Assert-NoSourceMatches "app/web/src" "127\\.0\\.0\\.1:3210|/v1/events|/v1/runs|createEventStream|edgeBaseUrl" "No Web source references direct Edge control endpoints"

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  Passed: $Passed  |  Failed: $Failed" -ForegroundColor $(if ($Failed -eq 0) { "Green" } else { "Red" })
Write-Host "========================================" -ForegroundColor Cyan

if ($Failed -ne 0) {
    exit 1
}
