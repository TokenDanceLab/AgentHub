# AgentHub 项目状态

最后更新：2026-05-31 UTC+8 | 分支：feat/desktop-run-workbench | 状态：Desktop Run Workbench 真实闭环实现中；active run sync、typed blocks、review surface 已进入验证

## 本次 Desktop Run Workbench 推进（2026-05-31）

- **基线保存**：上一轮 Desktop 日常工作台闭环已提交 `27ee3a7 feat(desktop): 收口日常工作台闭环`；`corepack pnpm` 与 `vite.config.ts` 的 `host: 127.0.0.1` 作为本轮 Desktop 基线保留。
- **Team A 进展**：`runQueries` 增加 runs query cache upsert/status helper；`useChatMessages` 在 `run.queued`、`run.started`、`run.status.changed`、terminal events 与 approval wait 时同步 active run 状态；Home/Settings active run 统计纳入 `waiting_approval`，Home Run/Approval CTA 优先打开主工作台 Run 面板。
- **Team B 进展**：Run detail 复用现有 Chat message typed blocks，新增 Runtime blocks 审阅区，覆盖 thinking、tool call/result、file change、result、text/code/session fallback。
- **Team C 进展**：Run detail 新增统一 Run review surface，集中展示 pending approvals、diff、artifact、preview；artifact/preview 没有事件载荷时明确显示 gap，不伪装下载或预览；审批动作在 review 面板保留失败态。
- **验证证据**：`corepack.cmd pnpm typecheck`、focused Vitest（`runQueries` / `useChatMessages` / `RunDetail` / `HomeDashboard`）、`corepack.cmd pnpm test`（731 passed / 27 skipped）、`corepack.cmd pnpm build` 与 `git diff --check` 已通过。Playwright 截图覆盖 `1440x900`、`1280x720`、`375x812`，三档均确认 Run review、pending approval、diff、artifact gap、preview gap、offline chip 存在，`scrollWidth === innerWidth` 且无 `run.*` 裸 key。

## 本次后端/运维推进（2026-05-29）

- **协作边界**：主工作树 `AgentHub/` 当前由 Desktop/Mobile/Web/Edge Agent 占用且落后远端；本轮后端只在隔离 worktree `AgentHub-backend-device-uuid/` 写入，未修改 `app/desktop/`、`app/mobile/`、`app/web/` 或 `edge-server/`。
- **AH-SR-027 收口**：Hub typed runtime event 之前只有 1 MiB per-event payload 上限，没有 per-task event-count 上限；异常 Edge callback loop 可以持续写入小 `agent_run_events` 和聊天投影。现在 `HandleTaskStream` 通过 capped transactional insert 写入 `agent_run_events`，默认 `MaxRunEventsPerTask=4096`；达到上限后返回 `BAD_REQUEST`，并回滚 runtime event 和 projected message，避免 PostgreSQL / replay 查询成本无界增长。
- **AH-SR-024 收口**：AgentTeam read/write boundary 已在仓内缓解。`ListTeams` 现在只返回 owner teams + requester 拥有已安装 Agent Profile 的 readable teams；`GetTeam`、TeamRun runs/state/tasks/events 读取复用 readable-member 检查；`HandleRouteDecision`、`DecideApproval`、`ResolveConflict` 仍要求 team owner，成员读者不能提交路由、审批或冲突决策。
- **AH-SR-025 收口**：AgentTeam delegation/resource guardrails 已在仓内缓解。`agent_team` 配置和 `AGENTHUB_AGENT_TEAM_*` env 覆盖委派深度、active subagents、route repeat、TeamRun 总任务、assignment timeout 和 budget；`CreateAssignment` 现在补齐 ancestor max-depth、脏数据循环检测、总任务 cap 和 active cap，不能绕过 coordinator route guardrails。
- **AH-SR-016 生产 CORS smoke 收口**：hk2 live container 已确认 `AGENTHUB_ENV=production`、`AGENTHUB_CORS_ORIGINS=https://hub.vectorcontrol.tech`；OPTIONS `/health` 对 `http://localhost:5173` 与 `http://127.0.0.1:5173` 返回 403 且无 `Access-Control-Allow-Origin`，对 `https://hub.vectorcontrol.tech` 返回 204 且允许该 origin；`/health` 仍为 `status=ok`、`migrations=39`。该 CORS smoke 后，AH-SR-027 已通过 no-server-build tar/load/recreate 流程更新 runtime 到 `f0894ea`。
- **AH-SR-017 收口**：生产探针发现主 API 对未知路径、`/metrics`、`/debug/pprof/` 返回空 `200`。仓内已修 Timeout middleware 的 header-only status flush，并给 router 增加显式 JSON 404/405；admin metrics/pprof 仍由独立 Basic Auth admin mux 管理。
- **B9 S3 对象存储收口**：附件存储已支持 S3-compatible backend。`AGENTHUB_S3_*` 环境变量已接入 config、生产 compose 和 `.env.production.example`；未配置 S3 时继续使用本地 `Upload.Dir`，配置 S3 后不再要求本地 upload dir 存在。S3 配置不完整会启动前 fail fast，避免误以为对象存储已启用但实际写入 hk2 根盘；S3 `PutObject` 使用 `If-None-Match: *`，已存在 hash object 不覆盖。
- **AH-SR-022 DB 约束收口**：message pin 跨 session 风险不再只靠 service 过滤。migration `0039_message_pins_session_fk` 已清理历史 cross-session `message_pins` 行，并用 `message_pins(session_id,message_id)` -> `messages(session_id,id)` 复合外键固化归属；hk2 读回 `schema_migrations=39|f`、`fk_message_pins_message_session` 存在、历史坏 pin 数为 0。临时 Postgres/Redis 集成测试已改为断言数据库拒绝跨 session pin。
- **hk2 生产部署证据**：2026-05-29 已通过本机构建镜像 tar -> `scp -J hk1` -> hk2 `git pull --ff-only` -> `docker load` -> `docker compose ... up -d --no-build --no-deps --force-recreate hub-server` 部署 commit `f0894ea`（AH-SR-027 Hub runtime event growth guardrail）。生产容器 image id/digest `sha256:c8a628ef41701bddfb1932b5c1234487f3854d14e652c32bee8efe993087f0ea`，tar SHA-256 `22949584df27819dbbbf23d50a036420123fdc014233698c88fb73438c4732ef`，Docker health `running/healthy`；本机 `/health` 为 `status=ok`、`migrations=39`。生产 CORS smoke 复验：`http://localhost:5173` 与 `http://127.0.0.1:5173` 返回 403 且无 allow-origin，`https://hub.vectorcontrol.tech` 返回 204 且 allow-origin 匹配。Hub 约 8.2MiB/256MiB、PG 约 22.6MiB/512MiB、Redis 约 5.2MiB/384MiB，根盘约 66%；本地 tar 与 hk2 `/tmp/agenthub-hub-*.tar` 已清理，未在 hk2/serverhub/server build。
- **B9 验证证据**：已跑 `hub-server && go test ./internal/config -run "Test(EnvOverrideS3Config|S3Config_IsConfigured|S3Config_IsEmpty|ValidateS3ConfigRequiresCompleteCredentials|ValidateS3ConfigDoesNotRequireLocalUploadDir)$" -count=1 -v`、`go test ./internal/service -run "Test(LocalStorage_PutAndGet|S3Storage_LocalPathReturnsEmpty|S3Storage_PutReturnsTrue|S3Storage_PutReturnsFalseWhenBlobAlreadyExists|SaveAttachment_StorageInjection)$" -count=1 -v`、`go test ./internal/config ./internal/service ./internal/app -count=1`、`go test ./... -short -count=1`、`docker compose -f deployments/docker-compose.prod.yml --env-file deployments/.env.production.example config --quiet` 和 `git diff --check`。
- **AH-SR-025 验证证据**：已跑 `hub-server && go test ./internal/config -run "TestLoadAgentTeamGuardrailDefaults|TestEnvOverrideAgentTeamGuardrails|TestValidateRejectsInvalidAgentTeamGuardrails|TestJWTSecretHardcodedOverriddenByEnv" -count=1 -v`、`go test ./internal/service -run "TestAgentTeamService_CreateAssignmentRejects(DelegationDepthLimit|DelegationCycle|TeamRunTaskLimit)|TestAgentTeamService_CreateAssignmentUsesConfigured(DelegationDepthLimit|TeamRunTaskLimit)|TestAgentTeamService_HandleRouteDecisionRejectsWhen(ActiveSubagentLimitReached|TaskLimitReached|RouteRepeatLimitReached)|TestAgentTeamService_HandleRouteDecisionRejects(TimedOutAssignment|BudgetExceeded)" -count=1 -v`、`go test ./internal/service -run TestAgentTeamService -count=1 -v`、`go test ./... -short -count=1` 和 `git diff --check`。
- **AH-SR-016 验证证据**：已跑 `hub-server && go test ./internal/middleware -run "Test(CORSRejectsProductionLoopbackOrigin|ValidateCORSOriginsForEnvironment)" -count=1 -v`；hk2 CORS smoke 读回 repo `83d6dd5`，env 为 production + official origin only，localhost/127.0.0.1 origins 403，official origin 204，health `status=ok`、`migrations=39`，runtime image digest 未变，`/tmp/agenthub-hub-*.tar` 数量为 0。
- **AH-SR-017 验证证据**：已跑 `hub-server && go test ./internal/router -run TestNoRouteReturnsNotFound -count=1 -v`、`go test ./internal/middleware -run "TestTimeout_(FlushesHeaderOnlyStatus|HandlerCompletesNormally|Returns504WhenHandlerSlow)" -count=1 -v`、`go test ./... -short -count=1` 和 `git diff --check`。
- **AH-SR-027 验证证据**：已跑 `hub-server && go test ./internal/service -run "TestHandleTaskStream(RejectsRunEventWhenTaskEventCapReached|PersistsTypedRunEventAndProjection|RejectsOversizedPayload|RejectsOversizedProjectedContent|RejectsOversizedEdgeRunID|_DispatchedTransitionConflictDoesNotPersist)" -count=1 -v`、`go test ./internal/repository ./internal/service ./internal/handler -count=1` 和 `go test ./... -short -count=1`。
- **AH-SR-024 验证证据**：已跑 `hub-server && go test ./internal/service -run "TestAgentTeamService_(GetTeamAllowsAgentProfileOwnerMemberRead|ListTeamsIncludesReadableMemberTeamsWithoutLeaking|MemberReadableTeamCannotMutateRunDecisions)$" -count=1 -v`、`go test ./internal/service -run TestAgentTeamService -count=1 -v`、`go test ./internal/repository -run TestAgentTeam -count=1 -v`、`go test ./... -short -count=1`。
- **部署约束**：hk2/serverhub/server 不得 build。Hub runtime 镜像更新只能走开发机/CI 构建、`docker save`、`scp`、hk2 `docker load`、`docker compose ... up -d --no-build --no-deps --force-recreate hub-server`。`hub-server/deployments/deploy.sh` 已同步显式 `--force-recreate`，避免同一 `latest` tag 预加载新镜像后容器不重建。
- **进度口径**：本轮后端/安全/部署收口已完成；AT-2/AT-3 后端在 roadmap 中已完成。AT-4 仍是 Desktop/Edge live smoke（两个真实 Runtime Profile 同一 TeamRun）和 Console/UI 验收，不由本轮后端直接修改 UI 完成。

> **2026-06-01 Ultracode 全维度并行推进**：本轮 5 个 Workflow + 5 个独立 Agent 并行审计与开发，覆盖 Web 前端 P0、Go 后端竞品对比、Desktop 前端竞品对比、Mobile/Shared/i18n 审计、OIDC/TeamRun smoke test、Desktop ChatView 同步、分支与脏文件审计、比赛材料整理。

## 本轮团队产出

