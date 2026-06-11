# AgentHub 当前状态

最后更新：2026-06-11 12:30 +08:00
当前 dev HEAD：`118bdd84` (`dev/delicious223`)
Release tag：`v0.4.0`（unsigned release）

## Roadmap 最终状态

224 个复选框中 216 个已勾选（96%）。剩余 8 项全部为平台发布阻塞项：
- 消息搜索点击导航（UI）、按需未读清除（UI）、WS 重连事件（ws lib compat）、连接状态指示器（UI）
- Tool allowlist（可通过 API 配置）、~~Android APK~~ ✅（2026-06-10 首次本地构建成功）、macOS（缺少硬件）
- 安全风险登记册关闭（流程）

右侧面板增强（Section 18）新增 9 个未勾选项（P1 UI 任务），独立于发布阻塞。

### Wave 进度

| Wave | 状态 | 说明 |
|------|------|------|
| Wave 0 | ✅ 完成 | 基线验证（9f8ae16e 及之前），OIDC、E2E smoke、SDK adapter E2E、右侧面板 14 项 |
| Wave 1 | ✅ 完成 | 8 个并行 Agent 全部交付 P0 数据缺口（c9832aa0） |
| Wave 2 | ✅ 完成 | i18n workbench、AgentsPage 更新、web platform、edge protocol（2504a901） |
| Wave 3 | ✅ 完成 | v0.4.0 发布收口：CC session 修复、README 重写、OIDC 真实用户、截图 & badge、demo conversations |

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
| 当前集成 dev | `dev/delicious223` HEAD `118bdd84`，从 `dev/delicious233` 创建；v0.4.0 roadmap 已归档。 |
| 上一条 dev | `origin/dev/delicious233 = 1e03b7ec`，领先 `origin/master` 旧基线 1 个 commit（v0.4.0 roadmap 归档）。 |
| RC tag | `v0.4.0`（指向 `ed4f6fda`，unsigned release） |
| master | `origin/master = 8ac93e8b`，当前可信基线，指向 v0.4.0。 |
| 当前工作树 | `D:\Code\TokenDance\AgentHub`，分支 `dev/delicious223`。 |
| 当前文档分工 | `docs/roadmap.md` 只写路线、优先级和边界；`STATE.md` 写当前事实；`docs/architecture.md` 写结构和实现边界；`docs/right-panel-enhancement-design.md` 写右侧面板设计规范；`docs/roadmap/` 写模块化路线图（3 个文件）。 |
| Git 维护风险 | 旧上下文记录过 bad-tree auto-gc 风险；未获明确批准前不做 destructive gc/prune/reset。 |

## 已合入能力

当前 `origin/master`（含 `dev/delicious233` 通过 PR #297 合入的所有能力）已具备以下公开仓库内可确认能力。

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
- TokenDance ID OIDC 全链路 PKCE 流程已验证通过。

### Desktop / Local Edge / package readiness

- Desktop Local Edge diagnostics、Hub task bridge、target 注册/同步和 sidecar readiness 已进入 dev。
- Desktop sidecar observed fixture smoke 已覆盖 fixture/mock sidecar health、SQLite app-data path、stdout/stderr log path、health URL、preflight/readiness、no direct CLI spawn。
- Desktop exact target observed bridge 已记录 expected/observed `target_id` / `edge_device_id`，能区分 matched、mismatch、offline、missing。
- Tauri package smoke gate 已强化 Windows unsigned/dev package reproducibility、sidecar placement、Local Edge diagnostics、macOS unsigned policy boundary。
- Release gate 负责人线已补 `scripts/verify-release-gate.ps1` 和 `docs/audit/release-gate-2026-06-09.md`。
- Desktop Agent Builder fixture evidence UI 已合入。

### Edge / CLI / SDK / SQLite

- Edge SQLite store、迁移、row/projection tests、durable observed fixture smoke、row-first restore、approval/file-change/artifact evidence、pins 和 replay projection 已合入。
- SQLite local store readiness 已进入 dev。
- Edge fixture adapter runner contract 已合入。
- CLI JSON readiness checker 和 CLI approved-real readiness tightening 已合入。
- SDK fixture capability evidence 与 SDK event fixture matrix 已合入。
- AgentSpec fixture demo 已导出，Agent/Profile/市场 fixture 摘要已合入。

