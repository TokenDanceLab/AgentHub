#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# AgentHub 真实 OIDC E2E 账号供给（本机全栈 dev 栈；幂等，可重复运行）
#
# 职责（对应 issue #1839 B2 片）：
#   1. 确保 TokenDance ID 中注册了 hub 侧正在使用的 OAuth client
#      （client_id/secret 与 start.sh 注入 hub 的完全一致；供 OIDC
#      Authorization Code + PKCE 交换使用）。
#   2. 注册/复用一枚随机测试账号（真实注册 API），并验证可登录。
#   3. 凭据写入 tests/artifacts/real-e2e-account.env（gitignored，
#      chmod 600），供 playwright real 配置与 spec 读取。
#
# 隐私：本脚本不持有、不打印任何 secret 字面量。client secret 只
# 经环境变量或运行期从 start.sh 提取（内存内使用），绝不写入仓库。
#
# 用法：
#   bash provision-real-e2e-stack.sh
#   AGENTHUB_E2E_USER_EMAIL=x AGENTHUB_E2E_USER_PASSWORD=y bash provision-real-e2e-stack.sh
#
# 环境变量（均可选，有合理默认）：
#   AGENTHUB_E2E_ID_BASE_URL    TokenDance ID 地址（默认 http://127.0.0.1:3000）
#   AGENTHUB_E2E_HUB_BASE_URL   hub 地址（默认 http://127.0.0.1:8080）
#   AGENTHUB_E2E_WEB_BASE_URL   web 地址（默认 http://127.0.0.1:5174）
#   AGENTHUB_E2E_ID_DB          ID 的 sqlite 文件（默认 /var/lib/tokendance-id/tokendance.db）
#   AGENTHUB_E2E_START_SH       提取 hub OIDC client 凭据的启动脚本（**无默认值**：仓库里不写
#                               任何人的本机路径；未设置时必须改用 AGENTHUB_E2E_ID_CLIENT_ID/SECRET 直供）
#   AGENTHUB_E2E_ID_CLIENT_ID / AGENTHUB_E2E_ID_CLIENT_SECRET
#                               优先直接给出 client 凭据（绕过 start.sh 提取）
#   AGENTHUB_E2E_USER_EMAIL / AGENTHUB_E2E_USER_PASSWORD
#                               复用既有主账号（否则随机生成并注册）
#   AGENTHUB_E2E_PARTNER_EMAIL / AGENTHUB_E2E_PARTNER_PASSWORD
#                               复用既有陪聊账号（聊天动线需要好友关系，
#                               故供给第二枚账号；否则随机生成并注册）
# ─────────────────────────────────────────────────────────────
set -euo pipefail

ID_BASE_URL="${AGENTHUB_E2E_ID_BASE_URL:-http://127.0.0.1:3000}"
HUB_BASE_URL="${AGENTHUB_E2E_HUB_BASE_URL:-http://127.0.0.1:8080}"
WEB_BASE_URL="${AGENTHUB_E2E_WEB_BASE_URL:-http://127.0.0.1:5174}"
ID_DB="${AGENTHUB_E2E_ID_DB:-/var/lib/tokendance-id/tokendance.db}"
START_SH="${AGENTHUB_E2E_START_SH:-}"

# 仓库根（本文件位于 scripts/e2e/ 下两级）
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ARTIFACT_DIR="$REPO_ROOT/tests/artifacts"
ACCOUNT_ENV="$ARTIFACT_DIR/real-e2e-account.env"

CLIENT_ID=""
CLIENT_SECRET=""
USER_EMAIL="${AGENTHUB_E2E_USER_EMAIL:-}"
USER_PASSWORD="${AGENTHUB_E2E_USER_PASSWORD:-}"

info()  { echo "E2E-INFO: $*"; }
die()   { echo "E2E-FAIL: $*" >&2; exit 1; }
ok()    { echo "E2E-PASS: $*"; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "missing command: $1"
}

