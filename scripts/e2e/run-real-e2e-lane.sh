#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# AgentHub 真实全栈 E2E lane（issue #1839 B3）
#
# 职责：
#   1. 全栈 preflight：TokenDance ID / hub / edge / web 健康探测。
#   2. 测试账号供给（委托 provision-real-e2e-stack.sh：运行期随机账号，
#      凭据落 tests/artifacts/real-e2e-account.env，gitignored chmod 600）。
#   3. 跑真实栈 spec（playwright.real.config.ts chromium）——默认不带位置
#      过滤，运行 testMatch 全部 spec（chat-real / real-oidc-login /
#      private-url-preview）；设 AGENTHUB_E2E_SPEC_TARGET 可只跑单个 spec。
#      真实 Authorization Code + PKCE 浏览器登录 + 聊天落 hub + 私有 URL
#      门禁场景，无任何 stub/自签 JWT 旁路。
#   4. 输出 evidence manifest（六字段合同：evidence_level / real_tested /
#      claim / status / skipped_evidence_levels / planned_evidence_levels）
#      到 tests/artifacts/manifest-<YYYYMMDD-HHMMSS>.json（gitignored），
#      并用 scripts/verify/verify-real-e2e-lane-manifest.py 做合同自检。
#
# 诚实边界（AGENTS §4）：
#   - 本 lane 只在真实栈上运行；栈缺失时以 blocked 状态落 manifest
#     （real_tested=false），绝不编造登录证据。
#   - playwright exit 0 但无通过行（全 spec skipped / report 缺失或
#     解析失败）时，manifest status 降级为 no-evidence（real_tested=false），
#     lane 以 FAIL 收口，绝不以 passed 呈现。
#   - 证据等级为 observed-local（本地单机真栈）；approved-real /
#     packaged-release 不在本 lane 覆盖。
#
# 输出行契约（与 wsl-full-stack-e2e.sh 对齐）：
#   E2E-INFO: ... | E2E-PASS: ... | E2E-FAIL: ... | E2E-RESULT: PASS|BLOCKED|FAIL
#
# 用法：
#   bash scripts/e2e/run-real-e2e-lane.sh
#
# 环境变量（均有默认，不设也能跑）：
#   AGENTHUB_E2E_ID_BASE_URL / _HUB_BASE_URL / _EDGE_BASE_URL / _WEB_BASE_URL
#   AGENTHUB_E2E_ID_CLIENT_ID / _ID_CLIENT_SECRET （直供 client 凭据，跳过 start.sh 提取）
#   AGENTHUB_E2E_START_SH （hub OIDC 凭据提取源，**无默认值**；未设置时走 _ID_CLIENT_ID/SECRET 直供）
#   AGENTHUB_E2E_ID_DB （ID sqlite，默认 /var/lib/tokendance-id/tokendance.db）
#   AGENTHUB_E2E_SPEC_TARGET （只跑指定 spec 文件名，如 real-oidc-login.spec.ts；
#                             不设 = 不带位置过滤，跑 playwright.real.config.ts
#                             testMatch 全部 spec）
#   AGENTHUB_E2E_PLAYWRIGHT_EXTRA_ARGS （追加给 playwright 的参数）
# ─────────────────────────────────────────────────────────────
set -uo pipefail  # 不用 -e：provision/playwright 退出码需显式处理

ID_BASE_URL="${AGENTHUB_E2E_ID_BASE_URL:-http://127.0.0.1:3000}"
HUB_BASE_URL="${AGENTHUB_E2E_HUB_BASE_URL:-http://127.0.0.1:8080}"
EDGE_BASE_URL="${AGENTHUB_E2E_EDGE_BASE_URL:-http://127.0.0.1:3210}"
WEB_BASE_URL="${AGENTHUB_E2E_WEB_BASE_URL:-http://127.0.0.1:5174}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ARTIFACT_DIR="$REPO_ROOT/tests/artifacts"
VERIFIER="$REPO_ROOT/scripts/verify/verify-real-e2e-lane-manifest.py"
# 默认（不设 AGENTHUB_E2E_SPEC_TARGET）：不传位置过滤 → playwright 按
# playwright.real.config.ts 的 testMatch 跑全部 real spec；设置后只跑
# 指定 spec 文件（单 spec 调试/回放）。
SPEC_TARGET="${AGENTHUB_E2E_SPEC_TARGET:-}"
# manifest 里的展示标签：空目标用 sentinel，避免 scope/command 出现空值。
SPEC_LABEL="${SPEC_TARGET:-all-testMatch}"

