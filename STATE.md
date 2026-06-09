# AgentHub 当前状态

最后更新：2026-06-10 20:00 +08:00
当前 dev HEAD：`e73c984a` (`dev/delicious233`)

本文只记录当前事实、分支治理和任务调度。长期路线图写在
`docs/roadmap.md`，架构边界写在 `docs/architecture.md`。

## 当前 Baseline

| 项目 | 当前事实 |
|---|---|
| 当前集成 dev | `dev/release-0.3.0-rc7` 从 `origin/master` 创建，已合入 Mobile RN release-gates 增量；本地 HEAD 当前领先 `origin/master`。 |
| 上一条 dev | `origin/dev/delicious233 = fc0f0628` 已通过 PR #297 合入 `origin/master`，不再作为本轮新增事实源。 |
| RC tag | `v0.3.0-rc.6 = fa6cd35e`，是已存在的历史 RC 基线，不移动、不重打。下一版候选使用 `0.3.0-rc.7` / `v0.3.0-rc.7`。 |
| master | `origin/master = b7e9c1a4 Merge pull request #297 from TokenDanceLab/dev/delicious233`，是当前可信基线。 |
| 当前工作树 | `D:\Code\TokenDance\AgentHub\.worktrees\r7`，分支 `dev/release-0.3.0-rc7`。 |
| 主工作树 | `D:\Code\TokenDance\AgentHub` 仍保留为历史现场，分支 `dev/delicious233` 且 dirty；不作为事实源。 |
| 当前文档分工 | `docs/roadmap.md` 只写路线、优先级和边界；`STATE.md` 写当前事实；`docs/architecture.md` 写结构和实现边界。 |
| Git 维护风险 | 旧上下文记录过 bad-tree auto-gc 风险；未获明确批准前不做 destructive gc/prune/reset。 |

## 已合入能力

当前 `origin/dev/delicious233` 已经具备以下公开仓库内可确认能力。

### Web / IM / shared workbench

- Web Agent 主链、target 选择、typed transcript blocks、artifact/replay 渲染基础已进入 dev。
- Web Projects query hooks 已接入 Hub，为 real-mode Projects 数据读取提供基础。
- Web 只通过 Hub 消费单任务 approvals/artifacts 合同，并在 transcript projection 中合并 active task approval/artifact。
- Web real-mode boundary 已显式化：`observed` / `approved-real` 下缺 Agents/Projects/Tasks 数据时显示 empty/error，不静默回 demo/mock。
- Web artifact/diff inspector 已消费 Hub file-change diff metadata，能展示只读 diff、patch、edit/review、apply/revert metadata。
- IM/@Agent 主链操作已补强：composer 展示 Agent/Target/Task 状态，缺 Desktop/Edge target 时禁用启动 Agent task，消息级 pin 入口已进入 UI。
- 群聊编排 fixture 已合入，覆盖 human -> agent、agent -> agent、项目群 `@Agent` queued 和 orchestrator route decision 的可见投影。
- target health 合同已强化，Web/Desktop 可表达 ready、offline、degraded、missing、signed-out 和分页限制等状态。
- runtime/provider/model/tool icon polish 已合入，基于 LobeHub icon registry 和 fallback。

### Hub / API / approval / artifact

- Hub/Edge/Device/Target 合同和 exact target dispatch proof 已进入 dev。
- Hub 单任务 approval/artifact 合同已合入，覆盖 approval list、approval decide、artifact list、owner scope、exact target/device control、correlation fields 和 200 OK envelope OpenAPI。
- Hub file-change diff projection 已合入，artifact list 可从 `run.agent.file_change` 投影最小 `diff`、`edit_id`、`review_status`、`can_apply`、`can_revert` 只读字段。
- approval roundtrip context gate 已合入，用于锁定 task approval request/decision 的上下文投影。
- 编排路由审计队列字段已进入 Hub dev 基线。
- TokenDance ID OIDC 后端登录交换已在 Hub README/API 层描述；真实 TokenDanceID 登录全链路仍未声明完成。

### Desktop / Local Edge / package readiness

