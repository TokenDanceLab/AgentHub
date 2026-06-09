[CmdletBinding()]
param(
    [string]$RepoRoot = ""
)

$ErrorActionPreference = "Stop"
$Failed = 0

if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
    $scriptDir = if (-not [string]::IsNullOrWhiteSpace($PSScriptRoot)) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
    $RepoRoot = (Resolve-Path (Join-Path $scriptDir "..\..")).ProviderPath
}

function Assert-True {
    param(
        [bool]$Condition,
        [string]$Message,
        [string]$Details = ""
    )

    if ($Condition) {
        Write-Host "PASS $Message" -ForegroundColor Green
        return
    }

    $script:Failed++
    Write-Host "FAIL $Message" -ForegroundColor Red
    if (-not [string]::IsNullOrWhiteSpace($Details)) {
        Write-Host $Details -ForegroundColor DarkGray
    }
}

$scriptPath = Join-Path $RepoRoot "scripts\verify-edge-cli-json-readiness.ps1"
$contractTestPath = Join-Path $RepoRoot "edge-server\internal\adapters\cli_json_readiness_test.go"

Assert-True (Test-Path -LiteralPath $scriptPath) "CLI JSON readiness checker exists"
Assert-True (Test-Path -LiteralPath $contractTestPath) "CLI JSON readiness contract test exists"

if (Test-Path -LiteralPath $scriptPath) {
    $scriptText = Get-Content -LiteralPath $scriptPath -Raw
    Assert-True ($scriptText -match 'CLI_JSON_FIXTURE_READINESS_VERIFIED') "checker reports fixture readiness status"
    Assert-True ($scriptText -match 'go.*test.*internal/adapters') "checker runs focused adapter fixture tests"
    Assert-True ($scriptText -match 'No Codex, Claude Code, or OpenCode command was executed') "checker declares no real CLI execution"
    Assert-True ($scriptText -match 'noDirectRuntimeCommandPattern') "checker hard-forbids direct runtime commands"
    Assert-True ($scriptText -match 'forbiddenPrimitivePattern') "checker hard-forbids network/deploy/auth primitives"
    Assert-True ($scriptText -notmatch 'Start-Process|Invoke-Expression|Invoke-Command|System\.Diagnostics\.Process|ProcessStartInfo') "checker has no process execution primitive"
    Assert-True ($scriptText -notmatch '(?m)^\s*(?:&\s*)?(?:codex|claude|opencode)\b') "checker has no direct Codex/Claude/OpenCode command pattern"
}

if (Test-Path -LiteralPath $contractTestPath) {
    $contractText = Get-Content -LiteralPath $contractTestPath -Raw
    Assert-True ($contractText -match 'TestCLIJSONReadinessCommandPlansRedactPromptEnvAndPaths') "contract covers command plan redaction"
    Assert-True ($contractText -match 'TestCodexExecJSONReadinessFixtureMapsBatchOutputStatusAndError') "contract covers Codex exec JSONL"
    Assert-True ($contractText -match 'TestClaudeStreamJSONReadinessFixtureMapsPermissionDecisionAndStatus') "contract covers Claude stream-json permission bridge"
    Assert-True ($contractText -match 'TestOpenCodeJSONReadinessFixtureMapsPermissionRiskStatusAndMetadata') "contract covers OpenCode permission risk JSON"
    Assert-True ($contractText -match 'TestCLIJSONReadinessModelProviderMetadataBaseline') "contract covers model/provider metadata baseline"
}

if (Test-Path -LiteralPath $scriptPath) {
    $output = & pwsh -NoProfile -ExecutionPolicy Bypass -File $scriptPath -RepoRoot $RepoRoot 2>&1
    $exitCode = $LASTEXITCODE
    $outputText = ($output | Out-String)
    Assert-True ($exitCode -eq 0) "checker passes fixture-only readiness gate" $outputText
    Assert-True ($outputText -match 'Status: CLI_JSON_FIXTURE_READINESS_VERIFIED') "checker output reports verified status" $outputText
    Assert-True ($outputText -match 'No Codex, Claude Code, or OpenCode command was executed') "checker output reports no real CLI execution" $outputText
    Assert-True ($outputText -match 'No model API, auth/login, external URL, deploy, container, or remote target was used') "checker output reports no model/API/login/deploy execution" $outputText
}

if ($Failed -gt 0) {
    exit 1
}
exit 0
