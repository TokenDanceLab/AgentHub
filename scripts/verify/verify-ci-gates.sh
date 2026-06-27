#!/usr/bin/env bash
# AgentHub CI gate policy verifier — bash equivalent of verify-ci-gates.ps1
#
# Reads .github/workflows/checks.yml and enforces mandatory coverage policies,
# step policies (continue-on-error), backend constraint patterns, pnpm setup,
# and validate job requirements.
#
# Usage:
#   ./scripts/verify/verify-ci-gates.sh [WORKFLOW_PATH]
set -euo pipefail

WORKFLOW_PATH="${1:-.github/workflows/checks.yml}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

pass() { printf '  %sPASS%s %s\n' "$GREEN" "$NC" "$1"; }
fail() { printf '  %sFAIL%s %s\n' "$RED" "$NC" "$1"; exit 1; }

# ── helpers ──────────────────────────────────────────────────

# Extract a named job block from YAML-like text (indented 2 spaces)
get_job_block() {
  local text="$1" job_name="$2"
  # Match from "  job_name:" to next "  [word]:" or end of text
  # Use awk for multi-line extraction
  printf "%s\n" "$text" | awk -v job="$job_name" '
    BEGIN { found=0; body="" }
    /^  [A-Za-z0-9_-]+:/ {
      if (found) exit
      if ($0 ~ "^  " job ":") { found=1; next }
    }
    found { body = body $0 "\n" }
    END { if (found) print body; else exit 1 }
  '
}

# Extract a step block from a job block
get_step_block() {
  local job_block="$1" step_name="$2"
  printf "%s\n" "$job_block" | awk -v step="$step_name" '
    BEGIN { found=0; emitted=0; body="" }
    /^[[:space:]]*- name: / {
      if (found) exit
      rest=$0; sub(/^[[:space:]]*- name: /, "", rest)
      gsub(/\r$/, "", rest)
      if (rest == step) { found=1; emitted=1; next }
    }
    found {
      if (/^[[:space:]]*- name: /) exit
      body = body $0 "\n"
    }
    END { if (emitted) print body; else exit 1 }
  '
}

# Assert text contains a pattern
assert_contains() {
  local text="$1" pattern="$2" msg="$3"
  if echo "$text" | grep -q -P "$pattern"; then
    return 0
  else
    fail "$msg"
  fi
}

assert_contains_fixed() {
  local text="$1" needle="$2" msg="$3"
  if echo "$text" | grep -q -F "$needle"; then
    return 0
  else
    fail "$msg"
  fi
}

# Assert text does NOT contain a pattern
assert_not_contains() {
  local text="$1" pattern="$2" msg="$3"
  if echo "$text" | grep -q -P "$pattern"; then
    fail "$msg"
  else
    return 0
  fi
}

# Assert step has (or lacks) continue-on-error: true
assert_step_continue_on_error() {
  local job_block="$1" step_name="$2" expected="$3"
  local step_block
  step_block="$(get_step_block "$job_block" "$step_name")" || fail "missing step '$step_name'"
  local has_continue
  if echo "$step_block" | grep -qP '^\s+continue-on-error:\s+true\s*$'; then
    has_continue=true
  else
    has_continue=false
  fi
  if [[ "$has_continue" != "$expected" ]]; then
    local want
    if [[ "$expected" == "true" ]]; then want="warning-only"; else want="hard-blocking"; fi
    fail "step '$step_name' must be $want"
  fi
}

# ── main ─────────────────────────────────────────────────────

if [[ ! -f "$WORKFLOW_PATH" ]]; then
  fail "workflow file not found: $WORKFLOW_PATH"
fi

workflow="$(cat "$WORKFLOW_PATH")"

