#!/usr/bin/env pwsh
<#
AgentHub P1 Edge CLI JSON readiness gate.

This checker is fixture-only. It validates JSON parser contracts and command
plan redaction evidence without executing Codex, Claude Code, OpenCode, model
APIs, auth flows, deployment tools, containers, or remote targets.
#>

[CmdletBinding()]
param(
    [string]$RepoRoot = "."
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path $RepoRoot).ProviderPath
$Passed = 0
$Failed = 0

function Step([string]$Text) {
    Write-Host "`n=== $Text ===" -ForegroundColor Cyan
}

function Pass([string]$Text) {
    $script:Passed++
    Write-Host "  PASS  $Text" -ForegroundColor Green
}

function Fail([string]$Text) {
    $script:Failed++
    Write-Host "  FAIL  $Text" -ForegroundColor Red
}

function Read-RepoFile([string]$RelativePath) {
    $path = Join-Path $RepoRoot $RelativePath
    if (-not (Test-Path -LiteralPath $path)) {
        Fail "missing $RelativePath"
        return ""
    }

    return Get-Content -LiteralPath $path -Raw -Encoding UTF8
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
        Fail "$Label ($RelativePath contains forbidden pattern: $Pattern)"
    }
}

function Assert-GoTestPasses {
    $go = Get-Command go -ErrorAction SilentlyContinue
    if ($null -eq $go) {
        Fail "go executable is required for fixture parser tests"
        return
    }

    $edgeRoot = Join-Path $RepoRoot "edge-server"
    $previousLocation = Get-Location
    try {
        Set-Location $edgeRoot
        $output = & $go.Source test ./internal/adapters -run "Codex|Claude|OpenCode|CLI|JSON|Permission|Readiness" -short -count=1 2>&1
        if ($LASTEXITCODE -eq 0) {
            Pass "focused CLI JSON fixture parser tests pass"
        } else {
            Fail "focused CLI JSON fixture parser tests failed"
            $output | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
        }
    } finally {
        Set-Location $previousLocation
    }
}

Write-Host "AgentHub P1 Edge CLI JSON readiness fixture gate" -ForegroundColor Magenta
Write-Host "No Codex, Claude Code, or OpenCode command was executed." -ForegroundColor Magenta
Write-Host "No model API, auth/login, external URL, deploy, container, or remote target was used." -ForegroundColor Magenta

$noDirectRuntimeCommandPattern = '(?im)^\s*(?:&\s*)?(?:codex|claude|opencode)\b'
$forbiddenPrimitivePattern = @(
    ("Start" + "-Process"),
    ("Invoke" + "-Expression"),
    ("Invoke" + "-Command"),
    ("Invoke" + "-WebRequest"),
    ("Invoke" + "-RestMethod"),
    ("System" + "\.Diagnostics" + "\.Process"),
    ("Process" + "StartInfo"),
    ("curl" + "\s+https?://"),
    ("https?" + "://"),
    ("dock" + "er\b"),
    ("kube" + "ctl\b"),
    ("tauri" + "\s+build"),
    ("pnpm" + "\s+deploy"),
    ("npm" + "\s+publish"),
    ("auth" + "\s+login"),
    ("self" + "[- ]hosted")
) -join "|"

Step "fixture contract files"
Assert-Contains "edge-server\internal\adapters\cli_json_readiness_test.go" "TestCLIJSONReadinessCommandPlansRedactPromptEnvAndPaths" "command plan redaction contract exists"
Assert-Contains "edge-server\internal\adapters\cli_json_readiness_test.go" "codex exec --json|`"--json`"" "Codex exec JSONL fixture contract exists"
Assert-Contains "edge-server\internal\adapters\cli_json_readiness_test.go" "stream-json|control_request" "Claude stream-json permission bridge fixture exists"
Assert-Contains "edge-server\internal\adapters\cli_json_readiness_test.go" "permission\.asked|bypassPermissions" "OpenCode permission risk fixture exists"
Assert-Contains "edge-server\internal\adapters\cli_json_readiness_test.go" "DefaultModels" "model/provider metadata baseline exists"
Assert-Contains "edge-server\internal\adapters\invocation_plan.go" "PromptRedacted|NoSpendDefault|RealTested" "invocation plan carries redaction and no-spend flags"
Assert-Contains "edge-server\internal\adapters\opencode.go" "permission\.asked" "OpenCode parser maps permission.asked"
Assert-Contains "edge-server\internal\adapters\opencode.go" "decisionBridge" "OpenCode parser marks blocked non-interactive permission bridge"

Step "hard real-execution forbids"
Assert-NotContains "scripts\verify-edge-cli-json-readiness.ps1" $noDirectRuntimeCommandPattern "checker has no direct Codex/Claude/OpenCode command pattern"
Assert-NotContains "scripts\verify-edge-cli-json-readiness.ps1" $forbiddenPrimitivePattern "checker has no model/API/network/deploy/container/auth primitive"
Assert-NotContains "edge-server\internal\adapters\cli_json_readiness_test.go" $noDirectRuntimeCommandPattern "fixture tests have no direct runtime command line"

Step "focused fixture tests"
Assert-GoTestPasses

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  Passed: $Passed  |  Failed: $Failed" -ForegroundColor $(if ($Failed -eq 0) { "Green" } else { "Red" })
Write-Host "========================================" -ForegroundColor Cyan

if ($Failed -gt 0) {
    Write-Host "Status: CLI_JSON_FIXTURE_READINESS_FAILED" -ForegroundColor Red
    exit 1
}

Write-Host "Status: CLI_JSON_FIXTURE_READINESS_VERIFIED" -ForegroundColor Green
exit 0
