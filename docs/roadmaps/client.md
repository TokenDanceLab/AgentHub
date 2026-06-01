# AgentHub Desktop Client Roadmap

> 范围：React 19 + Tauri 2 桌面应用 (`app/desktop`) | 最后更新：2026-05-24
>
> **Phase 0 已全部完成 (M7)**：P0-1~P0-4 + QW-1~QW-5 全部落地。
> 下文 `- [ ]` 为历史记录，实际代码已实现。Phase 1/2 为后续规划。
>
> 参考：21 个竞品/参考项目 | 实施详情见 `docs/architecture/design/client-p0-architecture.md` | 参考模式见 `docs/architecture/design/client-reference-patterns.md`

---

## 1. 当前状态

### 1.1 现状概览

| 维度 | 状态 | 详情 |
|------|:--:|------|
| 组件 | 17 个 | ChatView, DiffViewer, PromptInput, ThreadPanel, StatusBar, SearchDialog, ContextUsage, MarkdownRenderer, RunDetail, PermissionDialog, ModelSelector, AgentSelector, ReasoningSelector, SettingsPanel, MobileNav, ErrorBoundary, AppShell |
| Hooks | 7 个 | useChatMessages, useStreamingText, useAutoScroll, useKeyboard, useTheme, useMediaQuery, useDebounce |
| Stores | 5 个 | runStore, threadStore, connectionStore, uiStore, settingsStore |
| 测试 | 12/12 通过 | vitest + Testing Library |

### 1.2 已完成（Desktop P0 主链路、M3b/M4 已验收子项）

- [x] 设计令牌系统、ChatView 消息气泡、DiffViewer、PromptInput、ThreadPanel
- [x] StatusBar、SearchDialog、ContextUsage、App.tsx 3 面板布局
- [x] WebSocket 客户端（cursor 重放、指数退避）、国际化（zh/en）
- [x] Tauri 壳（窗口管理、原生菜单、系统托盘）

### 1.3 关键差距（按优先级）

| 优先级 | 维度 | 核心缺失 |
|:--:|------|------|
| **P0** | 状态架构 | 服务端/客户端状态混杂，无 TanStack Query、无状态机、无乐观更新 |
| **P0** | 输入体验 | 受控输入引起流式渲染闪烁，无草稿持久化、无循环检测、无去重 |
| **P0** | 连接健壮性 | 无心跳、无离线队列、无重连回调、无传输抽象 |
| **P0** | 性能 | 无虚拟滚动、App.tsx 500+ 行单体 |
| **P0** | QA/交接 | Desktop UI 变更必须按 `docs/operations/desktop-ui-qa-sop.md` 留存客户端截图、真实交互路径、DOM probe、脱敏命令摘要和剩余风险 |
| **P1** | 聊天消息 | 无消息树、无子 Agent 视图、无 Fork、无 @提及、无斜杠命令 |
| **P1** | Agent 可观测性 | 无实时 Token、无工具时间线、无任务列表 |
| **P1** | 线程管理 | 扁平列表、无状态标记、无归档、无快捷键面板 |
| **P2** | Diff/代码审查 | 无 side-by-side、无行级评论、无语法高亮 diff、无增量流式 diff |
| **P2** | Agent 协作/市场 | 无 Agent 市场、无通信图可视化、无实时协作 |

---

## 2. 实施任务清单

### Phase 0: 基础打磨（~14 天）

#### P0-1: 状态架构重构（5 天）

- [x] 引入 TanStack Query 服务端状态管理（3 天）
  - 新建 `app/desktop/src/api/queryClient.ts`、`threadQueries.ts`、`runQueries.ts`
  - 改造 `useChatMessages.ts`：事件 → `queryClient.invalidateQueries`
  - 改造 `runStore.ts`：删除服务端数据，仅保留 isStreaming 等客户端标志
  - 参考：Multica TanStack Query+Zustand 分离模式
- [x] RunState 正式状态机（1 天）
  - 状态：`NO_TASK → RUNNING ↔ STREAMING → WAITING_FOR_INPUT / IDLE / COMPLETED / FAILED / CANCELLED`
  - 新增字段：`loopCount`, `errorCount`, `abortController`, `fileReadCache`
  - 参考：Roo-Code AgentLoopState + cline TaskState
- [x] Zustand selector 粒度优化（1 天）
  - 所有 store 使用 `subscribeWithSelector` 中间件
  - 组件使用 selector 而非全 store 订阅

