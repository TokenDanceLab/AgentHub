param(
    [string]$WorkflowPath = ".github/workflows/checks.yml"
)

$ErrorActionPreference = "Stop"

function Fail([string]$Message) {
    throw "CI gate policy check failed: $Message"
}

function Get-JobBlock([string]$Workflow, [string]$JobName) {
    # Comments between sibling jobs belong to neither job. Stop before those
    # comments when they are immediately followed by the next two-space job
    # key; otherwise policy checks can accidentally inspect the next job's
    # heading text (for example "PostgreSQL + Redis").
    $nextJob = "(?:  \#.*\r?\n|[ \t]*\r?\n)*  [A-Za-z0-9_-]+:"
    $pattern = "(?ms)^  $([regex]::Escape($JobName)):\r?\n(?<body>.*?)(?=^$nextJob|\z)"
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
$mobileLight = Get-JobBlock $workflow "frontend-mobile-light"
$e2e = Get-JobBlock $workflow "e2e-smoke"
$changes = Get-JobBlock $workflow "changes"
$visualShell = Get-JobBlock $workflow "visual-qa-shell"
$validate = Get-JobBlock $workflow "validate"
$backendPerf = Get-JobBlock $workflow "backend-perf-leak-gates"

Assert-Contains $edge "Coverage check \(informational\)" "go-edge overall coverage must stay informational"
Assert-Contains $edge "Coverage per-package minimums" "go-edge must keep per-package coverage minimums"
Assert-Contains $edge ([regex]::Escape('check_pkg "edge-server/internal/security/" 70 "security"')) "go-edge must keep security package coverage minimum"
Assert-Contains $edge ([regex]::Escape('check_pkg "edge-server/internal/lifecycle/" 60 "lifecycle"')) "go-edge must keep lifecycle package coverage minimum"
Assert-Contains $edge ([regex]::Escape('check_pkg "edge-server/internal/adapters/" 55 "adapters"')) "go-edge must keep adapters package coverage minimum"
Assert-Contains $hub "THRESHOLD=40" "go-hub coverage threshold must be 40%"

# #1536: Edge lint is at 0 issues and hardened to hard-blocking; Hub lint
# still carries pre-existing findings (tracked in #1573) and stays
# warning-only until a finding-fingerprint ratchet exists. Complexity
# exclusions remain separately owned by #1568.
Assert-StepContinueOnError $edge "Lint" $false
Assert-StepContinueOnError $hub "Lint" $true
# #1574: gosec findings triaged and cleared in both servers; the gosec
# security scan steps are hard-blocking (no continue-on-error).
Assert-StepContinueOnError $edge "Security scan (gosec)" $false
Assert-StepContinueOnError $hub "Security scan (gosec)" $false
Assert-StepContinueOnError $edge "Coverage per-package minimums" $false
Assert-NotContains $edge "Commit message check" "commit-message policy must not live in the path-filtered go-edge job"

# #1534：vuln 扫描收敛到独立 job（vuln-scan-go / vuln-scan-js）且 fail-closed；
# go-hub/go-edge 内不再要求重复的 continue-on-error govulncheck step。
$vulnGo = Get-JobBlock $workflow "vuln-scan-go"
$vulnJs = Get-JobBlock $workflow "vuln-scan-js"
Assert-Contains $vulnGo ([regex]::Escape("verify-vulnerability-gates.sh govulncheck")) "vuln-scan-go must run the fail-closed govulncheck verifier"
Assert-Contains $vulnJs ([regex]::Escape("verify-vulnerability-gates.sh pnpm-audit")) "vuln-scan-js must run the fail-closed pnpm audit verifier"
Assert-Contains $validate "Self-test vulnerability gates" "validate must self-test the vulnerability gates"

Assert-Contains $backendFixture "working-directory:\s+hub-server" "backend-e2e-fixture must run from hub-server"
Assert-Contains $backendFixture "TeamRun fixture E2E" "backend-e2e-fixture must name the TeamRun fixture step"
Assert-Contains $backendFixture ([regex]::Escape("go test ./tests/teamrun -run '^TestTeamRunSmoke$' -count=1")) "backend-e2e-fixture must run only the TeamRun fixture smoke test"
Assert-StepContinueOnError $backendFixture "TeamRun fixture E2E" $false
Assert-Contains $backendFixture "P0 remote-control fixture readiness" "backend-e2e-fixture must run the P0 remote-control fixture readiness step"
Assert-Contains $backendFixture ([regex]::Escape("pwsh -NoProfile -ExecutionPolicy Bypass -File ./scripts/verify/verify-p0-remote-control-fixture.ps1")) "backend-e2e-fixture must run the P0 remote-control fixture readiness gate"
Assert-StepContinueOnError $backendFixture "P0 remote-control fixture readiness" $false

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
    "codesign",
    "signtool",
    "notarization",
    "notarytool",
    "cosign",
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
    @{ Name = "frontend-mobile-light"; Body = $mobileLight; Lockfile = "app/pnpm-lock.yaml" },
    @{ Name = "e2e-smoke"; Body = $e2e; Lockfile = "app/pnpm-lock.yaml" },
    @{ Name = "visual-qa-shell"; Body = $visualShell; Lockfile = "app/pnpm-lock.yaml" }
)) {
    # runtime major is governed by verify-action-runtimes.ps1 (#1580); here we
    # only require the pnpm setup step to exist with the pnpm cache wired up
    Assert-Contains $job.Body "pnpm/action-setup@" "$($job.Name) must install pnpm explicitly"
    Assert-Contains $job.Body "cache:\s+pnpm" "$($job.Name) must enable pnpm cache"
    Assert-Contains $job.Body ([regex]::Escape($job.Lockfile)) "$($job.Name) must cache the correct pnpm lockfile"
}

