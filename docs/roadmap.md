# AgentHub 路线图

> 最后更新: 2026-06-06 | 按优先级持续推进 | 历史长版: [archive/roadmap-pre-5day-cleanup-20260605.md](archive/roadmap-pre-5day-cleanup-20260605.md), [archive/roadmap-full-history-20260605.md](archive/roadmap-full-history-20260605.md)
> Review 采纳: Round 1+2 (2026-06-06) — 10 份报告在 [docs/review/](review/)

## 目标

AgentHub 是 IM 形态的多 Agent 协作平台。核心体验是用户像用飞书/微信一样发消息、@ 多个 Agent，由 Orchestrator 分派任务，Agent 在同一 transcript 内返回文本、工具过程、Diff、Preview、Approval、产物和部署状态。比赛前以 Desktop/Tauri 为主力交付面；Web/Mobile 在 Desktop 闭环跑通后迁移共享能力。

赛题材料在 workspace 根目录：`../docs/competition/bytedance.md`、`../docs/competition/SUBMISSION-CHECKLIST.md`。评分权重：AI 协作能力 30%，功能完整度 25%，生成效果 20%，代码理解 15%，创新与产品感 10%。

## 推进规则

- 先 Desktop，后 Web/Mobile。当前不做双线 UI 重组。
- 先真实演示闭环，后长期工程债。SQLite、Web、Mobile、Remote Edge 等重要但不能阻塞 TeamRun Demo。
- 每个完成项必须有证据：focused tests、截图、真实运行日志、TeamRun export、录屏片段或当前 PR 状态。
- Roadmap 记录优先级、依赖、验收和长期方向，不写人工日程表。
- 子代理只做窄任务：Codex GPT-5.5 做强实现/强审查，Claude sonnet 做窄范围代码，Claude haiku 做多模态视觉 QA，Claude opus 做长上下文推理/研究。
- R 系列 Desktop 小 PR 只作为来源分支；当前主线改为一个 Desktop P0 集成 PR，避免 PR 周转吞时间。
- `docs/review/` 是外部审查输入，不是第二套 backlog。只把高价值结论合并进本 roadmap，重复项归档或并入既有 P0/P1/P3。

## 当前最高优先级

| Rank | 任务 | 状态 | 下一步 | 验收证据 |
|---:|---|---|---|---|
| P0-1 | Desktop P0 集成（R5 + R3 + R6A） | PR #278 已合入 `dev/delicious233`；#272/#274/#275 已关闭 | 进入视觉 QA，不再逐个小 PR 周转 | `git diff --check`；focused vitest 91/91；Desktop typecheck；frontend-desktop CI |
| P0-2 | Desktop 视觉 QA | 集成后立刻做；竞品截图只作为密度/布局参考 | 1440x920、1280x800、390x844 截图；检查横向滚动、遮挡、composer 底部空间 | 截图路径、问题清单、必要 CSS 修复 |
| P0-3 | 真实 TeamRun E2E | ⚠️ Backend 6147 行完备但零真实运行证据（Review R1+R2 判定为比赛生死线） | 跑两个真实 Runtime Profile；导出 route/task/event/transcript；让 correlation/task 链在 UI 可见 | 运行日志、事件导出、截图、3 分钟视频素材 |
| P0-4 | 比赛材料同步 | 旧提交清单仍混有 Web/Mobile/2026-06-01 状态 | 更新 feature matrix、submission checklist、demo script、AI 协作日志 | 文档 diff 指向当前 commit 证据 |
| P0-5 | `docs/review/` triage | Round 1/2 报告已读入 | P0 只吸收 TeamRun/视觉/renderer 证据相关项；长期项放 P1/P3/P4 | roadmap 条目被合并，不产生新散列表 |

已合入：R2 Desktop Shell IA（merge commit `698faabf`）、R4 Right Inspector（merge commit `dfe68692`）、Desktop P0 集成 PR #278。R3/R5/R6A 后续只作为来源分支引用，不再单独推进。