ID_STATE="down"; HUB_STATE="down"; EDGE_STATE="down"; WEB_STATE="down"
PW_RC=""
MANIFEST_PATH=""

info() { echo "E2E-INFO: $*"; }
pass() { echo "E2E-PASS: $*"; }
fail() { echo "E2E-FAIL: $*" >&2; }
die_blocked() { echo "E2E-FAIL: blocked|$*" >&2; echo "E2E-RESULT: BLOCKED"; exit 2; }
die_failed()  { echo "E2E-FAIL: failed|$*" >&2; echo "E2E-RESULT: FAIL"; exit 1; }

probe() { curl -sf -m 4 "$1" >/dev/null 2>&1; }

stack_status() {
  local id=down hub=down edge=down web=down
  probe "$ID_BASE_URL/.well-known/openid-configuration" && id=up
  probe "$HUB_BASE_URL/health" && hub=up
  probe "$EDGE_BASE_URL/v1/health" && edge=up
  probe "$WEB_BASE_URL/workbench/" && web=up
  ID_STATE="$id"; HUB_STATE="$hub"; EDGE_STATE="$edge"; WEB_STATE="$web"
}

# ── evidence manifest（六字段合同）──────────────────────────
emit_manifest() { # 请求 status -> stdout "最终status|manifest路径"（passed 请求可能被降级为 no-evidence）
  local status="$1"
  # #1873 Slice C: 公开 artifact 携带 commit（代码版本）+ scope（测试范围），
  # 但不复制私有运行事实（账号/真实 endpoint 等）。
  local commit
  commit="$(git -C "$REPO_ROOT" rev-parse HEAD 2>/dev/null || echo unknown)"
  MANIFEST_STATUS="$status" \
  MANIFEST_COMMIT="$commit" \
  MANIFEST_SCOPE="$(
    if [ -n "$SPEC_TARGET" ]; then echo "app/web/$SPEC_TARGET"; else echo "app/web (playwright.real.config.ts all testMatch)"; fi
  )" \
  MANIFEST_ARTIFACT_DIR="$ARTIFACT_DIR" \
  MANIFEST_SPEC_TARGET="$SPEC_LABEL" \
  MANIFEST_ID_BASE_URL="$ID_BASE_URL" \
  MANIFEST_HUB_BASE_URL="$HUB_BASE_URL" \
  MANIFEST_EDGE_BASE_URL="$EDGE_BASE_URL" \
  MANIFEST_WEB_BASE_URL="$WEB_BASE_URL" \
  MANIFEST_ID_STATE="$ID_STATE" \
  MANIFEST_HUB_STATE="$HUB_STATE" \
  MANIFEST_EDGE_STATE="$EDGE_STATE" \
  MANIFEST_WEB_STATE="$WEB_STATE" \
  MANIFEST_PW_RC="${PW_RC:-0}" \
  MANIFEST_RUN_STARTED_AT="${RUN_STARTED_AT:-0}" \
  python3 - <<'PYEOF'
import glob, json, os, time

root = os.environ["MANIFEST_ARTIFACT_DIR"]
os.makedirs(root, exist_ok=True)
stamp = time.strftime("%Y%m%d-%H%M%S", time.localtime())
requested = os.environ["MANIFEST_STATUS"]
status = requested
run_started = float(os.environ.get("MANIFEST_RUN_STARTED_AT") or 0)
# SPEC_TARGET sentinel：all-testMatch = 不带位置过滤跑全部 testMatch spec。
spec_target = os.environ["MANIFEST_SPEC_TARGET"]
spec_command = ("playwright test --config playwright.real.config.ts --project=chromium"
                + ("" if spec_target == "all-testMatch" else " " + spec_target))

def latest(pattern):
    # tests/artifacts 跨运行持久：只取本次运行开始之后产出的证据，
    # 否则上一次运行的 report/html 会被误算为本次证据（no-evidence 降级失效）。
    matches = sorted(
        (p for p in glob.glob(os.path.join(root, pattern)) if os.path.getmtime(p) >= run_started),
        key=os.path.getmtime,
    )
    return matches[-1] if matches else None