| 类型 | 名称 | 维度 | 修复 | 状态 |
|------|------|:--:|:--:|:--:|
| Workflow | web-frontend-p0-sprint | 7 | 7/7 | ✅ |
| Workflow | backend-competitor-optimize | 5 | 14/16 | ✅ |
| Workflow | desktop-frontend-optimize | 5 | 23/23 | ✅ |
| Workflow | mobile-shared-audit | 3 | 17/17 | ✅ |
| Workflow | deep-research | 比赛策略 | — | ✅ |
| Agent | oidc-smoke-test | 14 子测试 | 14 | ✅ |
| Agent | teamrun-smoke-test | 11 子测试 | 11 | ✅ |
| Agent | desktop-chatview-sync | 6 组件 | 6 | ✅ |
| Agent | fix-desktop-test-regressions | 28 回归 | 28 | ✅ |
| Agent | audit-agenthub-git | 分支/Worktree | — | ✅ |
| Agent | audit-bytedance-wiring | 8 场景 | — | ✅ |
| Agent | move-competition-docs | 仓库清理 | — | ✅ |

## P0 必修项（bytedance 终审）— 全部完成

| # | 项目 | 证据 |
|---|------|------|
| P0-1 | RunDetail 消费 getTaskRunEventSummary | `app/web/src/components/RunDetail.tsx` — 6 项指标 (Steps/Elapsed/Tokens/Approvals/Artifacts) |
| P0-2 | ChatView 新 block types | `app/web/src/components/ChatView.types.ts` + ApprovalCard/ArtifactCard/DeployCard/LinkCard |
| P0-3 | Web IMView pin/archive/search/sort | `app/web/src/views/IMView.tsx` + IMSearchBar/IMSessionActions |
| P0-4 | 上下文连续性通用化 | `edge-server/internal/runnerctx/context_budget.go` — BuildContextPreface + 3 adapter 注入 |
| P0-5 | Web WS 重连恢复 | `app/web/src/stores/connectionStore.ts` + `useHubWSConnection.ts` + `WebLayout.tsx` 恢复编排 |
| P0-6 | deploy_card/link_card 渲染 | DeployCard + LinkCard 组件，ChatView block switch 分支 |
| P0-7 | ApprovalCard + 审批 UI | ApprovalCard 组件 + ChatView 渲染 + RunDetail 审批统计 |
| — | Desktop ChatView 同步 | 6 新组件 (ApprovalCard/ArtifactCard/DeployCard/LinkCard/ArtifactPreview/ReplyPreviewBar) |
| — | OIDC 烟雾测试 | `hub-server/tests/oidc/oidc_smoke_test.go` — 14/14 通过 |
| — | TeamRun smoke test | `hub-server/tests/teamrun/teamrun_smoke_test.go` — 11 子测试 |

## 8 个执行场景覆盖率

| 场景 | 状态 | 难度 |
|------|:--:|:--:|
| 1. Desktop 本地离线 | **可运行** | — |
| 2. Desktop 本地在线 Hub | 代码完整，缺部署态 smoke | 简单 |
| 3. SSH 远程 Desktop | 未实现（仅模型常量） | 困难 |
| 4. Desktop Relay 远程 | Relay 基础设施存在但未接线 task 路由 | 中等 |
| 5. Desktop 直连云 | 未实现 | 困难 |
| 6. Desktop Relay 到云 | 未实现（依赖 4+5） | 困难 |
| 7. Web → Desktop 最小闭环 | 代码完整，缺部署态 smoke | 简单-中等 |
| 8. Web → Cloud | 未实现 | 困难 |

## 测试状态

| 层级 | 总数 | 通过 | 状态 |
|------|:--:|:--:|:--:|
| Web Vitest | 45 | 45 | 🟢 |
| Desktop Vitest | 1115 | 1115 | 🟢 (回归已修复) |
| Go OIDC smoke (独立子包) | 14 | 14 | 🟢 |
| Go TeamRun smoke (独立子包) | 11 | 11 | 🟢 |
| Go tests/ (需 PG+Redis) | — | — | 🔴 TestMain 连真实 PG |

### AgentTeam 底层状态确认
- **AT-1 已完成**：模型（AgentTeam/AgentTeamMember/AgentTeamRun/AgentTeamAssignment）、迁移（0033/0034）、仓库（15 func）、服务（18 method）、处理器（15 endpoint）、路由（15 条 under `/web/agent-teams`）全部就绪，测试 7/7 通过。
- **AT-2 已完成**：StartTeamRun、TeamEvent append-only log、TeamRunState replay projection、TeamTask/RunEvent/approval/artifact/budget 投影已进入后端主线。
- **AT-3 已完成**：CoordinatorRouteDecision 结构化委派、assignment 创建、TeamRun 资源 guardrails、owner/member 读写边界和直接 `CreateAssignment` 防绕过路径已在仓内收口。
- **AT-4 剩余口径**：仍是 Desktop/Edge live smoke（两个真实 Runtime Profile 同一 TeamRun）和 Console/UI 验收；本轮后端 Agent 不修改 Desktop/UI。

### 后端 Issue 状态
- `0374d91` 已修复 #145 #142 #138 #105；#173 `Normalize or validate non-text message content before jsonb writes` 已在 2026-05-25 关闭，roadmap 记录为 2026-05-27 non-text message content normalization slice。

## 已知待办

### Desktop Agent（客户端）
- [ ] 修复 UI popover 裁剪 bug（top-right 图标 hover，`.root { overflow: hidden }` 截断 run card）
- [ ] Desktop Settings 接入 AgentTeam 管理界面（CRUD team/member，消费 `/web/agent-teams` API）
- [ ] Desktop TeamRun Console：task board、member status、subagent activity

### Mobile Agent（移动端）
- [ ] OIDC 深链（`agenthub://`）+ PKCE + 系统浏览器（前端按钮已接 Tauri command；Rust 仍是 stub）
- [ ] Platform secure store（Android Keystore）（前端读取/清除入口已接 Tauri command；Rust 仍是 stub）
- [ ] `tauri android dev` 端口冲突解决 + 热重载闭环
- [x] Mobile UI 基础修复：去除未生效 Tailwind-like class 假设，改为 Mobile-native semantic CSS，完成 emulator 截图验收
- [x] Mobile Settings 原生能力入口：TokenDance ID 登录、Hub session 检查/清除、notification probe 前端桥接
- [x] Mobile Settings action feedback：原生命令 pending 禁用按钮，状态反馈用 role=status 图标 panel，QA 覆盖 Check session 错误态
- [x] Mobile 设计系统推进：Threads/Runs/Chat/Run detail 对齐 dense command-center，完成 390x844 dark mocked workflow 截图
- [x] Mobile approval/diff/resources preview surface：waiting approval + diff files + structured blocks + artifacts/previews + approve/reject 操作 + resource detail sheet，完成 390x844 dark mocked 截图
- [x] Mobile diff readability：Diff preview 改为移动端逐行分色和 +/− chips，避免手机横向拖动审阅长 diff
- [x] Mobile structured blocks timeline：Run detail structured blocks 增加 timeline rail、序号、metadata chips 和类型色 icon，提升手机端审阅扫读效率
- [x] Mobile logs readability：Run logs 从 raw pre 升级为移动端日志行，按 source/severity 分色并保留底部审阅 dock
- [x] Mobile run section active state：Review/Diff/Blocks/Outputs/Logs sticky nav 点击后保留 active chip 与 `aria-current`，长页面审阅位置更清楚
- [x] Mobile visual QA 脚本：`corepack.cmd pnpm visual:qa` 可复截 mocked workflow 并校验 overflow/touch target/console
- [x] Mobile Android WebView CSP 修复：`tauri.conf.json` 已允许当前 Hub HTTP/WS host，emulator logcat 从 CSP blocker 推进到 Hub CORS blocker
- [x] Mobile native API bridge：Tauri runtime 下 REST 走 Rust `hub_request`，allowlist `http://api.hub.vectorcontrol.tech/`，避免 WebView CORS 作为主链路 blocker
- [x] Mobile queue filters：Threads 与 Runs 增加移动端横向筛选 chips，`visual:qa` 覆盖筛选后截图
- [x] Mobile queue refresh feedback：Threads/Runs 慢刷新时显示 overview status pill 和 `aria-busy` refresh button，截图覆盖 refetch in-flight
- [x] Mobile review action dock：pending approval run detail 底部保留 Approve/Reject 操作，长内容滚动时不丢失审阅上下文
- [x] Mobile approval confirmation sheet：Approve/Reject 先弹 decision-specific bottom sheet 再提交，Reject 使用危险态确认摘要和红色 confirm，降低移动端误触审批风险
- [x] Mobile rejection success feedback：Reject 提交成功后使用 rejected 文案、危险态 decision lock、Run header error badge、Review summary danger tile 和 error status badge，`visual:qa` 截图覆盖 reject 成功闭环
- [x] Mobile light-mode screenshot coverage：`visual:qa` 增加 light color scheme 截图，覆盖 Threads、pending review dock 和 approval confirmation sheet
- [x] Mobile chat context panel：Chat 页补 project/status/messages/last activity/handoff 摘要，避免移动端对话脱离线程上下文
- [x] Mobile chat latest jump：长线程上滑后显示 92x44 Latest 浮动按钮，点击回到最新消息并用 `visual:qa` 截图覆盖
- [x] Mobile chat copy feedback：消息和 activity card 补 44px Copy/Copied 操作，手机端可复制 Agent 输出或用户指令，`visual:qa` 截图覆盖成功反馈
- [x] Mobile chat composer scope：composer 上方补 project/items/status 持久 scope，移动端输入时不丢回复归属
- [x] Mobile chat send feedback：发送 pending/error/success 状态固定在 composer dock/对话流，对话流显示 Sending/Not sent/Sent 气泡，失败保留 draft 并提供 44px Retry，用截图覆盖慢 POST、503、retry-success 与成功 POST
- [x] Mobile settings login recovery：native Sign in/session/notification action 失败后在状态面板提供 44px Retry 动作，dark/light 截图覆盖登录恢复
- [x] Mobile bottom nav badges/safe area：底栏 Threads/Runs tab 显示 active thread / pending review 数字 badge，并给 Android gesture handle 保留最小底部安全区；`visual:qa` 与 portrait emulator 截图覆盖
- [x] Mobile runs triage shortcut：Runs 顶部新增 Next review 快捷卡，减少 waiting approval 的移动端审阅路径
- [x] Mobile runs row triage：Runs row 增加状态色 rail 和 thread context，筛选后仍能快速判断 run 状态与归属
- [x] Mobile thread handoff shortcut：Threads 顶部新增 Continue handoff 快捷卡，减少 active thread 的移动端继续路径
- [x] Mobile run detail summary strip：Run detail 顶部补 Review/Diff/Blocks/Outputs/Logs 摘要，进入详情先判断完整审阅证据面
- [x] Mobile recovery states：Threads/Runs/Chat Hub/API 失败态改为上下文内恢复卡，`visual:qa` 覆盖 mocked 503 截图
- [x] Mobile Android native API bridge emulator 复验：重建安装 APK，真实 WebView 无 CSP/CORS blocker，恢复态截图已更新
- [x] Mobile Hub reachability split：Threads/Runs 在 `/health` 可达时显示 Reachable，把 workflow JSON 同步失败留在恢复卡而不是误判 Offline
- [x] Mobile Desktop-style glassmorphism：移除 Mobile CSS 显式渐变铺底，对齐 Desktop 玻璃面板 token，核心列表/详情/Settings surface 改为 rgba + blur/saturate + 细边框 + 状态色 rail/chip
- [x] Mobile Settings i18n 扩展：Settings readiness/account/notification/about、native action status/retry、clear-session confirmation sheet 已接 i18n，中文截图覆盖首屏无英文残留
- [ ] Mobile Hub workflow API/session contract：对齐部署态 Hub JSON 路由，避免当前 `/v1/*` 空 `text/plain 200` 让 Threads/Runs 保持 recovery state
- [ ] Mobile 真实 Android emulator 复截 approval/diff + 结构化 run blocks
- [ ] **禁止修改** `app/desktop/src-tauri/` 下任何文件

### 后端（我负责）
- [x] AT-3：Supervisor 路由决策解析 + guardrails（仓内已收口）
- [x] AT-2 补全：TeamEvent 持久化 + TeamRunState replay（仓内已收口）
- [x] #173 状态确认（GitHub issue closed 2026-05-25T13:18:51Z）
- [x] 生产部署验证（2026-05-29 已用 no-server-build tar/load/recreate 流程部署 `f0894ea`，AH-SR-027 runtime event cap、磁盘/资源/CORS/health 已验证）

