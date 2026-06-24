#!/usr/bin/env bash
# AgentHub product-loop QA umbrella gate.
#
# This runner composes existing static, fixture, readiness, deploy-readiness,
# and observed-dispatch gates into one fail-closed report. It never performs
# TokenDanceID login, real CLI/model execution, public deploy, signing, release
# upload, push, merge, or tag work by itself.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="FixtureOnly"
ARTIFACT_ROOT=""
EVIDENCE_PATH=""
APPROVE_REAL=false
FAILURES=()
WARNINGS=()
SEGMENTS=()

while [[ $# -gt 0 ]]; do
    case "$1" in
        -Mode) MODE="$2"; shift 2 ;;
        -ArtifactRoot) ARTIFACT_ROOT="$2"; shift 2 ;;
        -EvidencePath) EVIDENCE_PATH="$2"; shift 2 ;;
        -ApproveRealEvidence) APPROVE_REAL=true; shift ;;
        -RepoRoot) REPO_ROOT="$2"; shift 2 ;;
        *) echo "Unknown argument: $1"; exit 2 ;;
    esac
done

# Resolve paths
if [[ -z "$ARTIFACT_ROOT" ]]; then
    ARTIFACT_ROOT="$REPO_ROOT/.tmp/product-loop-qa/run-$$"
fi
ARTIFACT_ROOT="$(cd "$REPO_ROOT" 2>/dev/null && realpath "$ARTIFACT_ROOT" 2>/dev/null || echo "$ARTIFACT_ROOT")"
mkdir -p "$ARTIFACT_ROOT"

if [[ -z "$EVIDENCE_PATH" ]]; then
    EVIDENCE_PATH="$ARTIFACT_ROOT/product-loop-qa.json"
fi

add_failure() {
    FAILURES+=("$1")
    printf '\e[31mFAIL: %s\e[0m\n' "$1"
}

add_warning() {
    WARNINGS+=("$1")
    printf '\e[33mWARN: %s\e[0m\n' "$1"
}

add_segment() {
    SEGMENTS+=("$1")
    printf '\e[36mSEGMENT: %s\e[0m\n' "$1"
}

run_script_quiet() {
    local script="$1"
    local label="$2"
    local args=("${@:3}")

    printf '\n  > %s (%s)...\n' "$label" "$script"
    if [[ -f "$REPO_ROOT/scripts/$script" ]]; then
        if bash "$REPO_ROOT/scripts/$script" "${args[@]}" 2>&1 | tail -5; then
            return 0
        else
            return 1
        fi
    else
        add_warning "Script not found: $script"
        return 1
    fi
}

echo ""
echo "===================================="
echo "  AgentHub Product Loop QA"
echo "  Mode: $MODE"
echo "  Repo: $REPO_ROOT"
echo "===================================="

# Segment 1: Static checks (always run)
add_segment "Static boundary checks"
if ! run_script_quiet "verify-oidc-readiness.sh" "OIDC readiness" "-SkipWorkspaceDocs"; then
    add_failure "OIDC readiness check failed"
fi
if ! run_script_quiet "verify-web-hub-boundary.sh" "Web Hub boundary"; then
    add_failure "Web Hub boundary check failed"
fi
if ! run_script_quiet "verify-v4-old-ui-active-paths.sh" "v4 old UI paths"; then
    add_failure "v4 old UI path check failed"
fi
if ! run_script_quiet "verify-runtime-readiness.sh" "Runtime readiness"; then
    add_failure "Runtime readiness check failed"
fi

# Segment 2: Go tests
add_segment "Go backend tests"
if ! (cd "$REPO_ROOT/edge-server" && go test ./... -short -count=1 2>&1 | tail -3); then
    add_failure "Edge Server tests failed"
else
    echo "  Edge Server tests: PASS"
fi
if ! (cd "$REPO_ROOT/hub-server" && go test ./... -short -count=1 2>&1 | tail -3); then
    add_failure "Hub Server tests failed"
else
    echo "  Hub Server tests: PASS"
fi

# Segment 3: YAML validation
add_segment "API contract validation"
if python3 -c "import yaml, pathlib; yaml.safe_load(pathlib.Path('$REPO_ROOT/api/openapi.yaml').read_text(encoding='utf-8')); print('yaml ok')" 2>/dev/null; then
    echo "  OpenAPI YAML: valid"
else
    add_failure "OpenAPI YAML validation failed"
fi

# Segment 4: Git diff hygiene
add_segment "Git diff hygiene"
if git -C "$REPO_ROOT" diff --check 2>&1 | grep -q .; then
    add_failure "Git diff --check found whitespace issues"
else
    echo "  Git diff --check: clean"
fi

# Generate report
cat > "$EVIDENCE_PATH" << EOF
{
  "generated": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "repo": "$REPO_ROOT",
  "mode": "$MODE",
  "failures": ${#FAILURES[@]},
  "warnings": ${#WARNINGS[@]},
  "segments": ${#SEGMENTS[@]}
}
EOF

echo ""
echo "========================================"
echo "  Summary"
echo "  Failures:  ${#FAILURES[@]}"
echo "  Warnings:  ${#WARNINGS[@]}"
echo "  Segments:  ${#SEGMENTS[@]}"
echo "  Evidence:  $EVIDENCE_PATH"
echo "========================================"

if [[ ${#FAILURES[@]} -gt 0 ]]; then
    echo ""
    echo "FAILURES:"
    for f in "${FAILURES[@]}"; do
        echo "  - $f"
    done
    exit 1
fi

exit 0