report_path = latest("report-*.json")
html_path = latest("html-*")
traces = sorted(
    (p for p in glob.glob(os.path.join(root, "test-results", "**", "trace*.zip"), recursive=True)
     if os.path.getmtime(p) >= run_started),
)
account_env = os.path.exists(os.path.join(root, "real-e2e-account.env"))

rows = []
if report_path and requested in ("passed", "failed"):
    try:
        with open(report_path, encoding="utf-8") as handle:
            report = json.load(handle)
        specs = []
        def collect(suite):
            for sub in suite.get("suites", []):
                collect(sub)
            specs.extend(suite.get("specs", []))
        collect(report)
        for spec in specs:
            title = spec.get("title") or os.environ["MANIFEST_SPEC_TARGET"]
            # Playwright >=1.60 JSONReportSpec：results 在 spec.tests[].results
            # （JSONReportTest），spec 上没有 results 字段；老版本 schema 才有
            # spec.results。两种形态都兼容：先展开 tests，缺失时回退 spec.results。
            results = []
            for test in spec.get("tests") or []:
                results.extend(test.get("results") or [])
            if not results:
                results = spec.get("results") or []
            statuses = [result.get("status") for result in results]
            if statuses and all(s in ("skipped", "pending") for s in statuses):
                # 全 skipped/pending 必须先于 ok 判定：skipped 的 spec.ok 为 true
                # （Playwright #34174），否则 skip 会被误报成 passed。
                outcome = "skipped"
            elif spec.get("ok") is True and any(s == "passed" for s in statuses):
                # passed 要求 ok 且至少一个执行结果状态为 passed。
                outcome = "passed"
            else:
                outcome = "failed"
            duration_ms = sum(int(result.get("duration", 0) or 0) for result in results)
            real_tested = outcome == "passed"
            rows.append({
                "name": title,
                "area": "web",
                "evidence_level": "observed-local",
                "real_tested": real_tested,
                "claim": "真实栈（本地单机真栈）上执行并通过；observed-local 证据，非 stub/fixture" if real_tested else
                         "spec 未完成（跳过或失败），运行态无对应 L3 证据",
                "status": outcome,
                "exit_code": 0 if outcome == "passed" else 1,
                "duration_ms": duration_ms,
                "command": spec_command,
                "working_directory": "app/web",
                "evidence": os.path.basename(report_path) if report_path else "",
            })
    except Exception as exc:
        rows = [{
            "name": os.environ["MANIFEST_SPEC_TARGET"],
            "area": "web",
            "evidence_level": "observed-local",
            "real_tested": False,
            "claim": "playwright JSON report unreadable；状态以 live 输出为准",
            "status": "failed",
            "exit_code": 1,
            "duration_ms": 0,
            "command": "",
            "working_directory": "",
            "evidence": "report parse error: %s" % exc,
        }]

failed_rows = [row for row in rows if row["status"] == "failed"]
passed_rows = [row for row in rows if row["status"] == "passed"]

if requested == "passed":
    real_tested = len(passed_rows) > 0 and len(failed_rows) == 0
    if real_tested:
        claim = ("真实全栈（PG/Redis/TokenDance ID/hub/edge/web）上 playwright.real.config.ts "
                 "testMatch 全部 spec 全绿；evidence_level=observed-local（本地单机真栈），非 stub/自签 JWT")
    else:
        # playwright exit 0 但无通过行（全 spec skipped / report 缺失或解析失败）：
        # 降级 status 为 no-evidence，绝不以 passed 呈现（校验器强制该合同）。
        status = "no-evidence"
        skipped_rows = [row for row in rows if row["status"] == "skipped"]
        if skipped_rows and not failed_rows:
            claim = ("playwright exit 0 但全部 spec skipped：未发生真实登录，"
                     "运行态无 L3 登录证据（降级 no-evidence，不以 passed 呈现）")
        else:
            claim = ("playwright exit 0 但无通过行（report 缺失或解析失败）："
                     "运行态无 L3 登录证据（降级 no-evidence，不以 passed 呈现）")
    if not rows:
        rows = [{
            "name": "playwright-report-missing",
            "area": "web",
            "evidence_level": "observed-local",
            "real_tested": False,
            "claim": claim,
            "status": "failed",
            "exit_code": 1,
            "duration_ms": 0,
            "command": "playwright test --config playwright.real.config.ts",
            "working_directory": "app/web",
            "evidence": "no report-*.json found under tests/artifacts after run",
        }]
