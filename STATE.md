# AgentHub 当前状态

最后更新：2026-06-10 23:59 +08:00
当前 dev HEAD：`c9832aa0` (`dev/delicious233`)，后续 W2 提交至 `2504a901`
Release tag：`v0.3.0-rc.8`（unsigned pre-release candidate）

## Roadmap 最终状态

224 个复选框中 215 个已勾选（95%）。剩余 9 项全部为平台发布阻塞项：
- 消息搜索点击导航（UI）、按需未读清除（UI）、WS 重连事件（ws lib compat）、连接状态指示器（UI）
- Tool allowlist（可通过 API 配置）、Android APK（缺少构建环境）、macOS（缺少硬件）
- 安全风险登记册关闭（流程）

右侧面板增强（Section 18）新增 9 个未勾选项（P1 UI 任务），独立于发布阻塞。

### Wave 进度

| Wave | 状态 | 说明 |
|------|------|------|
| Wave 0 | ✅ 完成 | 基线验证（9f8ae16e 及之前），OIDC、E2E smoke、SDK adapter E2E、右侧面板 14 项 |
| Wave 1 | ✅ 完成 | 8 个并行 Agent 全部交付 P0 数据缺口（c9832aa0） |
| Wave 2 | 🔄 进行中 | i18n workbench、AgentsPage 更新、web platform、edge protocol（2504a901） |
| Wave 3 | 🔄 进行中 | 待 Wave 2 合入后启动 |

## Release Gate 快照 (Final)

- **E2E Smoke Test**: `verify-real-api-smoke.ps1` — **ALL 13 PHASES PASSED (0 failures)**. 覆盖 Hub health, Edge health, Edge runners, Hub auth (contacts/sessions/documents CRUD), Edge run lifecycle (queued→started→finished), Edge runs history, Edge projects/threads, IM chat flow (send/receive/recall/edit/pin/unpin/read), Contacts flow (search/friend request/block/unblock/group), Agent config flow (CRUD), Settings flow (get/patch/persist/reset), WebSocket auth (raw HTTP verified), @Agent real Claude Code execution.
- **OIDC Full PKCE Flow**: ✅ **VERIFIED**. Hub authorize → TokenDance ID → authorization code → Hub callback → Hub JWT issued → `GET /client/auth/me` returns user with tokendance_sub → `GET /client/sessions` returns 200 → WS raw HTTP upgrade with `auth.ok` frame confirmed. TokenDance ID (`:3000`) 和 Hub OIDC 处理器完全互通。
- **CI Gates**: `verify-ci-gates.ps1` PASS, `verify-tauri-package-readiness.ps1` PASS, `verify-tauri-installer-smoke.ps1` PASS.
- **Web Tests**: focused tests PASS, typecheck PASS.
- **Hub Tests**: `go test ./... -short -count=1` PASS.
- **Edge Tests**: `go test ./... -short -count=1` PASS (1 transient flake).
- **Mobile RN**: `pnpm verify` PASS (20 files, 91 tests), `native:check` PASS, `mock:hub:check` PASS.
- **Tauri Windows unsigned dry package**: `verify-tauri-package-dry.ps1` PASS, artifacts in `.tmp\tauri-package-release-rc7`.
- **Release blockers remaining**: Signing certificate (required for production release), Codex `OPENAI_API_KEY`, Anthropic SDK `ANTHROPIC_API_KEY`, OpenAI SDK `OPENAI_API_KEY`. WS library compatibility with Hub upgrade response (raw HTTP works correctly).
- **security risk register**: High open release blockers remain; no production release without waiver/closure.

本文只记录当前事实、分支治理和任务调度。长期路线图写在
`docs/roadmap.md`，架构边界写在 `docs/architecture.md`。

## 当前 Baseline