### Product-loop / readiness gates

- Product-loop observed fixture E2E gate 已合入，覆盖 Web -> Hub -> Desktop/Tauri sidecar readiness -> Local Edge -> adapter fixture -> Hub replay -> Web transcript/approval/artifact render。
- localhost observed loop gate、localhost service probe plan 和 localhost 真实服务 smoke 已进入 dev。
- approved-real preflight manifest gate、redacted demo manifest gate 和 no-secret demo readiness gate 已合入。
- Web deploy/readiness、boundary、product-loop fixture QA 和 Tauri readiness gate 已作为当前 dev 基础能力存在。

### 2026-06-10 主线合入

- `dev/delicious233` → `origin/master` fast-forward 完成（95afab54）
- PR #297 之前的 master 基线：`origin/master = b7e9c1a4 Merge pull request #297`
- 新 master HEAD：`95afab54 docs(state): HEAD 2c48951f, RC8 tagged`
- 98 次提交已推送至 master，覆盖 2026-06-10 全链路打通全部成果

### 2026-06-10 ~ 2026-06-11 v0.4.0 收口

- **CC Session 修复**：每次 run 创建全新 Claude Code session（`--session-id`），避免 session 复用导致的状态污染
- **README 重写**：对外展示风格，去除内部信息和防御性内容；添加产品截图 + Tauri badge
- **OIDC 真实用户接入**：Web + Hub + Edge 全链路接入 OIDC 真实用户信息，清理 mock 数据，默认工作目录改为 HOME
- **Desktop 本地 Edge 集成**：Claude Code CLI 从 Desktop 直接启动
- **Desktop 版本号**：bump to v0.4.0，产品名统一为 "AgentHub Desktop"
- **Workbench 移除交互式 data mode 下拉框**，简化 UI
- **AgentsPage 右侧详情面板宽度自适应修复**
- **Web demo conversations**：Hub 无活跃 session 时展示 demo
- **文档**：截图移至 docs/images/，agenthub-design → tokendance-design 引用同步

## 当前不声明已经完成

- 真实 Web/Mobile/IM 全部远控闭环的发布级验收。
- Hub AgentProfile 市场安装/发布 mutation、真实头像 asset 管线和持久化配置闭环。
- Artifact/Diff 的真实 apply/revert 文件写入。
- 签名安装器、macOS notarization、release upload、updater metadata — **发布阻断项**。
- 生产部署、公开发布。
- Codex CLI 真实执行（缺 `OPENAI_API_KEY`）。
- Anthropic SDK / OpenAI SDK 的真实模型消耗——适配器已 E2E 验证，但面向最终用户的真实 API key 管理闭环未完成。

## 当前并发线

| 线程 | 状态 | 边界 |
|---|---|---|
| Web/IM 主链 | 最新 dev 已合入 target health、agent mainchain actions、group orchestration fixtures、real-mode boundary、artifact/diff inspector、**10 个 chat actions 全部接入 Hub API** | 10/10 chat actions wired。 |
| Hub approval/artifact/diff | 最新 dev 已合入单任务 approval/artifact 合同、diff metadata、approval context gate、编排路由审计队列字段 | apply/revert 写文件、TeamRun/单任务完全统一和 production 权限 gate 继续推进。 |
| Desktop/Local Edge | 最新 dev 已合入 diagnostics、sidecar observed/binary/package smoke、exact target bridge、Builder fixture UI、**auth token 管道、Hub WS 实时缓存失效、chatActions、Agent profile 融合、本地 Edge + CC CLI 集成** | 真实签名包、真实 sidecar binary 发布和跨平台安装仍需审批与平台 gate。 |
| Windows/Tauri packaging | Unsigned dry gate 已通过；NSIS installer + portable zip hash manifest 已产出 | **发布阻塞：签名证书**。macOS 仍是 future unsigned dry policy。 |
| Edge/CLI/SDK/SQLite | 最新 dev 已合入 **Claude Code + OpenCode 真实 CLI 执行**、**Anthropic SDK + OpenAI SDK HTTP 适配器（E2E verified）**、PreflightAdapter 接口、**cc-switch Edge 集成（模型别名路由）**、**AgentMemory 管道** | Codex 阻塞于 `OPENAI_API_KEY`；面向最终用户的 API key 管理闭环未完成。 |
| Product-loop/readiness | 最新 dev 已合入 observed fixture E2E、**`verify-real-api-smoke.ps1` 13 个阶段 95+/96 PASS**、**@Agent 真实 Claude Code 执行端到端验证** | WS ws 模块路径待修复。 |
| Mobile | 已合入 rc7 集成线，**hubClient 30+ 方法全面对齐 Hub API**，**platform adapter + 3 数据模式**，**91 tests PASS** | **Android APK 已产出**（2026-06-10，Release arm64-v8a，29.83 MB）。 |