elif requested == "blocked":
    real_tested = False
    claim = ("全栈未齐（id/hub/edge/web 探测见 stack 段），未执行真实登录；"
             "blocked 状态如实记录，未编造登录证据")
    rows = [{
        "name": "stack-preflight",
        "area": "stack",
        "evidence_level": "observed-local",
        "real_tested": False,
        "claim": claim,
        "status": "blocked",
        "exit_code": 2,
        "duration_ms": 0,
        "command": "probe id/.well-known/openid-configuration hub/health edge/v1/health web/workbench/",
        "working_directory": ".",
        "evidence": "id=%s hub=%s edge=%s web=%s" % (
            os.environ["MANIFEST_ID_STATE"], os.environ["MANIFEST_HUB_STATE"],
            os.environ["MANIFEST_EDGE_STATE"], os.environ["MANIFEST_WEB_STATE"]),
    }]
else:  # failed
    real_tested = False
    claim = "栈齐但 real spec 失败或 provision 失败；运行态无完整 L3 证据"
    if not rows:
        rows = [{
            "name": "lane-abort",
            "area": "lane",
            "evidence_level": "observed-local",
            "real_tested": False,
            "claim": claim,
            "status": "failed",
            "exit_code": int(os.environ.get("MANIFEST_PW_RC") or 1),
            "duration_ms": 0,
            "command": "bash scripts/e2e/run-real-e2e-lane.sh",
            "working_directory": ".",
            "evidence": "lane aborted before playwright report production",
        }]

canonical = ["fixture-unit", "playwright-ui", "visual-qa", "stubbed-hub", "observed-local",
             "approved-real", "backend-api", "performance-leak", "packaged-release"]
manifest = {
    "schema": "agenthub-real-e2e-lane-v1",
    "kind": "real-e2e-lane",
    "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    "commit": os.environ["MANIFEST_COMMIT"],
    "scope": os.environ["MANIFEST_SCOPE"],
    # ── 六字段合同（REQUIRED_SMOKE_FIELDS，见 verify-real-e2e-contract.py）──
    "evidence_level": "observed-local",
    "real_tested": real_tested,
    "claim": claim,
    "status": status,
    "skipped_evidence_levels": sorted(set(canonical) - {"observed-local"}),
    "planned_evidence_levels": ["observed-local"],
    # ── 上下文 ─────────────────────────────────────────────────
    "stack": {
        "id": {"base_url": os.environ["MANIFEST_ID_BASE_URL"], "state": os.environ["MANIFEST_ID_STATE"], "login": "real-browser-oidc-authorization-code-pkce"},
        "hub": {"base_url": os.environ["MANIFEST_HUB_BASE_URL"], "state": os.environ["MANIFEST_HUB_STATE"]},
        "edge": {"base_url": os.environ["MANIFEST_EDGE_BASE_URL"], "state": os.environ["MANIFEST_EDGE_STATE"]},
        "web": {"base_url": os.environ["MANIFEST_WEB_BASE_URL"], "state": os.environ["MANIFEST_WEB_STATE"]},
        "backend_services": ["postgres:16", "redis:7"],
    },
    "secret_handling": {
        "account_mode": "runtime-random-test-identities (provision-real-e2e-stack.sh)",
        "credentials_path": "tests/artifacts/real-e2e-account.env (chmod 600, gitignored)",
        "manifest_secrets": "none",
    },
    "playwright_exit_code": int(os.environ.get("MANIFEST_PW_RC") or 0),
    "artifacts": {
        "report": os.path.basename(report_path) if report_path else None,
        "html_report_dir": os.path.basename(html_path) if html_path else None,
        "trace_zip_count": len(traces),
        "account_env_written": account_env,
    },
    "rows": rows,
}

path = os.path.join(root, "manifest-" + stamp + ".json")
with open(path, "w", encoding="utf-8") as handle:
    json.dump(manifest, handle, indent=2, ensure_ascii=False)
# 输出契约：最终 status（可能被降级为 no-evidence）| manifest 路径
print(status + "|" + path)
PYEOF
}

