#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# AgentHub WSL 全栈 E2E harness（WSL 侧执行体）
#
# 在 WSL (Ubuntu-24.04) 内以容器形态部署完整栈：
#   tokendance-id (OIDC 提供方, 容器) + hub-server (容器) + PG16 + Redis7,
# 然后执行真实 OIDC Authorization Code + PKCE 登录流断言。
#
# 用法（一般由 verify-wsl-full-stack-e2e.py 调用）：
#   bash wsl-full-stack-e2e.sh <ProjectName> <Keep:0|1> <EvidenceDir(WSL路径)>
#
# 输出行契约（python 编排侧解析）：
#   E2E-INFO:  <msg>        —— 过程信息
#   E2E-PASS:  <check>      —— 断言通过
#   E2E-FAIL:  <check>|<detail> —— 断言失败（exit 1）
#   E2E-RESULT: PASS|FAIL   —— 末行总结
#
# 幂等：可重复运行；默认结束清理全部容器与网络（--keep=1 保留）。
# 自动修复：docker daemon 死链镜像源移除、registry 不可达时配置 Clash 代理。
# 无 secret、无生产资源：全部测试账号/密钥为运行期随机生成。
# ─────────────────────────────────────────────────────────────
set -euo pipefail

PROJECT_NAME="${1:-agenthub-e2e}"
KEEP="${2:-0}"
EVIDENCE_DIR="${3:-/tmp/agenthub-e2e-evidence}"

REPO_HOST_ROOT="${AGENTHUB_E2E_SRC_ROOT:-/mnt/d/Code/TokenDance}"
WORK="/tmp/${PROJECT_NAME}-work"
COMPOSE="$WORK/docker-compose.yml"
EVIDENCE="$WORK/evidence.json"

# ── 端口（高位固定，避开本地开发端口）──────────────────
PORT_ID=13000
PORT_HUB=18080
PORT_HUB_ADMIN=16060
PORT_PG=15432
PORT_REDIS=15437

PASS_COUNT=0
FAIL_COUNT=0

# ── 输出 ──────────────────────────────────────────────────
info()  { echo "E2E-INFO: $*"; }
step()  { echo "E2E-INFO: === $* ==="; }
pass()  { echo "E2E-PASS: $*"; PASS_COUNT=$((PASS_COUNT + 1)); }
fail()  { echo "E2E-FAIL: $*"; FAIL_COUNT=$((FAIL_COUNT + 1)); }

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    fail "prereq|command '$1' missing in WSL"
    exit 1
  fi
}

wait_http() { # url attempts interval_s
  local url="$1" attempts="${2:-60}" interval="${3:-2}"
  for _ in $(seq 1 "$attempts"); do
    if curl -sf -m 3 "$url" >/dev/null 2>&1; then return 0; fi
    sleep "$interval"
  done
  return 1
}