> 实施详情（代码、风险评估、测试要求）：见 `docs/architecture/design/client-p0-architecture.md#p0-1-状态架构重构5-天`
> **M5/M7 已完成 — 2026-05-24**

#### P0-2: 输入体验修复（4 天）

- [x] 非受控输入迁移（1 天）— `PromptInput.tsx` `useState` → `useRef + DOM`
- [x] 草稿持久化（1 天）— 新建 `useInputDraft.ts`，localStorage 按 threadId 存储
- [x] 工具调用循环检测（1 天）— `useChatMessages.ts` 签名去重，3 次警告 5 次拦截
- [x] 文件读取去重缓存（1 天）— `Map<path, {readCount, mtime}>` 缓存

> 实施详情：见 `docs/architecture/design/client-p0-architecture.md#p0-2-输入体验修复4-天`

#### P0-3: 连接健壮性（3 天）

- [x] WebSocket 心跳（0.5 天）— 10s ping/pong + 15s 超时检测
- [x] 离线消息队列（1 天）— 新建 `offlineQueue.ts`，断线入队 localStorage，重连后按序发送
- [x] 传输层抽象（1 天）— 新建 `transport.ts` Transport 接口，WebSocketTransport / MockTransport 实现
- [x] 架构分离（0.5 天）— `useChatMessages.ts` 拆分为 messageProcessor / stateStore / eventBus

> 实施详情：见 `docs/architecture/design/client-p0-architecture.md#p0-3-连接健壮性3-天`

#### P0-4: 性能基础（2 天）

- [x] 虚拟滚动（1.5 天）— `@tanstack/react-virtual`，>200 条消息时启用
- [x] App.tsx 视图注册表拆分（0.5 天）— 新建 `viewRegistry.ts`，App.tsx 从 500+ 行拆分

> 实施详情：见 `docs/architecture/design/client-p0-architecture.md#p0-4-性能基础2-天`
> **M5/M7 已完成 — 2026-05-24**

---

### Phase 1: 竞争 UX（~15 天）

#### P1-1: 多 Agent 聊天（5 天）

- [ ] 消息树形数据模型（2 天）— `buildTree/flattenTree` 函数
- [x] 子 Agent 内联视图 Desktop MVP（2026-05-29）— `ChatView` 支持 `child_agent` block，处理 `run.agent.task_dispatched`、`run.agent.child_spawn`、`run.agent.child_result` 并按 child id / child run id upsert；完整 sidechain 展开、child transcript 和服务端 message-tree lineage 仍依赖 P1-1 消息树后续。
- [ ] 消息 Fork 支持（1 天）— 从任意消息分叉新线程
  - [x] Desktop fork MVP（2026-05-29）：Agent 回复 action 与 `/fork` 会创建真实 Edge thread，切换到新 thread，并把来源 thread + 最近用户请求写入可编辑 composer draft；当前不是服务端 message-tree fork。

#### P1-2: 富文本输入（4 天）

- [x] @提及 + 自动补全 Desktop MVP（2026-05-29）— `@agent` 切换真实 Runtime，`@file` 打开真实附件入口，`@thread` 插入可发送 thread 引用；popover 已 portal 到 body，修复点击穿透、焦点丢失和右侧越界。完整富文本 reference model 仍留到 P1-1 message tree 后续。
- [ ] 斜杠命令系统（1.5 天）— `/model`, `/clear`, `/retry`, `/fork` 等
  - [x] Desktop composer slash palette MVP（2026-05-29）：`/` 可直接执行 Agent 切换、真实 model catalog 选择、reasoning、permission、workspace selector 和 clear composer；命令文本不会发送给 Runtime。
  - [x] `/retry` / `/fork` Desktop MVP（2026-05-29）：`/retry` 重发最近用户请求，Agent 消息 action 的 retry 也回溯上一条用户 prompt，不会把 Agent 输出当 prompt；`/fork` 创建真实 thread 并生成可编辑 draft。
  - [ ] 完整 message-tree fork、branch lineage、server-side parent message id 仍依赖 P1-1 数据模型后再接。
- [ ] 模型别名解析（0.5 天）— "sonnet" → 完整 model ID

#### P1-3: Agent 可观测性（3 天）