# Extract job blocks
edge="$(get_job_block "$workflow" "go-edge")" || fail "missing job 'go-edge'"
hub="$(get_job_block "$workflow" "go-hub")" || fail "missing job 'go-hub'"
backend_fixture="$(get_job_block "$workflow" "backend-e2e-fixture")" || fail "missing job 'backend-e2e-fixture'"
backend_focused="$(get_job_block "$workflow" "backend-focused-subset")" || fail "missing job 'backend-focused-subset'"
desktop="$(get_job_block "$workflow" "frontend-desktop")" || fail "missing job 'frontend-desktop'"
web="$(get_job_block "$workflow" "frontend-web")" || fail "missing job 'frontend-web'"
mobile="$(get_job_block "$workflow" "frontend-mobile")" || fail "missing job 'frontend-mobile'"
e2e="$(get_job_block "$workflow" "e2e-smoke")" || fail "missing job 'e2e-smoke'"
validate="$(get_job_block "$workflow" "validate")" || fail "missing job 'validate'"

# Coverage policies
assert_contains "$edge" "Coverage check \\(informational\\)" "go-edge overall coverage must stay informational"
assert_contains "$edge" "Coverage per-package minimums" "go-edge must keep per-package coverage minimums"
assert_contains "$edge" 'check_pkg "edge-server/internal/security/" 70 "security"' "go-edge must keep security package coverage minimum"
assert_contains "$edge" 'check_pkg "edge-server/internal/lifecycle/" 60 "lifecycle"' "go-edge must keep lifecycle package coverage minimum"
assert_contains "$edge" 'check_pkg "edge-server/internal/adapters/" 55 "adapters"' "go-edge must keep adapters package coverage minimum"
assert_contains "$hub" "THRESHOLD=40" "go-hub coverage threshold must be 40%"

# Lint / security step policies
assert_step_continue_on_error "$edge" "Lint" true
assert_step_continue_on_error "$hub" "Lint" true
assert_step_continue_on_error "$edge" "Security scan (gosec)" true
assert_step_continue_on_error "$hub" "Security scan (gosec)" true
assert_step_continue_on_error "$edge" "Vulnerability check (govulncheck)" false
assert_step_continue_on_error "$hub" "Vulnerability check (govulncheck)" false
assert_step_continue_on_error "$edge" "Coverage per-package minimums" false

# Backend E2E fixture constraints
assert_contains "$backend_fixture" "working-directory:" "backend-e2e-fixture must run from hub-server"
assert_contains "$backend_fixture" "TeamRun fixture E2E" "backend-e2e-fixture must name the TeamRun fixture step"
assert_contains_fixed "$backend_fixture" "go test ./tests/teamrun -run '^TestTeamRunSmoke$' -count=1" "backend-e2e-fixture must run only the TeamRun fixture smoke test"
assert_step_continue_on_error "$backend_fixture" "TeamRun fixture E2E" false
assert_contains "$backend_fixture" "P0 remote-control fixture readiness" "backend-e2e-fixture must run the P0 remote-control fixture readiness step"
assert_contains "$backend_fixture" "pwsh.*scripts/verify/verify-p0-remote-control-fixture.ps1" "backend-e2e-fixture must run the P0 remote-control fixture readiness gate"
assert_step_continue_on_error "$backend_fixture" "P0 remote-control fixture readiness" false

# Backend focused subset constraints
assert_contains "$backend_focused" "Backend focused subset" "backend-focused-subset must use a clear job name"
assert_contains "$backend_focused" "Hub focused backend packages" "backend-focused-subset must run the Hub focused backend package step"
assert_contains "$backend_focused" "Edge focused backend packages" "backend-focused-subset must run the Edge focused backend package step"
assert_contains_fixed "$backend_focused" "cd hub-server && go test ./internal/repository ./internal/service ./internal/app ./internal/handler ./internal/router -short -count=1" "backend-focused-subset must run the approved Hub focused backend packages"
assert_contains_fixed "$backend_focused" "cd edge-server && go test ./internal/store ./internal/api ./internal/lifecycle ./cmd/agenthub-edge -short -count=1" "backend-focused-subset must run the approved Edge focused backend packages"
assert_step_continue_on_error "$backend_focused" "Hub focused backend packages" false
assert_step_continue_on_error "$backend_focused" "Edge focused backend packages" false