### 共享端口与资源
| 资源 | Desktop | Mobile |
|------|---------|--------|
| Tauri 项目 | `app/desktop/src-tauri/` | `app/mobile/src-tauri/` |
| Vite 端口 | **5173** | **5174** |
| Rust crate | `agenthub-desktop` | `agenthub-mobile` |
| 前端共享 | `app/shared/` (`@agenthub/shared`) | 同左 |

### 分支与质量
- 分支：`dev/delicious233`（唯一事实源）
- Hub: 13/13 ✓ | Edge: 16/16 ✓（含新增 skills 包）
- `feat/* → dev/delicious233 → master`
- 小步 commit + push，跨方向改 API 先开 draft PR

## 快速上手

```bash
git clone https://github.com/TokenDanceLab/AgentHub.git
cd AgentHub
git checkout dev/delicious233
```

### 运行后端测试
```bash
cd edge-server && go test ./... -short -count=1   # 13/13 包
cd ../hub-server && go test ./... -short -count=1  # 13/13 包
```

### 运行前端测试
```bash
cd app/desktop && pnpm typecheck && pnpm test:ci
cd app/web && corepack.cmd pnpm typecheck && corepack.cmd pnpm exec vite build
```

Web 单元回归可先跑 `cd app/web && corepack.cmd pnpm test -- src/utils/hubAdapters.test.ts`。当前 `vite build` 通过；根/wrapper `pnpm build` 如在 Windows Node/libuv lifecycle 上异常，按既有工程债单独处理，不等同于 Vite 构建失败。

### 前端 TypeScript 检查
```bash
cd app/desktop && pnpm typecheck    # 生产源码检查；测试文件 strict index/optional 债不作为本轮 release gate
```

### Storybook
```bash
cd app/desktop && pnpm storybook    # http://localhost:6006
```

## 三层架构

```
Desktop (React 19 + Tauri) → Edge Server (Go, :3210) → CLI Agents
                           → Hub Server (Go, :8080) → PostgreSQL + Redis
```

| 层 | 技术栈 | 测试 | 关键特性 |
|---|------|:--:|------|
| **Desktop** | React 19, TypeScript, Zustand, TanStack Query, OKLCH tokens, CSS Modules | CI-safe Vitest；全量 edge-real/lint 仍有既有债 | viewRegistry, @shared/ui, Storybook, RunState 状态机, IM UI, AuthPage, 虚拟滚动 |
| **Edge** | Go, gorilla/websocket, NDJSON | 13/13 包 | 3 Adapter (Claude/Codex/OpenCode), Prometheus, event bus dropped counter, Orchestrator, E2E 19/19 API |
| **Hub** | Go, Gin, GORM, Redis, PostgreSQL | 13/13 包 | DI 架构, CORS→BodyLimit→RateLimit 链, 28 migrations, 公开 API |

CI 说明：Go lint 已迁移到 golangci-lint v2 配置，gosec 已切到当前 `github.com/securego/gosec/v2` 模块路径；当前 Edge/Hub 仍有既有 lint/gosec 债。Actions 中 lint/gosec 作为可见债务步骤运行，build/test/race/govulncheck/coverage 仍是硬阻断。

## 生产部署

| 服务 | URL | 位置 |
|:--|:--|:--|
| 官网 | https://hub.vectorcontrol.tech | nginx → agenthub-home/out/ |
| Hub API | http://api.hub.vectorcontrol.tech | nginx:80 → Docker `127.0.0.1:8090` |
| Hub 代码 | `/opt/agenthub-hub/` (dev/delicious233) | Docker Compose |

详细部署记录：`.ops/deployment-record.md`（本地，不入仓库）

## 当前进度

### 已完成批次
- **P0-P3**：Edge/Desktop 基础功能
- **M3b-M4**：AgentHook, 消息树, 安全管道, Hub 骨架
- **M5**：工程基础收敛（62 commits）
- **M6**：生产部署（Docker, nginx, Cloudflare DNS）
- **M7**：Desktop P0 打磨（TanStack Query + Zod + 虚拟滚动 + 心跳）

### 关键里程碑
- ✅ Hub DI 5 阶段完成（全局单例删除）
- ✅ Desktop P0 全部完成
- ✅ Edge↔Hub 3层 E2E 打通
- ✅ Repository 测试 0%→75.5%
- ✅ 生产部署（独立 PG/Redis，与 AIhub 隔离）
- ✅ 官网 Hub API 集成
- ✅ Desktop 卡片式 UI 重构（左导航 + 中间主卡片 + 右侧面板）
- ✅ 无边框 Tauri 窗口 + One Dark Pro 暗色主题
- ✅ i18n 跟随系统语言（navigator.language）

### 本轮进展（2026-05-25）

**后端 B10 批次（2026-05-25 晚间，19 fix，3 Team 并行）**：
- Hub Core Service（5 commits）：#154 session last_message_at + #132 过期扫描含 running + #159 备注可清空 + #120 UpdateRemark 404 + #157 消息搜索过滤 + #122 私聊好友校验
- Agent + Edge Callbacks（3 commits）：#130 stream 去重 + #109 生命周期强制 + #99 离线 dispatched + #137 队列失败日志 + #179 NDJSON 失败终止 + #177 CLI LookPath + #108 cancel 响应对齐
- WS + Auth + Middleware（1 commit）：#178 WS 多设备路由 + #96 撤回原 session + #93 已读序列前进 + #88 typing 成员校验 + #78 DeleteForMe 缓存 + #82 WS 认证对齐
- 测试：hub-server 13/13 + edge-server 15/15 全绿，race detector 通过
- 19 issue 已关闭；后续 5 个纯后端 issue（#145 #142 #138 #173 #105）已在 2026-05-25 至 2026-05-27 批次收口。

