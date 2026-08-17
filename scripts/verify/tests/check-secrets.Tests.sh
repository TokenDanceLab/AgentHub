#!/usr/bin/env bash
# Self-tests for check-secrets.sh — fail-closed secret guard contract.
#
# Positive: placeholder values, *.env.example files, and *_URL endpoint
# assignments pass.
# Negative: real AWS keys, GitHub tokens, private key blocks, and API keys
# (sk-...) in staged diffs must ALL exit non-zero.
#
# Runs in CI validate job alongside verify-vulnerability-gates.Tests.sh.
set -uo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/check-secrets.sh"
PASS=0
FAIL=0

check() {
  local name="$1" expect_fail="$2" actual="$3"
  if { [[ "$expect_fail" == "yes" ]] && [[ "$actual" -ne 0 ]]; } || \
     { [[ "$expect_fail" == "no" ]] && [[ "$actual" -eq 0 ]]; }; then
    echo "  PASS  $name (exit=$actual)"
    PASS=$((PASS + 1))
  else
    echo "  FAIL  $name (exit=$actual, expected $([[ "$expect_fail" == "yes" ]] && echo "!=0" || echo "0"))"
    FAIL=$((FAIL + 1))
  fi
}

# Create a temp git repo so check-secrets.sh has a git root to scan.
TMP_REPO="$(mktemp -d)"
trap 'rm -rf "$TMP_REPO"' EXIT
cd "$TMP_REPO"
git init --quiet
git config user.email "test@example.com"
git config user.name "Test"

echo "=== empty worktree (no changes) ==="
bash "$SCRIPT" --worktree >/dev/null 2>&1
check "empty worktree exits 0" no $?

echo "=== placeholder .env.example passes ==="
cat > .env.example <<'ENV'
AGENTHUB_TOKENDANCE_ID_CLIENT_SECRET=your-client-secret-here
AGENTHUB_HUB_JWT_SECRET=change-me-in-production
ENV
git add .env.example
bash "$SCRIPT" --staged >/dev/null 2>&1
check "placeholder .env.example passes" no $?

echo "=== *_URL endpoint assignment passes ==="
cat > config.yaml <<'YAML'
AGENTHUB_TOKENDANCE_ID_ISSUER_URL=https://id.example.com
AGENTHUB_TOKENDANCE_ID_REDIRECT_URI=https://hub.example.com/client/auth/callback
YAML
git add config.yaml
git commit --quiet -m "add config" 2>/dev/null
# Now stage a new change with a URL assignment
echo 'AGENTHUB_WEB_URL=https://web.example.com' >> config.yaml
git add config.yaml
bash "$SCRIPT" --staged >/dev/null 2>&1
check "*_URL endpoint assignment passes" no $?

echo "=== real AWS access key fails ==="
git reset --quiet
cat > secrets.yaml <<'YAML'
aws_access_key_id: AKIAIOSFODNN7EXAMPLE
YAML
git add secrets.yaml
bash "$SCRIPT" --staged >/dev/null 2>&1
check "AWS access key fails" yes $?

echo "=== GitHub token fails ==="
git reset --quiet
cat > gh-token.json <<'JSON'
{"token": "ghp_1234567890abcdefghijklmnopqrstuvwxyzABCD"}
JSON
git add gh-token.json
bash "$SCRIPT" --staged >/dev/null 2>&1
check "GitHub token fails" yes $?

echo "=== private key block fails ==="
git reset --quiet
cat > key.pem <<'PEM'
-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA1234567890abcdefghijklmnopqrstuvwxyz
-----END RSA PRIVATE KEY-----
PEM
git add key.pem
bash "$SCRIPT" --staged >/dev/null 2>&1
check "private key file path fails" yes $?

echo "=== API key (sk-) fails ==="
git reset --quiet
cat > api.yaml <<'YAML'
openai_api_key: sk-proj-1234567890abcdefghijklmnopqrstuvwxyz
YAML
git add api.yaml
bash "$SCRIPT" --staged >/dev/null 2>&1
check "sk- API key fails" yes $?

echo ""
echo "Results: $PASS passed, $FAIL failed"
if [[ "$FAIL" -gt 0 ]]; then
  exit 1
fi