- [ ] Token 用量实时更新（1 天）— 流式过程中实时更新 ContextUsage 条
  - [x] Desktop chat usage strip MVP（2026-05-29）：`run.agent.session_metrics/context_usage/context_warning/context_compaction` 会投影到当前 Agent 回复内的紧凑上下文条，`run.agent.result.usage` 会渲染同一风格的 Token 用量条；按 runId upsert，避免上下文告警刷屏。Playwright `desktop-chat-context-usage-pw.png` 与 probe 覆盖 typed runtime events、Token 用量、阈值、费用、模型/provider 标签、无横向溢出和不被 composer 遮挡。完整跨 run 聚合与持续 streaming 预算曲线仍留在 P1-3 后续。
- [x] 工具调用时间线面板 Desktop MVP（2026-05-29）— `ToolTimeline.tsx` 从真实聊天 message blocks 派生 route / tool / file / task / child-agent 活动，紧凑显示在 Agent 消息内；已用 Playwright `desktop-chat-subagent-cards-pw.png` 和 probe 覆盖 typed subagent + route + tool/file 活动。完整 RunDetail 观测控制台、实时 token usage 和服务端任务索引仍留在 P1-3 后续。
- [x] Agent 任务列表 Desktop MVP（2026-05-29）— `TaskList.tsx` 从同一条 Agent 消息里的 `agent_task` / `child_agent` blocks 派生紧凑总览，显示任务总数、运行/完成/失败计数、worker 与 child run 线索；不引入独立假状态。服务端 TeamTask 索引、跨 run 聚合和右侧 RunDetail 任务表仍留到后续。

#### P1-4: 线程管理升级（3 天）

- [x] 按项目+日期分组 Desktop MVP（2026-05-29）— ThreadPanel 按 Today / Yesterday / Earlier 分组；多项目同时可见时自动显示 `projectId · 日期`，单项目保持紧凑日期标题。
- [ ] 线程状态标记（0.5 天）— 运行中/错误/未读
  - [x] active/archived 状态 Desktop MVP（2026-05-29）：左侧会话支持活跃/已归档 tab、归档状态 pill 和计数；运行中/错误/未读的 live 状态仍待接 Run/Thread event 聚合。
  - [x] 真实 Run 状态标记 Desktop MVP（2026-05-29）：`App` 将 `/v1/runs` 全量列表传给 `ThreadPanel`，会话行从真实 `RunInfo.status` 派生 `运行中`、`待审批`、`失败` pill；选中会话不显示活动 dot，避免伪未读。Playwright `desktop-thread-status-pw.png` / `desktop-thread-status-probe.json` 覆盖 running、waiting_approval、failed、completed 四类 run。
  - [ ] 精确未读仍需 Thread read cursor / lastSeen item id 或 Hub unread counter；当前不再用 `runCount` 伪装未读。
- [x] 线程归档 Desktop/Edge MVP（2026-05-29）— Edge 支持 `PATCH /v1/threads/{id}`、`POST /v1/threads/{id}:archive`、`DELETE /v1/threads/{id}`；Desktop 归档/恢复按钮调用真实 mutation，TanStack Query 会更新所有 `['threads', projectId]` cache key 并在失败时回滚。Playwright `desktop-thread-archive-active-pw.png` / `desktop-thread-archive-archived-pw.png` 覆盖真实 UI 操作和 POST/PATCH 请求捕获。
- [x] 快捷键面板 Desktop MVP（2026-05-29）— `ShortcutHelp` 与 Settings `键盘快捷键` 共用 `KEYBOARD_SHORTCUT_GROUPS`，只展示真实接线快捷键；内置浏览器截图 `.tmp/desktop-g-shortcut-after-iab.png`、`.tmp/desktop-settings-keyboard-shortcuts-iab.png`，probe 覆盖 4 组 / 14 行、无水平溢出和 `g/p/y` descender 行盒余量。

---

### Phase 2: 差异化功能（~20 天）

#### P2-1: 进阶 Diff/代码审查（5 天）

- [ ] Side-by-side diff 视图（2 天）
- [ ] 行级评论（1.5 天）
- [ ] Diff 语法高亮（1 天）— Shiki 或 highlight.js
- [ ] Diff 统计面板（0.5 天）

#### P2-2: 多 Agent 协作可视化（5 天）