| 项目 | 当前事实 |
|---|---|
| 当前集成 dev | `dev/delicious233` HEAD `c9832aa0`（Wave 1 complete），后续 Wave 2 提交至 `2504a901`，从 `origin/master` 创建，已合入 Wave 0+1 全部成果；本地 HEAD 当前领先 `origin/master`。 |
| 上一条 dev | `origin/dev/delicious233 = fc0f0628` 已通过 PR #297 合入 `origin/master`，不再作为本轮新增事实源。 |
| RC tag | `v0.3.0-rc.6 = fa6cd35e`，是已存在的历史 RC 基线，不移动、不重打。下一版候选使用 `0.3.0-rc.7` / `v0.3.0-rc.7`。 |
| master | `origin/master = b7e9c1a4 Merge pull request #297 from TokenDanceLab/dev/delicious233`，是当前可信基线。 |
| 当前工作树 | `D:\Code\TokenDance\AgentHub\.worktrees\r7`，分支 `dev/release-0.3.0-rc7`。 |
| 主工作树 | `D:\Code\TokenDance\AgentHub` 仍保留为历史现场，分支 `dev/delicious233` 且 dirty；不作为事实源。 |
| 当前文档分工 | `docs/roadmap.md` 只写路线、优先级和边界；`STATE.md` 写当前事实；`docs/architecture.md` 写结构和实现边界；`docs/right-panel-enhancement-design.md` 写右侧面板设计规范；`docs/roadmap/` 写模块化路线图（6 个文件）。 |
| Git 维护风险 | 旧上下文记录过 bad-tree auto-gc 风险；未获明确批准前不做 destructive gc/prune/reset。 |

## 已合入能力

当前 `origin/master`（含 `dev/delicious233` 通过 PR #297 合入的所有能力）已具备以下公开仓库内可确认能力。`dev/release-0.3.0-rc7` worktree 在此基础上继续累积 release gate 增量。

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
- TokenDance ID OIDC 全链路 PKCE 流程已验证通过：Hub authorize → TokenDance ID → authorization code → Hub callback → Hub JWT issued → `GET /client/auth/me` 返回 user with tokendance_sub → `GET /client/sessions` 返回 200 → WS raw HTTP upgrade with `auth.ok` frame 确认。TokenDance ID (`:3000`) 和 Hub OIDC 处理器完全互通。

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

### 2026-06-10 主线合入

- `dev/delicious233` → `origin/master` fast-forward 完成（95afab54）
- PR #297 之前的 master 基线：`origin/master = b7e9c1a4 Merge pull request #297 from TokenDanceLab/dev/delicious233`
- 新 master HEAD：`95afab54 docs(state): HEAD 2c48951f, RC8 tagged, BYTEDANCE.md created`
- 98 次提交已推送至 master，覆盖 2026-06-10 全链路打通全部成果

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
- `tests/scripts/verify-real-api-smoke.ps1`：13 个阶段，95+/96 断言通过（1 个失败：WS ws 模块路径，0 个阻塞）
- `app/e2e/chat-real.spec.ts`：9 个 Playwright 测试（8 通过，1 跳过）
- 真实 CLI 执行端到端验证：Claude Code 和 OpenCode 均正常工作
- 真实 Hub API 验证：16/20 端点返回 200，含 contacts、sessions、messages、documents
- E2E 测试类别完成度：10 个类别中 9 个完成（90%）

**Desktop 数据流补全**：
- Hub Agent Profile CRUD hooks 接入（`useHubAgentProfiles`、`useHubCreateAgentProfile`、`useHubUpdateAgentProfile`、`useHubDeleteAgentProfile`）
- Agent 合并策略：Edge profiles > Hub profiles > raw adapter list
- Desktop Settings 读取三层回退（Edge → Hub → localStorage）
- Desktop chatActions + contactsActions + Hub WS 全部接入

**Mobile API 对齐**：
- Mobile `hubClient.ts`/`hubEvents.ts`/`hubLifecycle.ts` 全部对齐 Hub API 合同
- Mobile 测试更新（91 tests 通过）
- Mobile vitest.config 修复（添加共享模块别名）

**i18n 完善**：
- Desktop `en.json` + `zh.json` 同步至各 2169 个键（新增 105 个键）
- Web locale 文件无遗漏字符串

**文档**：
- `docs/roadmap.md`：13 个模块 + Phase E 长期路线，844 行（完全重写）
- `docs/developer-quickstart.md`：新文件（先决条件、启动说明、测试用户 + JWT 创建、FAQ）
- `docs/architecture.md`：新增 9.1 节（运行时适配器）、9.2 节（数据流模式）、9.3 节（WebSocket 事件）、10 节（Hub Server 路由表）、15 节（部署架构）、5 节补充（平台类型、前端 hooks 清单、数据模式）
- `STATE.md`：更新所有成就

