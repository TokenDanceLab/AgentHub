#!/usr/bin/env bash
# Secret guard for CI and local hooks.
#
# Two layers:
#   1. `gitleaks` scans the changed content against its default provider
#      rules (AWS, GitHub, Slack, Google, JWT, private keys, generic keys...).
#      Rule tuning and fixture allowlists live in .gitleaks.toml.
#   2. This wrapper adds the one check gitleaks cannot do -- it is content
#      based, so it never notices that `.env` or `id_rsa` was committed.
#
# Findings never print the matched value: gitleaks runs with --redact and the
# path rules only report the file name.

set -euo pipefail

MODE="${1:-}"
RANGE="${2:-}"

usage() {
  cat <<'USAGE'
Usage:
  scripts/verify/check-secrets.sh --staged
  scripts/verify/check-secrets.sh --worktree
  scripts/verify/check-secrets.sh --range <git-diff-range>
  scripts/verify/check-secrets.sh --ci   # pull_request: origin/<BASE_REF>...HEAD, else HEAD^..HEAD or worktree
USAGE
}

# --ci derives its range from the event environment so the workflow step stays
# a single command the CI invariant checker can verify.
if [[ "$MODE" == "--ci" ]]; then
  if [[ -n "${BASE_REF:-}" ]]; then
    MODE="--range"
    RANGE="origin/${BASE_REF}...HEAD"
  elif git rev-parse --verify HEAD^ >/dev/null 2>&1; then
    MODE="--range"
    RANGE="HEAD^..HEAD"
  else
    MODE="--worktree"
  fi
fi

if [[ "$MODE" != "--staged" && "$MODE" != "--worktree" && "$MODE" != "--range" ]]; then
  usage
  exit 2
fi

if [[ "$MODE" == "--range" && -z "$RANGE" ]]; then
  usage
  exit 2
fi

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

GITLEAKS="${GITLEAKS_BIN:-gitleaks}"
if ! command -v "$GITLEAKS" >/dev/null 2>&1; then
  echo "secret guard: gitleaks not found (set GITLEAKS_BIN or put it on PATH); refusing to pass (fail-closed)" >&2
  exit 1
fi

report() {
  local path="$1" kind="$2"
  FINDINGS=1
  if [[ -n "${GITHUB_ACTIONS:-}" ]]; then
    echo "::error file=${path}::${kind}"
  else
    echo "secret guard: ${path}: ${kind}"
  fi
}

changed_files() {
  case "$MODE" in
    --staged) git diff --cached --name-only --diff-filter=ACMRT ;;
    --worktree) git diff --name-only --diff-filter=ACMRT ;;
    --range) git diff --name-only --diff-filter=ACMRT "$RANGE" ;;
  esac
}

# Placeholders live in *.env.example; everything else with a secret-ish name
# is treated as a real credential file.
is_example_path() {
  local path="$1"
  [[ "$path" == *.env.example || "$path" == *.env.production.example ]]
}

check_sensitive_path() {
  local path="${1//\\//}"
  is_example_path "$path" && return 0

  if [[ "$path" =~ (^|/)\.env($|[./]) ]]; then
    report "$path" "sensitive .env-style file must not be committed; commit an example file with placeholders"
  elif [[ "$path" =~ (^|/)\.envrc$ ]]; then
    report "$path" "local .envrc must not be committed"
  elif [[ "$path" =~ (^|/)(secret|secrets|private)(/|$) ]]; then
    report "$path" "secret/private directory must not be committed"
  elif [[ "$path" =~ (^|/)id_(rsa|dsa|ecdsa|ed25519)$ ]]; then
    report "$path" "private SSH key must not be committed"
  elif [[ "$path" =~ \.(pem|key|p12|pfx|cer|crt)$ ]]; then
    report "$path" "key/certificate material must not be committed"
  fi
}

FINDINGS=0
CHANGED_TMP="$(mktemp)"
trap 'rm -f "$CHANGED_TMP"' EXIT
if ! changed_files >"$CHANGED_TMP"; then
  echo "secret guard: git diff --name-only failed (mode=$MODE range=${RANGE:-none}); refusing to pass (fail-closed)" >&2
  exit 1
fi

while IFS= read -r path; do
  [[ -z "$path" ]] && continue
  check_sensitive_path "$path"
done <"$CHANGED_TMP"

run_gitleaks() {
  if ! "$GITLEAKS" "$@" --no-banner --redact --exit-code 1; then
    FINDINGS=1
  fi
}

# gitleaks' --staged and --pre-commit each cover one side of the index, so the
# worktree mode runs both: a developer wants the guard green before committing.
case "$MODE" in
  --staged) run_gitleaks git . --staged ;;
  --worktree)
    run_gitleaks git . --staged
    run_gitleaks git . --pre-commit
    ;;
  --range) run_gitleaks git . --log-opts="$RANGE" ;;
esac

if [[ "$FINDINGS" -ne 0 ]]; then
  echo ""
  echo "Secret guard blocked this change. Move real credentials to the operator secret store; commit placeholders only."
  exit 1
fi

echo "Secret guard passed."