- Desktop：项目文档后台 sweep 已完成，`docs/architecture/system-architecture.md` / `docs/architecture/product-requirements.md` / `docs/architecture/implementation-guide.md` / `docs/roadmap.md` / README 系列 / archive + ADR 索引已统一 Runtime/Profile/Configuration/Execution Target、TokenDance ID、Hub/Edge/Desktop/Web 边界。
- Desktop：设置页按 Codex App 截图方向重构为全屏设置工作台，并新增任务列表、IM 群聊、Agent 调度、在线 IM、Agent 市场、Skill/MCP、模型配置、模型映射、cc-switch、多端、远控、账号鉴权和安全审计等一等入口；顶部快捷图标可直达任务列表和 Agent 调度分区。
- Desktop：Settings 已新增 `Agent Profiles` 与 `Execution Targets` 两个一级页面，把用户概念明确拆成 Agent Profile（Runtime + Model + Configuration）和 Execution Target（Local Edge / Hub Relay / SSH/Tailscale / Cloud Edge）；页面直接消费 `useHealth()` 与 `useAgentList()`，`HealthResponse`/Zod schema 已保留 `/v1/health.checks.runners` 扩展字段，Connections 页同步显示 Edge runner summary。
- Desktop/Hub/Web：TokenDance ID 登录入口已作为账号体系主入口进入登录页和 Settings/账号页；Hub Server 已实现 `POST /client/auth/oidc/authorize` + `/callback` 的 code exchange、ID token JWKS 校验、`tokendance_sub` 映射和 Hub access/refresh session 签发。Web 已接入浏览器 PKCE redirect callback：授权时可传本轮 `redirect_uri`，Hub 将其绑定到 state 并用于 token exchange，Web 回跳 `/auth/tokendance/callback` 后用 sessionStorage 中的 verifier 换 Hub session。Desktop 代码路径已接系统浏览器、本机回调捕获与 Hub OIDC exchange；Tauri 打包路径使用系统凭据存储 Hub session，浏览器开发 fallback 已收敛到 tab-scoped sessionStorage 并清理 legacy localStorage Hub token key。发行版登录、logout/reconnect 与截图证据仍需闭环。
- Web/Desktop fallback：Web Hub access/refresh token 和 token-source hint 已从持久 `localStorage` 收敛到 tab-scoped `sessionStorage`，并会在 load/save 时清理旧 `agenthub_hub_token`、`agenthub_hub_refresh_token`、`agenthub_token_source`；Desktop 非 Tauri 浏览器开发 fallback 也不再把 Hub access token 写入 `localStorage`。这只是浏览器端风险降级，公开 Web 发布前仍需 BFF/HttpOnly cookie 或等价 server-owned session 方案。
- Web：主工作区发送链路已从 `edgeClient` stub 切到 Hub session/message/task。Threads 面板读取/创建 Hub sessions；Hub 允许创建 owner-only group session 作为 Web workspace 会话，Workspace 空态发送或选 Agent 时可按需创建该会话，再写入 Hub message、邀请 Agent、通过 `/web/agent-tasks` 触发 Hub→Desktop/Edge `agent.dispatch`；取消走 `/web/agent-tasks/{id}/cancel`。浏览器仍不持有 Relay key，也不直接调用 Edge。
- Desktop/Edge/Hub：2026-05-26 Runtime bridge 输出回传已补齐。Desktop App 根部挂载 `DesktopHubTaskBridge`，先恢复/获取 Hub-issued access token，再开启 Hub WS 并调用 `useHubIntegration` 监听 `agent.dispatch`/`agent.cancel`；bridge 将 Hub task 转成 Local Edge `POST /v1/runs`，把 stdout `run.output.batch` 与结构化 `run.agent.*` 作为 `event_type + payload` 回传 Hub stream，并用有界可见输出缓存生成 `done.final_content`。Edge direct callback 模式也会在 `hubTaskId` 存在时 stream raw stdout/结构化文本，并用真实输出而非状态字符串作为 done 内容；Hub callback chunk 切分保持 UTF-8 完整。
- Desktop/Web/Hub：2026-05-26 Hub dispatch 真实启动 payload 已补强。Hub `agent.dispatch` 会把触发消息文本作为 `prompt` 下发；`/web/agent-tasks` 支持按 `agent_type` / `agent_instance_id` / `custom_agent_id` 指定目标，不再在用户已选择 Runtime 时静默回退到第一个 agent；Web 会把 Hub Agent Profile 的 `runtime_id`、model/provider/reasoning hint 传给 Hub，自动邀请 Claude Profile 时使用 Edge adapter id `claude-code`；Desktop bridge 会把 legacy `claude` 规范化为 `claude-code`，并在启动 Local Edge run 前先创建/复用 Hub session 对应的 Edge thread，避免真实 Web→Hub→Desktop→Edge 链路空 prompt、未知 agentId 或 thread 404。Web Hub-only fallback 不再把 mock runner 计为 Local Edge ready。
- Hub/Web/Desktop/Edge：2026-05-26 Agent Profile runtime config bridge 已补齐仓内链路。Hub 合并 CustomAgent 默认 `model_params` 与触发时 model params，Web AgentProfile 会把 `permission_mode`、`tool_allowlist` 和 `target_preferences.work_dir` 投影到 task trigger，Desktop bridge 会把 Hub `model_params` / `system_prompt` / `tool_whitelist` 翻译为 Edge `/v1/runs` 的 `model`、`reasoningEffort`、`thinkingMode`、`permissionMode`、`workDir`、`includePartial`、`systemPrompt`、`appendSystemPrompt`、`allowedTools`、`configOverrides` 和 `ephemeral`，Edge API/ProcessExecutor 继续传入 adapter `RunProcessContext`。这证明 Profile 配置能进入 Codex/Claude Code/OpenCode 启动参数；仍不等同于远程 Edge workspace allowlist 或完整阻塞式 HITL。
- Web：2026-05-26 Web Hub/Local Edge 边界已加结构 gate。`app/web/src/hooks/useHubIntegration.ts`、`api/eventClient.ts`、`hooks/useEventStream.ts`、旧 `useChatMessages.ts`、`useRunners.ts` 等未接主入口的直连 Edge 遗留面已删除；`scripts/verify-web-hub-boundary.ps1` 会阻断 Web 源码出现 `/v1/runs`、`/v1/events`、`127.0.0.1:3210`、`createEventStream` 或 `edgeBaseUrl`。验证通过 `.\scripts\verify-web-hub-boundary.ps1`、`app/web && corepack.cmd pnpm typecheck`、`app/web && corepack.cmd pnpm build`。
- Desktop/Edge：2026-05-26 Runtime readiness gate 已补齐。`scripts/verify-runtime-readiness.ps1` 只做 secret-free 结构检查，覆盖 AgentAdapter、Claude Code/Codex/OpenCode adapter、Edge env/profile/API、Desktop Settings runtime inventory、Web Hub-only stub 边界和文档 caveat；它不执行真实 CLI、不读取 CLI auth，不替代三大 Runtime live smoke。
- Desktop/Edge：2026-05-26 三大 Runtime live smoke 已完成。`scripts/integration-smoke.ps1 -SkipBuild` 分别用 Codex、Claude Code、OpenCode 真实 CLI 在隔离端口启动 Edge，均收到结构化 `run.agent.*` 事件并 `run.finished`；本轮同时修复 `scripts/client-smoke.ps1` 的真实 runId cancel 顺序，mock Edge client smoke 19/19 通过。
- Desktop：2026-05-26 权限决策前端路径已收紧。`useChatMessages` 不再发送 Edge 当前会丢弃的 WebSocket `permission_decide` 控制帧；App 使用 pending permission request 自带 `runId` 调 `/v1/permissions/decide`，REST 成功后才标记本地决策。当前仍未声称完成真正阻塞式 human-in-the-loop；Claude Code stdin can_use_tool 回写和远程 Edge 决策证明仍是后续安全闭环。
- Web：2026-05-26 Hub 主聊天已能把 Desktop/Edge bridge 写入 Hub `message.new` 的 runtime payload JSON 渲染为结构化块。`app/web/src/utils/hubAdapters.ts` 会把 `callId/toolName/input` 转成 tool block、`path/action/diff` 转成 file change block、`success/error/usage` 转成 result block；普通文本和普通 JSON 仍按文本显示，避免把 Hub 消息误解析为工具事件。
- Web/Desktop：2026-05-26 Hub REST envelope 已在两端 client 层对齐。Hub handler 统一返回 `{code,data,message}`；`app/web/src/api/hubClient.ts` 与 `app/desktop/src/api/hubClient.ts` 现在会解包 `data`、兼容旧裸 JSON mock，并把 Hub error envelope 转成 `AppError`，避免 TokenDance ID login、`/client/auth/me`、sessions/messages/profile 等生产响应被当成裸对象读取。Web Agent 列表登录后读取 Hub `GET /web/agent-profiles` 并映射成 Agent Profile；无 Hub token 时才保留显式 preview fallback。
- Web：2026-05-26 Hub-only boundary 已收紧。浏览器端删除旧 Local Edge `eventClient`、`edgeAuth`、`useHubIntegration`、`useChatMessages`、Local Edge status/event/runners hooks，权限弹窗类型迁到 `app/web/src/types/permissions.ts`；新增 `scripts/verify-web-hub-boundary.ps1` 并接入 runtime readiness，阻断 `app/web/src` 重新出现 Local Edge loopback、`/v1/runs`、`/v1/events` 或 Desktop-only Hub-Edge bridge。
- Hub：2026-05-26 Hub session boundary 已收紧。新增 `RequireHubSession()`，并把 `/client/auth/me`、contacts、sessions/messages、attachments、notifications、`/web/*`、`/edge/*` 串到 Hub-issued session gate；TokenDance ID bearer 只作为 identity compatibility 被识别，不能直接授权 Hub 产品 API、设备路由或 Web task dispatch。
- Desktop/Web/Hub：2026-05-26 Hub WebSocket 鉴权已对齐真实 `/client/ws` 路由。Hub 路由在 HTTP upgrade 前通过 `WSAuthMiddleware` 只接受 Hub-issued HS256 access token；Desktop/Web `createHubWS` 现在把当前 Hub session token 放入 `access_token` query，并在重连时刷新 URL。`hub-server/internal/handler/ws_test.go` 覆盖 Hub-local query token 能注册 WebSocket session，TokenDance bearer 仍在 upgrade 前拒绝。
- Web/Hub：2026-05-26 Web fallback 登录设备边界已对齐。`app/web/src/api/hubAuth.ts` 的账号密码 fallback 改为请求 `device_type=web`，避免浏览器会话误标为 Desktop；OpenAPI 已把 `/client/auth/login` 的 `device_type` 和 UUID `device_id` 标为必填，Web Vitest 覆盖该 payload。
- Desktop/Web：2026-05-26 客户端 `agenthub_device_id` 持久值已增加自修复。`app/desktop/src/api/deviceId.ts` 与 `app/web/src/api/deviceId.ts` 会复用/规范化 UUID，发现旧版 `desktop_*` 或其他非 UUID 值时立即生成新 UUID 并覆盖，避免 TokenDance ID/Hub login 在 handler UUID 边界被 400 拦下。
- Web：`app/web/tsconfig.json` 已恢复 `strict: true`、`strictNullChecks: true`、`noUncheckedIndexedAccess: true` 与 `exactOptionalPropertyTypes: true`；已清理 Web/shared optional DTO、Hub/IM adapter、permission、composer、Settings 与 private chat 的 exact optional 形状，当前 `corepack pnpm typecheck` 与 `corepack pnpm build` 通过。
- Web：暗色 Web shell 已按 Codex App 纯色深灰目标收敛：遵循 `codex-theme-v1` 的 `surface=#25252d`、`ink=#e3e4e6`、`accent=#5d68cc`，移除 `app/web/src` 内全部 `linear/radial/conic-gradient` 与 gradient mask；composer 直接复用 Desktop 单层 capsule 的宽度、字号、边框、blur 和低阴影结构，移除 Web 额外 goal/card 堆叠，空态建议项改为低噪 inline chips。Playwright 桌面/移动 smoke 覆盖运行时 0 个 gradient 节点、无 raw i18n key、无横向溢出、无 console error；截图证据保留为本地 ignored 产物，不纳入 Git。
- Desktop：左栏概念从“智能体/能力 chips”改为 `Agent Runtime`，不再把“流式输出/工具调用/文件修改”等基础能力当产品主概念；Runtime 卡片展示本地 Edge + CLI adapter 元信息，基础 capability 仅保留在协议/后端层。
- Desktop：App shell 已支持左侧栏折叠、右侧运行详情彻底关闭、左右栏宽拖拽 resize。真实 run 验证中，右侧运行面板展开宽度 360px，关闭后完全不占空间，主工作区从 640px 扩展到 1012px；两条 resize separator 可见。
- Desktop：移动端工具栏已补 Settings、Hub 登录、主题切换与菜单入口；375px Playwright 验证无横向溢出。
- Desktop：`useChatMessages` reducer 内的 runStore/queryClient 副作用已移到事件处理路径，修复 React “setState while rendering” console error；合法 `RUNNING/STREAMING/WAITING_FOR_INPUT -> COMPLETED` 不再输出误报 warning。
- Desktop：真实接口验证 `http://127.0.0.1:3210/v1/health` ok，`POST /v1/runs` 返回 202 accepted；右栏关闭/重开、Settings 任务/群聊/调度入口、i18n raw key、移动端布局均通过 Playwright 检查，截图见 `app/desktop/screenshots/shell-right-panel-real-run-closed.png`、`app/desktop/screenshots/settings-tasks-im-scheduling.png`。
- Web：~~已派 gpt-5.5 xhigh worker `Hegel` 在独立 worktree `D:\Code\TokenDance\AgentHub\.worktrees\webui-desktop-port` / `feat/webui-desktop-port` 推进 Web UI 移植，硬约束 TokenDance ID、设备/Hub 同步、在线 IM/群聊、任务列表、Agent 调度、市场、Skill/MCP、模型映射、cc-switch、远控与审计入口。~~ (分支已于 2026-05-25 清理；Web UI 路线保留 `dev/trump` 分支)
- Web：gpt-5.5 xhigh 只读审查 `Ampere` 已完成，审查修复（移动端溢出、Toggle 语义/触控）已合入主线。分支及 worktree 已于 2026-05-25 删除，无需合并。
- Desktop/shared：`app/shared/pnpm-lock.yaml` 已同步 `@types/react`、`@types/react-dom`、`typescript` 等已声明 dev dependency；此前 `pnpm exec tsc --noEmit` / Desktop build 受 shared React 类型 lockfile 过期阻塞的问题已解除，`app/desktop && pnpm build` 已通过。
- Desktop：新增验证已通过 Settings `Agent Profiles` / `Execution Targets` Playwright 桌面和 375px 移动端检查：无 console error、无 raw i18n key、无横向溢出；截图见 `app/desktop/screenshots/settings-agent-profiles.png`、`app/desktop/screenshots/settings-execution-targets.png`、`app/desktop/screenshots/settings-execution-targets-mobile.png`。Web worktree 验证已通过 `corepack.cmd pnpm exec vitest run src/pages/ecosystem/EcosystemConsole.test.tsx`、`corepack.cmd pnpm typecheck`、`corepack.cmd pnpm build`，移动端复测 `docScrollWidth=375`、switch `52x44`、无 console error，截图见 `.worktrees/webui-desktop-port/app/web/screenshots/ecosystem-console-mobile-fixed.png`。
- Desktop：run 启动反馈已继续推进。`AppError` 现在保留 HTTP status，并把 Edge 409 `active_run_exists` 顶层 `runId` 归入 `details.runId`；`PromptInput` 支持 async send result，只有 Edge 接受 run 后才清空草稿；启动中会禁用输入/重复提交；409 时打开现有 run、显示 toast，并保留未接受的草稿。
- Desktop：Toast 容器已挂回 App shell。此前 toast store 会写入但页面不可见，导致 `active_run_exists`、复制、连接状态等通知无法显示；本轮已修复。
- Desktop：新增验证已通过 `python -m json.tool src/i18n/locales/{en,zh}.json`、`pnpm vitest run src/__tests__/errors.test.ts src/__tests__/PromptInput.test.tsx src/__tests__/Toast.test.tsx`（42/42）；Playwright 模拟 Edge 409 覆盖草稿保留、toast 可见、无横向溢出，截图见 `app/desktop/screenshots/run-start-active-conflict.png`，当前页面截图见 `app/desktop/screenshots/run-start-feedback-desktop.png`。
- Desktop：Settings `Tasks` 已从预留 surface 接入真实数据面。任务页现在通过 `useRuns()` 展示 Local Edge run 总数/active 数、最近 run，通过 `useTaskBridgeStore` 展示 Hub dispatch bridge task 总数/active 数和桥接队列，并保留审批队列入口。
- Desktop：Tasks 验证已通过 `pnpm vitest run src/__tests__/SettingsPage.test.tsx src/__tests__/PromptInput.test.tsx src/__tests__/errors.test.ts src/__tests__/Toast.test.tsx`（43/43）、`python -m json.tool src/i18n/locales/{en,zh}.json`、`git diff --check`；Playwright 桌面和 375px 移动端检查无横向溢出、无 raw i18n key，截图见 `app/desktop/screenshots/settings-tasks-real-runs.png`、`app/desktop/screenshots/settings-tasks-real-runs-mobile.png`。
- Desktop：已修复 Playwright 暴露的重复 terminal run event 噪声。`RunStateMachine.transition()` 现在把同状态 transition 视为幂等 no-op，重复 `run.finished` / WebSocket replay 不再输出 `COMPLETED -> COMPLETED` warning；真实 Settings Tasks 桌面和 375px 移动端复测 `logs: []`，截图见 `app/desktop/screenshots/settings-tasks-runstate-idempotent.png`、`app/desktop/screenshots/settings-tasks-runstate-idempotent-mobile.png`。
- Desktop：Settings `Agent Scheduling` 已从预留 surface 接入真实调度概览。页面复用 `useRuns()`、`useTaskBridgeStore`、`useAgentList()`、`useHealth()` 和设置开关，展示调度队列、Agent Profile、Execution Target readiness、模型映射/cc-switch/远控/审批策略输入；Local Edge readiness 以 Edge 在线为准，runner inventory 缺失只影响指标文字。
- Desktop：Agent Scheduling 验证已通过 `pnpm vitest run src/__tests__/SettingsPage.test.tsx src/__tests__/PromptInput.test.tsx src/__tests__/errors.test.ts src/__tests__/Toast.test.tsx`（44/44）、`python -m json.tool src/i18n/locales/{en,zh}.json`、`git diff --check -- app/desktop/src/...`；Playwright 桌面和 375px 移动端检查 `logs: []`、无 raw i18n key、无横向溢出，截图见 `app/desktop/screenshots/settings-agent-scheduling-real-data.png`、`app/desktop/screenshots/settings-agent-scheduling-real-data-mobile.png`。
- Desktop：Settings `Agent Market` 已从预留 surface 接入本地真实 Profile 与发布准备视图。页面复用 `useAgentList()`、TokenDance ID 登录状态和 Agent capability 字段，展示本地 Agent Profile 数、可发布 Profile、能力覆盖、Hub 发布状态、已安装 Profile 卡片和发布审核清单。
- Desktop：Agent Market 验证已通过 `pnpm vitest run src/__tests__/SettingsPage.test.tsx src/__tests__/PromptInput.test.tsx src/__tests__/errors.test.ts src/__tests__/Toast.test.tsx`（45/45）、`python -m json.tool src/i18n/locales/{en,zh}.json`、`git diff --check -- app/desktop/src/...`；Playwright 桌面和 375px 移动端检查 `logs: []`、无 raw i18n key、无横向溢出，真实页面读到 OpenCode / Claude Code / Codex 三个本地 Profile，截图见 `app/desktop/screenshots/settings-agent-market-real-profiles.png`、`app/desktop/screenshots/settings-agent-market-real-profiles-mobile.png`。
- Desktop：Settings `Skill Management` 已从单行路径接入项目级 Skill registry 概览。页面基于当前 `.agents/skills/*/SKILL.md` 快照展示 7 个仓库级 Skill、6/7 可审核状态、1 个含脚本 Skill、1 个 references Skill、Hub sync 边界和脚本审计入口。
- Desktop：Skill Management 验证已通过 `pnpm vitest run src/__tests__/SettingsPage.test.tsx src/__tests__/PromptInput.test.tsx src/__tests__/errors.test.ts src/__tests__/Toast.test.tsx`（46/46）、`python -m json.tool src/i18n/locales/{en,zh}.json`、`git diff --check -- app/desktop/src/...`；Playwright 桌面和 375px 移动端检查 `logs: []`、无 raw i18n key、无横向溢出，截图见 `app/desktop/screenshots/settings-skill-registry-real-data.png`、`app/desktop/screenshots/settings-skill-registry-real-data-mobile.png`。
- Desktop/Edge 注意：当前 live Edge `http://127.0.0.1:3210` health 和 agents 在线，返回 Claude Code / Codex / OpenCode；此前真实连续双 POST 到 `thread_local` 观测到两个 202。2026-05-25 已用临时 Edge `127.0.0.1:3227` + 可控慢 `powershell Start-Sleep` runner 复现真实 HTTP 路径 first 202、second 409 `active_run_exists`，且 409 body 带回首个 active `runId`；先前 3210 现象更可能是旧进程或真实 runtime 过快完成。
- Docs：gpt-5.5 xhigh 文档架构 worker 已完成文档架构审查，结论已汇总到 roadmap/STATE；`docs/inbox/` 仍保留为临时投递入口，已处理报告归档到 `docs/reference/` 或 `docs/archive/`。主文档已基本对齐 Runtime/Profile/Configuration/Execution Target、TokenDance ID、IM、多端、远控、Skill/MCP、cc-switch、安全审计等边界；剩余风险集中在 `/v1/runners` / `runner.*` 的历史兼容命名，以及 `docs/archive/client-handoff.md`、`docs/roadmaps/integration.md` 等旧独立 `runner/` 文档需要归档或改写。
- Web：~~gpt-5.5 xhigh Web worker 已在 `.worktrees/webui-desktop-port/app/web` 内补强生态控制台。~~ (worktree 已随分支清理；`app/web/README.md` 已说明 `/` 生态控制台、`/workbench-preview` 旧工作台、TokenDance 生态边界和验证命令；`EcosystemConsole` 新增身份边界、协作同步、Agent runtime、运维护栏等入口，并补响应式 lane 布局和测试。验证通过 `corepack.cmd pnpm exec vitest run src/pages/ecosystem/EcosystemConsole.test.tsx`（4/4）、`corepack.cmd pnpm typecheck`、`corepack.cmd pnpm build`、`git diff --check -- app/web`。)
- Web：~~gpt-5.5 xhigh worker `McClintock` 已继续在 `.worktrees/webui-desktop-port/app/web` 内新增 `Feature readiness` 面板~~ (worktree 已随分支清理)。验证通过 `corepack.cmd pnpm exec vitest run src/pages/ecosystem/EcosystemConsole.test.tsx`（5/5）、`corepack.cmd pnpm typecheck`、`corepack.cmd pnpm build`、`git diff --check -- app/web`。
- Web：~~gpt-5.5 xhigh worker `Herschel` 已继续在 `.worktrees/webui-desktop-port/app/web` 内新增移动端/平板 `Jump to surface` picker~~ (worktree 已随分支清理)。验证通过 `corepack.cmd pnpm exec vitest run src/pages/ecosystem/EcosystemConsole.test.tsx`（6/6）、`corepack.cmd pnpm typecheck`、`corepack.cmd pnpm build`、`git diff --check -- app/web`。
- Hub：`CancelTask` 已通过 `AgentInstance` 解析真实 `SessionID` 后发布 `agent.cancel`，避免把 `AgentInstanceID` 误作为 `session_id`；回归测试 `TestCancelTaskPublishesResolvedSessionID` 已覆盖。
- Hub：auth middleware 测试已适配 `AuthMiddleware(*config.Config)` 签名，当前 HEAD `19fcaa1` 已包含该修复。
- Hub：Agent 任务回调链新增服务层回归测试，覆盖 `HandleTaskStream` 生成 `client_msg_id`、走 Redis seq、发布 `message.new`，以及 `HandleTaskDone` 在 Redis 失败时走 DB fallback、写最终消息并发布 `agent.done`。
- Hub：WebSocket 慢客户端背压路径新增 `TestManagerPushToConnCountsDroppedFrames`，验证 send buffer 满时 `ws_dropped_frames_total` 递增；`writeLoop` 退出路径统一 defer close，覆盖正常结束、写失败和 panic recovery。
- Hub：`UpsertDevice` 已改为按 `device_id` 冲突更新，`devices(user_id, device_type)` 降为非唯一索引；同用户同设备类型可拥有多个物理设备，跨用户或跨类型复用同一 `device_id` 会被拒绝为客户端错误。`TestDeviceRepo_Upsert` 已覆盖同物理设备更新、同用户同类型新增第二设备、跨用户抢占拒绝。
- Hub：联系人列表和收到的好友请求已补批量查询回归测试，覆盖多条记录只走一次 `WHERE id IN` 用户查询；好友请求 sender 缺失时记录 debug 并跳过坏数据，不阻断其他请求。
- Hub：`CustomAgent` 的 jsonb 字段从“只校验 JSON 语法”收紧为结构校验：`capability_tags`/`tool_whitelist` 必须是 JSON array，`model_params` 必须是 JSON object；handler 创建/更新前预检，model hook 保存前兜底。
- Hub：P3-2 魔数常量化已完成，request/body/timeout/rate-limit/message recall/pin limit/WebSocket heartbeat/EventBus pool/metrics interval/group name length 等默认值统一收敛到 `internal/config/constants.go`；WebSocket send buffer 保持现有运行值 256。
- Hub：Hub dispatch bridge 已持久化 `taskId` -> Edge `runId` / `edge_device_id` 映射；`pending_agent_tasks.edge_run_id` 与 `edge_device_id` 分别绑定 Edge run 和具体 Desktop device，`/edge/agent-tasks/{id}/ack|stream|done|fail` 支持 `run_id`/`edge_run_id`，Desktop `useHubIntegration` 在 ack、stream、done、fail 回调中持续回传 Edge run id。
- Hub：`AH-SR-020` Edge callback device/run proof 已 repo 内缓解。在线 dispatch 和离线 pending replay 都会在推送到具体 Desktop WS conn 时记录 `edge_device_id`；route 存在但 manager/conn 不可用时回落 pending queue，不误标 dispatched；service、handler、真实 HTTP 集成和 Desktop Vitest 已覆盖错误 user/device/run id 拒绝与 run_id 转发。
- Hub：`/client/auth/login` 和 `/edge/devices/register` 已在 handler 层校验 `device_id` 为 UUID，非法值返回 `BAD_REQUEST` 且不会进入 service/repository；`AH-SR-019` 已标记为 repo 内缓解并通过临时 Postgres/Redis 的真实登录/设备注册集成验证，剩余是部署与客户端覆盖验证。
- Hub：多设备登录已对齐真实 Postgres schema。迁移 `0021_devices_allow_multiple_same_type` 将 `(user_id, device_type)` 唯一约束改为普通索引，`/client/auth/login` 支持同用户两个 desktop UUID 分别登录并刷新 token；另一个用户复用已归属 `device_id` 返回 `BAD_REQUEST`，不再冒泡为 `INTERNAL_ERROR`。
- Hub：`AH-SR-022` message pin 跨 session 泄露已 repo 内缓解并由 DB 复合外键固化。`PinMessage` 创建 pin 前要求目标 message 属于当前 session，`ListPinnedMessages` 只在当前 session 范围 hydration pinned message；migration `0039_message_pins_session_fk` 清理历史坏 pin 后增加 `message_pins(session_id,message_id)` -> `messages(session_id,id)`，临时 Postgres/Redis 集成测试已覆盖跨 session pin API 拒绝与 DB 拒绝历史坏 pin。
- Hub：`AH-SR-021` attachment 共享已 repo 内缓解。新增 `message_attachments` 引用表，file message 发送时抽取并校验 UUID attachment 引用，发送者必须是 uploader 或已有会话引用授权；下载允许 uploader 或引用所在 session 的 active user member，局外人保持 `ATTACH_NOT_FOUND`。真实 Postgres/Redis 集成已覆盖 Alice 上传并发送 file message 后 Bob 下载成功、局外人下载失败。
- Hub：`AH-SR-010` Redis/cache nil 行为已 repo 内缓解。Auth/Contact/Session/Message/Agent 构造器和方法统一经 `resolve*Cache` 处理 nil 与 typed-nil cache；测试/离线路径使用 no-op/fallback cache 避免 panic，Message/Agent seq 仍走 DB fallback；生产 `App.Run` 仍保留 Redis ping fail-fast。
- Hub：`AH-SR-008` dev compose 暴露面已 repo 内缓解。`docker-compose.yml` 默认通过 `AGENTHUB_BIND_HOST=127.0.0.1` 只把 PostgreSQL、Redis、Hub API、Hub admin/metrics 绑定到本机回环；远程开发需要显式设置 `AGENTHUB_BIND_HOST=0.0.0.0`，生产 compose 保持内部网络/loopback 发布。
- Hub：`AH-SR-011` public stats 精确计数暴露已 repo 内缓解。`/api/public/stats` 保留官网所需的公开无认证入口和原字段名/数字类型，但 user/agent/message/online 计数改为下限桶，uptime 改为 `<1h`/小时/天/`30d+` 粗粒度桶。
- API：`api/openapi.yaml` 已补 `/edge/agent-tasks/{id}/ack` request body、`HubTaskAckRequest`、`/edge/devices/register` 请求体，并把 `/client/auth/login` 的 `device_id` 标为必填 UUID；YAML 解析和重复 key 检查已通过。
- Edge：event bus 慢订阅者丢弃 fanout 时累计 `DroppedCount()`，Prometheus 新增 `edge_event_bus_dropped_total`，`httpserver` 已接入真实 bus 统计。
- Edge：修复 lifecycle 测试 helper 固定 `run_test` 导致的 Windows 临时输出日志抢锁，改为 per-test 唯一 run/project/thread ID。
- Edge：`CreateProject` 已通过 `ErrProjectExists` 区分新建/已存在；API 新建返回 201 并发布 `project.created`，重复创建返回 200、保留原项目名称且不重复发布 created 事件。
- Edge：`POST /v1/runs` 已实现每 thread 一个公开 active run，命中 `queued`/`started`/`cancelling` 时返回 409 `active_run_exists` 和现有 `runId`；Store 继续允许同 thread 多 run，保留 orchestrator sub-agent 内部创建能力；executor 启动失败会把 queued run 标记为 `failed`，避免重试被永久 409 卡住。
- Edge：Run 清理已接入 `RunCleaner`/`CleanupRuns`，只清理 terminal run（`finished`/`failed`/`cancelled`），支持 24h terminal TTL 和每线程 50 条 terminal run 上限，连带删除关联 run item；FileStore 清理后持久化快照；`POST /v1/runs` 在 active-run 检查前做保守清理，不影响 `queued`/`started`/`cancelling` active run。
- Edge：Orchestrator prompt 模板转义已确认落地，`NewOrchestratorAdapter` 和 `formatAgentList` 统一通过 `escapePromptLiteral` 处理 backtick 与 `${}`；Edge P2 常量提取已收口，adapter scanner buffer 统一到 `configureAdapterScanner`，event bus 测试改用 `subscriberChannelBufferSize`。
- Edge：`/v1/health` 的 runner 检查已暴露 `total`、`available`、`unavailable`、`statuses`、`items`，无 registry、无 runner 或全离线时整体降级为 `degraded`，方便客户端和运维区分“没有 runner”和“runner 离线”。
- Edge：真实 Codex-profile smoke 已通过。临时启动 `agenthub-edge --addr 127.0.0.1:3221 --runner-profile codex` 后，run `run_22b2112afb09060a` 从 `queued`/`started` 到 `finished`，WebSocket replay 捕获 `run.agent.text_block: OK`、`run.agent.result`、`run.finished`，证明 Codex CLI -> Edge adapter -> event bus -> WS 链路可用；临时 3221 服务已关闭。
- Edge：修复真实 runtime executor 下 `/v1/runners` 误报默认 Mock Runner 的问题；adapter executor 会把 `runner_local_1` 覆盖为 `<Runtime> Runner (local)`。带补丁的临时 Codex Edge 验证 `/v1/runners` 和 `/v1/health.checks.runners` 均显示 `Codex Runner (local)`，capabilities 为 `codex/tool_calls/file_changes/multi_turn`。
- Edge：`AH-SR-005` 任意权限决策伪造已做 server 侧缓解。`/v1/permissions/decide` 现在必须消费 pending `runId/requestId`，未知请求、错 run、重复 decision 都会拒绝；EventBus observer 在 WebSocket fanout 前登记 `permission_requested`，adapter 权限事件会补齐 run/project/thread scope，OpenAPI 已把 `runId` 标为必填。仍未声称完成真正阻塞式 human-in-the-loop 审批，远程 Edge 模式还需要签名/认证决策证明。
- Edge：`AH-SR-018` raw run output flood/disk 风险已做 repo 内缓解。`ProcessExecutor` raw stdout/stderr 共享 4 MiB per-run 默认预算，超限时同时截断 temp-file 持久化和 `run.output.batch` 文本，并发布 `truncated/maxBytes/bytesWritten/message` 兼容 metadata。
- Edge：`AH-SR-018` structured adapter payload flood 风险已做 repo 内缓解。`run.agent.*` map payload 在进入 EventBus 前按默认 1 MiB 单事件 JSON payload 预算递归截断字符串字段，发布 `truncated/maxBytes/bytesBefore/message` 兼容 metadata；无法靠字符串收敛时降级为 `dropped: true` metadata-only payload，run lifecycle 不受影响。
- Edge：`AH-SR-015` REST timeout 与 WebSocket 长连接已拆开。`WriteTimeout=0` 保持 `/v1/events` WebSocket 兼容，非 WebSocket REST 请求经 30s timeout middleware 兜底，WebSocket upgrade 请求绕过该 middleware。
- Edge：`AH-SR-014` 本地调用边界已做可选 token 缓解。`--local-auth-token` / `AGENTHUB_EDGE_AUTH_TOKEN` 非空时，除 `/v1/health` 和 CORS preflight 外的 Edge API 都需要本地 token；REST 支持 `Authorization: Bearer <token>` 和 `X-AgentHub-Edge-Token`，浏览器 WebSocket 使用 `/v1/events?access_token=<token>`。默认空 token 保持本地开发兼容，Remote/Cloud/Hub relay Edge 仍需 Hub session/device proof 和审计设计。
- Client/Edge smoke：`scripts/client-smoke.ps1` 已对齐当前 Edge 架构，不再构建已删除的独立 `runner/` 目录；新增 `-EdgeAddr` 可跑隔离端口，默认用 Edge 内置 `--runner-profile agenthub-runner-mock`，并在独占 Edge 时断言当前 run 收到 `run.started`、`run.output.batch`、`run.finished` 和 mock runner 输出。
- 验证：`hub-server && go test ./internal/model ./internal/handler -run "TestCustomAgent" -count=1 -v`、`hub-server && go test ./internal/service -run "TestListContacts_BatchesFriendUserLookup|TestListFriendRequests_BatchesSenderLookupAndSkipsMissingSender" -count=1 -v`、`edge-server && go test ./internal/store -run TestStoreCreateProjectDistinguishesExistingProject -count=1 -v`、`edge-server && go test ./internal/api -run TestMuxPostProjectsExistingProjectReturnsOKWithoutCreatedEvent -count=1 -v`、`edge-server && go test ./internal/api ./internal/store ./internal/lifecycle -count=1 -v`、`edge-server && go test ./internal/api -run "TestGetHealth|TestPostRuns" -count=1 -v`、`edge-server && go test ./internal/store -run "TestStoreCleanup|TestFileStoreCleanup" -count=1 -v`、`edge-server && go test ./internal/api -run "TestPostRuns" -count=1 -v`、`edge-server && go test ./internal/store ./internal/api -count=1 -v`、`edge-server && go test ./internal/adapters -run "TestNewOrchestratorAdapter|TestDefaultOrchestratorPrompt|TestFormatAgentList|TestEscapePromptLiteral|TestOrchestratorAdapterEscapesSystemPrompt" -count=1 -v`、`edge-server && go test ./internal/adapters ./internal/events -count=1 -v` 均通过。
- 本轮新增验证：`hub-server && go test ./internal/handler ./internal/service ./internal/repository -run "TestEdgeAgentTaskAck|TestEdgeHubProtocol|TestPendingTask|TestHandleTaskAck|TestEdgeTaskLifecycle" -count=1`、`app/desktop && pnpm vitest run src/__tests__/useHubIntegration.test.ts`、`python -c "import yaml, pathlib; yaml.safe_load(pathlib.Path('api/openapi.yaml').read_text(encoding='utf-8'))"`、重复 key 检查、`edge-server && go test ./internal/httpserver ./internal/runners ./internal/api -count=1` 均通过。
- 权限修复新增验证：`edge-server && go test ./internal/api ./internal/events ./internal/adapters ./internal/lifecycle -run "TestPermission|TestPostPermission|TestMuxPermission|TestAddObserver|TestScopedEventEmitter|TestBusEventEmitter|TestBudgetAwareEmitter" -count=1 -v`、`edge-server && go test ./internal/api ./internal/events ./internal/adapters ./internal/lifecycle ./internal/httpserver -count=1`、`edge-server && go test ./... -short -count=1`、OpenAPI YAML 解析与重复 key 检查均通过；`git diff --check` 针对本次 Edge/API/doc 文件通过。
- Edge raw/structured output cap 新增验证：`edge-server && go test ./internal/adapters -run "TestPayloadLimitEmitter|TestBudgetAwareEmitter|TestScopedEventEmitter|TestBusEventEmitter" -count=1 -v`、`edge-server && go test ./internal/lifecycle -run "TestProcessExecutorTruncatesStructuredAdapterPayload|TestProcessExecutorTruncatesRawOutputAtRunBudget|TestRunOutputLimiter" -count=1 -v`、`edge-server && go test ./... -short -count=1` 均通过。
- Runtime bridge 输出回传新增验证：`edge-server && go test ./internal/lifecycle -run "TestProcessExecutor|TestSplitHubCallbackTextPreservesUTF8" -count=1`、`edge-server && go test ./tests -run "TestHubE2E_(RunCompletes|CompleteRoundTrip|CallbackFormat)" -count=1`、`app/desktop && corepack.cmd pnpm exec vitest run src/__tests__/useHubIntegration.test.ts`、`app && corepack.cmd pnpm --filter agenthub-desktop typecheck` 均通过。注意：`corepack.cmd pnpm --filter agenthub-desktop test -- src/__tests__/useHubIntegration.test.ts` 会误触发 Desktop 全量测试；当前 `edge-real.test.ts` 仍有既有 409/WS Origin 失败，不作为本轮单文件 hook 验证结果。
- Edge active-run 真实 HTTP smoke：临时构建 `edge-server/.tmp/agenthub-edge-smoke.exe` 并启动 `--addr 127.0.0.1:3227 --runner-command powershell.exe --runner-arg -NoProfile --runner-arg -Command --runner-arg "Start-Sleep -Seconds 8; Write-Output done"`；`GET /v1/health` 返回 `status=ok`/`executor=ok`，连续同 thread `POST /v1/runs` 返回 first `202`、second `409 active_run_exists`，second body 的 `runId` 等于 first `runId=run_8ec7c59058063719`；临时服务和二进制已关闭/清理。
- Hub UUID 边界新增验证：`hub-server && go test ./internal/handler -run "Test(AuthHandler_Login|DeviceHandler_Register|EdgeHubProtocol)" -count=1 -v`、`hub-server && go test ./... -short -count=1`、`edge-server && go test ./... -short -count=1`、OpenAPI YAML 解析与重复 key 检查、本轮 server/API/doc `git diff --check` 均通过；随后用临时 `docker compose` Postgres/Redis（`15432/16380`）跑通 `hub-server && go test ./tests -run "TestEdgeDevice(Register)?$" -count=1 -v`，覆盖真实 register/login/me/desktop login/`/edge/devices/register` 链路，临时容器和卷已 `docker compose down -v` 清理。
- Hub cache fallback 新增验证：`hub-server && go test ./internal/service -run "Test(ResolveCacheUsesNoopForTypedNilClient|SendMessage_NilCacheUsesDBSeqFallback|ChangePassword_NilCacheDoesNotPanic|UpdateProfile_NilCacheDoesNotPanic|AcceptFriendRequest_NilCacheDoesNotPanic|ListContacts_NilCacheMarksOffline|CreatePrivateSession_NilCacheDoesNotPanic|HandleTaskDoneNilCacheUsesDBSeqFallback)$" -count=1 -v`、`hub-server && go test ./internal/service -count=1`、`hub-server && go test ./... -short -count=1` 均通过。
- Dev compose loopback 新增验证：`docker compose config --services`、`docker compose config` 解析通过；`git diff --check` 针对 `docker-compose.yml`、`.env.example`、安全登记、roadmap、STATE 通过。
- Public stats/REST timeout 新增验证：先用 TDD 红灯确认 `TestPublicStatsBucketsCountsAndUptime` 失败在精确 `37` 未桶化、`TestRESTTimeoutMiddleware` 失败在缺少 wrapper；实现后 `hub-server && go test ./internal/handler -run TestPublicStatsBucketsCountsAndUptime -count=1`、`edge-server && go test ./internal/httpserver -run "TestRESTTimeoutMiddleware" -count=1`、`hub-server && go test ./... -short -count=1`、`edge-server && go test ./... -short -count=1` 均通过。
- Client/Edge smoke 新增验证：`app/shared && pnpm install --no-frozen-lockfile` 同步 lockfile 后，`app/desktop && pnpm build` 通过；随后 `.\scripts\client-smoke.ps1 -EdgeAddr 127.0.0.1:3228` 通过 23/23，覆盖 Edge build、shared 依赖安装、Desktop web build、Edge 启动、`/v1/health`、`/v1/runners`、`POST /v1/runs`、cancel、WebSocket 当前 run 事件和 Edge Go tests。
- Edge local auth 新增验证：`edge-server && go test ./internal/httpserver ./cmd/agenthub-edge -count=1`、`edge-server && go test ./... -short -count=1`、`hub-server && go test ./... -short -count=1`、`app/desktop && pnpm vitest run src/__tests__/edgeClient.test.ts src/__tests__/eventClient.test.ts`、`app/desktop && pnpm exec tsc --noEmit`、`.\scripts\client-smoke.ps1 -EdgeAddr 127.0.0.1:3228 -EdgeAuthToken local-smoke-token`（23/23）均通过。
- 全量短测：`hub-server && go test ./internal/config ./internal/router ./internal/middleware ./internal/service ./internal/ws -count=1`、`hub-server && go test ./... -short -count=1`、`edge-server && go test ./... -short -count=1` 均通过；本轮新增多设备登录验证：`go test ./internal/repository -run TestDeviceRepo_Upsert -count=1 -v`、`go test ./internal/service -run TestDeviceRegisterMapsOwnershipMismatchToBadRequest -count=1 -v`、真实 PG/Redis 下 `go test ./tests -run "TestLoginAllowsMultipleDesktopDevicesForSameUser|TestLoginRejectsDeviceIDOwnedByAnotherUser" -count=1 -v`；附件共享新增验证：`go test ./internal/service -run "Test(GetAttachmentByIDAllowsSessionMemberForReferencedAttachment|SendMessage_FileContent)" -count=1 -v`、`go test ./internal/repository -run "TestMessageAttachmentRepo_CreateAndAccess|TestAttachmentRepo_CreateAndGet|TestMessageRepo_(Pins|InsertAndGet)" -count=1 -v`、真实 PG/Redis 下 `go test ./tests -run TestAttachmentDownloadAllowsSessionMemberAfterFileMessage -count=1 -v`；`git diff --check` 针对本轮 server/doc 文件通过。
- 工作区：Hub Agent 回调测试、Hub WS 背压测试、Hub writeLoop close、Hub contact/custom agent 校验、Hub P3-2 常量化、Hub taskId/runId 持久化、Hub `device_id` UUID 边界、多设备登录 schema 与真实 PG/Redis 验证、Hub attachment 共享 schema/授权与真实 PG/Redis 验证、Hub cache fallback、Hub public stats bucket、dev compose loopback、Edge dropped counter、Edge lifecycle 测试隔离、Edge project duplicate 测试、Edge run 并发 API 约束、Edge run cleanup、Edge orchestrator prompt 转义、Edge 常量提取、Edge health runner 状态、Edge runtime runner 状态修复、Edge permission registry、Edge raw/structured output cap、Edge REST timeout、Edge local auth、client-smoke 当前 Edge runtime 修复、shared lockfile 同步与 `api/events.md`/`api/openapi.yaml`/`docs/roadmap.md`/本状态页/安全风险登记为已合入主线或本轮收敛的推进记录；继续工作前按当前 git 状态重新核验。