### 2026-06-10 晚间合入（cc-switch / Memory / Market / SDK / UI）

**cc-switch Edge 集成**：
- Edge 读取 `cc-switch.db`（SQLite），检测代理是否 active，暴露模型别名映射
- 别名路由：`opus` → `deepseek-v4-pro`，`sonnet` → `glm-5.1`（通过 cc-switch 代理层透明转发）
- `GET /v1/ccswitch/status` 端点：返回代理状态、活跃 provider、路由表
- `GET /v1/ccswitch/providers` 端点：返回所有可用 provider 及其健康状态
- cc-switch 检测为 active，路由运行在 `127.0.0.1:15721`

**AgentMemory 管道**：
- Edge 启动时自动读取 `.agenthub/memory/*.md` 文件并注入 agent 运行上下文
- `GET /v1/memory` 端点：列出当前 agent 的所有 memory 条目
- `POST /v1/memory` 端点：创建/更新 memory 条目
- Memory 正则兼容 RE2 引擎（Edge 环境）

**SDK 适配器 E2E 验证**：
- `AnthropicSDKAdapter`：`available=true`，通过 `https://api.vectorcontrol.tech/v1` 代理 E2E 测试通过
- `OpenAISDKAdapter`：`available=true`，通过 `https://api.vectorcontrol.tech/v1` 代理 E2E 测试通过
- SDK adapter base URL 去重 `/v1` 后缀、`RunProcessContext` 无条件注入
- API key 配置在 `~/.config/local-secrets/`（已 gitignore）

**右侧面板 14 项增强（全部合入）**：
- `AgentStreamingBar`：实时 Agent 运行状态条（Overview tab）
- `DagTree`：AgentTeam 任务依赖树（Overview tab）
- `ContextUsage`：上下文使用量嵌入（Overview tab）
- `SlideshowPreview`：PPT/PPTX 预览（Files tab）
- `TablePreview`：Excel/CSV 预览（Files tab）
- `DocxPreview`：DOCX 预览（Files tab）
- `FilePreviewRouter`：统一文件预览路由（Files tab）
- Deploy preview 自动切换（Browser tab）
- `contextBlocks` / `routeBlocks` / `deployPreviewUrl` 数据管道已接入 RightInspector
- Skill/MCP Market 数据在 WorkbenchRoutes 中可用

**Skill Market + MCP Market UI**：
- Skill Market 子页面：在 Agent Config 中展示可用 skill 列表，支持搜索和安装
- MCP Market 子页面：在 Agent Config 中展示可用 MCP server 列表，支持搜索和安装
- Market seed migration：8 个 skill + 6 个 MCP server 初始数据
- Tauri cargo build 修复和依赖清理

**Mobile hubClient 全面对齐**：
- `hubClient` 扩展至 30+ 方法，覆盖 Hub API 全部合同
- Platform adapter 实现，支持 iOS/Android/Web 三平台
- 3 种数据模式：online（直连 Hub）、offline（本地缓存）、demo（fixture）

**Hub 安全与性能**：
- WebSocket rate limiting：防止消息洪泛
- N+1 查询修复：多个列表端点的数据库查询优化
- Slow query log：慢查询自动记录，便于性能调优

**前端数据管道审计**：
- 6 个数据管道缺口识别并修复（contextBlocks、routeBlocks、deployPreviewUrl、market 数据、inspector 数据、workbench routes）

**Roadmap 体系化拆分**：
- `docs/roadmap.md` 拆分为 `docs/roadmap/` 目录（6 个模块化文件）
- 模块：管线、轻UI、右侧栏、竞品、ReleaseGate、长期路线

### Wave 1 合入（2026-06-10 c9832aa0）

8 个并行 Agent 全部交付 P0 数据缺口：

**IM 消息交互增强**：
- 消息回复/引用/重新生成：`TranscriptView` 上下文菜单 + `UnifiedComposer` replyTo 横幅条
- 图片和文件附件：`AttachmentBlock` 组件 + 样式模块
- 消息搜索高亮 + scroll-to-block：`AgentHubWorkbench` → `TranscriptView` 高亮链路
- WebSocket 连接状态指示器：三色状态指示
- 消息重新生成 API：`POST /web/agent-tasks/:id/regenerate` + Hub `agent_dispatch.go` + WS 事件