# #1535: coverage include contract — every frontend package counts ALL
# production src in the denominator (app/test-config/coverage.ts factory).
# The baseline gate runs all four packages plus a negative self-test proving
# imported-by-nobody modules are counted as 0% and trip the ratchet.
Assert-Contains $validate "Verify coverage baseline" "validate job must run the coverage baseline gate"
Assert-Contains $validate "scripts/verify/verify-coverage-baseline\.py" "validate job must call the coverage baseline verifier"
Assert-Contains $validate "Self-test coverage include contract" "validate job must run the coverage include negative self-test"
Assert-Contains $validate "coverage-include\.Tests\.ps1" "validate job must call the coverage include self-test"
Assert-StepContinueOnError $validate "Verify coverage baseline" $false
Assert-StepContinueOnError $validate "Self-test coverage include contract (negative)" $false

$ciPolicyStep = Get-StepBlock $validate "Verify CI gate policy"
Assert-Contains $ciPolicyStep "scripts/verify/verify-ci-gates\.ps1" "CI policy step must call scripts/verify/verify-ci-gates.ps1"

$commitMessageStep = Get-StepBlock $validate "Verify commit messages (PR only)"
Assert-Contains $commitMessageStep "scripts/verify/verify-commit-messages\.sh" "commit-message step must call the commit-message verifier"
Assert-Contains $commitMessageStep ([regex]::Escape('github.event.pull_request.head.sha')) "commit-message step must inspect the real PR head"
Assert-Contains $commitMessageStep ([regex]::Escape('origin/${{ github.base_ref }}')) "commit-message step must compare with the real base branch"
Assert-StepContinueOnError $validate "Verify commit messages (PR only)" $false

$commitMessageSelfTestStep = Get-StepBlock $validate "Self-test commit-message gate"
Assert-Contains $commitMessageSelfTestStep "verify-commit-messages\.Tests\.sh" "commit-message self-test step must call its test script"
Assert-StepContinueOnError $validate "Self-test commit-message gate" $false

$qualityDebtStep = Get-StepBlock $validate "Verify quality-debt ratchet (#1536)"
Assert-Contains $qualityDebtStep "scripts/verify/verify-quality-debt-ratchet\.ps1" "quality-debt step must call the ratchet verifier"
Assert-StepContinueOnError $validate "Verify quality-debt ratchet (#1536)" $false