### 当前接手顺序（2026-05-26）
- Runtime bridge：Web→Hub task→Desktop→Local Edge→Hub typed stream/done 的可见输出闭环已落地并有回归测试，Web 直连 Edge 遗留 hook 已清理并有 `.\scripts\verify-web-hub-boundary.ps1` 防回归。下一步不要重复补普通 content 投影；优先做真实 TokenDance ID 部署态登录/设备注册 smoke、Desktop logout/reconnect 截图证据、Web 公开发布前的 BFF/HttpOnly cookie 或等价 server-owned session 方案，以及 typed stream live E2E 截图。OIDC 结构检查入口是 `.\scripts\verify-oidc-readiness.ps1`，只证明仓内 wiring/docs/storage/Hub WS upgrade auth 对齐，不替代真实部署 smoke。Web Agent/Profile 面已开始从 preview mock 收敛到 Hub `agent_profiles`；继续推进时优先把 Settings/Market/Execution Target 接到 Hub profile/target/task lifecycle。
- Web：2026-05-26 RunDetail runtime 投影已补齐。`app/web/src/utils/hubAdapters.ts` 新增 `projectRunDetail()`，从 Hub Chat blocks 派生 output/tool call/changed files；`app/web/src/layouts/WebLayout.tsx` 右侧 RunDetail 不再传空数组。验证通过 `app/web && corepack.cmd pnpm test -- src/utils/hubAdapters.test.ts`、`corepack.cmd pnpm typecheck`、`corepack.cmd pnpm exec vite build`。
- Hub：2026-05-26 typed RunEvent persistence 已做最小闭环。`/edge/agent-tasks/:id/stream` 兼容旧 `content/chunk`，也接受 `event_type + payload`；Hub 写入 `agent_run_events`、发布 `agent.stream`，并继续投影 `message.new` 供现有聊天 UI 使用。`GET /web/agent-tasks/:id/events` 提供 owner-scoped replay/read。验证通过 Hub 聚焦测试、`go test ./... -short -count=1` 和 OpenAPI YAML 解析。
- Hub/Web/Desktop：2026-05-26 Web typed RunEvent consumption 已做仓内闭环。Desktop bridge 不再把 tool/file/runtime payload 只作为普通 content 回传，而是对 `run.agent.*` / `run.output.batch` 调 Hub typed stream；Hub app 订阅 `agent.stream` 并推送到 session WebSocket；Web 新增 `AgentRunEvent` client 类型和 `listTaskRunEvents()`，`WebLayout` 合并 `agent.stream` 与 `GET /web/agent-tasks/{id}/events` replay，RunDetail 优先消费 typed events。`hubAdapters` 覆盖 Codex `files[]` file_change、stdout batch chunks、tool call/result 投影。验证通过 `hub-server && go test ./internal/app -run TestStartEventSubscriptionsPushesAgentStreamToSession -count=1 -v`、`app/web && corepack.cmd pnpm test -- src/utils/hubAdapters.test.ts`、`app/web && corepack.cmd pnpm typecheck`、`app/desktop && corepack.cmd pnpm exec vitest run src/__tests__/useHubIntegration.test.ts`、`app/desktop && corepack.cmd pnpm typecheck`。
- Hub/Web/Desktop/Edge：2026-05-26 Agent Profile runtime config bridge 验证通过 `hub-server && go test ./internal/service -run "TestDispatchTaskIncludesPrompt|TestMergeModelParamsLetsDispatchOverrideProfileDefaults" -count=1`、`edge-server && go test ./internal/api -run "TestPostRunsPassesRuntimeProfileConfigToExecutor|TestPostRunsBindsProjectAndThread" -count=1`、`edge-server && go test ./internal/lifecycle ./internal/adapters -run "TestClaudeCodeBuildCommandArgs|TestCodex|TestOpenCodeBuildCommandArgs" -count=1`、`app/desktop && corepack.cmd pnpm exec vitest run src/__tests__/useHubIntegration.test.ts`、`app/web && corepack.cmd pnpm test -- src/api/agentQueries.test.ts src/utils/hubAdapters.test.ts`、Web/Desktop typecheck 和 OpenAPI YAML 解析。
- Hub/TokenDance ID：2026-05-26 OIDC dev setup 示例已对齐动态 loopback 规则。`hub-server/.env.example`、`scripts/setup-tokendance-oidc.{ps1,sh}` 和 `scripts/seed-tokendance-client.sql` 不再写 `http://127.0.0.1:PORT_IDX/callback` / `agenthub://callback`，改为注册无端口 `http://127.0.0.1/callback` 和 Web dev callback，并输出 `AGENTHUB_TOKENDANCE_ID_ALLOWED_REDIRECT_URIS`。
- Hub/TokenDance ID：2026-05-29 AH-SR-026 已仓内缓解。Hub 当前只保留 OIDC authorize/callback、refresh、me/logout/profile 等会话入口，不暴露 legacy local password login/register；`users.password_hash` 对齐 migration 0035 作为 nullable 字段，`model.User.PasswordHash` 改为 `*string`，OIDC-only 用户读取时保持 nil。验证通过仓储 NULL password 红绿测试、OIDC callback focused tests、`go test ./internal/model -count=1` 和 `hub-server && go test ./... -short -count=1`。部署后仍需做真实 TokenDance ID login smoke，确认生产可创建/读取 `password_hash IS NULL` 的 Hub 用户。
- Web/Desktop：2026-05-26 Settings 账号页 OIDC 状态已移除旧 `td_code_verifier` / `td_state` 判断。Web 使用当前 `agenthub_oidc_pkce_pending` session payload 区分一次浏览器 PKCE 往返提示；Desktop 不再从 storage 推断 PKCE，因为 Tauri OIDC state/verifier 保持在系统浏览器 + 本机回调路径中。验证通过 `app/desktop && corepack.cmd pnpm exec vitest run src/__tests__/SettingsPage.test.tsx`、Web/Desktop typecheck 和 `git diff --check`。
- Hub：2026-05-26 Execution Target owner boundary 已收紧。`GET /web/execution-targets/:id` 和 `POST /web/execution-targets/:id/ping` 现在都要求目标 `owner_id` 等于当前 Hub user，避免任意 Hub Web 会话凭 UUID 读取或标记其他用户的执行目标；聚焦验证通过 `hub-server && go test ./internal/service ./internal/handler -run "TestExecutionTarget" -count=1`。
- Hub/Edge：2026-05-26 Execution Target workspace policy 地基已推进。Hub target model/migration/API 增加 `workspace_allowlist`、`trust_level`、`health_state` 和 policy enum 校验；Edge `agenthub-edge` 增加 `--workspace-allowlist` / `AGENTHUB_WORKSPACE_ALLOWLIST`，配置后拒绝 allowlist 外或 symlink 逃逸的 `/v1/runs.workDir`，且拒绝路径不会创建 run 或启动 Runtime。验证通过 Hub/Edge 聚焦测试、两个 Go 短测、OpenAPI YAML 解析和 `git diff --check`。注意这不是 Remote/Cloud target 完成证据，只是 registered target/workspace policy 的本地执行护栏。
- Web/Desktop：2026-05-26 Execution Target Settings 已接 Hub 真实 inventory。两端 `hubClient` 和 `executionTargetQueries` 读取 owner-scoped `/web/execution-targets`，Settings 展示 Hub target 总数/在线数、health breakdown、类型计数、登录/加载/空/错误态和逐 target ping；Web 仍通过 Hub session 读取，不新增浏览器到 Local Edge 的调用。该进展只证明 target inventory 和 health 可见，不代表 Web/Hub task 已按 `target_id` 调度到远程或云执行目标。验证通过 Web `hubClient/agentQueries/executionTargetQueries` focused Vitest、Web typecheck、Desktop `hubClient/executionTargetQueries/SettingsPage` focused Vitest、Desktop typecheck、Web-Hub boundary、JSON 解析和 `git diff --check`。
- Hub/Web/Desktop：2026-05-26 `target_id` task contract 已推进。`/web/agent-tasks` 接受可选 owner-scoped Execution Target id，Hub 校验 owner/deleted/type 后写入 `pending_agent_tasks.target_id` 并在 `agent.dispatch` payload 透传；Web/Desktop Hub client 类型和 OpenAPI/events 文档同步。当前仍按现有 inviter desktop route 派发，下一步 `feat/hub-edge-target-routing` 才做 target.device_id route、离线队列隔离和禁止 fallback。
- Hub：2026-05-26 `feat/hub-edge-target-routing` 已完成仓内最小 target-bound desktop dispatch。`/web/agent-tasks target_id` 会解析 Execution Target 绑定的 owner desktop `device_id`，预写 `pending_agent_tasks.edge_device_id`，dispatch 只查 `desktop:<device_id>` exact route；目标 device 离线、route 不存在或 conn/device 不匹配时进入 target/device 专属 Redis queue，Desktop reconnect 只 replay 同一 device 的 target queue，legacy 无 target 任务仍走原用户队列。验证通过 Hub cache/ws/service/app focused tests 和 `hub-server && go test ./... -short -count=1`。这仍不是 Remote SSH/Tailscale/Cloud Edge 完成证据。
- Web/Desktop：2026-06-01 Execution Target 路由 UX 收口到 Hub task 入口。Web composer 会读取 owner-scoped target inventory，默认选择可派发的 `local_edge` / `hub_relay` target，并把用户选择作为 `/web/agent-tasks.target_id` 发送；离线 target 保持可选以进入 device-scoped pending queue，Remote/Cloud 等未实现类型显示 locked。Desktop Hub bridge 会保留 `agent.dispatch.target_id` 到 task store，Settings `Tasks`/`Agent Scheduling` 队列能看到 target evidence，避免只看 run id 无法判断目标路由。验证通过 Desktop focused Vitest、Desktop/Web typecheck、Web hubClient focused Vitest、shared hubClient tests 和 `git diff --check`；本机仍缺 Go，Hub Go focused tests 未能运行。
- Docs：2026-05-26 8 个部署场景口径已收紧。当前不是 8/8：Desktop 本地离线已完成，Desktop 本地在线和 Web 中继当前 Desktop 是最小闭环；Desktop/Web 到远程 Desktop 或 Cloud Edge 的直接/中继场景仍属 P3/P4，依赖 registered Edge target、workspace allowlist、relay routing 和远程审批。
- Docs：`bytedance.md` 功能映射已归档到 `docs/reference/cross-comparison/11-bytedance-feature-map.md`。该文档只作为 gap matrix 和竞品方向参考，不是 Trump/旧 worktree 完成证据；下一批顺序仍是部署态 TokenDance ID smoke、Runtime UI parity、多 Agent group smoke、Artifact lifecycle，以及 Home 站点到 AgentHub Web/Hub session 的低风险深链。
- Docs：Cherry Studio 参考已新增到 `docs/reference/projects/cherry-studio/`，入口已挂到 `docs/reference/README.md`。可采纳点是 operational Home、Settings row/group primitives、typed message/tool blocks、composer scopes、artifact preview、SDK env blocklist、permission hook、SSE abort/timeout 和 Channel/Scheduler 边界；明确不采纳 renderer-as-SSOT、provider secret 持久化、Web 直连本地 Runtime 或第三方 provider 直登。AionUi 继续只作为 action-first Home、team composition、runtime auto-detection、scheduling/approval ergonomics 参考。
- Docs：AgentTeam 竞品深度研究已新增到 `docs/reference/cross-comparison/13-agentteam-competitive-roadmap.md` 并同步主架构/产品/实现/roadmap 口径。当前只能说 Hub group/session、Agent Profile、Desktop bridge 和 Edge local sub-agent prototype 是基础；产品级 `AgentTeam`、`TeamRun`、`TeamTask`、`TeamEvent`、可恢复 `TeamRunState`、typed `CoordinatorRouteDecision`、delegation guardrails、双真实 Runtime Profile 群组 E2E、聚合 transcript 和冲突处理仍未完成。下一批建议拆 `feat/agentteam-contract`、`feat/teamrun-state-router`、`feat/teamrun-local-smoke`；路线保持 IM-native，ReactFlow/DAG 只作为 TeamRunState 可视化或模板编辑器，不做 canvas-first 产品转向。
- Docs：产品方向竞品研究已新增到 `docs/reference/cross-comparison/14-product-direction-competitive-roadmap.md`。长期定位是 local-first multi-runtime Agent command center + Hub-governed collaboration fabric + Target network；四根柱子是 Runtime Workbench、AgentTeam Collaboration、Target Network、Agent Platform。Runtime 生态方向要从“支持几个 CLI”升级为 runtime control plane：Runtime capability、`ModelSpec/ModelRoute`、cc-switch `ProviderBinding`、Tooling Registry 和每次 run 的 `RunConfigSnapshot`。8 场景缺口按 P2A identity/session evidence、P2B enterprise foundation、P3A registered Remote Edge、P3B Cloud Edge lease、P4 Team Platform 管理。下一批不要重复做静态 Home/preview surface，优先推进 `feat/operational-home-console`、`feat/runtime-event-blocks-ui`、`feat/artifact-lifecycle`、`feat/run-config-snapshot`、`feat/platform-profile-market`、Target dispatch 三段任务和 Remote/Cloud productization 四段任务。
- Runtime readiness：`.\scripts\verify-runtime-readiness.ps1` 是 AgentAdapter/Runtime wiring 的结构 gate，只证明仓内真实调用链和 UI/docs 边界对齐；Codex、Claude Code、OpenCode live smoke 已在 2026-05-26 通过。下一步需要补 Desktop/Web 截图证据、Hub task typed stream live E2E 和真正阻塞式审批；尤其 Claude Code 阻塞式审批不要用当前 permission event 展示替代。
- Desktop：Settings `Tasks` 已接 `/v1/runs` 与 Hub task bridge，重复 terminal run event 的 `COMPLETED -> COMPLETED` warning 已清理；下一优先级是继续把 IM 群聊、Agent 调度、Agent Market、Skill/MCP、模型映射、cc-switch 从预留 surface 接到真实 Hub/Edge API，并补 runStore/TanStack Query active run 列表同步链。
- Desktop：Settings `Agent Scheduling` 已接本地 run、Hub bridge task、Agent Profile、Edge health 与策略开关；下一优先级建议继续把 Agent Market、Skill/MCP、模型映射、cc-switch、远控/审计从预留 surface 接到真实 Hub/Edge/API 或本机配置源，并把 runStore/TanStack Query active run 列表同步链补齐。
- Desktop：Settings `Agent Market` 已接本地 Agent Profile 和 capability 字段；下一优先级建议继续把 Skill/MCP、模型映射、cc-switch、远控/审计接到真实 Hub/Edge/API 或本机配置源，并补 Profile 发布/安装的 Hub API 契约。
- Desktop：Settings `Skill Management` 已接项目级 `.agents/skills` registry 快照；下一优先级建议继续把 MCP、模型映射、cc-switch、远控/审计接到真实 Edge capability、Hub API 或本机配置源。
- Desktop：2026-05-31 日常工作台闭环已推进。Home 已接真实 active runs / pending approvals / target health / Hub session / recent threads / Hub task bridge 摘要，并把空 CTA 改成可导航动作；Settings Skills 明确本地 `.agents/skills` 为权威来源，Hub sync 显示 login locked 或 interface gap；IM 增加 refresh / retry / unread session summary，Hub notifications 会同步到 Desktop notification badge。验证通过 focused Vitest、Desktop typecheck、全量 test、build、`git diff --check` 和 1440/1280/375px Playwright overflow 截图。下一优先级是 Run Workbench：active run 同步链、typed runtime blocks、approval/diff/artifact review surface。
- Worktree 建议：下一轮优先拆 `feat/hub-edge-target-routing`（按 `target_id -> device_id` 派发、pending queue 隔离、禁止 fallback）、`feat/runtime-event-blocks-ui`（typed blocks/tool group/artifact projection）、`feat/operational-home-console`（两端 Home 展示 active runs、pending approvals、target health、TokenDance ID session state）和 `feat/runtime-typed-control-callbacks`（normalized callback/control event）。Execution Target 不要一口吃成远程/云执行；所有任务都必须保持 Web Hub-only、Hub-issued session 授权和 secret-free 证据边界。
- Edge：active-run 真实 HTTP smoke 已用可控慢 runner 收口；后续若 3210 真实 runtime 仍出现双 202，应重点确认当前进程版本和 runtime 是否在第二个 POST 前已完成。
- Edge：raw output cap 和 structured adapter payload cap 已 repo 内缓解；后续用 live runtime 做截断 metadata smoke，确认真实 Codex/Claude/OpenCode adapter 事件在客户端可读。
- Edge：下一步若继续权限链路，要做真正阻塞式审批和远程 Edge 决策认证；当前修复只关闭 REST 任意 requestId 伪造和重复消费。
- Docs：处理文档架构审查的最小建议：先在 API/架构文档标注 Runner 兼容命名，再归档或改写旧 `docs/archive/client-handoff.md`、`docs/roadmaps/integration.md`。
- Docs：Codex follow-up 已完成，确认最小补丁应优先改 `docs/architecture/implementation-guide.md` 的旧 client 文档入口，并在 API docs 标注 `/v1/runners` / `runner.*` 是历史兼容命名。
- Web：~~继续保持 `D:\Code\TokenDance\AgentHub\.worktrees\webui-desktop-port` 独立~~ worktree 及 `feat/webui-desktop-port` 分支已于 2026-05-25 删除，产出已合入 `dev/delicious233`。
- 后端：保留当前 Hub/Edge 并行改动，不回退；Hub `device_id` UUID 边界、多设备登录 schema、Hub cache fallback、Hub public stats bucket、dev compose loopback、Edge REST timeout、Edge local auth、Edge active-run smoke 和当前 `client-smoke` 23/23 已收口，后续优先做部署态 Hub 登录/设备注册验证、runner degraded/offline 与 Hub task/IM/scheduling API 的客户端消费；若继续安全队列，下一批可处理 `AH-SR-016/017` 部署态 CORS/admin 暴露验证，或开始 Remote/Cloud Edge 的 Hub session/device proof 设计。

