#!/usr/bin/env bash
# ───────────────────────────────────────────────────────────────
# devserver.sh — 远程 dev 服务器测试平台统一入口（#1681）
#
# 远程服务器 = 真实测试面（L3）：全栈（TokenDanceID + hub + edge +
# web vite）跑在服务器上，本脚本从本地发起同步/启动/测试/回传。
#
# 用法:
#   scripts/dev/devserver.sh sync     # 打包本地 master 增量并推送到服务器（ff-only）
#   scripts/dev/devserver.sh start    # 服务器全栈启动（幂等）
#   scripts/dev/devserver.sh stop     # 停止 hub/edge/web 进程（容器保留）
#   scripts/dev/devserver.sh status   # 四服务健康 + git 状态
#   scripts/dev/devserver.sh test     # 服务器跑 go test -short 并回传报告 JSON
#   scripts/dev/devserver.sh integration  # integration lane：重建测试库 + 全量跑并回传报告
#
# 环境变量（均在本地配置，仓库不存任何地址/凭据）:
#   AGENTHUB_DEVSERVER_SSH      ssh 目标（必填；具体 alias/地址只放私有运维配置）
#   AGENTHUB_DEVSERVER_SSH_BIN  ssh-compatible 可执行文件（默认 ssh；可注入受控 wrapper）
#   AGENTHUB_DEVSERVER_ROOT     服务器仓库路径（默认 /srv/agenthub/AgentHub；可私有覆盖）
#
# 安全契约：
#   - 仓库内零硬编码地址/凭据；secret 只存在于服务器本地 .env（gitignored）。
#   - sync 要求服务器工作树干净（git status --porcelain 为空）才允许快进，
#     防止证据跑在脏树上（#1681 服务器证据纪律）。
# ───────────────────────────────────────────────────────────────
set -euo pipefail

REMOTE="${AGENTHUB_DEVSERVER_SSH:-}"
SSH_BIN="${AGENTHUB_DEVSERVER_SSH_BIN:-ssh}"
REPO_ROOT="${AGENTHUB_DEVSERVER_ROOT:-/srv/agenthub/AgentHub}"
LOCAL_REPO="$(cd "$(dirname "$0")/../.." && pwd)"