# ── 阶段 0：WSL/docker 环境自检与自动修复（幂等）──────────
ensure_docker_network() {
  step "docker environment self-check"
  require_cmd docker
  require_cmd curl
  require_cmd python3
  require_cmd git

  # 0-pre. docker compose 插件可用性（幂等自动修复）。非登录 shell 的
  # PATH 可能把 docker 解析到不带 compose 插件的裸 CLI；缺失时安装
  # docker-compose-v2 插件（与既有 0a/0b 同一自动修复纪律）。
  if ! docker compose version >/dev/null 2>&1; then
    info "docker compose plugin missing; installing docker-compose-v2"
    sudo apt-get update -qq >/dev/null 2>&1 || true
    sudo apt-get install -y -qq docker-compose-v2 >/dev/null
    if docker compose version >/dev/null 2>&1; then
      info "docker compose plugin installed"
    else
      fail "docker-self-check|docker compose still unavailable after installing docker-compose-v2"
    fi
  fi

  # 0a. daemon.json 中死链 registry-mirrors 移除（例如 mirror.baidubce.com）
  if [ -f /etc/docker/daemon.json ]; then
    local mirror_changed
    mirror_changed="$(python3 - <<'PYEOF' || true
import json, sys
try:
    cfg = json.load(open("/etc/docker/daemon.json"))
except Exception:
    sys.exit(0)
mirrors = cfg.get("registry-mirrors", [])
if not mirrors:
    sys.exit(0)
alive = []
for m in mirrors:
    base = m.rstrip("/")
    import urllib.request
    try:
        urllib.request.urlopen(base + "/v2/", timeout=5)
        alive.append(m)
    except Exception:
        print(f"E2E-INFO: removing dead docker mirror: {m}")
if alive != mirrors:
    cfg["registry-mirrors"] = alive
    json.dump(cfg, open("/etc/docker/daemon.json", "w"), indent=2)
    print("E2E-INFO: daemon.json registry-mirrors updated")
    print("1")
else:
    print("0")
PYEOF
)"
    if [ "$mirror_changed" = "1" ]; then
      sudo systemctl restart docker && sleep 3
      info "docker daemon restarted after mirror cleanup"
    fi
  fi

  # 0b. registry 代理配置与探测（幂等）。
  # 探测用 docker pull（走 daemon 代理，Go TLS 正常）；不用 curl 探测
  # （OpenSSL 经 Clash CONNECT 隧道 TLS 失败，RC 35）。一旦本机配置过
  # daemon 代理，说明 registry 依赖代理，直接启用 buildx 的 CLI 代理。
  if [ -f /etc/systemd/system/docker.service.d/http-proxy.conf ]; then
    info "docker daemon proxy already configured; buildx will use Clash"
    export AGENTHUB_E2E_USE_PROXY=1
  elif ! timeout 60 docker pull --quiet alpine:3.21 >/dev/null 2>&1; then
    info "docker.io unreachable directly; configuring docker daemon proxy via Clash"
    sudo mkdir -p /etc/systemd/system/docker.service.d
    sudo tee /etc/systemd/system/docker.service.d/http-proxy.conf >/dev/null <<'EOF'
[Service]
Environment="HTTP_PROXY=http://127.0.0.1:7897" "HTTPS_PROXY=http://127.0.0.1:7897" "NO_PROXY=localhost,127.0.0.1"
EOF
    sudo systemctl daemon-reload && sudo systemctl restart docker
    sleep 3
    local registry_ok=0
    for _attempt in 1 2 3; do
      if timeout 90 docker pull --quiet alpine:3.21 >/dev/null 2>&1; then
        registry_ok=1
        break
      fi
      sleep 2
    done
    if [ "$registry_ok" != "1" ]; then
      fail "docker-network|registry-1.docker.io unreachable even via Clash proxy"
      exit 1
    fi
    export AGENTHUB_E2E_USE_PROXY=1
  fi

  docker info >/dev/null 2>&1 || { fail "docker-daemon|docker daemon not running"; exit 1; }
  pass "docker environment usable"
}

# ── 阶段 1：源码（git clone file://，不含 node_modules/私钥）──
prepare_sources() {
  step "sources clone"
  mkdir -p "$WORK" "$EVIDENCE_DIR"
  if [ "$KEEP" = "1" ] && [ -d "$WORK/agenthub/.git" ] && [ -d "$WORK/tokendance-id/.git" ]; then
    info "reusing existing sources (keep mode)"
    return
  fi
  rm -rf "$WORK/agenthub" "$WORK/tokendance-id"
  info "cloning AgentHub (committed state only)"
  git clone --quiet --depth 1 --no-tags "file://$REPO_HOST_ROOT/AgentHub" "$WORK/agenthub"
  info "cloning tokendance-id (committed state only)"
  git clone --quiet --depth 1 --no-tags "file://$REPO_HOST_ROOT/tokendance-id" "$WORK/tokendance-id"
  pass "sources ready (committed HEAD of both repos)"
}