- [x] TeamRun branch switch Desktop MVP（2026-05-29）— TeamRun Console 的 AgentTeam / TeamRun 列表已从静态卡片改为真实可点击分支选择；选择不同 Hub TeamRun 会把 `selectedTeamId/selectedRunId` 写入 `useHubAgentTeams` 查询 key，并重新读取对应 `TeamRunState`、tasks、events。Playwright 截图 `.tmp/desktop-agentteam-console-branch-switch-pw.png`、probe `.tmp/desktop-agentteam-console-after-probe.json` 覆盖切到 Review TeamRun 后成员、任务板、路由和 `agent.result` 活动全部换源；双真实 Runtime Profile live smoke 仍归 AT-4。
- [x] TeamRun result/artifact/budget blocks Desktop MVP（2026-05-29）— TeamRun Console 现在直接消费 `TeamRunState.terminal_reason`、`run_events` 中的 `agent.result`、`artifacts` 和 `budget`，渲染结果、产物与预算区块，不再只在活动列表里露出原始事件。Playwright 截图 `.tmp/desktop-agentteam-console-results-pw.png`、probe `.tmp/desktop-agentteam-console-after-probe.json` 覆盖 terminal reason、result event、artifact path、token budget、无横向溢出和空 console；双真实 Runtime Profile live smoke 仍归 AT-4。
- [x] TeamRun approval/conflict decision Desktop MVP（2026-05-29）— TeamRun Console 的 `允许` 与 `标记人工合并` 按钮已走真实 Hub mutation，Playwright 捕获 request body：approval 为 `{ decision: "allow", reason: "Desktop TeamRun Console decision" }`，conflict 为 `{ path, resolution: "manual_merge", reason: "Marked from Desktop TeamRun Console" }`；Desktop `useHubIntegration` 同步消费 Hub `agent.control` / `permission.decide` 并 POST Local Edge `/v1/permissions/decide`。截图 `.tmp/desktop-agentteam-console-decision-after-pw.png`、probe `.tmp/desktop-agentteam-console-after-probe.json` 覆盖按钮消失、状态刷新、request body 与空 console；2026-05-29 追加真实 HTTP Edge pending endpoint 集成测试，证明 Desktop hook 能消费 pending permission 并阻止同一 control 重放。完整 live Hub WS device delivery + Go Edge handler 同进程 E2E 仍归 AT-5。
- [x] TeamRun artifact source compare Desktop MVP（2026-05-29）— 冲突卡现在按 `conflict_id` / normalized path 从 `TeamRunState.artifacts` 聚合同一路径的来源，显示 agent task、member、edge run、action/status/time，并把 `采用该来源`、`保留全部`、`标记人工合并` 按钮放在卡片内部；`采用该来源` 会向 Hub 发送 `resolution: "accept_agent_task"` 和 `selected_agent_task_id`，不是前端占位。Playwright 截图 `.tmp/desktop-agentteam-console-conflict-compare-pw.png`、probe `.tmp/desktop-agentteam-console-after-probe.json` 覆盖两个 source 卡、真实 request body、无横向溢出和空 console；artifact 内容/diff content index 后的真正 side-by-side diff 仍归 AT-5 后续。
- [ ] Agent 通信图可视化（3 天）— D3/ReactFlow
- [ ] Agent 市场/发现（2 天）

#### P2-3: 实时协作（4 天）

- [ ] 多光标/实时协作（3 天）— Yjs / PartyKit
- [ ] 会话共享链接（1 天）

#### P2-4: 工作区集成（3 天）

- [ ] 文件树侧栏（1.5 天）
- [ ] Git 集成面板（1.5 天）

#### P2-5: 性能和可访问性（3 天）

- [ ] React.memo 全面审计（1 天）
- [ ] 代码块懒加载（0.5 天）
- [ ] WCAG 2.1 AA a11y 审计（1 天）
- [ ] E2E 测试覆盖（0.5 天）— Playwright + Tauri driver

---

## 3. P0 依赖图和关键路径

### 任务依赖

```
P0-1 (状态架构, 5d)
  ├── 阻塞: P0-2 中的循环检测和去重缓存
  ├── 阻塞: P0-4 中的视图注册表
  └── 可并行: P0-2 中的非受控输入 + 草稿持久化

P0-2 (输入体验, 4d)
  ├── 前置: P0-1 完成（循环检测依赖 runStore 新字段）
  ├── 可提前做: 非受控输入 + 草稿持久化
  └── 可并行: P0-3 心跳和离线队列

P0-3 (连接健壮性, 3d)
  ├── 前置: 无（完全独立）
  └── 可并行: 与 P0-1/P0-2 同时进行

P0-4 (性能基础, 2d)
  ├── 前置: P0-1 完成
  └── 阻塞: Phase 1 虚拟滚动是前提
```

### 关键路径