- Desktop Local Edge diagnostics、Hub task bridge、target 注册/同步和 sidecar readiness 已进入 dev。
- Desktop sidecar observed fixture smoke 已覆盖 fixture/mock sidecar health、SQLite app-data path、stdout/stderr log path、health URL、preflight/readiness、no direct CLI spawn。
- Desktop exact target observed bridge 已记录 expected/observed `target_id` / `edge_device_id`，能区分 matched、mismatch、offline、missing。
- Tauri package smoke gate 已强化 Windows unsigned/dev package reproducibility、sidecar placement、Local Edge diagnostics、macOS unsigned policy boundary；不执行真实 build/sign/notarize/release upload。
- Windows/Tauri packaging release dry 已在隔离 worktree `codex/packaging-release-windows-tauri-20260609` 复跑，产出 unsigned NSIS installer、portable zip、Windows Local Edge sidecar 和 `artifact-manifest.json` hash 证据，artifact root 为 `.tmp\tauri-package-release-20260609`；不签名、不公证、不上传 release、不提交二进制，updater `latest.json`/`.sig` 仍是后续 signing/release approval gate。
- Release gate 负责人线已补 `scripts/verify-release-gate.ps1` 和 `docs/audit/release-gate-2026-06-09.md`，覆盖 dev->master refs、RC/tag 规范、release-readiness dry workflow 边界、Windows unsigned artifact manifest 和 Open Critical/High security blockers；公开 release 仍阻断于 signing/notarization/updater approval 与开放 High 风险。
- Desktop Agent Builder fixture evidence UI 已合入，展示 fixture-only runtime/profile、provider/model、tools/MCP、approval policy、workspace trust、Local Edge fixture health 和 no-spend evidence。

### Edge / CLI / SDK / SQLite

- Edge SQLite store、迁移、row/projection tests、durable observed fixture smoke、row-first restore、approval/file-change/artifact evidence、pins 和 replay projection 已合入。
- SQLite local store readiness 已进入 dev，覆盖 local temp SQLite readiness report 和 per-write reopen contract；仍不声明 production row-first CRUD 完成。
- Edge fixture adapter runner contract 已合入，覆盖 fake process fixture runner 的 session/task/route/approval/file-change/artifact/transcript/result 事件归一、运行证据持久化、redaction 和 malformed/error stream no-panic。
- CLI JSON readiness checker 和 CLI approved-real readiness tightening 已合入，覆盖 Codex `exec --json`、Claude Code `stream-json` permission bridge、OpenCode `run --format json` permission risk、命令计划脱敏、approved-real 前置检查和 no-spend fixture boundary。
- SDK fixture capability evidence 与 SDK event fixture matrix 已合入，用 Claude/OpenAI SDK-like 静态样例覆盖 text/tool/file_change/permission/result/artifact canonical events；不安装 SDK 包、不联网、不运行真实模型/API。
- AgentSpec fixture demo 已导出，Agent/Profile/市场 fixture 摘要已合入，覆盖 runtime/model/provider、skills、MCP、tool allowlist、memory、avatar、approval 和 target preference 的 demo 合同。

### Product-loop / readiness gates

- Product-loop observed fixture E2E gate 已合入，覆盖 Web -> Hub -> Desktop/Tauri sidecar readiness -> Local Edge -> adapter fixture -> Hub replay -> Web transcript/approval/artifact render，明确 `real_tested=false`。
- localhost observed loop gate、localhost service probe plan 和 localhost 真实服务 smoke 已进入 dev，用于 no-spend 本地服务组合探测；默认不代表真实 CLI/model/API 或生产部署完成。
- approved-real preflight manifest gate、redacted demo manifest gate 和 no-secret demo readiness gate 已合入，用于审批前检查 approval、budget、timeout、artifact root、redaction、runtime、URL、测试账号标识和 secret scan。
- Web deploy/readiness、boundary、product-loop fixture QA 和 Tauri readiness gate 已作为当前 dev 基础能力存在。

### 2026-06-10 数据流打通成果（本轮新增）

**IM 聊天全链路（Web + Desktop）**：
- Web hubClient 新增 4 个方法：`editMessage`、`addMessageReaction`、`removeMessageReaction`、`listMessageReactions`
- Desktop hubClient 同步新增 4 个 Reaction 方法
- Web `useWebWorkbenchModel` 新增 10 个 chat actions：recall、edit、pin、unpin、forward、searchMessages、searchSessionMessages、markRead、addReaction、removeReaction
- 自动已读回执：进入会话后自动标记最后一条消息为已读
- Desktop `useDesktopWorkbenchModel` 同步接入 chatActions（send、recall、edit、pin、unpin、markRead）
- Desktop `sessionQueries.ts` 修复所有方法签名以匹配 Hub API（markRead、pin、unpin、forward、reactions）