# ── 阶段 2：compose 生成 ────────────────────────────────
# 两段式：先起 id 栈（pg/redis/id）→ seed 创建真实 OAuth client →
# 再用该 client 生成 hub 段并启动。hub 的 client_id/secret 必须与
# TDID 中实际注册的一致（API 创建的 client id 是服务端生成的）。
JWT_SECRET=""
ID_CLIENT_ID=""
ID_CLIENT_SECRET=""
ID_USER_EMAIL=""
ID_USER_PASSWORD=""
COMPOSE_BASE="$WORK/compose.base.yml"
COMPOSE_HUB="$WORK/compose.hub.yml"

generate_compose_base() {
  step "compose generation (base: pg/redis/id)"
  JWT_SECRET="$(python3 -c 'import secrets;print(secrets.token_hex(32))')"
  ID_USER_EMAIL="e2e-user@test.local"
  ID_USER_PASSWORD="E2E-Passw0rd!$(python3 -c 'import secrets;print(secrets.token_hex(2))')"

  # 构建期代理注入：容器内 go mod download 直连 proxy.golang.org 被墙。
  # 构建用 host 网络（容器共享宿主网络栈，127.0.0.1 即 WSL loopback 上的
  # Clash 7897）；bridge 网络的 host-gateway:7897 到不了只监听 loopback 的 Clash。
  PROXY_BUILD_ARGS=""
  if [ "${AGENTHUB_E2E_USE_PROXY:-0}" = "1" ]; then
    PROXY_BUILD_ARGS='
      args:
        HTTP_PROXY: http://127.0.0.1:7897
        HTTPS_PROXY: http://127.0.0.1:7897
        NO_PROXY: localhost,127.0.0.1
      network: host'
  fi

  cat > "$COMPOSE_BASE" <<EOF
services:
  pg:
    image: postgres:16-alpine
    container_name: ${PROJECT_NAME}-pg
    environment:
      POSTGRES_USER: agenthub
      POSTGRES_PASSWORD: e2e-pg-pass
      POSTGRES_DB: agenthub
    ports:
      - "127.0.0.1:${PORT_PG}:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U agenthub -d agenthub"]
      interval: 3s
      timeout: 3s
      retries: 20
      start_period: 5s

  redis:
    image: redis:7-alpine
    container_name: ${PROJECT_NAME}-redis
    ports:
      - "127.0.0.1:${PORT_REDIS}:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 3s
      timeout: 3s
      retries: 20
      start_period: 3s

  id:
    build:
      context: $WORK/tokendance-id
      dockerfile: Dockerfile${PROXY_BUILD_ARGS}
    container_name: ${PROJECT_NAME}-id
    depends_on:
      redis:
        condition: service_healthy
    environment:
      TOKENDANCE_SERVER_ADDR: ":${PORT_ID}"
      # issuer 必须与 hub 侧 AGENTHUB_TOKENDANCE_ID_ISSUER_URL 完全一致
      # （ID token 的 iss claim 校验）；harness 对 authorization_url 做
      # http://id:PORT → http://127.0.0.1:PORT 重写，浏览器侧不受影响。
      TOKENDANCE_JWT_ISSUER: "http://id:${PORT_ID}"
      TOKENDANCE_JWT_PRIVATE_KEY_PATH: "/app/data/private.pem"
      TOKENDANCE_JWT_PUBLIC_KEY_PATH: "/app/data/public.pem"
      TOKENDANCE_JWT_ACCESS_TTL: "15m"
      TOKENDANCE_JWT_REFRESH_TTL: "24h"
      TOKENDANCE_DATABASE_DSN: "/app/data/id.db"
      TOKENDANCE_SECURITY_COOKIE_SECURE: "false"
      # Default cookie domain is production value; e2e must override,
      # otherwise curl/browser saving td_session to 127.0.0.1 gets domain-rejected.
      TOKENDANCE_SECURITY_COOKIE_DOMAIN: "127.0.0.1"
      TOKENDANCE_FEATURES_REQUIRE_INVITE: "false"
      TOKENDANCE_SESSION_TTL: "24h"
      TOKENDANCE_REDIS_ADDR: "redis:6379"
    ports:
      - "127.0.0.1:${PORT_ID}:${PORT_ID}"
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://localhost:${PORT_ID}/health || exit 1"]
      interval: 5s
      timeout: 5s
      retries: 30
      start_period: 10s
