#!/usr/bin/env bash
# Self-tests for check-secrets.sh — fail-closed secret guard contract.
#
# Positive: placeholder values, *.env.example files, *_URL endpoint
# assignments, absolute path literals, userinfo-less endpoint URL values
# without query/fragment, and benign kebab-case identifiers that merely
# contain a token prefix mid-word (e.g. "task-backfill-mis"+"match-conflict")
# pass — literal rules require the token prefix to sit on a word boundary
# (#2295).
# Negative: real AWS keys, GitHub tokens, private key blocks, API keys
# (sk-), Slack/Google tokens, JWTs, URL DSNs with userinfo (user:pass@), URLs
# carrying query-string credentials (?access_token=…), and real password
# literals in staged diffs must ALL exit non-zero — including each token shape
# at a line start and after '"', '=', ' ', ':' and ',' (the boundary rule must
# not widen the pass surface).
#
# Fixture registry (#2295 / ADR-028): scripts/verify/secret-fixture-allowlist.json
# may silence a literal rule only for an exact (path, literal) pair. Positive:
# a registered fixture passes, including inside the registry file itself (which
# has no path exemption). Negative: the same literal at another path, another
# literal at the registered path, an unregistered credential shape on the very
# same line, a missing/renamed path, a dead (non-credential-shaped) literal, a
# glob path, a missing owner, entry count over maxEntries, malformed JSON and a
# literal absent from its registered path must ALL exit non-zero.
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

echo "=== benign kebab-case ID containing an sk- substring passes (#2295) ==="
git reset --quiet
# 该 ID 是全仓唯一被旧规则误判的真实案例：ta**sk-**backfill-mismatch-conflict
# 里 `sk-` 后跟 26 个 [A-Za-z0-9_-]。片段拼写，避免本自测文件自身被判红。
benign_id="task-backfill-mis"
benign_id="${benign_id}match-conflict"
printf 'package agent\n\nfunc fixtureID() string { return "%s" }\n' "$benign_id" > benign_fixture_id.go
git add benign_fixture_id.go
bash "$SCRIPT" --staged >/dev/null 2>&1
check "benign kebab-case ID with an embedded sk- substring passes" no $?

echo "=== word-boundary rule keeps every real token shape red ==="
# 六种 token 形状各配一种边界位置（行首 / " / = / 空格 / : / ,）；字面量一律由
# 低于阈值的片段拼成，本文件的新增行因此不会自己触发扫描。
git reset --quiet
aws_key="AKIA1234"
aws_key="${aws_key}567890ABCDEF"
printf '%s\n' "$aws_key" > token_at_line_start.txt
git add token_at_line_start.txt
bash "$SCRIPT" --staged >/dev/null 2>&1
check "AWS access key at line start still fails" yes $?

git reset --quiet
gh_token="ghp_1234567890"
gh_token="${gh_token}abcdefghijklmnop"
printf '{"token": "%s"}\n' "$gh_token" > token_after_quote.json
git add token_after_quote.json
bash "$SCRIPT" --staged >/dev/null 2>&1
check "GitHub token after a double quote still fails" yes $?

git reset --quiet
api_key="sk-proj-abc123"
api_key="${api_key}def456ghi789jkl012"
printf 'OPENAI_API_KEY=%s\n' "$api_key" > token_after_equals.txt
git add token_after_equals.txt
bash "$SCRIPT" --staged >/dev/null 2>&1
check "API key after '=' still fails" yes $?

git reset --quiet
slack_token="xoxb-1234567890"
slack_token="${slack_token}abcdefghijklmnop"
printf 'slack: %s\n' "$slack_token" > token_after_colon_space.yaml
git add token_after_colon_space.yaml
bash "$SCRIPT" --staged >/dev/null 2>&1
check "Slack token after ': ' still fails" yes $?

git reset --quiet
google_key="AIzaSyDabc123"
google_key="${google_key}def456ghi789jkl012mnopqrst"
printf 'key:%s\n' "$google_key" > token_after_colon.txt
git add token_after_colon.txt
bash "$SCRIPT" --staged >/dev/null 2>&1
check "Google API key after ':' still fails" yes $?