**Desktop 认证令牌管道**：
- `hubQueries.ts`、`sessionQueries.ts`、`documentQueries.ts`、`projectQueries.ts` 全部传入 `{ getToken: getAccessToken }` 用于认证请求
- Hub WebSocket (`useHubWebSocket.ts`) 接入 workbench model，实时事件驱动 React Query 缓存失效

**Hub Server 数据层完善**：
- 新增 `model.Document` + `repository.Document`（云文档全链路 CRUD）
- 修复 Document model/schema 不匹配（`DeletedAt` 移除，`ProjectID`/`Metadata` 对齐 DB）
- 修复 `user_settings` 表缺失（迁移 0049 手动补建）
- 移除重复的 `/web/documents` 路由注册
- 修复 Prometheus metrics 空指针（`metrics.Register()` 移到提前返回之前）

**Edge CLI 适配器完善**：
- Claude Code 适配器：真实 CLI 执行验证通过
- OpenCode 适配器：修复 `--session` 只在 resume 时传递
- Codex 适配器：新增 `PreflightAdapter` 接口，预检 `OPENAI_API_KEY` 缺失时快速失败；环境变量透传

**SDK HTTP 适配器（新增）**：
- `AnthropicSDKAdapter`：通过 HTTP direct call Anthropic Messages API with SSE streaming
- `OpenAISDKAdapter`：通过 HTTP direct call OpenAI Chat Completions API with SSE streaming
- 两个适配器均通过 `--anthropic-sdk-path`/`--openai-sdk-path` 标志注册，支持 env var API key
- 无外部 SDK 依赖，纯 `net/http`

**E2E 测试与验证**：
- `tests/scripts/verify-real-api-smoke.ps1`：44/44 断言通过（Hub 健康 → Edge 健康 → 认证 → 联系人/会话/文档 CRUD → Edge run 生命周期 → 运行历史）
- `app/e2e/chat-real.spec.ts`：9 个 Playwright 测试（Hub API + Edge API + Web UI）
- 真实 CLI 执行端到端验证：Claude Code 和 OpenCode 均正常工作
- 真实 Hub API 验证：16/20 端点返回 200，含 contacts、sessions、messages、documents、WebSocket

**Desktop 数据流补全**：
- Hub Agent Profile CRUD hooks 接入（`useHubAgentProfiles`、`useHubCreateAgentProfile`、`useHubUpdateAgentProfile`、`useHubDeleteAgentProfile`）
- Agent 合并策略：Edge profiles > Hub profiles > raw adapter list
- Desktop Settings 读取三层回退（Edge → Hub → localStorage）

## 当前不声明已经完成

- 真实 TokenDanceID 登录全链路验收（Hub OIDC handler 已实现，缺 env 配置和 TokenDance ID 端 OAuth client）。
- `scripts/verify-token-dance-id-login-readiness.ps1` 的 `READY_FOR_OPERATOR`：OIDC 被禁用（`AGENTHUB_TOKENDANCE_ID_CLIENT_ID` 未设置）时 token 不可用，只能通过已知 JWT secret 直接签发 token 进行 dev 测试。
- 真实 Web/Mobile/IM 全部远控闭环的发布级验收。
- Hub AgentProfile 市场安装/发布 mutation、真实头像 asset 管线和持久化配置闭环。
- Artifact/Diff 的真实 apply/revert 文件写入。
- 签名安装器、macOS notarization、release upload、updater metadata。
- 生产部署、公开发布或 3 分钟 Demo 视频交付。
- Codex CLI 真实执行（缺 `OPENAI_API_KEY`）。
- Anthropic SDK / OpenAI SDK 的真实 API key 消耗（适配器已实现，key 未配置）。

## 当前并发线