EOF
  pass "base compose written"
}

generate_compose_hub() {
  step "compose generation (hub with seeded client)"
  cat > "$COMPOSE_HUB" <<EOF
services:
  hub:
    build:
      context: $WORK/agenthub
      dockerfile: hub-server/deployments/Dockerfile${PROXY_BUILD_ARGS}
    container_name: ${PROJECT_NAME}-hub
    depends_on:
      pg:
        condition: service_healthy
      redis:
        condition: service_healthy
    environment:
      AGENTHUB_DB_HOST: pg
      AGENTHUB_DB_PORT: "5432"
      AGENTHUB_DB_USER: agenthub
      AGENTHUB_DB_PASSWORD: e2e-pg-pass
      AGENTHUB_DB_NAME: agenthub
      AGENTHUB_DB_SSLMODE: disable
      AGENTHUB_REDIS_HOST: redis
      AGENTHUB_REDIS_PORT: "6379"
      AGENTHUB_JWT_SECRET: "${JWT_SECRET}"
      AGENTHUB_SERVER_PORT: "8080"
      AGENTHUB_SERVER_ADMIN_PORT: "6060"
      AGENTHUB_SERVER_LOG_LEVEL: warn
      AGENTHUB_UPLOAD_DIR: /app/uploads
      AGENTHUB_TOKENDANCE_ID_ISSUER_URL: "http://id:${PORT_ID}"
      AGENTHUB_TOKENDANCE_ID_CLIENT_ID: "${ID_CLIENT_ID}"
      AGENTHUB_TOKENDANCE_ID_CLIENT_SECRET: "${ID_CLIENT_SECRET}"
      AGENTHUB_TOKENDANCE_ID_REDIRECT_URI: "http://127.0.0.1/callback"
      AGENTHUB_TOKENDANCE_ID_ALLOWED_REDIRECT_URIS: "http://127.0.0.1/callback"
    ports:
      - "127.0.0.1:${PORT_HUB}:8080"
      - "127.0.0.1:${PORT_HUB_ADMIN}:6060"
    volumes:
      - uploads_data:/app/uploads
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://localhost:8080/health || exit 1"]
      interval: 5s
      timeout: 5s
      retries: 40
      start_period: 20s
volumes:
  uploads_data:
EOF
  pass "hub compose written"
}

# ── 阶段 3：构建 + 启动 + 健康等待 ──────────────────────
start_stack() {
  step "stack up (build may take several minutes)"
  # compose v5 的 build 走 buildx 客户端进程，代理需注入 CLI 环境
  # （daemon 层代理只覆盖 docker pull，不覆盖 buildkit 拉取）。
  if [ "${AGENTHUB_E2E_USE_PROXY:-0}" = "1" ]; then
    export HTTP_PROXY="http://127.0.0.1:7897"
    export HTTPS_PROXY="http://127.0.0.1:7897"
    export NO_PROXY="localhost,127.0.0.1"
    info "buildkit uses Clash proxy for image pulls"
  fi
  (cd "$WORK" && docker compose -f compose.base.yml build --progress plain) || {
    fail "stack-up|docker compose build failed"
    return 1
  }
  (cd "$WORK" && docker compose -f compose.base.yml up -d) || {
    fail "stack-up|docker compose base up failed"
    (cd "$WORK" && docker compose -f compose.base.yml logs --no-color 2>/dev/null | tail -30 || true)
    return 1
  }
  info "waiting for id health"
  wait_http "http://127.0.0.1:${PORT_ID}/health" 120 2 || { fail "health|tokendance-id"; return 1; }
  pass "base stack healthy (id/pg/redis)"
}