## P0: Desktop 比赛闭环

### P0-A 信息架构

- [x] 合入 R2：Global Rail + Conversation Sidebar + Unified Transcript + Right Inspector + Unified Composer 的 shell 基础。
- [ ] 保证 1440x920、1280x800、390x844 无横向滚动、无文本遮挡、composer 不遮挡最后消息。
- [ ] 保持 light-first 主方向；深色参考只用于任务队列密度和可读性验证。
- [ ] 左侧两级导航：Global Rail 只放全局入口，Conversation Sidebar 展示 Manager/Worker/Project 群聊。
- [ ] 顶部 header 展示当前会话、参与 Agent、运行/模型状态、搜索/设置入口。

### P0-B IM transcript 和富消息

- [x] IM @Agent 输入：`IMMessageInput` 已接入 `useMention` / `MentionPopover`。
- [x] IM 富消息基础：`IMBlockRenderer` 已支持 Tool/Diff/Thinking/Approval 摘要。
- [x] 合入 #278：主 Chat 与 IM 共享 block/normalization 约束，避免 renderer 漂移。
- [x] child_agent、route_decision、artifact、deploy block 进入 IM 流。
- [ ] Diff/Preview/Tool/Artifact 卡片既能在消息流可见，也能在右侧 Inspector 汇总。

### P0-C Right Inspector 证据列

- [x] 合入 R4：宽屏右侧常驻证据列，窄屏可折叠但入口明确。
- [ ] 接线 RightInspector：`run-detail` slot 当前仍指向 `RunDetail`，`useRightInspectorData` 仍是空数据 hook；视觉 QA 前先接真实 panel。
- [ ] 展示 progress、Active/Done/Warning queue、tool timeline、changed files、workspace、artifacts。
- [ ] 任务卡显示 Agent 角色、当前 tool、进度、耗时、暂停/取消/审批/详情入口。
- [ ] 右侧列回答“做了几步、跑了哪些工具、改了哪些文件、产物在哪”。

### P0-D Composer 和协作动作

- [x] 合入 #278：`PromptInput` / `IMMessageInput` 的 @Agent、附件、workdir、approval mode 语义一致。
- [x] 合入 #278：IM 发送立即出现 pending 气泡，失败可回滚并展示错误。
- [ ] 统一 Edge permission approval 和 Team approval 的视觉路径。
- [ ] Enter 发送、Shift+Enter 换行、disabled/loading、附件入口都有测试。

### P0-E 真实 TeamRun（⚠️ 比赛生死线）

> Review 2026-06-06 判定：backend 6147 行完备但零真实运行证据，比赛就绪度 4/10。这是最高 ROI 单项。

- [ ] 至少两个真实 Runtime/Profile 在同一 group/team run 中协作。
- [ ] Orchestrator route、子任务、工具过程、失败/审批处理、产出聚合进入同一 transcript。
- [ ] 导出 Hub state/events/tasks/assignments 或等价无密证据。
- [ ] 录制 3 分钟脚本素材：开场、分派、执行、Diff/Preview、审批、总结。

## P1: 生成效果和 Desktop 稳定性