$qualityDebtSelfTestStep = Get-StepBlock $validate "Self-test quality-debt ratchet (negative)"
Assert-Contains $qualityDebtSelfTestStep "verify-quality-debt-ratchet\.Tests\.ps1" "quality-debt self-test step must call its test script"
Assert-StepContinueOnError $validate "Self-test quality-debt ratchet (negative)" $false
Assert-Contains $validate "Verify project skill whitelist" "validate job must run the project skill whitelist verifier"
Assert-Contains $validate "scripts/verify/verify-project-skills\.ps1" "validate job must call scripts/verify/verify-project-skills.ps1"
$docSsotStep = Get-StepBlock $validate "Verify doc SSOT"
Assert-Contains $docSsotStep "scripts/verify/verify-doc-ssot\.py" "doc SSOT step must call scripts/verify/verify-doc-ssot.py"
Assert-StepContinueOnError $validate "Verify doc SSOT" $false

$docEntrypointSelfTestStep = Get-StepBlock $validate "Self-test doc entrypoint SSOT"
Assert-Contains $docEntrypointSelfTestStep "scripts/verify/tests/verify-doc-entrypoints\.Tests\.ps1" "doc entrypoint self-test step must call its test script"
Assert-StepContinueOnError $validate "Self-test doc entrypoint SSOT" $false
Assert-Contains $validate "Verify Web Hub-only boundary" "validate job must run the Web Hub-only boundary verifier"
Assert-Contains $validate "scripts/verify/verify-web-hub-boundary\.ps1" "validate job must call scripts/verify/verify-web-hub-boundary.ps1"
Assert-Contains $validate "Verify Hub pure package imports" "validate job must run the Hub pure package import verifier"
Assert-Contains $validate "scripts/verify/verify-hub-pure-packages\.ps1" "validate job must call scripts/verify/verify-hub-pure-packages.ps1"
Assert-StepContinueOnError $validate "Verify Hub pure package imports" $false
Assert-Contains $validate "Verify Mobile Hub-only boundary" "validate job must run the Mobile Hub-only boundary verifier"
Assert-Contains $validate "scripts/verify/verify-mobile-hub-boundary\.ps1" "validate job must call scripts/verify/verify-mobile-hub-boundary.ps1"
Assert-Contains $validate "Verify hubClient thin-shell SSOT" "validate job must run the hubClient thin-shell SSOT verifier"
Assert-Contains $validate "scripts/verify/verify-hubclient-ssot\.ps1" "validate job must call scripts/verify/verify-hubclient-ssot.ps1"
Assert-StepContinueOnError $validate "Verify hubClient thin-shell SSOT" $false
Assert-Contains $validate "Verify Design token SSOT" "validate job must run the design token SSOT verifier"
Assert-Contains $validate "scripts/verify/verify-design-token-ssot\.ps1" "validate job must call scripts/verify/verify-design-token-ssot.ps1"
Assert-StepContinueOnError $validate "Verify Design token SSOT" $false
Assert-Contains $validate "Verify real E2E contract" "validate job must run the real E2E contract verifier"
Assert-Contains $validate "scripts/verify/verify-real-e2e-contract\.ps1" "validate job must call scripts/verify/verify-real-e2e-contract.ps1"
Assert-Contains $validate "Validate OpenAPI YAML" "validate job must keep OpenAPI YAML parsing"
Assert-Contains $validate "Verify OpenAPI↔hub router contract" "validate job must run the OpenAPI↔hub router contract verifier"
Assert-Contains $validate "scripts/verify/verify-openapi-contract\.py" "validate job must call scripts/verify/verify-openapi-contract.py"
Assert-StepContinueOnError $validate "Verify OpenAPI↔hub router contract" $false
Assert-Contains $validate "Verify Shared Edge-free boundary" "validate job must run the Shared Edge-free boundary verifier"
Assert-Contains $validate "scripts/verify/verify-shared-boundary\.py" "validate job must call scripts/verify/verify-shared-boundary.py"
Assert-StepContinueOnError $validate "Verify Shared Edge-free boundary" $false
Assert-Contains $validate "Verify Shared barrel Edge-export ban" "validate job must run the Shared barrel Edge-export ban verifier"
Assert-Contains $validate "scripts/verify/verify-shared-barrel\.py" "validate job must call scripts/verify/verify-shared-barrel.py"
Assert-StepContinueOnError $validate "Verify Shared barrel Edge-export ban" $false
Assert-Contains $validate "Verify Hub handler layering" "validate job must run the Hub handler layering verifier"
Assert-Contains $validate "scripts/verify/verify-hub-layering\.py" "validate job must call scripts/verify/verify-hub-layering.py"
Assert-StepContinueOnError $validate "Verify Hub handler layering" $false
Assert-Contains $validate "Verify Conventions method SSOT" "validate job must run the Conventions method SSOT verifier"
Assert-Contains $validate "scripts/verify/verify-conventions\.py" "validate job must call scripts/verify/verify-conventions.py"
Assert-StepContinueOnError $validate "Verify Conventions method SSOT" $false
Assert-Contains $validate "Verify Shared REST contract Hub-client to Hub-router" "validate job must run the Shared REST contract verifier"
Assert-Contains $validate "scripts/verify/verify-shared-rest-contract\.py" "validate job must call scripts/verify/verify-shared-rest-contract.py"
Assert-StepContinueOnError $validate "Verify Shared REST contract Hub-client to Hub-router" $false
Assert-Contains $validate "Verify Shared UI hubClient gate" "validate job must run the Shared UI hubClient gate verifier"
Assert-Contains $validate "scripts/verify/verify-shared-ui-hubclient\.py" "validate job must call scripts/verify/verify-shared-ui-hubclient.py"
Assert-StepContinueOnError $validate "Verify Shared UI hubClient gate" $false
Assert-Contains $validate "check-secrets\.sh" "validate job must keep secret guard"
Assert-Contains $validate "Verify coverage baseline" "validate job must run the coverage baseline gate"
Assert-Contains $validate "scripts/verify/verify-coverage-baseline\.py" "validate job must call scripts/verify/verify-coverage-baseline.py"
Assert-StepContinueOnError $validate "Verify coverage baseline" $false