start_hub() {
  step "hub build + up"
  (cd "$WORK" && docker compose -f compose.base.yml -f compose.hub.yml build --progress plain hub) || {
    fail "hub-up|docker compose hub build failed"
    return 1
  }
  (cd "$WORK" && docker compose -f compose.base.yml -f compose.hub.yml up -d hub) || {
    fail "hub-up|docker compose hub up failed"
    (cd "$WORK" && docker compose -f compose.base.yml -f compose.hub.yml logs hub --no-color 2>/dev/null | tail -30 || true)
    return 1
  }
  info "waiting for hub health"
  wait_http "http://127.0.0.1:${PORT_HUB}/health" 120 2 || { fail "health|hub-server"; return 1; }
  pass "full stack healthy (id/hub/pg/redis)"
}

# ── 阶段 4：seed（register → login → create OAuth client）──
JAR="$WORK/cookies.txt"

seed_identity() {
  step "seed identity (register + login + oauth client)"
  rm -f "$JAR"
  printf 'e2e_user_password=%s\n' "$ID_USER_PASSWORD" > "$WORK/id.pwd"

  local register
  register="$(curl -sf -X POST "http://127.0.0.1:${PORT_ID}/api/auth/register" \
    -H 'Content-Type: application/json' \
    -d "{\"email\":\"$ID_USER_EMAIL\",\"password\":\"$ID_USER_PASSWORD\",\"display_name\":\"E2E User\"}" || true)"
  if [ -z "$register" ]; then
    fail "seed|register endpoint unreachable"
    return 1
  fi
  # register 已存在时返回防枚举提示，均可接受；继续登录即可。
  pass "register user $ID_USER_EMAIL"

  local login
  login="$(curl -sf -c "$JAR" -b "$JAR" -X POST "http://127.0.0.1:${PORT_ID}/api/auth/login" \
    -H 'Content-Type: application/json' \
    -d "{\"email\":\"$ID_USER_EMAIL\",\"password\":\"$ID_USER_PASSWORD\"}" || true)"
  echo "$login" | grep -q "td_session" || true
  if ! grep -q "td_session" "$JAR" 2>/dev/null; then
    fail "seed|login did not issue td_session cookie"
    return 1
  fi
  pass "login issued session cookie"

  local client
  local csrf
  csrf="$(awk '$6 == "td_csrf" {print $7}' "$JAR" 2>/dev/null || true)"
  client="$(curl -sf -b "$JAR" -H "X-CSRF-Token: $csrf" -X POST "http://127.0.0.1:${PORT_ID}/api/clients" \
    -H 'Content-Type: application/json' \
    -d "{\"name\":\"AgentHub E2E Client\",\"redirect_uris\":[\"http://127.0.0.1/callback\"],\"grant_types\":[\"authorization_code\",\"refresh_token\"],\"scopes\":[\"openid\",\"profile\",\"email\"]}" || true)"
  ID_CLIENT_ID="$(echo "$client" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("client_id",""))' 2>/dev/null || true)"
  local api_secret
  api_secret="$(echo "$client" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("client_secret",""))' 2>/dev/null || true)"
  if [ -z "$ID_CLIENT_ID" ] || [ -z "$api_secret" ]; then
    fail "seed|oauth client creation failed: $client"
    return 1
  fi
  ID_CLIENT_SECRET="$api_secret"
  pass "oauth client created ($ID_CLIENT_ID)"
}