### 本轮提交（2026-05-24）
- `cd26e2c` — Claude Session 2026-05-25 交接报告 + ui-screenshot skill；包含 Hub CancelTask/session_id 修复与 auth middleware 测试适配
- `e03c407` — merge master 冲突解决
- `adc829d` — CI/配置修复（go.mod、Dockerfile、CI workflow、docker-compose）
- `d299f1c` — 清理死代码 useAgents.ts
- `5e04e76` — P0-1 状态架构重构：TanStack Query + Zod + runStore 纯客户端化
- `3faa348` — STATE.md + roadmap 更新
- `4cd8551` — i18n 中文化收官
- `1f50b17` — hubAuth getState snapshot 稳定化

### Desktop P0 验收清单
- [x] P0-1: TanStack Query + Zod + RunState 状态机 + selector 优化
- [x] P0-2: 非受控输入 + 草稿持久化 + 循环检测 + 文件去重缓存
- [x] P0-3: WebSocket 心跳 + 离线队列 + Transport 抽象
- [x] P0-4: 虚拟滚动 + App.tsx 568→343 行

### 已知问题（预存，非阻塞）(持续监控)
- 5 个 shared/ui 测试文件无法加载（pnpm 跨包虚拟存储）
- AuthPage 4 个测试失败
- hubClient getState snapshot 测试失败
- `AH-SR-012` 的当前树清理已完成：已删除跟踪中的 `app/desktop/stats.html`、Edge ad hoc coverage 文件和 Hub test upload blobs，并补 `.gitignore` 防止重新生成后误提交；旧提交历史里的 blob 是否重写清理仍需维护者单独协调。

