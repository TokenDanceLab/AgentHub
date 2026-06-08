param(
    [string]$WorkflowPath = ".github/workflows/checks.yml"
)

$ErrorActionPreference = "Stop"

function Fail([string]$Message) {
    throw "CI gate policy check failed: $Message"
}

function Get-JobBlock([string]$Workflow, [string]$JobName) {
    $pattern = "(?ms)^  $([regex]::Escape($JobName)):\r?\n(?<body>.*?)(?=^  [A-Za-z0-9_-]+:|\z)"
    $match = [regex]::Match($Workflow, $pattern)
    if (-not $match.Success) {
        Fail "missing job '$JobName'"
    }
    return $match.Groups["body"].Value
}

function Get-StepBlock([string]$JobBlock, [string]$StepName) {
    $pattern = "(?ms)^\s+- name: $([regex]::Escape($StepName))\r?\n(?<body>.*?)(?=^\s+- name:|\z)"
    $match = [regex]::Match($JobBlock, $pattern)
    if (-not $match.Success) {
        Fail "missing step '$StepName'"
    }
    return $match.Groups["body"].Value
}

function Assert-Contains([string]$Text, [string]$Pattern, [string]$Message) {
    if ($Text -notmatch $Pattern) {
        Fail $Message
    }
}

function Assert-NotContains([string]$Text, [string]$Pattern, [string]$Message) {
    if ($Text -match $Pattern) {
        Fail $Message
    }
}

function Assert-StepContinueOnError([string]$JobBlock, [string]$StepName, [bool]$Expected) {
    $step = Get-StepBlock $JobBlock $StepName
    $hasContinue = $step -match "(?m)^\s+continue-on-error:\s+true\s*$"
    if ($hasContinue -ne $Expected) {
        $want = if ($Expected) { "warning-only" } else { "hard-blocking" }
        Fail "step '$StepName' must be $want"
    }
}

if (-not (Test-Path -LiteralPath $WorkflowPath)) {
    Fail "workflow file not found: $WorkflowPath"
}

$workflow = Get-Content -LiteralPath $WorkflowPath -Raw
$edge = Get-JobBlock $workflow "go-edge"
$hub = Get-JobBlock $workflow "go-hub"
$backendFixture = Get-JobBlock $workflow "backend-e2e-fixture"
$backendFocused = Get-JobBlock $workflow "backend-focused-subset"
$desktop = Get-JobBlock $workflow "frontend-desktop"
$web = Get-JobBlock $workflow "frontend-web"
$mobile = Get-JobBlock $workflow "frontend-mobile"
$e2e = Get-JobBlock $workflow "e2e-smoke"
$validate = Get-JobBlock $workflow "validate"

Assert-Contains $edge "THRESHOLD=75" "go-edge coverage threshold must be 75%"
Assert-Contains $hub "THRESHOLD=40" "go-hub coverage threshold must be 40%"

Assert-StepContinueOnError $edge "Lint" $true
Assert-StepContinueOnError $hub "Lint" $true
Assert-StepContinueOnError $edge "Security scan (gosec)" $true
Assert-StepContinueOnError $hub "Security scan (gosec)" $true
Assert-StepContinueOnError $edge "Vulnerability check (govulncheck)" $false
Assert-StepContinueOnError $hub "Vulnerability check (govulncheck)" $false

Assert-Contains $backendFixture "working-directory:\s+hub-server" "backend-e2e-fixture must run from hub-server"
Assert-Contains $backendFixture "TeamRun fixture E2E" "backend-e2e-fixture must name the TeamRun fixture step"
Assert-Contains $backendFixture ([regex]::Escape("go test ./tests/teamrun -run '^TestTeamRunSmoke$' -count=1")) "backend-e2e-fixture must run only the TeamRun fixture smoke test"
Assert-StepContinueOnError $backendFixture "TeamRun fixture E2E" $false

Assert-Contains $backendFocused "Backend focused subset" "backend-focused-subset must use a clear job name"
Assert-Contains $backendFocused "Hub focused backend packages" "backend-focused-subset must run the Hub focused backend package step"
Assert-Contains $backendFocused "Edge focused backend packages" "backend-focused-subset must run the Edge focused backend package step"
Assert-Contains $backendFocused ([regex]::Escape("cd hub-server && go test ./internal/repository ./internal/service ./internal/app ./internal/handler ./internal/router -short -count=1")) "backend-focused-subset must run the approved Hub focused backend packages"
Assert-Contains $backendFocused ([regex]::Escape("cd edge-server && go test ./internal/store ./internal/api ./internal/lifecycle ./cmd/agenthub-edge -short -count=1")) "backend-focused-subset must run the approved Edge focused backend packages"
Assert-StepContinueOnError $backendFocused "Hub focused backend packages" $false
Assert-StepContinueOnError $backendFocused "Edge focused backend packages" $false

$backendForbiddenPatterns = @(
    "-RealCli",
    "real[-_]?cli",
    "self-hosted",
    "services:",
    "integration-smoke.ps1",
    "edge-runtime-smoke.ps1",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "CODEX_",
    "CLAUDE_",
    "\bcodex\b",
    "\bclaude\b",
    "\bopencode\b",
    "postgres",
    "redis",
    "dev-up",
    "docker",
    "http://",
    "https://",
    "go test ./tests -count=1"
)

foreach ($forbidden in $backendForbiddenPatterns) {
    Assert-NotContains $backendFixture $forbidden "backend-e2e-fixture must not invoke '$forbidden'"
    Assert-NotContains $backendFocused $forbidden "backend-focused-subset must not invoke '$forbidden'"
}

foreach ($job in @(
    @{ Name = "frontend-desktop"; Body = $desktop; Lockfile = "app/pnpm-lock.yaml" },
    @{ Name = "frontend-web"; Body = $web; Lockfile = "app/pnpm-lock.yaml" },
    @{ Name = "frontend-mobile"; Body = $mobile; Lockfile = "app/pnpm-lock.yaml" },
    @{ Name = "e2e-smoke"; Body = $e2e; Lockfile = "app/pnpm-lock.yaml" }
)) {
    Assert-Contains $job.Body "pnpm/action-setup@v4" "$($job.Name) must install pnpm explicitly"
    Assert-Contains $job.Body "cache:\s+pnpm" "$($job.Name) must enable pnpm cache"
    Assert-Contains $job.Body ([regex]::Escape($job.Lockfile)) "$($job.Name) must cache the correct pnpm lockfile"
}

Assert-Contains $validate "Verify CI gate policy" "validate job must run the CI gate policy verifier"
Assert-Contains $validate "scripts/verify-ci-gates\.ps1" "validate job must call scripts/verify-ci-gates.ps1"
Assert-Contains $validate "Validate OpenAPI YAML" "validate job must keep OpenAPI YAML parsing"
Assert-Contains $validate "check-secrets\.sh" "validate job must keep secret guard"

Write-Host "ci gate policy ok"