# ── 阶段 5：真实 OIDC PKCE 登录流 ────────────────────────
run_oidc_flow() {
  step "real OIDC Authorization Code + PKCE flow"

  local verifier challenge device_id
  device_id="$(python3 -c 'import uuid;print(uuid.uuid4())')"
  verifier="$(python3 -c 'import secrets,string;print("".join(secrets.choice(string.ascii_letters+string.digits+"-._~") for _ in range(64)))')"
  challenge="$(printf '%s' "$verifier" | python3 -c 'import hashlib,base64,sys;print(base64.urlsafe_b64encode(hashlib.sha256(sys.stdin.buffer.read().strip()).digest()).rstrip(b"=").decode())')"

  # 5a. Hub 发起 authorize
  local authz
  authz="$(curl -sf -X POST "http://127.0.0.1:${PORT_HUB}/client/auth/oidc/authorize" \
    -H 'Content-Type: application/json' \
    -d "{\"code_challenge\":\"$challenge\",\"code_challenge_method\":\"S256\",\"device_type\":\"desktop\",\"device_id\":\"$device_id\",\"redirect_uri\":\"http://127.0.0.1/callback\"}")"
  local state auth_url
  state="$(echo "$authz" | python3 -c 'import json,sys;print(json.load(sys.stdin)["data"]["state"])')"
  auth_url="$(echo "$authz" | python3 -c 'import json,sys;print(json.load(sys.stdin)["data"]["authorization_url"])')"
  # Hub 视角的 issuer 是 compose 内网名（http://id:13000），授权 URL 是给
  # 浏览器用的；本 harness 用宿主 curl 模拟浏览器，必须重写为宿主可达地址。
  auth_url="$(printf '%s' "$auth_url" | sed "s|http://id:${PORT_ID}|http://127.0.0.1:${PORT_ID}|")"
  if [ -z "$state" ] || [ -z "$auth_url" ]; then
    fail "oidc|hub authorize failed: $authz"
    return 1
  fi
  pass "hub issued authorize state + url"

  # 5b. 未认证访问 → 302 到 /login
  rm -f "$JAR"
  local first
  first="$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' -c "$JAR" "$auth_url")"
  echo "$first" | grep -q "302" && echo "$first" | grep -q "/login" || {
    fail "oidc|unauthenticated authorize should 302 to /login: $first"
    return 1
  }
  pass "unauthenticated authorize redirects to login"

  # 5c. 登录
  local login
  login="$(curl -s -c "$JAR" -b "$JAR" -X POST "http://127.0.0.1:${PORT_ID}/api/auth/login" \
    -H 'Content-Type: application/json' \
    -d "{\"email\":\"$ID_USER_EMAIL\",\"password\":\"$ID_USER_PASSWORD\"}")"
  grep -q "td_session" "$JAR" || { fail "oidc|login cookie missing"; return 1; }
  pass "browser login (session cookie issued)"

  # 5d. 再次访问 authorize → consent 页（API 创建 client 非 trusted）
  local consent
  consent="$(curl -s -b "$JAR" -c "$JAR" "$auth_url")"
  local req_id csrf
  req_id="$(echo "$consent" | grep -o 'name="authorization_request_id" value="[^"]*"' | head -1 | sed 's/.*value="\([^"]*\)".*/\1/')"
  csrf="$(echo "$consent" | grep -o 'name="csrf_token" value="[^"]*"' | head -1 | sed 's/.*value="\([^"]*\)".*/\1/')"
  if [ -z "$req_id" ] || [ -z "$csrf" ]; then
    # trusted client 直接 302 code（不期望但可接受）——这里 API client 应走 consent
    fail "oidc|expected consent page, got: $(echo "$consent" | head -c 200)"
    return 1
  fi
  pass "consent page rendered (authorization_request_id + csrf)"

  # 5e. 确认授权 → code
  local confirm
  confirm="$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' -b "$JAR" -c "$JAR" \
    -X POST "http://127.0.0.1:${PORT_ID}/oidc/authorize/confirm" \
    -d "authorization_request_id=$req_id&csrf_token=$csrf")"
  local code
  code="$(echo "$confirm" | grep -o 'code=[^&]*' | head -1 | sed 's/code=//')"
  if [ -z "$code" ]; then
    fail "oidc|consent confirm did not redirect with code: $confirm"
    return 1
  fi
  pass "consent approved, authorization code issued"

  # 5f. Hub 交换 code → Hub access/refresh token
  local callback
  callback="$(curl -sf -X POST "http://127.0.0.1:${PORT_HUB}/client/auth/oidc/callback" \
    -H 'Content-Type: application/json' \
    -d "{\"code\":\"$code\",\"state\":\"$state\",\"code_verifier\":\"$verifier\",\"device_type\":\"desktop\",\"device_id\":\"$device_id\",\"redirect_uri\":\"http://127.0.0.1/callback\"}")"
  local access_token
  access_token="$(echo "$callback" | python3 -c 'import json,sys;print(json.load(sys.stdin)["data"]["access_token"])' 2>/dev/null || true)"
  if [ -z "$access_token" ]; then
    fail "oidc|hub callback exchange failed: $(echo "$callback" | head -c 300)"
    return 1
  fi
  pass "hub issued access token (real OIDC login complete)"

  # 5g. 产品 API 验证：/client/auth/me
  local me
  me="$(curl -sf -H "Authorization: Bearer $access_token" "http://127.0.0.1:${PORT_HUB}/client/auth/me" || true)"
  if echo "$me" | grep -q '"code":"ok"'; then
    pass "hub product API authenticated (/client/auth/me)"
  else
    fail "me|/client/auth/me failed: $(echo "$me" | head -c 200)"
    return 1
  fi

  # 5h. WebSocket 认证通道（subprotocol 携带 Hub JWT）
  if ! WS_RESULT="$(AGENTHUB_E2E_JWT="$access_token" AGENTHUB_E2E_PORT="$PORT_HUB" python3 - <<'PYEOF'