## 模型分配

| 别名 | 实际模型 | 上下文 | 角色 |
|---|---|---|---|
| **opus** | DeepSeek-V4-Pro | 1M | 主 Agent 架构/审查 |
| **sonnet** | Kimi-K2.6 | 256k | 前端/多模态 |
| **haiku** | GLM-5.1 | 200k | Go 后端编码 |

## 项目规则

- `AGENTS.md` — 共享开发规范
- `docs/governance/branch-governance.md` — 分支策略
- `docs/governance/document-standards.md` — 文档规范
- `docs/roadmap.md` — 全局路线图（唯一事实源）
- `.ops/deployment-record.md` — 部署记录（本地，不入仓库）

## Subagent 接口

### 后端 subagent（haiku/GLM-5.1）
- 范围：`edge-server/` 或 `hub-server/`，不碰 `app/desktop/`
- 提交格式：`type(scope): 中文摘要`
- 验证：`go build ./... && go test ./... -short -count=1`

### 前端 subagent（sonnet/Kimi-K2.6）
- 范围：`app/desktop/` 或 `app/web/`，不碰 Go 代码
- 共享 UI 组件放 `app/shared/src/ui/`（从 `@shared/ui` 导入）
- 新组件必须：测试 + Storybook story + barrel export
- 样式用 CSS Modules + OKLCH 变量（禁止硬编码颜色）
- 验证：`pnpm tsc --noEmit && pnpm test`