| 线程 | 状态 | 边界 |
|---|---|---|
| Web/IM 主链 | 最新 dev 已合入 target health、agent mainchain actions、group orchestration fixtures、real-mode boundary、artifact/diff inspector | 仍需真实 Hub data、真实 task queue 和群成员权限闭环。 |
| Hub approval/artifact/diff | 最新 dev 已合入单任务 approval/artifact 合同、diff metadata、approval context gate、编排路由审计队列字段 | apply/revert 写文件、TeamRun/单任务完全统一和 production 权限 gate 继续推进。 |
| Desktop/Local Edge | 最新 dev 已合入 diagnostics、sidecar observed/binary/package smoke、exact target bridge、Builder fixture UI | 真实签名包、真实 sidecar binary 发布和跨平台安装仍需审批与平台 gate。 |
| Windows/Tauri packaging release dry | `codex/packaging-release-windows-tauri-20260609` 正在收口 release-readiness dry gate 复用本地 `verify-tauri-package-dry.ps1`，本地 artifact root `.tmp\tauri-package-release-20260609` 已产出 installer/portable/sidecar/hash manifest | unsigned workflow artifacts only；不签名、不公证、不上传 release、不提交二进制；macOS 仍是 future unsigned dry policy。 |
| Edge/CLI/SDK/SQLite | 最新 dev 已合入 SQLite durable/readiness、fixture adapter runner、CLI JSON readiness、SDK capability/event matrix、**Claude Code + OpenCode 真实 CLI 执行验证通过**、**Anthropic SDK + OpenAI SDK HTTP 适配器** | Codex CLI 真实执行缺 `OPENAI_API_KEY`；Anthropic/OpenAI SDK API key 未配置。 |
| Product-loop/readiness | 最新 dev 已合入 observed fixture E2E、localhost probe/smoke、approved-real/no-secret gates、P0 approved-real gold-path harness、**`verify-real-api-smoke.ps1` 44/44 通过** | 缺账号/env 或缺 evidence 时必须输出 `BLOCKED_WITH_EVIDENCE`；本文不记录 secret 或证据包细节。 |
| Mobile | 已合入 rc7 集成线 | 当前新增来自 `codex/mobile-motion-release-gates`：native capability settings、motion press feedback、Account/Workbench readiness 展示；只按 Hub target/run/approval/replay 合同对齐，不分叉 runtime 或登录语义。 |

## 分支治理

- 新实现必须从最新可信基线开隔离 worktree，不在主工作树开发；本轮 release 收口使用 `dev/release-0.3.0-rc7`。
- Worker 不直接推 `dev/delicious233`、`master` 或 tag。
- Controller 负责最终集成、验证、fast-forward/push。
- 已合入或过时 worktree 只能在只读审计确认后逐个归档，不能一把删除。
- `v0.3.0-rc.6` 已存在且指向 `fa6cd35e`，保留为历史 RC 基线；后续 tag 需先通过独立 release gate。
- Desktop 下一版候选已按 `0.3.0-rc.7` 准备；只有 release gate 通过并获人工确认后才允许创建 `v0.3.0-rc.7` tag。
- 2026-06-10 本轮数据流打通复验：`tests\scripts\verify-real-api-smoke.ps1 -RepoRoot .` **44/44 断言通过**（Hub 健康 → Edge 健康 → 认证 → 联系人/会话/文档 CRUD → Edge run 生命周期 → 运行历史）。
- 2026-06-10 Playwright E2E：`app\e2e\chat-real.spec.ts` 9 个测试覆盖 Hub API + Edge API + Web UI 聊天流程。
- 2026-06-10 真实 Hub API 验证：16/20 端点返回 200（contacts、sessions、messages、documents、WebSocket 等）。未覆盖端点为需要真实 TokenDanceID 登录或真实 CLI/API key 的场景。
- 第一批清理候选只包含已被 dev 吸收且 worktree clean 的分支；`dev/johnny`、`feat/backend-edge-hub`、`codex/backend-*` 属于旧大分叉，只能 cherry-pick 级复查。

## Release Gate 快照