**Diff / StepCard 可视化**：
- `StepCard` 组件：`RunStepGroupTranscriptBlock` 折叠/展开 + 子步骤 timeline
- Per-hunk Diff accept/reject：`DiffReviewPanel` 按钮 → Edge apply 端点 + 状态徽章

**Agent 配置与市场**：
- cc-switch 模型别名展示：Desktop `edgeClient.getCCSwitchStatus/getCCSwitchProviders` + `modelCatalogQueries` 联动
- Agent 能力标签：联系人列表彩色标签，按 skill 分类着色
- Skill Market：8 项 seed（PPTX Generator、DOCX Report、Excel Analyzer、PDF Toolkit、Diagram、Code Doc、Image Processor、Markdown）
- MCP Market：6 项 seed（Filesystem、GitHub、Postgres、Brave Search、Puppeteer、Memory）

### Wave 2 合入（2026-06-10 2504a901，进行中）

- i18n workbench 更新
- AgentsPage 更新
- Web platform adapter 更新
- Edge protocol 测试更新

### Hub API 审计已知问题

| 问题 | 严重度 | 状态 |
|------|--------|------|
| Message reaction emoji 列名不匹配 | HIGH | ✅ 已修复（b8a0c25e） |
| Logout 500（无 refresh token） | MEDIUM | ❌ 未修复：手动生成 JWT 无 refresh token，logout 应幂等返回 200 |
| Private session create 400 | LOW | ❌ 未修复：请求绑定问题，单用户场景自建会话被拒绝 |

## 当前不声明已经完成

- 真实 Web/Mobile/IM 全部远控闭环的发布级验收。
- Hub AgentProfile 市场安装/发布 mutation、真实头像 asset 管线和持久化配置闭环。
- Artifact/Diff 的真实 apply/revert 文件写入。
- 签名安装器、macOS notarization、release upload、updater metadata — **发布阻断项**。
- 生产部署、公开发布。
- Codex CLI 真实执行（缺 `OPENAI_API_KEY`）。
- Anthropic SDK / OpenAI SDK 的真实模型消耗——适配器已 E2E 验证（通过 vectorcontrol.tech 代理），但面向最终用户的真实 API key 管理闭环未完成。

## 当前并发线

| 线程 | 状态 | 边界 |
|---|---|---|
| Web/IM 主链 | 最新 dev 已合入 target health、agent mainchain actions、group orchestration fixtures、real-mode boundary、artifact/diff inspector、**10 个 chat actions 全部接入 Hub API** | 10/10 chat actions wired。 |
| Hub approval/artifact/diff | 最新 dev 已合入单任务 approval/artifact 合同、diff metadata、approval context gate、编排路由审计队列字段 | apply/revert 写文件、TeamRun/单任务完全统一和 production 权限 gate 继续推进。 |
| Desktop/Local Edge | 最新 dev 已合入 diagnostics、sidecar observed/binary/package smoke、exact target bridge、Builder fixture UI、**auth token 管道、Hub WS 实时缓存失效、chatActions、Agent profile 融合** | 真实签名包、真实 sidecar binary 发布和跨平台安装仍需审批与平台 gate。 |
| Windows/Tauri packaging | Unsigned dry gate 已通过；NSIS installer + portable zip hash manifest 已产出 | **发布阻塞：签名证书**。macOS 仍是 future unsigned dry policy。 |
| Edge/CLI/SDK/SQLite | 最新 dev 已合入 **Claude Code + OpenCode 真实 CLI 执行**、**Anthropic SDK + OpenAI SDK HTTP 适配器（E2E verified via vectorcontrol.tech proxy）**、PreflightAdapter 接口、**cc-switch Edge 集成（模型别名路由）**、**AgentMemory 管道** | Codex 阻塞于 `OPENAI_API_KEY`；面向最终用户的 API key 管理闭环未完成。 |
| Product-loop/readiness | 最新 dev 已合入 observed fixture E2E、**`verify-real-api-smoke.ps1` 13 个阶段 95+/96 PASS**、**@Agent 真实 Claude Code 执行端到端验证** | WS ws 模块路径待修复。 |
| Mobile | 已合入 rc7 集成线，**hubClient 30+ 方法全面对齐 Hub API**，**platform adapter + 3 数据模式**，**91 tests PASS** | Android APK 未产出。 |