wait_http() { # url attempts interval_s
  local url="$1" attempts="${2:-30}" interval="${3:-2}"
  for _ in $(seq 1 "$attempts"); do
    if curl -sf -m 3 "$url" >/dev/null 2>&1; then return 0; fi
    sleep "$interval"
  done
  return 1
}

# ── 阶段 1：环境自检 ─────────────────────────────────────────
require_cmd curl
require_cmd sqlite3
require_cmd python3
python3 -c 'import bcrypt' 2>/dev/null || die "python3 bcrypt module missing"

info "resolving OAuth client credentials"
if [ -n "${AGENTHUB_E2E_ID_CLIENT_ID:-}" ] && [ -n "${AGENTHUB_E2E_ID_CLIENT_SECRET:-}" ]; then
  CLIENT_ID="$AGENTHUB_E2E_ID_CLIENT_ID"
  CLIENT_SECRET="$AGENTHUB_E2E_ID_CLIENT_SECRET"
elif [ -f "$START_SH" ]; then
  CLIENT_ID="$(grep -E '^export AGENTHUB_TOKENDANCE_ID_CLIENT_ID=' "$START_SH" | head -1 | cut -d= -f2- | tr -d '"' || true)"
  CLIENT_SECRET="$(grep -E '^export AGENTHUB_TOKENDANCE_ID_CLIENT_SECRET=' "$START_SH" | head -1 | cut -d= -f2- | tr -d '"' || true)"
else
  die "client credentials missing: set AGENTHUB_E2E_ID_CLIENT_ID/SECRET or AGENTHUB_E2E_START_SH"
fi
[ -n "$CLIENT_ID" ] || die "could not resolve OAuth client id"
[ -n "$CLIENT_SECRET" ] || die "could not resolve OAuth client secret"
ok "oauth client credentials resolved (values kept in memory)"

# ── 阶段 2：栈健康 ───────────────────────────────────────────
info "waiting for TokenDance ID ($ID_BASE_URL/health)"
wait_http "$ID_BASE_URL/health" 20 2 || die "TokenDance ID not healthy at $ID_BASE_URL"
ok "TokenDance ID healthy"
info "waiting for hub ($HUB_BASE_URL/health)"
wait_http "$HUB_BASE_URL/health" 20 2 || die "hub not healthy at $HUB_BASE_URL"
ok "hub healthy"
[ -f "$ID_DB" ] || die "ID sqlite db not found at $ID_DB"

# ── 阶段 3：hub 所用 OAuth client 注册（幂等）────────────────
# hub 侧 client_id/secret 由 start.sh 固定注入，ID API 只能服务端生成
# client_id（无法指定），因此此处直接 seed 进 ID 的 sqlite：redirect_uris
# 覆盖 hub 回调与 web 回调，is_trusted=0 以走真实 consent 页。
info "ensuring hub OAuth client in ID database"
# web SPA 以 /workbench/ 为 base（vite），OIDC 回调真实落在
# <web>/workbench/auth/tokendance/callback；同时保留无 base 变体兼容。
CLIENT_JSON_URI="[\"$HUB_BASE_URL/client/auth/oidc/callback\",\"$WEB_BASE_URL/auth/tokendance/callback\",\"http://localhost:5174/auth/tokendance/callback\",\"$WEB_BASE_URL/workbench/auth/tokendance/callback\",\"http://localhost:5174/workbench/auth/tokendance/callback\"]"
HASH="$(python3 -c "import bcrypt,sys;print(bcrypt.hashpw(sys.argv[1].encode(),bcrypt.gensalt(rounds=12)).decode())" "$CLIENT_SECRET")"
OWNER_ID="$(sqlite3 "$ID_DB" "SELECT id FROM users WHERE email='dev@local.test' LIMIT 1" 2>/dev/null || true)"
[ -n "$OWNER_ID" ] || OWNER_ID="$(sqlite3 "$ID_DB" 'SELECT id FROM users ORDER BY created_at ASC LIMIT 1' 2>/dev/null || true)"
[ -n "$OWNER_ID" ] || die "ID database has no user to own the oauth client"
NEW_CLIENT_ID="$(python3 -c 'import uuid;print(uuid.uuid4())')"
NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
if sqlite3 "$ID_DB" "SELECT 1 FROM oauth_clients WHERE client_id='$CLIENT_ID' AND deleted_at IS NULL LIMIT 1" 2>/dev/null | grep -q 1; then
  sqlite3 "$ID_DB" "UPDATE oauth_clients SET secret_hash='$HASH', redirect_uris='$CLIENT_JSON_URI', enabled=1, is_trusted=0, updated_at='$NOW' WHERE client_id='$CLIENT_ID'"
  ok "oauth client refreshed (redirect_uris/secret_hash up to date)"