| 任务 | 来源 | 优先级 | 验收 |
|---|---|---:|---|
| Diff 语法高亮和长行处理 | 前端审计 P1/P2 | 高 | 大文件不卡顿，长行不水平溢出 |
| Diff 解析统一 | 前端审计 P1 | 高 | `shared/diff.ts` 与 desktop parser 收敛为一套行为 |
| Artifact/Preview 稳定提取 | 前端审计 P1 | 高 | 中文/JSON/tool metadata 输出能识别文件和预览入口 |
| Tool 参数深度截断 | 前端审计 P1 | 高 | 嵌套/base64 数据不爆 DOM，有明确截断提示 |
| null/畸形 tool input 防崩溃 | 前端审计 P1 | 高 | `summarizeInput`、ToolGroup、ChatView 对 null 安全 |
| output 截断提示 | Phase B4 + 前端审计 | 高 | >20K 或 1MB 输出有 `truncated` 事件/提示，不静默丢头部 |
| scroll-to-bottom 简化 | 前端审计 P1 | 中 | 用户上滑历史时不被强制滚回底部 |
| Blob URL revoke | 前端审计 P1 | 中 | 下载后释放 object URL |
| 消息骨架屏/streaming ticker | 前端审计 P2 | 中 | 流式等待态可读，不闪烁 |
| 共享 Tool/Icon/Input summarizer utilities | `docs/review` Round 2 | 中 | `ChatView`、`IMBlockRenderer`、`ToolGroup` 不再重复 `TOOL_ICON_MAP` / `summarizeInput` |
| TeamRun correlation/task 链可视化 | Codeg ACP 对比 | 中 | IM/Inspector 能看到父子任务、correlation_id 或等价调用链 |
| per-thread draft persistence | 前端架构审计 P1 | 中 | 切换 thread 不丢 composer 草稿 |
| context meter / token budget 提示 | 多模态 UI 审计 | 中 | 长任务录屏时能说明上下文状态，不只在日志里出现 |
| Markdown 数学公式 | 前端审计 P2 | 低 | 仅在 demo/文档生成需要时做 |
| Kanna 跨 Turn session 复用 | Review R2 Kanna 对比 | 中 | 跨 Turn 复用 CLI session 降低延迟和成本 |
| Turn 边界分组 | Review R2 UI 审计 | 中 | user/agent 消息视觉分组，参考 CCUI turn 级 |
| ChatView 巨石拆分 | Review R1 前端审计 | 中 | 1786→22 文件，机械提取 ~2 天 |
| 双渲染器收敛 | Review R1 前端审计 | 中 | ChatView + IMBlockRenderer → shared block contract |

## P2: IM 产品完整性

### P2-A 会话核心

- [ ] 对话列表：新建、置顶、归档、搜索，按最近活跃排序。
- [ ] 单聊模式：选中联系人或 Agent 后进入 1v1 对话。
- [ ] 群聊模式：项目群聊、Manager 私聊、Worker 私聊层级清晰。
- [ ] 消息操作：回复、引用、复制代码、重新生成、展开预览。
- [ ] 上下文管理：聊天历史自动传递，支持 pin 关键消息。
- [ ] IM 搜索：按消息、Agent、任务状态检索。
- [ ] IM 群聊管理：leave、dissolve、成员管理 API 有 UI 入口。
- [ ] Typing indicator：HubWSHandle.sendTyping 接入 UI。

### P2-B Agent 可视化

- [ ] Agent 运行状态：思考中、工具调用中、生成中、等待审批、失败。
- [ ] Agent Profile 与 Runtime badge 分离：Profile 是“谁”，Runtime 是“用什么跑”。
- [ ] 文件操作可视化：Agent 读写文件的实时展示。
- [ ] 子 Agent / RouteDecision 卡片在 IM 和主 Chat 都可见。
- [ ] 高风险操作审批弹窗和消息流 ApprovalCard 统一。

### P2-C Orchestrator

- [ ] 群聊意图理解和任务拆解。
- [ ] 子 Agent 并行调度和失败降级。
- [ ] 多 Agent 产出聚合。
- [ ] 多 Agent 修改同一文件时的冲突检测。
- [ ] 后台 Agent 调度器：参考 Claude Code `/bg`、Cursor multitask、Copilot Automations。

## P3: 工程稳定性和安全

### P3-A Phase A 剩余基础设施