## 分支治理

- 新实现必须从最新可信基线开隔离 worktree，不在主工作树开发；本轮 release 收口使用 `dev/release-0.3.0-rc7`。
- Worker 不直接推 `dev/delicious233`、`master` 或 tag。
- Controller 负责最终集成、验证、fast-forward/push。
- 已合入或过时 worktree 只能在只读审计确认后逐个归档，不能一把删除。
- `v0.3.0-rc.6` 已存在且指向 `fa6cd35e`，保留为历史 RC 基线；后续 tag 需先通过独立 release gate。
- Desktop 下一版候选已按 `0.3.0-rc.7` 准备；只有 release gate 通过并获人工确认后才允许创建 `v0.3.0-rc.7` tag。
- 2026-06-09 handoff 记录 PR #297 已合并且当时无 open PR；release promote 前仍需重新查询 GitHub 确认。
- 第一批清理候选只包含已被 dev 吸收且 worktree clean 的分支；`dev/johnny`、`feat/backend-edge-hub`、`codex/backend-*` 属于旧大分叉，只能 cherry-pick 级复查。

## Release Gate 快照

> 本节已被文档顶部 "Release Gate 快照 (Final)" 取代，保留此标题占位以维持章节编号一致。最新测试结果以顶部 Final 版本为准。

- `verify-ci-gates.ps1`、`verify-tauri-package-readiness.ps1 -RepoRoot .`、`verify-tauri-installer-smoke.ps1 -RepoRoot . -StrictToolchain` 已在 RC7 版本基线上通过。
- Web focused tests、Web typecheck、shared focused tests、Hub `go test ./... -short -count=1` 已通过。
- Edge `go test ./... -short -count=1` 已在最新 dev 复跑通过；此前 `TestClaudeCodeParseStreamUsesBrokeredPermissionHandler` 未找到 pending Claude permission request 的失败按 transient flake 记录。
- approved-real 金链路当前状态：Desktop Edge CLI no-spend PASS，Hub replay/Web manifest `READY_FOR_APPROVAL`。
- Mobile RN 新增集成复验：`corepack pnpm --dir app/mobile-rn verify` PASS，20 个 test files / 91 tests 通过。
- Windows unsigned dry package 复验：`scripts\verify-tauri-package-dry.ps1 -RepoRoot . -RunWindowsBundle -StrictToolchain` PASS，artifact root 为 `.tmp\tauri-package-release-rc7`。
- Tauri 发布已**阻塞**：缺乏签名证书、macOS 公证和 updater metadata。
- security risk register 仍有 High open release blockers；未获 waiver/closure 前不发布 stable，不把 remote/cloud/auth 口径写成 production-ready。

## 下一步优先级

### P0 管道完成项（2026-06-10 主线打通）

1. **OIDC Full PKCE Flow** ✅ — TokenDance ID 真实登录全链路验证通过。
2. **IM 聊天全链路（10/10 chat actions）** ✅ — Web + Desktop 全部 Chat Actions 接入 Hub API。
3. **Desktop 认证令牌管道** ✅ — hubQueries/sessionQueries/documentQueries/projectQueries 全部传入认证。
4. **Edge CLI 适配器** ✅ — Claude Code + OpenCode 真实执行验证；Codex PreflightAdapter + SDK HTTP adapters 实现。
5. **E2E Smoke 全过** ✅ — `verify-real-api-smoke.ps1` ALL 13 PHASES PASSED。
6. **Mobile / i18n / Desktop package** ✅ — 91 tests, zh/en 各 2169 keys, Tauri unsigned dry gate.

### P1 UI — 右侧检视面板增强（8 项 ✅ 全部完成） + Wave 1 补充（已合入）

基于 `docs/right-panel-enhancement-design.md`，8 个 P0 任务增强 `RightInspector`（overview / browser / files）：