# Forbidden patterns in backend jobs
backend_forbidden_patterns=(
  "RealCli"
  "real[-_]?cli"
  "self-hosted"
  "services:"
  "integration-smoke.ps1"
  "edge-runtime-smoke.ps1"
  "OPENAI_API_KEY"
  "ANTHROPIC_API_KEY"
  "CODEX_"
  "CLAUDE_"
  "[[:<:]]codex[[:>:]]"
  "[[:<:]]claude[[:>:]]"
  "[[:<:]]opencode[[:>:]]"
  "postgres"
  "redis"
  "dev-up"
  "docker"
  "codesign"
  "signtool"
  "notarization"
  "notarytool"
  "cosign"
  "http://"
  "https://"
  "go test ./tests -count=1"
)

for forbidden in "${backend_forbidden_patterns[@]}"; do
  assert_not_contains "$backend_fixture" "$forbidden" "backend-e2e-fixture must not invoke '$forbidden'"
  assert_not_contains "$backend_focused" "$forbidden" "backend-focused-subset must not invoke '$forbidden'"
done

# pnpm setup for frontend jobs
for job_name in "frontend-desktop" "frontend-web" "frontend-mobile" "e2e-smoke"; do
  case "$job_name" in
    frontend-desktop) job_body="$desktop" ;;
    frontend-web) job_body="$web" ;;
    frontend-mobile) job_body="$mobile" ;;
    e2e-smoke) job_body="$e2e" ;;
    *) fail "unknown frontend job '$job_name'" ;;
  esac
  lockfile="app/pnpm-lock.yaml"
  assert_contains "$job_body" "pnpm/action-setup@v4" "$job_name must install pnpm explicitly"
  assert_contains "$job_body" "cache:" "$job_name must enable pnpm cache"
  assert_contains "$job_body" "$lockfile" "$job_name must cache the correct pnpm lockfile"
done

# Validate job requirements
assert_contains "$validate" "Verify CI gate policy" "validate job must run the CI gate policy verifier"
assert_contains "$validate" "scripts/verify/verify-ci-gates\\.ps1" "validate job must call scripts/verify/verify-ci-gates.ps1"
assert_contains "$validate" "Verify project skill whitelist" "validate job must run the project skill whitelist verifier"
assert_contains "$validate" "scripts/verify/verify-project-skills\\.ps1" "validate job must call scripts/verify/verify-project-skills.ps1"
assert_contains "$validate" "Verify doc SSOT" "validate job must run the doc SSOT verifier"
assert_contains "$validate" "scripts/verify/verify-doc-ssot\\.ps1" "validate job must call scripts/verify/verify-doc-ssot.ps1"
assert_contains "$validate" "Verify real E2E contract" "validate job must run the real E2E contract verifier"
assert_contains "$validate" "scripts/verify/verify-real-e2e-contract\\.ps1" "validate job must call scripts/verify/verify-real-e2e-contract.ps1"
assert_contains "$validate" "Validate OpenAPI YAML" "validate job must keep OpenAPI YAML parsing"
assert_contains "$validate" "check-secrets\\.sh" "validate job must keep secret guard"

assert_contains "$mobile" '^    timeout-minutes:[[:space:]]+45[[:space:]]*$' "frontend-mobile job must have a hard timeout"
mobile_visual_step="$(get_step_block "$mobile" "Screenshot visual QA (mobile)")" || fail "missing step 'Screenshot visual QA (mobile)'"
mobile_mock_hub_step="$(get_step_block "$mobile" "E2E (mock hub)")" || fail "missing step 'E2E (mock hub)'"
assert_contains "$mobile_visual_step" '^[[:space:]]+timeout-minutes:[[:space:]]+12[[:space:]]*$' "mobile visual QA must have a hard timeout"
assert_contains "$mobile_mock_hub_step" '^[[:space:]]+timeout-minutes:[[:space:]]+10[[:space:]]*$' "mobile mock-hub E2E must have a hard timeout"

echo "ci gate policy ok"
