# AgentHub 安全风险登记表

最后审查：2026-08-09

本文件只记录当前安全风险队列、发布门禁和验证入口。2026-06-27 前的完整历史登记表见 [../history.md](../history.md)。

## SAST 门禁（gosec，#1574）

Hub/Edge 的 `Security scan (gosec)` step 自 #1574 起 hard fail（不再 `continue-on-error`），`quality-debt-baseline.json` 中两条 gosec soft gate 已删除。当前 gosec 告警数为 0，处置记录见 PR #1574：真实修复（G104 unhandled error、G301/G302/G306 权限收紧、G115 溢出防护、G401/G501/G505 弱哈希替换、G306 WriteFile 权限）；窄抑制（G101 常量、G304 服务端/配置路径、G404 jitter、G204 子进程、G202 参数化 SQL、G703 受 isPathWithin 防护、G122 本地打包 walk）；负向自测 `scripts/verify/tests/verify-gosec-gates.Tests.sh`。

## 发布门禁

- `Critical` / `High` 且状态为 `Open`、`rotate required`、`deploy verification required`、`client verification required` 或 `runtime/log verification required` 的风险，默认阻断公开发布。
- `Accepted` 必须记录 owner、日期、原因、补偿控制和复查触发条件。
- 真实生产 endpoint、host、日志、备份、secret、token、callback code 和 session 证据只放私有运维文档；本仓库只写无密结论和证据指针。
- 跨仓库身份、授权或 Gateway 边界变化必须同步 TokenDance workspace 级文档。

## 当前 P0 / High 风险