Assert-Contains $mobile "(?m)^\s+timeout-minutes:\s+45\s*$" "frontend-mobile job must have a hard timeout"
Assert-Contains (Get-StepBlock $mobile "Screenshot visual QA (mobile)") "(?m)^\s+timeout-minutes:\s+12\s*$" "mobile visual QA must have a hard timeout"
Assert-Contains (Get-StepBlock $mobile "E2E (mock hub)") "(?m)^\s+timeout-minutes:\s+10\s*$" "mobile mock-hub E2E must have a hard timeout"
Assert-Contains $mobile "github.event_name == 'workflow_dispatch'" "frontend-mobile full suite must stay workflow_dispatch-only"

Assert-Contains $mobileLight "Frontend \(mobile light\)" "frontend-mobile-light must use a clear job name"
Assert-Contains $mobileLight "needs:\s+changes" "frontend-mobile-light must depend on unified changes job"
Assert-Contains $mobileLight "needs.changes.outputs.mobile" "frontend-mobile-light must path-filter on mobile"
Assert-Contains $mobileLight "(?m)^\s+timeout-minutes:\s+15\s*$" "frontend-mobile-light job must have a hard timeout"
Assert-Contains $mobileLight ([regex]::Escape("pnpm --filter agenthub-mobile-rn typecheck")) "frontend-mobile-light must typecheck mobile"
Assert-Contains $mobileLight ([regex]::Escape("pnpm --filter agenthub-mobile-rn test")) "frontend-mobile-light must run mobile unit tests"
Assert-NotContains $mobileLight "npx expo export" "frontend-mobile-light must not run Expo export"
Assert-NotContains $mobileLight "scripts/visual-qa\.mjs" "frontend-mobile-light must not run mobile visual QA"
Assert-NotContains $mobileLight "playwright install --with-deps" "frontend-mobile-light must not install Playwright"