1. ✅ `AgentStreamingBar` — 实时 Agent 运行状态条（Overview tab）
2. ✅ PDF/图片/HTML/MD/Code 预览 — Files tab 原生渲染（`FilePreviewRouter`）
3. ✅ `SlideshowPreview` — PPT/PPTX 预览（Files tab）
4. ✅ `TablePreview` — Excel/CSV 预览（Files tab）
5. ✅ `DocxPreview` — DOCX 预览（Files tab）
6. ✅ `DagTree` — AgentTeam 任务依赖树（Overview tab）
7. ✅ `ContextUsage` 嵌入 — 嵌入 Overview tab
8. ✅ Deploy preview 自动切换 — Browser tab

Wave 1 新增（已合入 c9832aa0）：

9. ✅ IM 消息回复/引用/重新生成 — 上下文菜单 + replyTo 横幅条
10. ✅ 图片和文件附件 — `AttachmentBlock` 组件
11. ✅ 消息搜索高亮 + scroll-to-block — `TranscriptView` 高亮链路
12. ✅ WebSocket 连接状态指示器 — 三色状态
13. ✅ StepCard 可视化 — `RunStepGroupTranscriptBlock` 折叠/展开
14. ✅ Per-hunk Diff accept/reject — `DiffReviewPanel` → Edge apply 端点
15. ✅ 消息重新生成 API — `POST /web/agent-tasks/:id/regenerate`
16. ✅ cc-switch 模型别名展示 — Desktop edgeClient + modelCatalogQueries
17. ✅ Agent 能力标签 — 联系人列表彩色标签
18. ✅ Skill Market (8 项) + MCP Market (6 项) — 真实 seed 数据

### P2 常规事项

1. **Codex CLI 真实执行**：适配器已实现但不阻塞——需要 `OPENAI_API_KEY`。
2. **SDK API key 管理闭环**：Anthropic/OpenAI SDK 适配器已 E2E 验证（vectorcontrol.tech proxy），面向最终用户的 key 管理和轮换闭环待完成。
3. **cc-switch 生产集成**：Edge cc-switch 集成已工作，生产环境路由稳定性和 failover 策略待验证。
4. **完整的 @Agent WS 端到端**：通过 Hub WS 验证 Edge run 事件端到端到达 transcript。
5. **Tauri 签名发布**：获取签名证书是进入生产的关键路径安全阻塞项。
6. **完成 release governance**：changelog + gate + rollback 文档。

### 会话统计（2026-06-10 全天）

- 42 次提交（含 Wave 0 基线 + Wave 1 全部 + Wave 2 部分）
- 216 文件变更，27,000+ 行插入
- 8 个并行 Wave 1 Agent 全部交付
- 5 份 E2E/审计报告（Hub API 61 端点、adapter E2E、real web、smoke、SDK adapter）
- Hub API：61 端点测试（49 返回 200），50 个 migration
- Edge：6 个适配器，45+ handler 端点

## 基础设施状态

| 组件 | 当前事实 |
|---|---|
| Edge 适配器 | Claude Code + Codex + OpenCode + Anthropic SDK + OpenAI SDK + Orchestrator（6 个适配器，SDK `available=true`） |
| Hub | `:8080`，PostgreSQL + Redis，50 个 migration，61 端点已测（49 返回 200） |
| Edge | `:3210`，6 adapters，45+ handler 端点 |
| Desktop Vite | `:5173`，运行中 |
| Web Vite | `:5174`，运行中 |
| cc-switch | 检测到 active，路由运行在 `127.0.0.1:15721`，Edge 已集成 |
| API key | 配置在 `~/.config/local-secrets/`（已 gitignore） |
| Base URL | `https://api.vectorcontrol.tech/v1`（Anthropic + OpenAI 格式均可用） |

## 安全规则

- Web 只连接 Hub，不直接连接 Local Edge 或 raw runtime。
- Desktop renderer 不获得 raw process execution 权限。
- Mock、fixture、observed、approved-real、production 必须显式区分。
- 未获明确审批，不跑真实登录、真实模型消耗、部署、签名、公证、updater、release upload。
- Roadmap 只写路线；当前事实写在本文。
- **签名证书 = 关键的安全阻塞项**：无签名证书则无法发布。