log() { printf '[devserver] %s\n' "$*"; }
die() { printf '[devserver] ERROR: %s\n' "$*" >&2; exit 1; }
ssh_cmd() { "$SSH_BIN" "$@"; }
require_remote_config() {
  [ -n "$REMOTE" ] || die "AGENTHUB_DEVSERVER_SSH 未配置；具体远端 alias/地址必须留在私有运维配置"
}
remote_bash() {
  local quoted_root
  printf -v quoted_root '%q' "$REPO_ROOT"
  ssh_cmd -o ConnectTimeout=30 "$REMOTE" "bash -s -- $quoted_root"
}
resolve_report_dir() {
  local configured="${AGENTHUB_DEVSERVER_REPORT_DIR:-.tmp/devserver-reports}"
  case "$configured" in
    /*) printf '%s\n' "$configured" ;;
    *) printf '%s/%s\n' "$LOCAL_REPO" "$configured" ;;
  esac
}

# ssh 只读前置检查；失败给出可操作提示（不在仓库放任何地址）。
remote_check() {
  require_remote_config
  ssh_cmd -o ConnectTimeout=10 "$REMOTE" "echo ok" >/dev/null 2>&1 ||
    die "无法连接已配置的远端测试目标；请检查私有 SSH 配置（见 scripts/dev/README.md）"
}

cmd_sync() {
  require_remote_config
  bundle_tmp="$(mktemp -t agenthub-sync.XXXXXX)"
  trap 'rm -f "${bundle_tmp:-}"' EXIT
  log "检查服务器工作树…"
  local dirty
  dirty="$(ssh_cmd -o ConnectTimeout=10 "$REMOTE" "cd '$REPO_ROOT' && git status --porcelain" 2>/dev/null || true)"
  if [ -n "$dirty" ]; then
    die "服务器工作树不干净，禁止快进（证据纪律）。先在服务器处理：\n$dirty"
  fi
  local base
  base="$(ssh_cmd -o ConnectTimeout=10 "$REMOTE" "cd '$REPO_ROOT' && git rev-parse HEAD" 2>/dev/null || true)"
  [ -n "$base" ] || die "无法读取服务器 HEAD"
  if ! git -C "$LOCAL_REPO" cat-file -e "$base" 2>/dev/null; then
    log "服务器 HEAD ($base) 不在本地，尝试全量 bundle…"
    git -C "$LOCAL_REPO" bundle create "$bundle_tmp" --all
  else
    # 服务器只跟踪 master：bundle 打包本地 master ref（而不是当前分支），
    # 保证 bundle 内含 master ref 可供 fetch master:refs/remotes/origin/master。
    # 无增量时 bundle create 以 "Refusing to create empty bundle" 退出 —— 属正常分支。
    git -C "$LOCAL_REPO" bundle create "$bundle_tmp" "$base..master" 2>/dev/null || true
  fi
  if [ ! -s "$bundle_tmp" ] || ! git -C "$LOCAL_REPO" bundle verify "$bundle_tmp" >/dev/null 2>&1; then
    log "无增量（服务器已是最新）"
    return 0
  fi
  local size
  size=$(wc -c <"$bundle_tmp" | tr -d ' ')
  log "推送增量 bundle（$size bytes）…"
  ssh_cmd -o ConnectTimeout=15 "$REMOTE" "cat > /tmp/agenthub-sync.bundle" <"$bundle_tmp"
  ssh_cmd -o ConnectTimeout=30 "$REMOTE" "cd '$REPO_ROOT' && git fetch /tmp/agenthub-sync.bundle master:refs/remotes/origin/master && rm -f /tmp/agenthub-sync.bundle && git merge --ff-only origin/master && git log --oneline -1"
  log "sync 完成"
}

cmd_start() {
  remote_check
  remote_bash <<'REMOTE_SCRIPT'
set -euo pipefail
REPO_ROOT="${1:?missing remote repo root}"
cd "$REPO_ROOT"
# 服务器系统级环境（/etc/environment）不随非交互 SSH 会话加载；显式 source
# 以取 GOPROXY 等镜像配置（仓库不硬编码任何镜像地址）。本地覆盖用 DEVSERVER_GOPROXY。
if [ -z "${DEVSERVER_GOPROXY:-}" ] && [ -f /etc/environment ]; then
  # shellcheck disable=SC1091
  . /etc/environment 2>/dev/null || true
  export GOPROXY="${GOPROXY:-}"
fi
[ -n "${DEVSERVER_GOPROXY:-}" ] && export GOPROXY="$DEVSERVER_GOPROXY"
# PATH 必须在 source 之后补（/etc/environment 会整体覆盖 PATH）。
export PATH=/usr/local/go/bin:$PATH

# 依赖容器（幂等）
docker compose up -d postgres redis

# env 从服务器本地 .env 读取，值不出脚本
for key in AGENTHUB_JWT_SECRET AGENTHUB_DB_PASSWORD AGENTHUB_DB_NAME AGENTHUB_DB_USER \
           AGENTHUB_DB_HOST AGENTHUB_DB_PORT AGENTHUB_TOKENDANCE_ID_ISSUER_URL \
           AGENTHUB_TOKENDANCE_ID_CLIENT_ID AGENTHUB_TOKENDANCE_ID_CLIENT_SECRET \
           AGENTHUB_TOKENDANCE_ID_REDIRECT_URI AGENTHUB_TOKENDANCE_ID_ALLOWED_REDIRECT_URIS; do
  line="$(awk -F= -v k="$key" '$1==k {sub(/^[^=]*=/,""); print}' .env | tail -1)"
  [ -n "$line" ] || { echo "[devserver] ERROR: .env 缺 $key"; exit 1; }
  export "$key=$line"
done

# 幂等重启：按 pidfile 停旧进程，不误伤其他端口用户
stop_by_pidfile() { # $1=name $2=pidfile
  if [ -f "$2" ] && kill -0 "$(cat "$2")" 2>/dev/null; then
    kill "$(cat "$2")" 2>/dev/null || true
    for _ in 1 2 3 4 5; do kill -0 "$(cat "$2")" 2>/dev/null || break; sleep 1; done
  fi
  rm -f "$2"
}
stop_by_pidfile hub /tmp/agenthub-hub.pid
stop_by_pidfile edge /tmp/agenthub-edge.pid

# 后端：go build 产物直跑（go run 会 spawn /tmp/go-build 子进程，
# pidfile 记不住真实服务进程，停不干净；build+exec 让 pidfile 精确）。
mkdir -p /tmp/agenthub-bin
go build -o /tmp/agenthub-bin/server-hub ./hub-server/cmd/server-hub
go build -o /tmp/agenthub-bin/agenthub-edge ./edge-server/cmd/agenthub-edge
nohup /tmp/agenthub-bin/server-hub >/tmp/hub.log 2>&1 & echo $! >/tmp/agenthub-hub.pid
nohup /tmp/agenthub-bin/agenthub-edge >/tmp/edge.log 2>&1 & echo $! >/tmp/agenthub-edge.pid

# 健康等待（wait_http 替换裸 sleep）
wait_http() { # $1=url $2=name $3=迭代上限（每次 sleep 2s，总时长约 2×$3 秒）
  local i=0
  until curl -sf -m 2 "$1" >/dev/null 2>&1; do
    i=$((i+1)); [ "$i" -ge "$3" ] && { echo "[devserver] TIMEOUT — $2 未在 ~$((2*$3))s 内就绪"; return 1; }
    sleep 2
  done
  echo "[devserver] $2 Ready"
}
wait_http http://127.0.0.1:8080/health hub 90
wait_http http://127.0.0.1:3210/v1/health edge 60
echo "[devserver] start 完成"
REMOTE_SCRIPT
}

cmd_stop() {
  remote_check
  remote_bash <<'REMOTE_SCRIPT'
set -euo pipefail
for entry in hub:/tmp/agenthub-hub.pid edge:/tmp/agenthub-edge.pid; do
  name="${entry%%:*}"; pidfile="${entry##*:}"
  if [ -f "$pidfile" ] && kill -0 "$(cat "$pidfile")" 2>/dev/null; then
    kill "$(cat "$pidfile")" && echo "[devserver] $name stopped"
  fi
  rm -f "$pidfile"
done
# 容器保留（PG/Redis 数据面不动）
REMOTE_SCRIPT
}

cmd_status() {
  remote_check
  remote_bash <<'REMOTE_SCRIPT'
set -euo pipefail
REPO_ROOT="${1:?missing remote repo root}"
echo "== git =="
git -C "$REPO_ROOT" status -sb | head -2
echo "== services =="
for url_name in "http://127.0.0.1:3000/.well-known/openid-configuration ID" "http://127.0.0.1:8080/health hub" "http://127.0.0.1:3210/v1/health edge" "http://127.0.0.1:5174/ web"; do
  url="${url_name% *}"; name="${url_name##* }"
  if curl -sf -m 3 "$url" >/dev/null 2>&1; then echo "$name OK"; else echo "$name DOWN"; fi
done
echo "== containers =="
docker ps --format '{{.Names}} {{.Status}}' | grep -E 'postgres|redis' || true
REMOTE_SCRIPT
}

cmd_test() {
  remote_check
  local out_dir out_file
  out_dir="$(resolve_report_dir)"
  mkdir -p "$out_dir"
  out_file="$out_dir/report-$(date +%Y%m%d-%H%M%S).json"
  log "服务器跑 go test -short（hub+edge internal）…"
  remote_bash >"$out_file" <<'REMOTE_SCRIPT'
set -euo pipefail
REPO_ROOT="${1:?missing remote repo root}"
# 服务器系统级环境（/etc/environment）不随非交互 SSH 会话加载；显式 source。
if [ -z "${DEVSERVER_GOPROXY:-}" ] && [ -f /etc/environment ]; then
  # shellcheck disable=SC1091
  . /etc/environment 2>/dev/null || true
  export GOPROXY="${GOPROXY:-}"
fi
[ -n "${DEVSERVER_GOPROXY:-}" ] && export GOPROXY="$DEVSERVER_GOPROXY"
# PATH 必须在 source 之后补（/etc/environment 会整体覆盖 PATH）。
export PATH=/usr/local/go/bin:$PATH
cd "$REPO_ROOT"
commit="$(git rev-parse --short HEAD)"
branch="$(git rev-parse --abbrev-ref HEAD)"
start_ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
if go test -short -count=1 ./hub-server/internal/... ./edge-server/internal/... >/tmp/devserver-test.log 2>&1; then
  result="pass"
else
  result="fail"
fi
end_ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
packages_ok="$(grep -c '^ok' /tmp/devserver-test.log || true)"
failures="$(grep -c '^--- FAIL' /tmp/devserver-test.log || true)"
cat <<JSON
{
  "schema": "devserver-test-report.v1",
  "arch": "$(uname -m)",
  "branch": "$branch",
  "commit": "$commit",
  "startedAt": "$start_ts",
  "finishedAt": "$end_ts",
  "result": "$result",
  "packagesOk": $packages_ok,
  "packagesFailed": $failures,
  "log": "/tmp/devserver-test.log"
}
JSON
REMOTE_SCRIPT
  log "报告已回传: $out_file"
  python3 -c "import json,sys; d=json.load(open('$out_file')); print(json.dumps(d, indent=2))" 2>/dev/null || cat "$out_file"
}

# Integration lane（对齐 CI backend-integration job）：
# 每次在服务器 PG 上重建独立测试库 agenthub_test（DROP+CREATE），
# 与 CI 的 ephemeral service 容器语义一致——共享 dev 库会被重复运行
# 残留数据污染（tsetup_user/owner-scope 断言失败），因此 lane 必须
# 在全新数据库上跑。凭据从服务器 .env 读取，不出仓库。
cmd_integration() {
  remote_check
  local out_dir out_file
  out_dir="$(resolve_report_dir)"
  mkdir -p "$out_dir"
  out_file="$out_dir/integration-$(date +%Y%m%d-%H%M%S).json"
  log "服务器重建测试库 + 跑 integration lane（PG+Redis）…"
  remote_bash >"$out_file" <<'REMOTE_SCRIPT'
set -euo pipefail
REPO_ROOT="${1:?missing remote repo root}"
if [ -z "${DEVSERVER_GOPROXY:-}" ] && [ -f /etc/environment ]; then
  # shellcheck disable=SC1091
  . /etc/environment 2>/dev/null || true
  export GOPROXY="${GOPROXY:-}"
fi
[ -n "${DEVSERVER_GOPROXY:-}" ] && export GOPROXY="$DEVSERVER_GOPROXY"
export PATH=/usr/local/go/bin:$PATH
cd "$REPO_ROOT"

# 从服务器本地 .env 提取凭据/配置（值不出脚本、不回传明文）。
for key in AGENTHUB_DB_USER AGENTHUB_DB_PASSWORD AGENTHUB_REDIS_HOST AGENTHUB_REDIS_PORT \
           AGENTHUB_TOKENDANCE_ID_ISSUER_URL AGENTHUB_TOKENDANCE_ID_CLIENT_ID \
           AGENTHUB_TOKENDANCE_ID_CLIENT_SECRET AGENTHUB_TOKENDANCE_ID_REDIRECT_URI; do
  line="$(awk -F= -v k="$key" '$1==k {sub(/^[^=]*=/,""); print}' .env | tail -1)"
  [ -n "$line" ] || { echo "[devserver] ERROR: .env 缺 $key"; exit 1; }
  export "$key=$line"
done
# lane 专用库：每次 DROP+CREATE，保证与 CI 全新容器同语义。
export AGENTHUB_DB_NAME=agenthub_test
export AGENTHUB_DB_HOST=127.0.0.1
export AGENTHUB_DB_PORT=5432
export AGENTHUB_DB_SSLMODE=disable
export AGENTHUB_JWT_SECRET="ci-integration-jwt-secret-min-32-chars-ok!!"
export AGENTHUB_ENV=test

docker exec -e PGPASSWORD="$AGENTHUB_DB_PASSWORD" agenthub-postgres \
  psql -U "$AGENTHUB_DB_USER" -d postgres -c "DROP DATABASE IF EXISTS agenthub_test" >/dev/null
docker exec -e PGPASSWORD="$AGENTHUB_DB_PASSWORD" agenthub-postgres \
  psql -U "$AGENTHUB_DB_USER" -d postgres -c "CREATE DATABASE agenthub_test" >/dev/null

commit="$(git rev-parse --short HEAD)"
branch="$(git rev-parse --abbrev-ref HEAD)"
start_ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
if (cd hub-server && go test -tags integration ./tests/integration/ -count=1 -timeout=20m >/tmp/devserver-integration.log 2>&1); then
  result="pass"
else
  result="fail"
fi
end_ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
# 非 -v 模式无 "--- PASS" 行；用包级 ok 行计数，FAIL 行始终输出。
packages_ok="$(grep -c '^ok ' /tmp/devserver-integration.log || true)"
fail_count="$(grep -c '^--- FAIL' /tmp/devserver-integration.log || true)"
cat <<JSON
{
  "schema": "devserver-integration-report.v1",
  "arch": "$(uname -m)",
  "branch": "$branch",
  "commit": "$commit",
  "startedAt": "$start_ts",
  "finishedAt": "$end_ts",
  "result": "$result",
  "packagesOk": $packages_ok,
  "testsFailed": $fail_count,
  "log": "/tmp/devserver-integration.log"
}
JSON
REMOTE_SCRIPT
  log "报告已回传: $out_file"
  python3 -c "import json,sys; d=json.load(open('$out_file')); print(json.dumps(d, indent=2))" 2>/dev/null || cat "$out_file"
}

usage() {
  cat <<EOF
用法: scripts/dev/devserver.sh <sync|start|stop|status|test|integration>
详见文件头注释。
EOF
}

case "${1:-}" in
  sync) cmd_sync ;;
  start) cmd_start ;;
  stop) cmd_stop ;;
  status) cmd_status ;;
  test) cmd_test ;;
  integration) cmd_integration ;;
  *) usage; exit 2 ;;
esac