else
  sqlite3 "$ID_DB" "INSERT INTO oauth_clients (id, client_id, secret_hash, name, redirect_uris, grant_types, scopes, user_id, enabled, is_trusted, created_at, updated_at) VALUES ('$NEW_CLIENT_ID', '$CLIENT_ID', '$HASH', 'AgentHub Hub (local dev)', '$CLIENT_JSON_URI', '[\"authorization_code\",\"refresh_token\"]', '[\"openid\",\"profile\",\"email\"]', '$OWNER_ID', 1, 0, '$NOW', '$NOW')"
  ok "oauth client seeded"
fi

# ── 阶段 3b：hub 侧 redirect_uri 白名单预检 ──────────────────
# web 真实回调带 /workbench 前缀；hub 的
# AGENTHUB_TOKENDANCE_ID_ALLOWED_REDIRECT_URIS 必须包含该变体，
# 否则 /client/auth/oidc/authorize 直接 400。此处用一次性 PKCE
# authorize 探测（不回显响应体，避免泄露 client_id 等参数）。
WEB_REDIRECT_URI="$WEB_BASE_URL/workbench/auth/tokendance/callback"
AUTHZ_PROBE_FILE="$(mktemp)"
PKCE_JSON="$(python3 - <<'PYEOF'
import base64, hashlib, json, secrets, string, uuid
verifier = ''.join(secrets.choice(string.ascii_letters + string.digits + '-._~') for _ in range(64))
challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b'=').decode()
print(json.dumps({'challenge': challenge, 'device_id': str(uuid.uuid4())}))
PYEOF
)"
PROBE_CHALLENGE="$(echo "$PKCE_JSON" | python3 -c 'import json,sys;print(json.load(sys.stdin)["challenge"])')"
PROBE_DEVICE_ID="$(echo "$PKCE_JSON" | python3 -c 'import json,sys;print(json.load(sys.stdin)["device_id"])')"
AUTHZ_HTTP="$(curl -s -o "$AUTHZ_PROBE_FILE" -w '%{http_code}' -m 10 -X POST "$HUB_BASE_URL/client/auth/oidc/authorize" \
  -H 'Content-Type: application/json' \
  -d "{\"code_challenge\":\"$PROBE_CHALLENGE\",\"code_challenge_method\":\"S256\",\"device_type\":\"web\",\"device_id\":\"$PROBE_DEVICE_ID\",\"redirect_uri\":\"$WEB_REDIRECT_URI\"}" || true)"
if [ "$AUTHZ_HTTP" = "200" ] && grep -q 'authorization_url' "$AUTHZ_PROBE_FILE" 2>/dev/null; then
  rm -f "$AUTHZ_PROBE_FILE"
  ok "hub accepts web redirect_uri ($WEB_REDIRECT_URI)"
else
  rm -f "$AUTHZ_PROBE_FILE"
  die "hub authorize rejected web redirect_uri (HTTP ${AUTHZ_HTTP:-n/a}). hub 需以包含 $WEB_REDIRECT_URI 的 AGENTHUB_TOKENDANCE_ID_ALLOWED_REDIRECT_URIS 重启（start.sh 白名单缺 /workbench 变体；勿改 start.sh，运行期扩展环境变量后重启 hub 即可）"