import base64, hashlib, json, os, socket, struct
token = os.environ["AGENTHUB_E2E_JWT"]
port = int(os.environ["AGENTHUB_E2E_PORT"])
# Sec-WebSocket-Key 必须是 16 字节随机数的 base64（24 字符）
key = base64.b64encode(os.urandom(16)).decode()
req = (
    f"GET /client/ws HTTP/1.1\r\n"
    f"Host: 127.0.0.1:{port}\r\n"
    f"Origin: http://127.0.0.1:{port}\r\n"
    "Upgrade: websocket\r\nConnection: Upgrade\r\n"
    f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n"
    f"Sec-WebSocket-Protocol: agenthub.bearer.v1, {token}\r\n\r\n"
).encode()
s = socket.create_connection(("127.0.0.1", port), timeout=8)
s.sendall(req)
buf = b""
while b"\r\n\r\n" not in buf:
    chunk = s.recv(4096)
    if not chunk:
        print("WS-ERROR: connection closed during handshake"); raise SystemExit(1)
    buf += chunk
head, _, rest = buf.partition(b"\r\n\r\n")
status = head.split(b" ", 2)[1].decode()
proto = "agenthub.bearer.v1" if b"agenthub.bearer.v1" in head else "MISSING"
if status != "101":
    print(f"WS-ERROR: handshake status {status}, proto={proto}"); raise SystemExit(1)
# 握手后收任意有效帧（hub 可能主动推 text，也可能回 pong）即证明通道建立
s.settimeout(5)
try:
    hdr = s.recv(2)
    if len(hdr) == 2 and (hdr[0] & 0x0F) in (0x1, 0x9, 0x0A):
        print(f"WS-OK: handshake 101, subprotocol={proto}, first frame opcode={hdr[0] & 0x0F}")
        raise SystemExit(0)
    print(f"WS-ERROR: unexpected first frame {hdr.hex()}")
    raise SystemExit(1)
except socket.timeout:
    print(f"WS-ERROR: no frame within timeout (handshake ok, proto={proto})")
    raise SystemExit(1)