# ── 主流程 ──────────────────────────────────────────────────
main() {
  # 本次运行起点：emit_manifest 只采信此时间之后产出的证据文件，
  # 防止 tests/artifacts 上一次运行的残留被误归为本次证据。
  RUN_STARTED_AT="$(date +%s)"
  info "preflight: id=$ID_BASE_URL hub=$HUB_BASE_URL edge=$EDGE_BASE_URL web=$WEB_BASE_URL"
  stack_status
  info "stack state: id=$ID_STATE hub=$HUB_STATE edge=$EDGE_STATE web=$WEB_STATE"

  if [ "$ID_STATE" != "up" ] || [ "$HUB_STATE" != "up" ] || [ "$EDGE_STATE" != "up" ] || [ "$WEB_STATE" != "up" ]; then
    emit_out="$(emit_manifest blocked)"
    MANIFEST_PATH="${emit_out#*|}"
    die_blocked "full stack incomplete (id=$ID_STATE hub=$HUB_STATE edge=$EDGE_STATE web=$WEB_STATE); manifest=$MANIFEST_PATH"
  fi
  pass "full stack healthy (id/hub/edge/web)"

  info "provisioning real test accounts"
  # 复用既有账号凭据（上次运行落盘）：TokenDance ID 注册限流
  # register_per_hour=3（每 IP/小时，运行期 Redis 计数），一次 lane 需 2 个
  # 账号——复用 + 登录再验证让重跑零注册；首跑才注册。（凭据文件 gitignored，
  # chmod 600，仅同机 lane 可见。）
  ACC_ENV="$ARTIFACT_DIR/real-e2e-account.env"
  if [ -f "$ACC_ENV" ]; then
    set -a
    # shellcheck disable=SC1090
    . "$ACC_ENV"
    set +a
    info "reusing test accounts from $ACC_ENV (login re-verified in provision step)"
  fi
  if ! bash "$REPO_ROOT/scripts/e2e/provision-real-e2e-stack.sh"; then
    emit_out="$(emit_manifest failed)"
    MANIFEST_PATH="${emit_out#*|}"
    die_failed "account provisioning failed (manifest=$MANIFEST_PATH); see output above"
  fi
  pass "test accounts provisioned (credentials in tests/artifacts/real-e2e-account.env, gitignored)"

  info "running real spec(s) (chromium, playwright.real.config.ts): ${SPEC_LABEL}"
  cd "$REPO_ROOT/app/web" || die_failed "app/web not found"
  # CI=true 会让 config 以 reuseExistingServer=false 重启 webServer，与已启动的
  # web 冲突；置空 CI 让其复用现有 5174（retries=0，确定性）。
  # SPEC_TARGET 为空时不传位置过滤 → testMatch 全部 spec 都跑（#1922 项4）。
  # shellcheck disable=SC2086
  CI= pnpm exec playwright test --config playwright.real.config.ts \
    --project=chromium ${SPEC_TARGET:+"$SPEC_TARGET"} ${AGENTHUB_E2E_PLAYWRIGHT_EXTRA_ARGS:-}
  PW_RC=$?
  info "playwright exit code: $PW_RC"

  if [ "$PW_RC" -eq 0 ]; then
    emit_out="$(emit_manifest passed)"
  else
    emit_out="$(emit_manifest failed)"
  fi
  MANIFEST_STATUS_FINAL="${emit_out%%|*}"
  MANIFEST_PATH="${emit_out#*|}"
  info "evidence manifest: $MANIFEST_PATH (final status: $MANIFEST_STATUS_FINAL)"

  if ! python3 "$VERIFIER" "$MANIFEST_PATH"; then
    die_failed "manifest contract check failed: $MANIFEST_PATH"
  fi
  pass "manifest contract ok: $MANIFEST_PATH"

  if [ "$PW_RC" -eq 0 ] && [ "$MANIFEST_STATUS_FINAL" = "passed" ]; then
    echo "E2E-RESULT: PASS"
    exit 0
  fi
  if [ "$PW_RC" -eq 0 ]; then
    # playwright exit 0 但 manifest 降级（全 skipped / report 缺失或解析失败）：
    # 无通过行即无证据，如实以 FAIL 收口，绝不报 PASS。
    die_failed "playwright exit 0 but manifest status demoted to '$MANIFEST_STATUS_FINAL' (no passed rows; no L3 login evidence)"
  fi
  die_failed "real spec(s) ${SPEC_LABEL} exited with $PW_RC"
}

main
