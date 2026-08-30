#!/usr/bin/env bash
# Self-tests for check-secrets.sh — fail-closed secret guard contract.
#
# Positive: placeholder values, *.env.example files, *_URL endpoint
# assignments, absolute path literals, and userinfo-less endpoint URL values
# without query/fragment pass.
# Negative: real AWS keys, GitHub tokens, private key blocks, API keys
# (sk-), URL DSNs with userinfo (user:pass@), URLs carrying query-string
# credentials (?access_token=…), and real password literals in staged diffs
# must ALL exit non-zero.
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

echo "=== path-literal assignment passes ==="
git reset --quiet
cat > paths.yaml <<'YAML'
TOKENDANCE_DATABASE_DSN=/var/lib/tokendance-id/tokendance.db
TOKENDANCE_JWT_PRIVATE_KEY_PATH=/tmp/id-private.pem
YAML
git add paths.yaml
bash "$SCRIPT" --staged >/dev/null 2>&1
check "path-literal assignment passes" no $?

echo "=== endpoint URL value assignment passes ==="
git reset --quiet
cat > issuer.yaml <<'YAML'
TOKENDANCE_JWT_ISSUER=http://127.0.0.1:3000
YAML
git add issuer.yaml
bash "$SCRIPT" --staged >/dev/null 2>&1
check "endpoint URL value assignment passes" no $?

echo "=== URL with query-string credential still fails ==="
git reset --quiet
cat > qs.yaml <<'YAML'
SOME_TOKEN_ENDPOINT=https://auth.svc/cb?access_token=real-secret-value-123
YAML
git add qs.yaml
bash "$SCRIPT" --staged >/dev/null 2>&1
check "URL with query-string credential still fails" yes $?

echo "=== URL DSN with userinfo still fails ==="
git reset --quiet
cat > dsn.yaml <<'YAML'
AGENTHUB_TOKEN_DSN=postgres://agenthub:realpassword123@db.internal:5432/agenthub
YAML
git add dsn.yaml
bash "$SCRIPT" --staged >/dev/null 2>&1
check "URL DSN with userinfo still fails" yes $?

echo "=== real password literal still fails ==="
git reset --quiet
cat > pw.yaml <<'YAML'
AGENTHUB_DB_PASSWORD=b3-lane-dev-password
YAML
git add pw.yaml
bash "$SCRIPT" --staged >/dev/null 2>&1
check "real password literal still fails" yes $?

echo "=== i18n locale zh long Chinese value with token key passes ==="
git reset --quiet
mkdir -p app/web/src/i18n/locales/zh
cat > app/web/src/i18n/locales/zh/common.json <<'JSON'
{
  "auth.error.oidc.tokenExchangeFailed": "令牌交换失败请检查网络后重新发起登录此操作需要稳定的网络连接才能完成身份验证流程",
  "auth.tokenDanceCallbackPending": "正在打开TokenDanceID登录请在那里完成授权后返回AgentHub继续操作"
}
JSON
git add app/web/src/i18n/locales/zh/common.json
bash "$SCRIPT" --staged >/dev/null 2>&1
check "i18n locale zh long Chinese value with token key passes" no $?

echo "=== non-locale JSON same-shape assignment still fails ==="
git reset --quiet
mkdir -p config
cat > config/settings.json <<'JSON'
{
  "auth.tokenServiceSecret": "real-secret-value-that-is-long-enough"
}
JSON
git add config/settings.json
bash "$SCRIPT" --staged >/dev/null 2>&1
check "non-locale JSON same-shape assignment still fails" yes $?

echo "=== i18n locale file with literal sk- key still fails ==="
git reset --quiet
mkdir -p app/web/src/i18n/locales/en
# Secret literal assembled from sub-threshold fragments so this test file
# itself does not trip the CI secret scan on added lines.
key_val="sk-proj-12345678"
key_val="${key_val}90abcdefghijklmnopqrstuvwxyz"
printf '{\n  "demo.skKey": "%s"\n}\n' "$key_val" > app/web/src/i18n/locales/en/demo.json
git add app/web/src/i18n/locales/en/demo.json
bash "$SCRIPT" --staged >/dev/null 2>&1
check "i18n locale file with literal sk- key still fails" yes $?

echo "=== adjacent non-locale i18n dir not exempted ==="
git reset --quiet
mkdir -p app/web/src/i18n/config
cat > app/web/src/i18n/config/tokens.json <<'JSON'
{
  "auth.tokenServiceSecret": "real-secret-value-that-is-long-enough"
}
JSON
git add app/web/src/i18n/config/tokens.json
bash "$SCRIPT" --staged >/dev/null 2>&1
check "adjacent non-locale i18n dir not exempted" yes $?

echo ""
echo "Results: $PASS passed, $FAIL failed"
if [[ "$FAIL" -gt 0 ]]; then
  exit 1
fi