git reset --quiet
jwt_head="eyJhbGciOiJIUzI1"
jwt_head="${jwt_head}NiIsInR5cCI6IkpXVCJ9"
jwt_body="eyJzdWIiOiIxMjM0NTY3ODkwIn0"
jwt_sig="dozjgNryP4J3jVmNHl0w5N"
printf 'values: ["x",%s.%s.%s]\n' "$jwt_head" "$jwt_body" "$jwt_sig" > token_after_comma.yaml
git add token_after_comma.yaml
bash "$SCRIPT" --staged >/dev/null 2>&1
check "JWT after ',' still fails" yes $?

echo "=== fixture registry (#2295 / ADR-028): exact (path, literal) only ==="
# 登记簿路径在 check-secrets.sh 里是常量，所以自测必须在临时仓的同一相对路径上
# 造它。所有假凭据一律由低于阈值的片段拼成，本自测文件的新增行因此不会自己触发
# CI 的字面量扫描（沿用本文件既有约定）。
REG_DIR="scripts/verify"
REG_FILE="${REG_DIR}/secret-fixture-allowlist.json"
mkdir -p "$REG_DIR"

fix_key_a="sk-proj-abc123"
fix_key_a="${fix_key_a}def456ghi789jkl012"
fix_key_b="sk-proj-zzz999"
fix_key_b="${fix_key_b}yyy888xxx777www666vvv555"

write_registry() {
  # $1 = literal, $2 = path, $3 = extra entry JSON (optional), $4 = maxEntries
  local lit="$1" reg_path="$2" extra="${3:-}" max="${4:-1}"
  {
    printf '{\n  "version": 1,\n  "maxEntries": %s,\n  "entries": [\n' "$max"
    printf '    {"path": "%s", "literal": "%s", "owner": "Test", "review": "2026-09-04", "reason": "self-test fixture"}\n' "$reg_path" "$lit"
    if [[ -n "$extra" ]]; then printf '    ,%s\n' "$extra"; fi
    printf '  ]\n}\n'
  } > "$REG_FILE"
}

echo "--- registered fixture passes ---"
git reset --quiet
rm -f fixture_a.txt fixture_b.txt fixture_copy.txt fixture_two.txt
printf 'fixture = "%s"\n' "$fix_key_a" > fixture_a.txt
write_registry "$fix_key_a" "fixture_a.txt"
git add fixture_a.txt "$REG_FILE"
bash "$SCRIPT" --staged >/dev/null 2>&1
check "registered (path, literal) fixture passes" no $?

echo "--- registry file itself is scanned, not exempted ---"
# 上一个用例已经把含完整 literal 的登记簿文件自己 stage 了：它能过，靠的是
# 「登记簿里的凭据形状字面量必须是已登记 literal 之一」，不是路径豁免。
git reset --quiet
printf '  "reason": "leaked %s inside reason"\n' "$fix_key_b" >> "$REG_FILE"
git add fixture_a.txt "$REG_FILE"
bash "$SCRIPT" --staged >/dev/null 2>&1
check "unregistered credential literal inside the registry file fails" yes $?

echo "--- same path, different literal fails ---"
git reset --quiet
write_registry "$fix_key_a" "fixture_a.txt"
printf 'fixture = "%s"\nother = "%s"\n' "$fix_key_a" "$fix_key_b" > fixture_a.txt
git add fixture_a.txt "$REG_FILE"
bash "$SCRIPT" --staged >/dev/null 2>&1
check "unregistered second literal at a registered path fails" yes $?

echo "--- registered literal at another path fails ---"
git reset --quiet
printf 'fixture = "%s"\n' "$fix_key_a" > fixture_a.txt
printf 'moved = "%s"\n' "$fix_key_a" > fixture_copy.txt
write_registry "$fix_key_a" "fixture_a.txt"
git add fixture_a.txt fixture_copy.txt "$REG_FILE"
bash "$SCRIPT" --staged >/dev/null 2>&1
check "registered literal moved to another path fails" yes $?