### 主 Agent（opus/DeepSeek-V4-Pro）
- 设计决策、审查输出、编辑核心文件
- 分发 subagent、交叉审查
- 更新 roadmap 和文档

## 当前阻塞 / 已知问题

- api.hub.vectorcontrol.tech 无 SSL（HTTP only）— （待排期）
- 登录已修复但需验证（migration 0017 + UUIDv7 修复后需重建容器）— （低优先级）
- 服务器磁盘 29GB 总量偏小，需定期清理 Docker 镜像 — （运维任务）

## 本地开发

```powershell
# Edge Server（必需，先启动）
cd edge-server && go build -o agenthub-edge.exe ./cmd/agenthub-edge && .\agenthub-edge.exe --store-file test_store.json

# Desktop（Tauri 原生窗口）
cd app/desktop && pnpm tauri dev

# Hub Server — 不需要本地跑！Desktop 直接连生产 Hub
# Hub URL: http://api.hub.vectorcontrol.tech
```

## 接手文档

| 文档 | 位置 | 面向 |
|---|---|---|
| 前端接手指南 | `.ops/frontend-handoff.md` | 前端 agent |
| 后端接口审计 | `.ops/backend-audit.md` | 后端 agent |
| 运维手册 | `.ops/deployment.md` | 运维 |