Assert-Contains $backendPerf "Backend perf/leak gates" "backend-perf-leak-gates must use a clear job name"
Assert-Contains $backendPerf "github.event_name == 'workflow_dispatch'" "backend-perf-leak-gates must be workflow_dispatch-only"
Assert-Contains $backendPerf ([regex]::Escape("verify-backend-perf-leak-gates.ps1")) "backend-perf-leak-gates must run the perf/leak script"
Assert-Contains $backendPerf "(?m)^\s+timeout-minutes:\s+20\s*$" "backend-perf-leak-gates must have a hard timeout"
Assert-NotContains $backendPerf "load-test" "backend-perf-leak-gates must not claim load/capacity smoke"

Assert-Contains $changes "dorny/paths-filter@" "changes job must use dorny/paths-filter (major governed by #1580 runtime gate)"
Assert-Contains $changes ([regex]::Escape("app/shared/src/workbench/**")) "changes job must watch workbench paths"
Assert-Contains $changes ([regex]::Escape("app/shared/src/styles/**")) "changes job must watch shared styles"
Assert-Contains $changes ([regex]::Escape("app/web/scripts/visual-qa*")) "changes job must watch web visual-qa scripts"
Assert-Contains $changes ([regex]::Escape("app/desktop/scripts/visual-qa*")) "changes job must watch desktop visual-qa scripts"
Assert-Contains $changes ([regex]::Escape(".github/workflows/checks.yml")) "changes job must watch checks.yml"
Assert-Contains $changes ([regex]::Escape("hub-server/**")) "changes job must watch hub-server paths"
Assert-Contains $changes ([regex]::Escape("edge-server/**")) "changes job must watch edge-server paths"
Assert-Contains $changes ([regex]::Escape("pkg/**")) "changes job must watch shared pkg module"
Assert-Contains $changes ([regex]::Escape("go.work")) "changes job must watch go.work files"
Assert-Contains $changes ([regex]::Escape("app/mobile-rn/**")) "changes job must watch mobile-rn paths"
Assert-Contains $changes "(?m)^\s+mobile:\s*$" "changes job must expose mobile output"

Assert-Contains $visualShell "Visual QA shell \(web, path-filtered\)" "visual-qa-shell must use a clear job name"
Assert-Contains $visualShell "needs:\s+changes" "visual-qa-shell must depend on unified changes job"
Assert-Contains $visualShell "Install Playwright Chromium" "visual-qa-shell must install chromium only"
Assert-Contains $visualShell ([regex]::Escape("playwright install --with-deps chromium")) "visual-qa-shell must install chromium only"
Assert-Contains $visualShell ([regex]::Escape("pnpm visual:qa:shell")) "visual-qa-shell must run visual:qa:shell"
Assert-Contains $visualShell ([regex]::Escape("pnpm assert:visual:qa:shell")) "visual-qa-shell must assert non-blank screenshots"
Assert-Contains $visualShell "Upload visual QA shell screenshots" "visual-qa-shell must upload artifacts"
Assert-Contains $visualShell "web-visual-qa-shell-screenshots" "visual-qa-shell must name the artifact"
Assert-Contains $visualShell "(?m)^\s+timeout-minutes:\s+20\s*$" "visual-qa-shell job must have a hard timeout"
Assert-Contains (Get-StepBlock $visualShell "Capture web visual:qa:shell") "(?m)^\s+timeout-minutes:\s+15\s*$" "visual-qa-shell capture step must have a hard timeout"
Assert-NotContains $visualShell "pixel[-_ ]?golden" "visual-qa-shell must not fail on pixel golden"
Assert-NotContains $visualShell "toHaveScreenshot" "visual-qa-shell must not use Playwright pixel golden matchers"
Assert-NotContains $visualShell "windows-latest" "visual-qa-shell must stay on ubuntu for cost control"

Write-Host "ci gate policy ok"