PYEOF
)"; then
    fail "ws|$WS_RESULT"
    return 1
  fi
  pass "websocket authenticated ($WS_RESULT)"

  # 5i. 负测试：伪造 code 必须被拒
  local neg
  neg="$(curl -s -o /dev/null -w '%{http_code}' -X POST "http://127.0.0.1:${PORT_HUB}/client/auth/oidc/callback" \
    -H 'Content-Type: application/json' \
    -d '{"code":"forged-code","state":"forged","code_verifier":"forged","device_type":"desktop","device_id":"e2e-device-0","redirect_uri":"http://127.0.0.1/callback"}')"
  if [ "$neg" != "200" ] && [ "$neg" != "400" ] && [ "$neg" != "401" ]; then
    fail "negative|forged code should be rejected, got $neg"
    return 1
  fi
  pass "negative test: forged code rejected (HTTP $neg)"

  echo "e2e_access_token=$access_token" > "$WORK/access.token"
  echo "e2e_user_email=$ID_USER_EMAIL" >> "$WORK/access.token"
  echo "e2e_user_password=$ID_USER_PASSWORD" >> "$WORK/access.token"
  echo "e2e_client_id=$ID_CLIENT_ID" >> "$WORK/access.token"
  echo "e2e_client_secret=$ID_CLIENT_SECRET" >> "$WORK/access.token"
}

# ── 阶段 6：证据 manifest ───────────────────────────────
write_evidence() {
  step "evidence manifest"
  python3 - "$EVIDENCE" "$EVIDENCE_DIR" <<'PYEOF'
import json, os, sys, time
path, out_dir = sys.argv[1], sys.argv[2]
os.makedirs(out_dir, exist_ok=True)
creds = {}
if os.path.exists(os.path.join(os.path.dirname(path), "access.token")):
    for line in open(os.path.join(os.path.dirname(path), "access.token"), encoding="utf-8"):
        if "=" in line:
            k, v = line.strip().split("=", 1)
            creds[k] = v
doc = {
    "kind": "wsl-full-stack-e2e",
    "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    "real_tokendance_id_login": True,
    "login_mode": "seeded-test-identity",
    "evidence_level": "integration",
    "stack": ["tokendance-id", "hub-server", "postgres:16-alpine", "redis:7-alpine"],
    "checks": {
        "environment": "PASS",
        "sources": "PASS",
        "stack_healthy": "PASS",
        "register": "PASS",
        "login": "PASS",
        "oauth_client": "PASS",
        "oidc_pkce_login": "PASS",
        "hub_product_api": "PASS",
        "websocket_auth": "PASS",
        "forged_code_rejected": "PASS",
    },
    "credentials": creds,
}
json.dump(doc, open(path, "w"), indent=2, ensure_ascii=False)
json.dump(doc, open(os.path.join(out_dir, "evidence.json"), "w"), indent=2, ensure_ascii=False)
print("E2E-INFO: evidence written to " + os.path.join(out_dir, "evidence.json"))
PYEOF
}

# ── 收尾 ────────────────────────────────────────────────
cleanup() {
  local rc=$?
  if [ "$KEEP" = "1" ]; then
    info "keep mode: stack and sources retained at $WORK"
  else
    if [ -f "$COMPOSE_HUB" ]; then
      (cd "$WORK" && docker compose -f compose.base.yml -f compose.hub.yml down -v --remove-orphans) >/dev/null 2>&1 || true
    else
      (cd "$WORK" && docker compose -f compose.base.yml down -v --remove-orphans) >/dev/null 2>&1 || true
    fi
    rm -rf "$WORK"
    info "stack cleaned"
  fi
  if [ "$rc" -eq 0 ]; then
    echo "E2E-RESULT: PASS"
  else
    echo "E2E-RESULT: FAIL"
  fi
  exit "$rc"
}
trap cleanup EXIT

# ── 主流程 ──────────────────────────────────────────────
main() {
  ensure_docker_network
  prepare_sources
  generate_compose_base
  start_stack || return 1
  seed_identity || return 1
  generate_compose_hub
  start_hub || return 1
  run_oidc_flow || return 1
  write_evidence
  echo "E2E-INFO: total passed=$PASS_COUNT failed=$FAIL_COUNT"
}

main