| ID | Severity | Status | Risk | Closing condition |
|---|---|---|---|---|
| AH-SR-028 | Critical | Mitigated in repo; rotate required | Hub JWT secret 曾有硬编码默认值；代码已改为环境变量，但旧环境可能需要轮换。 | 轮换所有部署实例 secret，并验证旧 secret 不再可用。 |
| AH-SR-035 | High | Mitigated in repo; deploy verification required | Hub OIDC callback、JWKS 和 Hub session 代码/测试已存在，但缺少浏览器完成真实授权码流证据。 | 完成 staging/production OIDC browser login，确认 Hub session 和 `/client/auth/me`，私有记录无密证据。 |
| AH-SR-036 | High | Mitigated in repo; deploy/client verification required | Desktop system-browser PKCE、Hub session、WS auth、logout/reconnect 有代码，但缺少真实 Desktop 登录闭环证据。 | Desktop 对 live Hub 完成 login/logout/reconnect，私有记录无密证据。 |
| AH-SR-037 | High | Accepted (cleanup-baseline #438) | Web 仍用 tab-scoped `sessionStorage` 保存 Hub session（非 localStorage）。本阶段正式 **Accepted** 补偿控制：仅 HTTPS 生产、短 TTL access + refresh 轮换、CSP、不在公开 Web 静默 demo 成功（AH-SR-043）、token 不进 URL/日志。后续可选 BFF/HttpOnly 作为增强而非发布阻塞关闭条件。 | Owner: Web; Accepted 2026-07-16; revisit if public Web attack surface expands or XSS incident. |
| AH-SR-045 | High | Mitigated in repo (owner fail-closed + sensitive read scoping) | Hub JWT remote reads fail-closed：`OwnerID==""` 不再对 Hub JWT 世界可读；projects/threads/runs 及 items/artifacts/previews/run-diff/events/settings/agent-profiles/instances/delivery-journal 等敏感读路由按 owner 过滤或共享配置 404。Local auth 仍保持单用户全量访问。仍缺完整 route/target/workspace/user-action capability 模型与 live remote 证据。 | 可选：target/workspace 级 capability 与 live remote read 负例证据。 |
| AH-SR-046 | High | Mitigated in repo (purpose + action/target/thread + Hub→Edge fixture E2E) | Edge `PostRuns` dual-token：`purpose=run-start` 强制；可选 `action`/`thread_id`/`target_id` 绑定；Hub `IssueCapabilityToken` + dispatch 附带 bindings。**In-repo fixture E2E**（#461，无生产网络/无真实 secret）：Hub issue→Edge-shaped validate（`hub-server/internal/jwtutil/capability_test.go`）；Hub-shaped issue→Edge `ValidateCapabilityToken`（`edge-server/internal/jwtutil/capability_test.go`）；Hub-shaped token→`PostRuns` accept/reject（`edge-server/internal/api/handlers_test.go` DualToken suite）。可选 residual：staging live probe、CORS allow-header 全覆盖。 | Optional only: non-prod live Hub→Edge probe if desired; code-path residual closed by fixture suite. |
| AH-SR-048 | High | Mitigated in repo; runtime/log verification required | Edge 启动日志已脱敏，但真实 adapter debug 日志仍需验证不泄露 prompt、MCP、config、image path 或 session。 | 用真实 adapter smoke 审查 runtime/debug logs，私有记录无密证据。 |
| AH-SR-049 | High | Mitigated in repo (durable journal + offline/replay fixture; auto redelivery deferred) | Hub outbox + retry loop 已接线；Edge 内存 journal + **SQLite durable journal**（`AGENTHUB_DELIVERY_JOURNAL_DB`）；`DurableSnapshot` + `GET /v1/delivery-journal?afterSeq=` 对账读取；`HasSuccessful` 幂等跳过。**#462 offline/replay fixture**：`TestCallbackClient_OfflineReplayReconciliation`（reopen 后 HasSuccessful + DurableSnapshot cursor）；`RedeliveryCandidates` 纯选择 helper + 单测。**Automatic redelivery worker 明确推迟**。 | Optional only: live Hub outbox cross-service probe；生产自动 redelivery worker 另开任务。 |

## High Deploy/Client Verification Queue

这些项已有代码缓解，但仍需要部署、客户端或远程模式证据：

| ID | 主题 | 需要的证据 |
|---|---|---|
| AH-SR-001 | TokenDance bearer issuer/audience | 所有启用兼容路径环境配置 AgentHub client audience，并验证 wrong-audience 拒绝。 |
| AH-SR-002 | TokenDance bearer 不等于 Hub session | Desktop/Web 使用 Hub-issued session；TokenDance bearer 不能直接授权 `/client/*`、`/web/*`、`/edge/*`。 |
| AH-SR-003 | 登录 device ID 一致性 | 登录、logout、refresh、多设备注册真实流程通过。 |
| AH-SR-004 / AH-SR-005 / AH-SR-023 | Remote Edge/approval/target-bound design | 非 loopback remote mode 之前补齐认证、target health、allowlist sync 和审批证明。 |
| AH-SR-020 | Edge callback 绑定 user/device/run | 真实 Desktop reconnect + callback 链路通过。 |
| AH-SR-021 | Attachment sharing | Hub/Desktop file-message flow 通过，并决定 forwarded file reference 策略。 |
| AH-SR-029 | Hub session boundary | TokenDance bearer 被 Hub REST/WS 拒绝；Hub-issued session 被接受。 |
| AH-SR-032 | Edge workspace allowlist | 部署配置只允许预期 project roots，不能空 allowlist 或 `/`。 |
| AH-SR-042 | Mobile device proof | Mobile 暂不深挖；发布前再做 Android/iOS development build 证据。 |

## Medium / Product Boundary Queue

| ID | 状态 | 风险 | 下一步 |
|---|---|---|---|
| AH-SR-043 | Mitigated in repo (web + shared gates; residual desktop seeds) | Web composer demo success 仅允许显式 `mock`/`fixture` + shell `demoRuntimeFallback`；共享 `allowsWorkbenchDemoRuntimeMutation` fail-closed，`auto`/`observed`/`approved-real` 不静默假成功；mutation path inventory + unit tests。Desktop 仍有 demo seed conversations / isDemo fallback（非本 issue 主范围）。 | 可选：Desktop seed 去默认 + live Hub mutation E2E 证据。 |
| AH-SR-044 | Mitigated in repo (#465) | Desktop/Web product health 不再把 Edge runners 当 inventory SSOT；Local Edge status 由 health + agents/models 推导，Hub sync 发布 agent/model capability；`/v1/runners` 与 `health.checks.runners` 保留为 diagnostics。 | 可选：settings UI 若仍插值旧 runner 文案键则清理；live Desktop/Web 健康面板截图证据。 |
| AH-SR-051 | Mitigated in repo (2026-08-09 security/release/infra lane) | **本批四项修复**：(1) JWT 弱密钥黑名单从精确匹配改 prefix 匹配，覆盖 `.env.example` 文档值 `dev-secret-change-in-production-min-length-32`（41 字符，原精确匹配漏网、绕过 32 字符最小长度门禁）——`hub-server/internal/config/config_validate.go` + `isKnownWeakSecret` + 3 测试；(2) `release.yml` 加 `security-gate` job（tag-guard 之后、build-go 之前，真阻断 `continue-on-error: false`，跑 `verify-release-gate.py -SkipRefCheck`，`RELEASE_SIGNING_APPROVED` repo variable 注入）；(3) `verify-release-gate.py` 两条无条件 signing/updater Blocker 改双条件变量化（`RELEASE_SIGNING_APPROVED=true` + `deployments/production/signing-manifest.sha256` 证据文件，无则保守阻断）；(4) `deployments/production/docker-compose.yml` `PG_HOST` 默认值 `127.0.0.1:<port>` → `127.0.0.1`（端口走 `PG_PORT`，修 DSN 拼错）；(5) `app/web/nginx.conf` 加 CSP/HSTS/X-Frame-Options/nosniff（对齐 AH-SR-037 desktop 严格度）。 | 无 Open High；signing 冻结由 `RELEASE_SIGNING_APPROVED` + 证据文件双条件解除，operator 解除前发布阻断（保守）。Go toolchain 升级 ≥1.26.5、refresh token reuse 检测、image 钉版本列 Wave 3 独立 PR。 |
| AH-SR-052 | Accepted (High; compensating control: operator env) | Hub access-token jti 黑名单（logout 即时吊销，#888）在 Redis 故障时**默认 fail-open**（`AuthFailClosedDefault = false`）。Redis 短时故障窗口内，已 logout 的 access JWT 仍被产品 API 接受直到自然 TTL 到期。补偿控制：operator 在生产 `deployments/production/docker-compose.yml` 显式设 `AGENTHUB_AUTH_FAIL_CLOSED=true`。 | Owner: Hub; Accepted 2026-08-17; closing: flip `AuthFailClosedDefault` to `true`（破坏性，需 PR + 全量 middleware/cache 测试）或 verify 所有生产部署已注入 env。 |
| AH-SR-013 | Local-only | 本机未跟踪 `.env` 可能包含 secret-looking 值。 | 保持 `.env` ignored；不要 zip/paste/force-add；必要时本机轮换。 |
| AH-SR-050 | Open (foundation only; #1174) | Desktop **local terminal host** surface: typed `TerminalPort` + capability gate only; no real PTY yet. Residual risk if future host adapter exposes free-form shell or renderer process APIs. | Real host must: (1) keep PTY ownership off renderer, (2) allowlist profiles only (no free-form command from UI), (3) Web `localTerminal=false` + UI hidden, (4) audit spawn/write/close. |

## Dependency Watch

| 包 | 严重度 | 状态 |
|---|---:|---|
| `github.com/jackc/pgx/v5` v5.9.2 | critical / low | 等待上游修复或安全替代路径 |
| `github.com/google/uuid` v1.6.0 | medium | 等待上游修复 |
| `glib` (Rust/Tauri) `0.18.5` → RUSTSEC-2024-0429 / GHSA-wrw7-89jp-8q8g | medium | 有据临时处置（#1578）：Tauri 2 稳定线全部 Linux 持有 crate（gtk/gdk/atk `0.18.2`、webkit2gtk `2.0.2`、wry `0.56`、tao `0.36`、muda `0.19`、tray-icon `0.24`、tauri `2.11.x`）均钉死 gtk-rs `0.18`/glib `^0.18`，glib `>=0.20` 在稳定线不可达；上游迁移跟踪 tauri-apps/tauri#7335 / #12563（owner: lucasfernog）/ #14684。Owner：AgentHub Desktop 安全评审；评审截止 2026-11-30，过期后 `verify-rust-advisories.sh` 门禁自动 FAIL 强制复审（CI job: `vuln-scan-rust`）。Desktop 依赖已升至 Tauri 2.11.5 / tray-icon 0.24.2（#1578）。 |

## 验证入口

```powershell
python ./scripts/verify/verify-ci-gates.py
python ./scripts/release/verify-release-gate.py
python -c "import yaml, pathlib; yaml.safe_load(pathlib.Path('api/openapi.yaml').read_text(encoding='utf-8')); print('yaml ok')"
git diff --check
```

按 touched surface 追加：

```powershell
cd hub-server; go test ./... -short -count=1
cd ../edge-server; go test ./... -short -count=1
cd ../app/desktop; corepack pnpm test; corepack pnpm typecheck
cd ../web; corepack.cmd pnpm typecheck; corepack.cmd pnpm exec vite build
```

## 维护规则

- 新风险进入本文件；历史证据、长命令输出和日期型审计进入 [../history.md](../history.md) 指向的外部归档或私有运维文档。
- 修复落地时只在表格中写当前状态和关闭条件，避免追加长篇日志。
- 变成架构决策的风险链接 [../decisions.md](../decisions.md) 或架构章节。
- 处于 `Open` 的 High 风险必须在 issue 或 PR 中有 owner 和下一步。