```
Day 1-2:  │ P0-1 (TanStack Query) │  │ P0-3 (心跳+离线队列) │  │ P0-2 (非受控输入+草稿) │
Day 3-5:  │ P0-1 继续 (状态机+selector) │  │ P0-3 (传输层抽象)    │  │ P0-2 (循环检测+去重)  │
Day 6-7:  │ P0-4 (虚拟滚动+viewRegistry) │ ← 依赖 P0-1 完成

总工期: ~7 天 (并行) vs ~14 天 (串行)
关键路径: P0-1 (5d) → P0-4 (2d) = 7d
```

### 并行建议

| Stream | 内容 | 工期 |
|------|------|:--:|
| **A** | P0-1 状态架构（最长路径） | 5d |
| **B** | P0-2 前半（非受控输入+草稿）+ P0-3（连接健壮性） | 4d |
| **C** | P0-4 性能基础（Day 6-7） | 2d |

---

## 4. Quick Wins（<1 天/项）

| # | 任务 | 时间 | 影响 |
|---|------|:--:|------|
| QW-1 | 非受控输入迁移 | 0.5d | 流式渲染时 PromptInput 不再闪烁 |
| QW-2 | 草稿持久化 | 0.5d | 切换线程不再丢失输入 |
| QW-3 | WebSocket 心跳 | 0.5d | 15s 自动断线检测 |
| QW-4 | Zustand selector 粒度 | 0.5d | 减少不必要重渲染 |
| QW-5 | Toast 反馈 | 0.5d | 操作有明确成功/失败反馈 |

---

## 5. 架构决策速查

### 状态管理拆分

```
TanStack Query（服务端缓存）     Zustand（客户端 UI 状态）
├── ["threads"]                 runStore: isStreaming, runState, loopCount
├── ["runs"]                    uiStore: sidebarWidth, theme, rightPanelTab
├── ["agents"]                  connectionStore: isOnline, latency, errorCount
└── Mutations（乐观更新）         settingsStore: defaultModel, language
```

### 事件流

```
Edge Server → WebSocket NDJSON → eventClient.ts
  → Transport.send() [心跳 + 离线队列]
  → messageProcessor.ts [循环检测 + 去重]
  → queryClient.invalidateQueries [TanStack Query 缓存刷新]
  → Zustand [客户端状态更新]
  → React 组件树 [selector 粒度重渲染]
```

---

## 6. 不构建的内容

| 决定 | 原因 |
|------|------|
| 不用 protobuf（保持 JSON） | 当前规模 JSON 足够 |
| 不用自研编辑器 | textarea 够用，P1 MentionInput 是轻量增强 |
| 不用 Service Worker 离线 | Tauri 原生离线能力替代 |
| 不构建多窗口 | 推迟到 P3+ |
| 不引入额外状态库 | Zustand + TanStack Query 覆盖全部场景 |
| 不构建插件系统（当前） | 先完成核心 UX 打磨 |

---

## 7. 验证命令

```bash
# 单元测试
npx vitest run

# E2E 测试（P2 后）
npx playwright test

# 类型检查
npx tsc --noEmit

# 构建验证
npm run build

# 具体 P0 验收标准见 docs/architecture/design/client-p0-architecture.md 各节
```

---

## 8. 工作量总计

| 阶段 | 天数 | 任务数 | 核心交付 |
|------|:--:|:--:|------|
| Phase 0: 基础打磨 | 14 | 12 | TanStack Query、非受控输入、循环检测、心跳、虚拟滚动 |
| Phase 1: 竞争 UX | 15 | 12 | 消息树、@提及、斜杠命令、Token 实时、工具时间线 |
| Phase 2: 差异化 | 20 | 13 | side-by-side diff、行评论、Agent 通信图、Git 集成 |
| **总计** | **49** | **37** | |

### 优先级速查

| 优先级 | 数量 | 代表项 |
|:--:|:--:|------|
| **P0** | 12 | TanStack Query、非受控输入、循环检测、去重、心跳、虚拟滚动、状态机 |
| **P1** | 12 | 消息树、@提及、斜杠命令、子 Agent 视图、Token 实时、时间线、线程分组 |
| **P2** | 13 | side-by-side diff、行评论、Agent 通信图、Agent 市场、协作、Git 集成、a11y |

---

## 9. 参考文档

- 实施详情：`docs/architecture/design/client-p0-architecture.md`
- 参考模式：`docs/architecture/design/client-reference-patterns.md`
- 相关路线图：`docs/roadmaps/integration.md`