echo "--- two literals on one line: registered first, unregistered second ---"
git reset --quiet
rm -f fixture_copy.txt
printf 'line = "%s" + "%s"\n' "$fix_key_a" "$fix_key_b" > fixture_a.txt
write_registry "$fix_key_a" "fixture_a.txt"
git add fixture_a.txt "$REG_FILE"
bash "$SCRIPT" --staged >/dev/null 2>&1
check "unregistered literal after a registered one on the same line fails" yes $?

echo "--- registry absent: default deny is unchanged ---"
git reset --quiet
printf 'fixture = "%s"\n' "$fix_key_a" > fixture_a.txt
git rm --cached --quiet "$REG_FILE" 2>/dev/null
rm -f "$REG_FILE"
git add fixture_a.txt
bash "$SCRIPT" --staged >/dev/null 2>&1
check "fixture with no registry still fails" yes $?

echo "--- registry integrity is fail-closed ---"
# 每个完整性用例**只 stage 登记簿自己**，夹具文件只在磁盘上（供加载器读），
# 这样退出码非 0 就只可能来自加载器的完整性校验，不可能来自「夹具字面量未登记」
# 这条无关的失败路径——否则用例会因为错误的原因而绿（实测过这个坑）。
integrity_case() {
  # $1 = name, $2 = registry body writer (function name)
  git reset --quiet
  bash "$SCRIPT" --staged >/dev/null 2>&1
  check "$1" yes $?
}

printf 'fixture = "%s"\n' "$fix_key_a" > fixture_a.txt

git reset --quiet
write_registry "$fix_key_a" "does-not-exist.txt"
git add "$REG_FILE"
integrity_case "entry pointing at a non-existent path fails"

git reset --quiet
write_registry "$fix_key_b" "fixture_a.txt"
git add "$REG_FILE"
integrity_case "registered literal absent from its path fails"

git reset --quiet
write_registry "$fix_key_a" "*_a.txt"
git add "$REG_FILE"
integrity_case "glob path entry fails"

git reset --quiet
write_registry "$fix_key_a" "fixture_a.txt"
python3 - "$REG_FILE" <<'MUT'
import json, sys
doc = json.load(open(sys.argv[1], encoding="utf-8"))
doc["entries"][0]["owner"] = ""
json.dump(doc, open(sys.argv[1], "w", encoding="utf-8"), ensure_ascii=False, indent=2)
MUT
git add "$REG_FILE"
integrity_case "entry with an empty owner fails"

# 计数棘轮：两条**各自都合法**的条目 + maxEntries=1。两条都合法是关键——
# 若第二条本身非法，加载器会先死在别的检查上，这个用例就会因为错误的原因而绿
# （maxEntries=0 那种写法实测就是踩了 "maxEntries must be a positive integer"）。
git reset --quiet
printf 'fixture = "%s"\n' "$fix_key_b" > fixture_b.txt
extra_entry="$(printf '{"path": "fixture_b.txt", "literal": "%s", "owner": "Test", "review": "2026-09-04", "reason": "self-test fixture"}' "$fix_key_b")"
write_registry "$fix_key_a" "fixture_a.txt" "$extra_entry" 1
git add "$REG_FILE"
integrity_case "entry count over maxEntries fails"

# 死条目：literal 不是任何字面量规则的完整形状。夹具文件里写入同一个字符串，
# 好让「literal 必须出现在登记路径里」这条检查先满足，红就只能来自形状检查。
git reset --quiet
dead_value="not-a-credential-shaped-value"
printf 'fixture = "%s"\n' "$dead_value" > fixture_a.txt
write_registry "$dead_value" "fixture_a.txt"
git add "$REG_FILE"
integrity_case "dead entry (literal is not a credential shape) fails"

git reset --quiet
printf 'fixture = "%s"\n' "$fix_key_a" > fixture_a.txt
printf '{ not json\n' > "$REG_FILE"
git add "$REG_FILE"
integrity_case "malformed registry JSON fails"

git reset --quiet
rm -f fixture_a.txt fixture_b.txt fixture_copy.txt fixture_two.txt "$REG_FILE"

echo ""
echo "Results: $PASS passed, $FAIL failed"
if [[ "$FAIL" -gt 0 ]]; then
  exit 1
fi