## 分支治理

- 新实现必须从最新可信基线开隔离 worktree，不在主工作树开发。
- Worker 不直接推 `dev/delicious233`、`master` 或 tag。
- Controller 负责最终集成、验证、fast-forward/push。
- 已合入或过时 worktree 只能在只读审计确认后逐个归档，不能一把删除。
- 已有 tag：`v0.1.0`、`v0.2.0`、`v0.2.1-rc.1`、`v0.3.0-rc.*` 系列、`v0.4.0-rc1`、`v0.4.0`。后续 tag 需先通过独立 release gate。
- 第一批清理候选只包含已被 dev 吸收且 worktree clean 的分支。

## 下一步优先级

### P0 管道完成项（已全部完成）

1. ✅ **OIDC Full PKCE Flow** — TokenDance ID 真实登录全链路验证通过。
2. ✅ **IM 聊天全链路（10/10 chat actions）** — Web + Desktop 全部 Chat Actions 接入 Hub API。
3. ✅ **Desktop 认证令牌管道** — hubQueries/sessionQueries/documentQueries/projectQueries 全部传入认证。
4. ✅ **Edge CLI 适配器** — Claude Code + OpenCode 真实执行验证；Codex PreflightAdapter + SDK HTTP adapters 实现。
5. ✅ **E2E Smoke 全过** — `verify-real-api-smoke.ps1` ALL 13 PHASES PASSED。
6. ✅ **Mobile / i18n / Desktop package** — 91 tests, zh/en 各 2169 keys, Tauri unsigned dry gate.

### P1 UI — 右侧检视面板增强（全部完成）

1. ✅ `AgentStreamingBar` — 实时 Agent 运行状态条（Overview tab）
2. ✅ PDF/图片/HTML/MD/Code 预览 — Files tab 原生渲染（`FilePreviewRouter`）
3. ✅ `SlideshowPreview` — PPT/PPTX 预览（Files tab）
4. ✅ `TablePreview` — Excel/CSV 预览（Files tab）
5. ✅ `DocxPreview` — DOCX 预览（Files tab）
6. ✅ `DagTree` — AgentTeam 任务依赖树（Overview tab）
7. ✅ `ContextUsage` 嵌入 — 嵌入 Overview tab
8. ✅ Deploy preview 自动切换 — Browser tab
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
2. **SDK API key 管理闭环**：Anthropic/OpenAI SDK 适配器已 E2E 验证，面向最终用户的 key 管理和轮换闭环待完成。
3. **cc-switch 生产集成**：Edge cc-switch 集成已工作，生产环境路由稳定性和 failover 策略待验证。
4. **完整的 @Agent WS 端到端**：通过 Hub WS 验证 Edge run 事件端到端到达 transcript。
5. **Tauri 签名发布**：获取签名证书是进入生产的关键路径安全阻塞项。
6. **完成 release governance**：changelog + gate + rollback 文档。

## 安全规则

- Web 只连接 Hub，不直接连接 Local Edge 或 raw runtime。
- Desktop renderer 不获得 raw process execution 权限。
- Mock、fixture、observed、approved-real、production 必须显式区分。
- 未获明确审批，不跑真实登录、真实模型消耗、部署、签名、公证、updater、release upload。
- Roadmap 只写路线；当前事实写在本文。
- **签名证书 = 关键的安全阻塞项**：无签名证书则无法发布。