- [x] A0/A1/A2/A3：错误码、请求日志、调试端点、安全 P0 已完成。
- [x] A4：App.tsx Wave 2 拆分完成，主线保守口径约 991 行。
- [ ] Desktop Rust 基础测试：commands.rs / oidc_server.rs 核心路径覆盖。
- [ ] A5 Edge 自动构建：`tauri dev` 检测 edge-server 变更自动 `go build`。
- [ ] A5 sccache / CI 缓存共享。
- [ ] A5 开发文档：冷启动预期、前置依赖、troubleshooting。
- [ ] A6 API 密钥迁移到 secure_store：模型 provider key 从 localStorage 迁到 keyring。
- [ ] A6 secret guard 加固：pre-commit staged scan、base64 检测、二进制密钥文件检测。

### P3-B Phase B Edge 持久化和性能

> Review 2026-06-06：B0 SQLite 在 Desktop 单机单用户场景非紧急，先加 JSON compaction 控制文件膨胀即可。SQLite 作为 P3 正常推进。

- [ ] B0 JSONL 事件流：append-only 日志替代 JSON 快照。
- [ ] B0 SQLite schema：projects / threads / runs / items + 索引，保持 store interface 不变。
- [ ] B0 FTS5 搜索：BM25 排序，snippet 高亮。
- [ ] B0 数据迁移：旧 JSON 快照自动导入 SQLite，损坏时可回退。
- [ ] B1 离线队列：Hub 断连时写操作入队，重连后批量同步。
- [ ] B1 Cursor 同步协议：`?cursor=<last_seq>` 增量拉取。
- [ ] EventBus debounce + signature 去重：16ms batch，相同 payload 只广播一次，降低高频流式 fanout。
- [x] B2 N+1 修复：Session list、StartTeamRun、dispatchTask 已关闭。
- [ ] B2 migration 双系统统一：golang-migrate 作为唯一生产路径，AutoMigrate 仅测试使用。
- [x] B3 Hub agent.go 拆分完成。
- [ ] B3 Edge ProcessExecutor 拆分为 executor/output/hub_callback/subagent 四个文件。
- [ ] B4 双重 dispatch 路径统一：text scan 与 NDJSON event 合并。
- [ ] B4 输出截断事件：stdout/stderr 超限时发 `run.output.truncated`。

### P3-C API、事件和 CI 治理

- [ ] OpenAPI 补齐：`GET /v1/model-catalog`。
- [ ] OpenAPI 补齐：`GET /v1/agent-instances/{id}`。
- [ ] OpenAPI 修正：`DELETE /v1/threads/{threadId}`。
- [ ] OpenAPI 修正：`POST /v1/threads/{threadId}:archive` 不再标 planned。
- [ ] OpenAPI 修正：`POST /v1/agent-instances` 与代码注册状态一致。
- [ ] OpenAPI 补齐：`POST /cloud/edge/register`。
- [ ] OpenAPI 补齐：`GET /client/auth/oidc/callback`。
- [ ] events.md 修正：`run.agent.sub_agent_status` / `task_dispatch_failed` / `friend.accepted` / `message.delta` 与代码一致。
- [ ] Desktop 全量测试基线治理：shared UI 测试的 React 版本/路径重复问题，edge-real 测试对统一信封和错误码的旧断言。
- [ ] Release workflow 加分支限制，避免任意分支推 `v*` tag 触发发布。
- [ ] gosec/golangci-lint 从 warning 变成可解释的 gate；不要用降级规则换绿。
- [ ] macOS CI 的 `continue-on-error` 要么取消，要么写明跳过原因。
- [ ] Renovate/Dependabot + CODEOWNERS。

### P3-D 安全增强

- [ ] Hub OIDC blacklist 写入失败补偿：Redis 不可用时不能让旧 refresh token 被重放。
- [ ] Edge `internal/runners` 死代码清理或明确兼容边界。
- [ ] Hub API 路由版本策略：加 `/v1/` 或文档声明 `/client`/`/edge`/`/web` 的版本边界。
- [ ] Tauri CSP 收紧：`connect-src` 固定端口，移除不必要 `unsafe-inline`。
- [ ] 配置弱密码校验扩展到 DB/Redis/TokenDanceID。