fi

# ── 阶段 4：测试账号供给（主账号 + 陪聊账号）─────────────────
# 聊天动线断言需要两个互为好友的真实账号；私聊会话禁止 self 目标，
# 故第二枚账号是必需品而不是可选项。
PARTNER_EMAIL="${AGENTHUB_E2E_PARTNER_EMAIL:-}"
PARTNER_PASSWORD="${AGENTHUB_E2E_PARTNER_PASSWORD:-}"

provision_identity() { # email password display_name -> 设置 REPLY_EMAIL / REPLY_PASSWORD
  local email="$1" password="$2" display_name="$3"
  if [ -z "$email" ] || [ -z "$password" ]; then
    email="agenthub-e2e-$(date +%s)-$(head -c4 /dev/urandom | od -An -tx1 | tr -d ' \n')@test.local"
    password="E2E-Passw0rd!$(head -c4 /dev/urandom | od -An -tx1 | tr -d ' \n')"
    local register
    register="$(curl -sf -m 10 -X POST "$ID_BASE_URL/api/auth/register" \
      -H 'Content-Type: application/json' \
      -d "{\"email\":\"$email\",\"password\":\"$password\",\"display_name\":\"$display_name\"}" || true)"
    if [ -z "$register" ]; then
      die "register failed for $email (existing account? rate limit?)"
    fi
    ok "test account registered: $email"
  else
    info "reusing provided test account $email"
  fi
  local jar login
  jar="$(mktemp)"
  login="$(curl -sf -m 10 -c "$jar" -b "$jar" -X POST "$ID_BASE_URL/api/auth/login" \
    -H 'Content-Type: application/json' \
    -d "{\"email\":\"$email\",\"password\":\"$password\"}" || true)"
  if ! grep -q '^#HttpOnly_' "$jar" && ! grep -q 'td_session' "$jar"; then
    rm -f "$jar"
    die "login did not issue td_session cookie for $email"
  fi
  rm -f "$jar"
  ok "test account login verified: $email"
  REPLY_EMAIL="$email"
  REPLY_PASSWORD="$password"
}

info "provisioning primary identity"
REPLY_EMAIL="" REPLY_PASSWORD=""
provision_identity "$USER_EMAIL" "$USER_PASSWORD" "AgentHub E2E User"
USER_EMAIL="$REPLY_EMAIL"
USER_PASSWORD="$REPLY_PASSWORD"

info "provisioning partner identity"
REPLY_EMAIL="" REPLY_PASSWORD=""
provision_identity "$PARTNER_EMAIL" "$PARTNER_PASSWORD" "AgentHub E2E Partner"
PARTNER_EMAIL="$REPLY_EMAIL"
PARTNER_PASSWORD="$REPLY_PASSWORD"

# ── 阶段 5：凭据落盘（gitignored） ───────────────────────────
mkdir -p "$ARTIFACT_DIR"
cat > "$ACCOUNT_ENV" <<EOF
AGENTHUB_E2E_ID_BASE_URL=$ID_BASE_URL
AGENTHUB_E2E_HUB_BASE_URL=$HUB_BASE_URL
AGENTHUB_E2E_WEB_BASE_URL=$WEB_BASE_URL
AGENTHUB_E2E_USER_EMAIL=$USER_EMAIL
AGENTHUB_E2E_USER_PASSWORD=$USER_PASSWORD
AGENTHUB_E2E_PARTNER_EMAIL=$PARTNER_EMAIL
AGENTHUB_E2E_PARTNER_PASSWORD=$PARTNER_PASSWORD
EOF
chmod 600 "$ACCOUNT_ENV"
ok "test credentials written to $ACCOUNT_ENV (chmod 600, gitignored)"

echo "E2E-RESULT: PASS"