- `verify-ci-gates.ps1`、`verify-tauri-package-readiness.ps1 -RepoRoot .`、`verify-tauri-installer-smoke.ps1 -RepoRoot . -StrictToolchain` 已在 RC7 版本基线上通过。
- Web focused tests、Web typecheck、shared focused tests、Hub `go test ./... -short -count=1` 已通过。
- Edge `go test ./... -short -count=1` 已在最新 dev 复跑通过；此前 `TestClaudeCodeParseStreamUsesBrokeredPermissionHandler` 未找到 pending Claude permission request 的失败按 transient flake 记录。
- approved-real 金链路当前状态：Desktop Edge CLI no-spend PASS，Hub replay/Web manifest `READY_FOR_APPROVAL`，TokenDanceID readiness `BLOCKED`，缺 `AGENTHUB_TDID_LOGIN_ISSUER_URL`、`AGENTHUB_TDID_LOGIN_CLIENT_ID`、`AGENTHUB_TDID_LOGIN_TEST_ACCOUNT_REF`。
- 2026-06-10 00:xx 本轮复验：`tests\scripts\verify-p0-approved-real-gold-path.ps1 -RepoRoot .` PASS；`tests\scripts\verify-approved-real-demo-readiness.ps1 -RepoRoot .` PASS。
- Mobile RN 新增集成复验：`corepack pnpm --dir app/mobile-rn verify` PASS，20 个 test files / 89 tests 通过；`corepack pnpm --dir app/mobile-rn native:check` PASS；`corepack pnpm --dir app/mobile-rn mock:hub:check` PASS。
- Windows unsigned dry package 复验：`scripts\verify-tauri-package-dry.ps1 -RepoRoot . -ArtifactsRoot .tmp\tauri-package-release-rc7 -RunWindowsBundle -StrictToolchain` PASS，artifact root 为 `.tmp\tauri-package-release-rc7`。Manifest：`AgentHub_0.3.0-rc.7_x64-portable.zip` 16,746,708 bytes / `0C68CE0695467CF1F436C5BDF1F5658ED1CBD2D1F0548A48A37AD560BC44BF78`；`AgentHub_0.3.0-rc.7_x64-setup.exe` 12,198,380 bytes / `2C6FF0849AB6BF4FA3BBB495ACF2B922158FF6F889BE2AD3EF9AD32D3D85AC5B`；`agenthub-desktop.exe` 19,220,480 bytes / `24B768463573A9CB9BBEE58E40D7E092C55D2F8CE868E71C8DFEEB580B8B795B`；`agenthub-edge-windows-amd64.exe` 25,663,488 bytes / `ED1FED612216C2E4F46A5FC094E85EAD41E3A9133034119D2DF8F2345D43B88F`。
- Android 本地 APK 仍未产出：Windows 原生构建此前阻断在 Expo modules CMake / Ninja 长路径链路；下一步需要 EAS/Linux runner 或进一步收短原生构建路径后复验，不能把 APK release 记为完成。
- security risk register 仍有 High open release blockers；未获 waiver/closure 前不发布 stable，不把 remote/cloud/auth 口径写成 production-ready。

## 下一步优先级

1. **TokenDanceID 真实登录全链路**：Hub OIDC handler 已实现，但 `AGENTHUB_TOKENDANCE_ID_CLIENT_ID` 等环境变量未配置，登录仍走直接 JWT 签发。这是所有真实数据流的 P0 阻塞项——配置后所有 Hub API 查询自动激活。
2. **Web 前端真实数据对接**：TokenDanceID 登录打通后，Web 侧 `hubClient` / `hubWS` / React Query hooks 全部就绪，可逐页从 mock 切换到 Hub 真实数据。当前 IM 聊天 10 个 chat actions、联系人、会话、文档 CRUD 的前端方法和 API 调用均已实现。
3. **Desktop 真实数据对接**：Desktop 侧 auth token 管道、Hub WS 实时缓存失效、chat actions、联系人 actions、agent profile 合并策略、settings 三层回退均已实现。TokenDanceID 登录后可验证全链路。
4. **localhost 服务组合升级**：`verify-real-api-smoke.ps1` 已通过 44/44 断言；可逐步将 Web dev server、Local Edge SQLite/real adapter、Hub 健康探测接入自动组合。
5. **SDK 真实 API 消耗**：`AnthropicSDKAdapter` 和 `OpenAISDKAdapter` 已实现 HTTP direct call + SSE streaming，仅缺 API key。适配器在 key 缺失时 `Available=false`，不阻塞其他流程。
6. **Windows/Tauri unsigned package smoke**：dry gate 已通过，NSIS installer + portable zip + sidecar hash manifest 已产出。签名、公证、release upload 需另获批准。
7. **受控 approved-real CLI/SDK 方案**：preflight manifest gate 已就绪；真实 CLI/model/API 消耗、部署和签名仍必须另获批准。

## 安全规则

- Web 只连接 Hub，不直接连接 Local Edge 或 raw runtime。
- Desktop renderer 不获得 raw process execution 权限。
- Mock、fixture、observed、approved-real、production 必须显式区分。
- 未获明确审批，不跑真实登录、真实模型消耗、部署、签名、公证、updater、release upload。
- Roadmap 只写路线；当前事实写在本文。