## P4: 长期产品和生态

- [ ] Web 工作台：等 Desktop 跑通后迁移共享 transcript/composer/inspector，不另起一套体验。
- [ ] Mobile 轻量端：查看、审批、预览，不承担比赛主力。
- [ ] Remote Edge：SSH / Tailscale / Hub Relay 连接远程 Desktop。
- [ ] Cloud Edge：云端执行目标和审计。
- [ ] Agent Adapter SDK：参考 Copilot SDK / Cursor SDK，降低第三方 CLI 接入成本。
- [ ] Feishu/Lark/Telegram IM 桥接：作为协作入口，不变成第二套登录系统。
- [ ] Agent Market：搜索、安装、使用自定义 Agent。
- [ ] 部署发布：聊天中“部署”指令，返回部署状态卡片和预览 URL。
- [ ] 版本历史：Checkpoint + Diff 对比 + 回滚。
- [ ] Content Pool：SHA-256 + zstd 文件内容去重。
- [ ] OpenAPI spec -> 类型生成；desktop/web/mobile 共享 API client。

## 暂缓规则

这些不是废弃项，但在 Desktop 演示闭环前不抢 P0：

- Web/Mobile 大重组。
- Go repo-wide、Docker、cross-platform、E2E 的系统性基线治理。
- Edge SQLite/FTS5 完整落地。
- Feishu/Lark、Agent Market、Remote/Cloud Edge。
- ChatView 全量重写或全局状态大重构。

如果暂缓项成为 Desktop Demo 的直接 blocker，必须写清 blocker、最小修复范围和回退方案，再单独派发。

## 分支和派工

| 角色 | 适合任务 | 禁止事项 |
|---|---|---|
| 主 Agent | 架构判断、PR 顺序、合并、roadmap、比赛材料、最终验收 | 不把未验证分支当完成 |
| Codex GPT-5.5 subagent | 全方面强；中等上下文内的核心实现、跨模块小集成、关键 code review | 不承担超过 256k 的超大仓库研究 |
| Claude opus = DeepSeek-V4-Pro | 1M 长上下文推理、竞品仓库研究、架构/安全审查 | 不做机械批量改文件 |
| Claude sonnet = GLM-5.1 | 代码和 agentic 能力强；窄范围 Go/TS 实现、测试修复 | 不接大面积读仓；每次只给必要文件 |
| Claude haiku = mimo-v2.5 | 多模态、看图、视觉 QA、竞品截图复核 | 不作为代码主力 |

每次派工必须写清：允许路径、禁止范围、验收命令、证据输出。subagent 交付后由主 Agent 复核 diff 和测试。

## 已完成基线

- A0 Edge errcode、A1 reqlog、A2 debug endpoints、A3 P0 security、A4 App.tsx Wave 2。
- A6.2 Edge 成功响应统一信封、A6.3 DB TLS。
- B2 Hub N+1 修复和索引。
- Sprint #1 IM @Agent，Sprint #2 IM 富消息，Sprint #4 Tool 卡片颜色/标题。
- 前端止血：execCommand、Agent Market mock、iframe sandbox、z-index、console 噪音。
- PR #270 TeamRun E2E 证据链基础已合入，但最终真实录屏和导出仍是 P0。

## 归档规则

- 主 roadmap 保留优先级、依赖、长期任务、当前分支队列和验收标准。
- 历史分析、已完成流水、竞品长文、深度审计明细放 `docs/archive/`。
- **Review 报告**：活跃发现放 `docs/review/`，采纳进 roadmap 后标记 "已采纳"。过期不等于归档。
- 更新时改现有条目，不追加第二套状态叙事。
- 比赛提交事实同步到 `docs/competition/*`；接手状态同步到 `docs/handoffs/STATE.md`。
