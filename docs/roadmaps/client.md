# AgentHub Desktop Client Roadmap

> 范围：React 19 + Tauri 2 桌面应用 (`app/desktop`) | 最后更新：2026-05-24
> 参考：18 个竞品/参考项目源码级分析 | 基础：68 份报告 / 35,000+ 行分析

---

## 1. 当前状态评估

### 1.1 现状概览

对 `app/desktop/src/` 完整源码审计后，现状总结如下：

| 维度 | 状态 | 详情 |
|------|:--:|------|
| 组件 | 17 个 | ChatView, DiffViewer, PromptInput, ThreadPanel, StatusBar, SearchDialog, ContextUsage, MarkdownRenderer, RunDetail, PermissionDialog, ModelSelector, AgentSelector, ReasoningSelector, SettingsPanel, MobileNav, ErrorBoundary, AppShell |
| Hooks | 7 个 | useChatMessages, useStreamingText, useAutoScroll, useKeyboard, useTheme, useMediaQuery, useDebounce |
| Stores | 5 个 | runStore, threadStore, connectionStore, uiStore, settingsStore |
| Contexts | 2 个 | ThemeContext, I18nContext |
| 设计令牌 | 230 行 | tokens.css：7 级字号、4 层表面色、4 档文字色、3 级字重、动画关键帧、WCAG 减弱动画、移动端防缩放 |
| API 层 | 112 行 | eventClient.ts：WebSocket + cursor 重放 + 指数退避（1s-30s） |
| 事件处理 | 589 行 | useChatMessages reducer：17 种事件类型 |
| 测试 | 12/12 通过 | vitest + Testing Library |

### 1.2 已有且工作正常

- [x] **设计令牌系统** — tokens.css 已完成 Phase 1 beautify（7 级字号 `textXs`-`textXl`，4 层表面色 `surfaceDefault`/`surfaceRaised`/`surfaceSunken`/`surfaceOverlay`，3 级字重，动画关键帧 `fadeIn`/`slideInRight`/`progressIndeterminate`，prefers-reduced-motion，移动端防缩放）
- [x] **ChatView 消息气泡** — 支持 9 种工具图标、相对时间格式化、工具输入摘要、流式文本渲染 (useStreamingText)、自动滚动 (useAutoScroll)、打字指示器
- [x] **DiffViewer** — 文件树侧栏、可折叠 hunks、行号、+/- 计数、按文件 accept/reject、expandAll/collapseAll
- [x] **PromptInput** — Agent 选择器、模型下拉、Reasoning effort 选择器、自适应 textarea、4000 字符限制
- [x] **ThreadPanel** — 内联重命名、删除确认、搜索过滤、相对时间显示
- [x] **StatusBar** — 延迟测量（绿色 <50ms，黄色 <200ms），错误计数，重连脉冲，深色/浅色主题切换
- [x] **SearchDialog** — Ctrl+K 全局搜索、前端文本扫描、消息块搜索（text/code/thinking/tool_use）、片段截断 80 字符
- [x] **ContextUsage** — 5 色分段条（system/user/assistant/tool/other）、Token 计数格式化、费用显示、紧凑模式、70% 警告/90% 危险阈值
- [x] **App.tsx** — 3 面板布局、懒加载 ChatView/RunDetail/SearchDialog、健康检查轮询、移动端响应式
- [x] **WebSocket 客户端** — cursor 重放、指数退避重连、状态/订阅处理器、JSON 发送
- [x] **国际化** — i18next 集成，en/zh 两种语言
- [x] **Tauri 壳** — Rust 侧窗口管理、原生菜单、系统托盘

### 1.3 关键差距

#### 1.3.1 状态架构（最重要）

| 差距 | 当前 | 应有 | 参考 |
|------|------|------|------|
| 服务端/客户端状态混杂 | runStore 混合 outputText + isStreaming | TanStack Query（服务端缓存） + Zustand（客户端 UI 状态） | Multica 分离模式 |
| 无缓存失效 | useChatMessages 直接写入本地状态 | 事件 → invalidate query → 组件自动重渲染 | TanStack Query 模式 |
| 无乐观更新 | 每次操作等服务器响应 | 即时 UI 更新 + 后台同步 | Multica useMutation |
| RunState 只有 5 个字段 | runId, status, outputText, toolCalls, changedFiles | 需 20+ 字段（含流式标志、错误计数、中止跟踪、去重缓存） | cline TaskState (20+ 维度) |
| 无正式状态机 | run.status 是自由字符串 | 正式状态机：NO_TASK → RUNNING ↔ STREAMING → WAITING_FOR_INPUT / IDLE | Roo-Code AgentLoopState |
| 无 Zustand selector | 全 store 订阅 | subscribeWithSelector 粒度订阅 | Roo-Code StateStore.subscribeToAgentState() |

#### 1.3.2 输入体验

| 差距 | 当前 | 应有 | 参考 |
|------|------|------|------|
| 受控输入 | `useState('')` — 每次重渲染触发 | **非受控输入** `useRef + DOM 写入` | 全部 7 个命令中心项目 |
| 无草稿持久化 | 切换线程丢失输入 | localStorage 或线程级 inputDraft | command-centers |
| 无富文本提及 | 纯文本 textarea | `@agent` `@file` `@thread` 提及 + 自动补全 | LibreChat / OpenCode |
| 无斜杠命令 | 无 | `/model`, `/clear`, `/retry`, `/fork` 等 | aider 30+ 命令 / continue pluggable |
| 无模型别名 | 需要完整模型 ID | "sonnet" → "claude-sonnet-4-6" 别名解析 | aider MODEL_ALIASES |

#### 1.3.3 Agent 交互

| 差距 | 当前 | 应有 | 参考 |
|------|------|------|------|
| 无工具调用去重 | Read 同一文件无限制 | fileReadCache Map<path, {readCount, mtime}> | cline TaskState |
| 无循环检测 | 工具可无限重复 | 软阈值 3 次警告 + 硬阈值 5 次升级用户 | cline loop-detection |
| 无子 Agent 视图 | 无 | 内联嵌套子 Agent 消息，树形展示 | Codex CLI AgentTree / LibreChat 消息树 |
| 无权限控制 UI | 硬编码全通过 | 可配置规则：Read 自动批准、Bash 始终询问 | cline CommandPermissionController |
| 无中断/恢复 | 无 | cancel() 当前运行、resume 历史运行 | Roo-Code AgentLoopState |
| 无 token 用量实时 | 仅结果时显示 | 流式过程中实时更新 ContextUsage 条 | OpenCode token meter |

#### 1.3.4 代码审查

| 差距 | 当前 | 应有 | 参考 |
|------|------|------|------|
| 无 side-by-side diff | 仅 unified 视图 | 双栏对比视图 | CCViewer / continue |
| 无行级评论 | 无 | 在 diff 行上添加评论/建议 | CCViewer DiffViewer |
| 无语法高亮 diff | 纯文本 | Shiki 或 highlight.js 语法着色 | continue Shiki 集成 |
| 无增量流式 diff | 预计算后显示 | 实时 myers-diff 流式计算 | continue streamDiff |
| 无 diff 统计面板 | 无 | +N/-M lines, N files changed 摘要条 | OpenCode DiffViewer |

#### 1.3.5 搜索和导航

| 差距 | 当前 | 应有 | 参考 |
|------|------|------|------|
| 仅前端文本扫描 | SearchDialog | FTS5 全文搜索（标题+内容） | CCViewer SQLite FTS5 |
| 无跨会话搜索 | 单线程内 | 全局跨项目/线程搜索 | CCViewer |
| 无搜索结果预览 | 文字片段 | 匹配行高亮 + 上下文 | CCViewer |
| 无快捷键大全 | 仅 Ctrl+K | 快捷键面板 (?) + 自定义 | OpenCode Keyboard Shortcuts |

#### 1.3.6 线程管理

| 差距 | 当前 | 应有 | 参考 |
|------|------|------|------|
| 扁平列表 | 无分组 | 按项目分组 + 按日期分组 | CCViewer / LibreChat |
| 无状态标记 | 无 | 运行中/错误/未读 状态图标 | LobeHub |
| 无归档 | 只有删除 | 归档/取消归档 | CCViewer |
| 无草稿关联 | 无 | threadDraft 持久化输入框内容 | command-centers |
| 无 Fork | 无 | 从任意消息分叉新线程 | LibreChat 4 模式 Fork |

#### 1.3.7 连接和离线

| 差距 | 当前 | 应有 | 参考 |
|------|------|------|------|
| 无心跳 | 依赖 WS 内置 | 10s ping/pong + 断线检测 | Kanna KannaSocket |
| 无离线队列 | 断线消息丢失 | 离线消息队列 + 重连后发送 | Multica WSClient |
| 无重连回调 | 无 | onReconnect / onMaxRetries / onStateChange | Multica |
| 无传输抽象 | 硬编码 WebSocket | 可替换传输层（WebSocket / IPC / Native Messaging） | Roo-Code ExtensionClient |

#### 1.3.8 性能

| 差距 | 当前 | 应有 | 参考 |
|------|------|------|------|
| 无虚拟滚动 | 所有消息渲染 | 超过 200 条消息时虚拟列表 | CCViewer / LibreChat |
| 无 React.memo 审计 | 未优化 | 关键组件 memo + useMemo/useCallback 审计 | OpenCode |
| 无懒加载图片 | 无 | Mermaid 图表懒加载、代码块展开/折叠 | OpenCode |
| App.tsx 500+ 行 | 单体 | 视图注册表 + 动态面板 | command-centers viewRegistry |

---

## 2. 竞争差距分析

对比 6 个关键 UX 维度与最佳参考项目：

### 2.1 综合对比

| UX 维度 | AgentHub 当前 | 最佳参考 | 差距 | 核心缺失 |
|------|:--:|------|:--:|------|
| **聊天/消息** | 7/10 | LibreChat (10/10) | -3 | 消息树、Fork、子 Agent 嵌套、消息反应、编辑/重新生成 |
| **Agent 可观测性** | 4/10 | OpenCode (9/10) | -5 | Token 实时用量、工具调用时间线、Agent 状态机可视化、任务列表 |
| **Diff/代码审查** | 5/10 | CCViewer (9/10) | -4 | side-by-side、语法高亮、行级评论、增量流式 diff、diff 统计面板 |
| **Agent 管理** | 3/10 | LobeHub (8/10) | -5 | Agent 市场/发现、实例仪表盘、角色配置、对话历史分析 |
| **布局/Shell** | 6/10 | CCViewer (8/10) | -2 | 可调整面板大小、多面板布局预设、标签面板、命令面板 |
| **主题/设计系统** | 6/10 | LobeHub (9/10) | -3 | 主题市场、自定义主题编辑器、OKLCH 高级色彩、动画库 |

### 2.2 各维度详细对比

#### 2.2.1 聊天/消息体验

| 功能 | AgentHub | LibreChat | OpenCode | LobeHub | cline |
|------|:--:|:--:|:--:|:--:|:--:|
| Markdown 渲染 | x | x | x | x | x |
| 代码语法高亮 | x | x | x | x | x |
| 流式文本渲染 | x | x | x | x | x |
| 工具调用展示 | x | x | x | x | x |
| 消息操作（复制/重试/删除） | x | x | — | x | x |
| 消息编辑 | — | x | — | x | — |
| 消息重新生成 | — | x | x | x | — |
| 消息分支/Fork | — | x | — | — | — |
| 消息反应（点赞/踩） | — | — | — | x | — |
| 子 Agent 内联嵌套 | — | x | — | — | — |
| 消息树形视图 | — | x | — | — | — |
| 滚动到底部按钮 | x | x | x | x | x |
| 打字指示器 | 三点 | 三点+头像 | 脉冲条 | 三点+头像 | 脉冲条 |
| 消息搜索（会话内） | — | x | x | — | — |

#### 2.2.2 Agent 可观测性

| 功能 | AgentHub | OpenCode | Kanna | LobeHub | cline |
|------|:--:|:--:|:--:|:--:|:--:|
| 实时 Token 用量 | 结果时 | x（实时） | — | x（实时） | x（实时） |
| Token 费用显示 | x | x | — | x | x |
| 工具调用时间线 | — | x | x | — | — |
| Agent 状态机显示 | — | — | x | x | — |
| 工具调用次数统计 | — | x | — | — | — |
| 上下文窗口百分比 | x | x | — | x | x |
| 任务/TODO 列表 | — | x | — | — | — |
| 子 Agent 层级视图 | — | — | — | — | x |
| 权限请求历史 | x | — | — | — | — |
| 错误/重试跟踪 | — | — | — | — | x |

#### 2.2.3 Diff/代码审查

| 功能 | AgentHub | CCViewer | OpenCode | continue | aider |
|------|:--:|:--:|:--:|:--:|:--:|
| Unified Diff | x | x | x | x | x |
| Side-by-Side | — | x | — | x | — |
| 行号 | x | x | x | x | — |
| 文件树侧栏 | x | x | x | — | — |
| 语法高亮 diff 行 | — | x | — | x | x |
| 折叠 hunks | x | x | x | — | — |
| Accept/Reject 按文件 | x | — | — | — | — |
| Accept/Reject 按 hunk | — | x | — | x | — |
| 行级评论 | — | x | — | — | — |
| 增量流式 diff | — | — | — | x | x |
| Diff 统计面板 | — | — | x | — | — |
| Git commit UI | — | x | — | — | x |

---

## 3. 实施阶段

### Phase 0: 基础打磨（~14 天）

> 目标：修复核心架构债务，达到"可靠可用"标准

#### P0-1: 状态架构重构（5 天）

- [ ] **引入 TanStack Query 服务端状态管理**（3 天）
  - 文件：`app/desktop/src/api/queryClient.ts`（新建）
  - 文件：`app/desktop/src/api/threadQueries.ts`（新建）— useThreads, useThread, useThreadMessages
  - 文件：`app/desktop/src/api/runQueries.ts`（新建）— useRun, useRuns, useCreateRun
  - 改造：`app/desktop/src/hooks/useChatMessages.ts` — 事件 → queryClient.invalidateQueries
  - 改造：`app/desktop/src/stores/runStore.ts` — 删除服务端数据，仅保留 isStreaming 客户端标志
  - 改造：`app/desktop/src/stores/threadStore.ts` — 移至 TanStack Query 缓存
  - 参考：Multica `03-source-adoption-map.md` TanStack Query+Zustand 分离模式

- [ ] **RunState 正式状态机**（1 天）
  - 文件：`app/desktop/src/stores/runStore.ts` — 重构为状态机
  - 状态：`NO_TASK → RUNNING ↔ STREAMING → WAITING_FOR_INPUT / IDLE / COMPLETED / FAILED / CANCELLED`
  - 新增字段：`loopCount`, `errorCount`, `abortController`, `fileReadCache: Map<string, {readCount, mtime}>`
  - 参考：Roo-Code `AgentLoopState` + cline `TaskState`（20+ 维度）

- [ ] **Zustand selector 粒度优化**（1 天）
  - 改造：所有 store 使用 `subscribeWithSelector` 中间件
  - 改造：组件使用 selector 而非全 store 订阅
  - 文件：`app/desktop/src/stores/uiStore.ts`, `connectionStore.ts`, `runStore.ts`
  - 参考：Roo-Code `StateStore.subscribeToAgentState()`

#### P0-2: 输入体验修复（4 天）

- [ ] **非受控输入迁移**（1 天）
  - 文件：`app/desktop/src/components/PromptInput.tsx:49` — `useState('')` → `useRef + DOM 写入`
  - 原因：受控输入在每次流式渲染时触发不必要的重渲染
  - 参考：全部 7 个命令中心项目（crush, eca, emdash, jean, orca, picoclaw, ruflo）

- [ ] **草稿持久化**（1 天）
  - 文件：`app/desktop/src/hooks/useInputDraft.ts`（新建）
  - 逻辑：localStorage 按 threadId 存储输入草稿，切换线程自动保存/恢复
  - 文件：`app/desktop/src/components/PromptInput.tsx` — 集成 useInputDraft
  - 参考：command-centers `01-source-adoption-map.md`

- [ ] **工具调用循环检测**（1 天）
  - 文件：`app/desktop/src/hooks/useChatMessages.ts` — 在 `run.agent.tool_call` 事件处理中新增 `checkRepeatedToolCall` 逻辑
  - 逻辑：`Map<string, number>` 跟踪 `toolName:JSON.stringify(input)` 签名 → 出现 3 次注入警告 → 出现 5 次硬拦截
  - 参考：cline `loop-detection.ts:21-68`

- [ ] **文件读取去重缓存**（1 天）
  - 文件：`app/desktop/src/hooks/useChatMessages.ts` — 在 Read 工具调用时检查缓存
  - 逻辑：`Map<filePath, {readCount, mtime}>` — 同一文件且 mtime 未变 → 跳过
  - 参考：cline `TaskState.ts:50-52` fileReadCache

#### P0-3: 连接健壮性（3 天）

- [ ] **WebSocket 心跳**（0.5 天）
  - 文件：`app/desktop/src/api/eventClient.ts` — 添加 10s ping/pong + 15s 超时检测
  - 参考：Kanna `04-source-adoption-map.md` KannaSocket

- [ ] **离线消息队列**（1 天）
  - 文件：`app/desktop/src/api/offlineQueue.ts`（新建）
  - 逻辑：断线时消息入队 localStorage → 重连后按序发送
  - 文件：`app/desktop/src/api/eventClient.ts` — 集成离线队列
  - 参考：Multica `03-source-adoption-map.md` WSClient

- [ ] **传输层抽象**（1 天）
  - 文件：`app/desktop/src/api/transport.ts`（新建）— Transport 接口
  - 实现：`WebSocketTransport`, `MockTransport`（测试用）
  - 未来：`IPCBridgeTransport`（Tauri 原生）
  - 参考：Roo-Code `ExtensionClient` transport-agnostic 模式

- [ ] **架构分离：MessageProcessor / StateStore / EventEmitter**（0.5 天）
  - 文件：`app/desktop/src/hooks/useChatMessages.ts` — 拆分为：`messageProcessor.ts`（事件→动作），`stateStore.ts`（immutable state + 订阅），`eventBus.ts`（typed events）
  - 当前：589 行单文件混杂处理
  - 参考：Roo-Code `MessageProcessor → StateStore → EventEmitter` 三层分离

#### P0-4: 性能基础（2 天）

- [ ] **虚拟滚动**（1.5 天）
  - 依赖：`@tanstack/react-virtual`
  - 文件：`app/desktop/src/components/ChatView.tsx` — 消息列表 >200 条时启用虚拟滚动
  - 参考：CCViewer / LibreChat 虚拟列表

- [ ] **App.tsx 视图注册表拆分**（0.5 天）
  - 文件：`app/desktop/src/views/viewRegistry.ts`（新建）
  - 文件：`app/desktop/src/App.tsx` — 从 500+ 行拆分为 viewRegistry + 动态面板
  - 参考：command-centers `01-source-adoption-map.md` viewRegistry

---

### Phase 1: 竞争 UX（~15 天）

> 目标：在关键 UX 维度上达到或超越参考项目水平

#### P1-1: 多 Agent 聊天（5 天）

- [ ] **消息树形数据模型**（2 天）
  - 文件：`app/desktop/src/lib/messageTree.ts`（新建）
  - 函数：`buildTree<T>(messages: T[], getParentId) → TreeNode<T>[]`
  - 函数：`flattenTree<T>(tree: TreeNode<T>[]) → FlatNode<T>[]`
  - 文件：`app/desktop/src/components/ChatView.tsx` — 使用 flattenTree 渲染
  - 参考：LibreChat `03-source-adoption-map.md` buildTree + siblingIndex

- [ ] **子 Agent 内联视图**（2 天）
  - 文件：`app/desktop/src/components/SubAgentCard.tsx`（新建）— 嵌套子 Agent 消息卡片
  - 文件：`app/desktop/src/hooks/useChatMessages.ts` — 处理 `run.agent.child_spawn` / `run.agent.child_result` 事件
  - 文件：`app/desktop/src/components/ChatView.tsx` — children 递归渲染
  - 参考：Codex CLI `AgentTree/AgentPath` + LibreChat 子代理调度

- [ ] **消息 Fork 支持**（1 天）
  - 文件：`app/desktop/src/components/MessageActions.tsx`（新建）
  - 功能：从任意 agent 消息分叉新对话
  - 文件：`app/desktop/src/api/threadQueries.ts` — forkThread mutation
  - 参考：LibreChat Fork 4 模式算法

#### P1-2: 富文本输入（4 天）

- [ ] **@提及 + 自动补全**（2 天）
  - 文件：`app/desktop/src/components/MentionInput.tsx`（新建）
  - 类型：`@agent` — Agent 列表 | `@file` — 工作区文件 | `@thread` — 历史线程
  - 文件：`app/desktop/src/components/MentionDropdown.tsx`（新建）— 自动补全下拉
  - 参考：LibreChat / OpenCode 提及系统

- [ ] **斜杠命令系统**（1.5 天）
  - 文件：`app/desktop/src/commands/registry.ts`（新建）— 可插拔命令注册表
  - 内建命令：`/model`, `/agent`, `/clear`, `/retry`, `/fork`, `/search`, `/help`, `/export`
  - 文件：`app/desktop/src/components/PromptInput.tsx` — 集成命令补全
  - 参考：aider 30+ slash commands + continue 可插拔命令

- [ ] **模型别名解析**（0.5 天）
  - 文件：`app/desktop/src/lib/modelAliases.ts`（新建）— MODEL_ALIASES 映射表
  - 文件：`app/desktop/src/components/ModelSelector.tsx` — 集成别名
  - 参考：aider `models.py:92-116` MODEL_ALIASES

#### P1-3: Agent 可观测性（3 天）

- [ ] **Token 用量实时更新**（1 天）
  - 文件：`app/desktop/src/components/ContextUsage.tsx` — 订阅流式 token 事件，实时更新进度条
  - 文件：`app/desktop/src/hooks/useChatMessages.ts` — 在 `run.agent.text_delta` 中提取 token 计数
  - 参考：OpenCode token meter / LobeHub 实时费用

- [ ] **工具调用时间线面板**（1 天）
  - 文件：`app/desktop/src/components/ToolTimeline.tsx`（新建）
  - 功能：按时间排列工具调用、显示耗时、成功/失败状态、展开查看输入/输出
  - 参考：OpenCode `03-ui-adoption.md` 工具调用时间线

- [ ] **Agent 任务列表**（1 天）
  - 文件：`app/desktop/src/components/TaskList.tsx`（新建）
  - 功能：显示当前运行的任务列表、进度指示、完成/失败状态、摘要
  - 文件：`app/desktop/src/hooks/useChatMessages.ts` — 处理 `task_started/task_progress/task_notification` 事件（已存在事件处理，仅需 UI 组件）
  - 参考：OpenCode task tracking

#### P1-4: 线程管理升级（3 天）

- [ ] **按项目+日期分组**（1 天）
  - 文件：`app/desktop/src/components/ThreadPanel.tsx` — 添加分组逻辑
  - 分组：Today / Yesterday / This Week / Older + 嵌套项目分组
  - 参考：CCViewer / LibreChat 分组模式

- [ ] **线程状态标记**（0.5 天）
  - 文件：`app/desktop/src/components/ThreadPanel.tsx` — 状态图标
  - 状态：running（绿色脉冲）| failed（红色）| completed（灰色）| archived（隐藏）
  - 参考：LobeHub 线程状态

- [ ] **线程归档**（0.5 天）
  - 文件：`app/desktop/src/api/threadQueries.ts` — archiveThread / unarchiveThread
  - 文件：`app/desktop/src/components/ThreadPanel.tsx` — 归档 UI

- [ ] **快捷键面板**（1 天）
  - 文件：`app/desktop/src/components/ShortcutPanel.tsx`（新建）— `?` 快捷键大全
  - 文件：`app/desktop/src/hooks/useKeyboard.ts` — 扩展快捷键注册
  - 参考：OpenCode Keyboard Shortcuts

---

### Phase 2: 差异化功能（~20 天）

> 目标：构建 AgentHub 独有的差异化能力

#### P2-1: 进阶 Diff/代码审查（5 天）

- [ ] **Side-by-side diff 视图**（2 天）
  - 文件：`app/desktop/src/components/DiffViewer.tsx` — 添加 side-by-side 模式切换
  - 文件：`app/desktop/src/components/DiffSideBySide.tsx`（新建）
  - 参考：CCViewer / continue side-by-side

- [ ] **行级评论**（1.5 天）
  - 文件：`app/desktop/src/components/DiffLineComment.tsx`（新建）
  - 功能：在 diff 行上添加评论/建议
  - Store：扩展 diffViewerStore
  - 参考：CCViewer DiffViewer 行评论

- [ ] **Diff 语法高亮**（1 天）
  - 文件：`app/desktop/src/components/DiffViewer.tsx` — 集成 Shiki 或 highlight.js
  - 参考：continue Shiki 代码渲染 / CCViewer

- [ ] **Diff 统计面板**（0.5 天）
  - 文件：`app/desktop/src/components/DiffStats.tsx`（新建）
  - 内容：文件变更数、+N/-M 行数摘要、变更语言分布
  - 参考：OpenCode DiffViewer 统计

#### P2-2: 多 Agent 协作可视化（5 天）

- [ ] **Agent 通信图可视化**（3 天）
  - 文件：`app/desktop/src/components/AgentGraph.tsx`（新建）— D3/ReactFlow 渲染 Agent 间消息传递
  - 功能：节点 = Agent，边 = 消息，实时动画
  - 参考：Codex CLI AgentTree / Kanna AgentCoordinator

- [ ] **Agent 市场/发现**（2 天）
  - 文件：`app/desktop/src/components/AgentMarket.tsx`（新建）
  - 功能：浏览预置 Agent、安装/卸载、角色配置
  - 参考：LobeHub Agent 市场 / `projects/lobehub/02-full-borrow-list.md`

#### P2-3: 实时协作（4 天）

- [ ] **多光标/实时协作**（3 天）
  - 文件：`app/desktop/src/hooks/useCollaboration.ts`（新建）
  - 依赖：Yjs / PartyKit 或 WebSocket 广播
  - 功能：多人同时查看同一会话、实时看到他人输入
  - 参考：LibreChat 多用户

- [ ] **会话共享链接**（1 天）
  - 文件：`app/desktop/src/components/ShareDialog.tsx`（新建）
  - 功能：生成只读/可写分享链接、权限控制

#### P2-4: 工作区集成（3 天）

- [ ] **文件树侧栏**（1.5 天）
  - 文件：`app/desktop/src/components/FileTree.tsx`（新建）
  - 功能：显式工作区文件树、点击打开 diff、右键菜单（add to context / ignore）
  - 参考：OpenCode file explorer

- [ ] **Git 集成面板**（1.5 天）
  - 文件：`app/desktop/src/components/GitPanel.tsx`（新建）
  - 功能：变更文件列表、stage/unstage、commit message 生成、diff review
  - 参考：CCViewer Git commit UI / aider auto-commit

#### P2-5: 性能和可访问性（3 天）

- [ ] **React.memo 全面审计**（1 天）
  - 文件：所有组件 — 添加 React.memo + useMemo/useCallback 审计
  - 工具：React DevTools Profiler
  - 参考：OpenCode 性能优化

- [ ] **代码块懒加载**（0.5 天）
  - 文件：`app/desktop/src/components/MarkdownRenderer.tsx` — 大代码块折叠 + 按需展开
  - Mermaid 图表懒加载
  - 参考：OpenCode 懒加载

- [ ] **完整的 a11y 审计**（1 天）
  - 标准：WCAG 2.1 AA
  - 内容：键盘导航、屏幕阅读器、焦点管理、对比度检查
  - 文件：所有交互组件

- [ ] **E2E 测试覆盖**（0.5 天）
  - 工具：Playwright + Tauri driver
  - 覆盖：消息流、线程 CRUD、设置、主题切换

---

## 4. 技术架构决策

### 4.1 组件树

```
App.tsx（视图注册表）
├── AppShell.tsx
│   ├── Sidebar
│   │   ├── ThreadPanel.tsx
│   │   │   ├── ThreadGroup（Today/Yesterday/This Week/Older）
│   │   │   └── ThreadItem（status icon + title + time + actions）
│   │   ├── AgentMarket.tsx [P2]
│   │   └── SettingsPanel.tsx
│   ├── MainPanel
│   │   ├── ChatView.tsx
│   │   │   ├── MessageBubble
│   │   │   │   ├── AgentAvatar
│   │   │   │   ├── MessageBlocks
│   │   │   │   │   ├── TextBlock → MarkdownRenderer
│   │   │   │   │   ├── CodeBlock（语法高亮 + 复制）
│   │   │   │   │   ├── ThinkingBlock（折叠）
│   │   │   │   │   ├── ToolUseBlock → ToolResultRenderer
│   │   │   │   │   ├── FileChangeBlock
│   │   │   │   │   ├── SessionInitBlock
│   │   │   │   │   └── ResultBlock
│   │   │   │   ├── SubAgentCard [P1]
│   │   │   │   ├── MessageActions（Copy/Retry/Delete/Fork） [P1]
│   │   │   │   └── Timestamp（relative + exact tooltip）
│   │   │   ├── ScrollToBottomButton
│   │   │   └── TypingIndicator
│   │   ├── PromptInput.tsx
│   │   │   ├── MentionInput [P1]
│   │   │   ├── MentionDropdown [P1]
│   │   │   ├── SlashCommandCompleter [P1]
│   │   │   ├── AgentSelector
│   │   │   ├── ModelSelector（with aliases） [P1]
│   │   │   └── ReasoningSelector
│   │   └── EmptyState
│   ├── RightPanel（多标签）
│   │   ├── RunDetail
│   │   │   ├── OutputTab
│   │   │   ├── ToolCallsTab → ToolTimeline [P1]
│   │   │   └── FilesTab
│   │   ├── DiffViewer
│   │   │   ├── FileTreeSidebar
│   │   │   ├── DiffSideBySide [P2]
│   │   │   ├── DiffUnified
│   │   │   ├── DiffStats [P2]
│   │   │   └── DiffLineComment [P2]
│   │   ├── TaskList [P1]
│   │   ├── AgentGraph [P2]
│   │   ├── ContextUsage（实时）
│   │   └── GitPanel [P2]
│   ├── StatusBar.tsx
│   ├── SearchDialog.tsx（Ctrl+K）
│   └── ShortcutPanel.tsx [P1]
```

### 4.2 状态管理拆分

```
┌─────────────────────────────────────────────────────────┐
│  TanStack Query（服务端状态 — 缓存 + 同步）              │
│                                                         │
│  queryClient                                            │
│  ├── ["threads"]         → useThreads()                 │
│  ├── ["threads", id]     → useThread(id)                 │
│  ├── ["threads", id, "messages"] → useThreadMessages()  │
│  ├── ["runs"]            → useRuns()                    │
│  ├── ["runs", id]        → useRun(id)                   │
│  └── ["agents"]          → useAgents()     [P2]         │
│                                                         │
│  Mutations:                                              │
│  ├── useCreateRun       (乐观更新)                       │
│  ├── useForkThread      (乐观更新)          [P1]         │
│  ├── useArchiveThread                      [P1]         │
│  └── useDecidePermission                                   │
│                                                         │
│  Events → queryClient.invalidateQueries                  │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  Zustand + subscribeWithSelector（客户端 UI 状态）       │
│                                                         │
│  runStore                                               │
│  ├── isStreaming: boolean                               │
│  ├── currentRunId: string | null                        │
│  ├── runState: AgentLoopState  [P0]                     │
│  ├── loopCount: number          [P0]                     │
│  ├── errorCount: number         [P0]                     │
│  ├── abortController: AbortController | null  [P0]       │
│  └── fileReadCache: Map<string, {count, mtime}>  [P0]   │
│                                                         │
│  uiStore                                                │
│  ├── sidebarWidth: number                               │
│  ├── rightPanelTab: string                              │
│  ├── theme: 'dark' | 'light' | 'system'                 │
│  └── mobileMenuOpen: boolean                            │
│                                                         │
│  connectionStore                                        │
│  ├── isOnline: boolean                                  │
│  ├── isConnected: boolean                               │
│  ├── latency: number                                    │
│  ├── errorCount: number                                 │
│  └── reconnectAttempt: number                           │
│                                                         │
│  settingsStore                                          │
│  ├── defaultModel: string                               │
│  ├── defaultAgent: string                               │
│  ├── permissionMode: string                             │
│  └── language: string                                   │
│                                                         │
│  diffViewerStore  [P1/P2]                               │
│  ├── viewMode: 'unified' | 'side-by-side'               │
│  ├── expandAll: boolean                                 │
│  ├── lineComments: Map<filePath, Comment[]>              │
│  └── acceptedFiles: Set<string>                         │
│                                                         │
│  inputDraftStore  [P0]                                  │
│  └── drafts: Map<threadId, string>  → localStorage      │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  React Context（全局基础设施）                           │
│                                                         │
│  ThemeContext → 主题切换 + CSS 变量                      │
│  I18nContext  → i18next 翻译                            │
│  QueryClientProvider → TanStack Query                    │
│  EventBus Context → typed event bus        [P0]          │
└─────────────────────────────────────────────────────────┘
```

### 4.3 事件流

```
Edge Server                Desktop App
──────┬──                  ──────┬────
     │                          │
     │  WebSocket NDJSON        │
     ├─────────────────────────►│ eventClient.ts
     │  (cursor replay)         │   │
     │                          │   ├── Transport.send()  [P0]
     │                          │   │   ├── WebSocketTransport
     │                          │   │   └── MockTransport (test)
     │                          │   ├── Heartbeat  [P0]
     │                          │   │   └── 10s ping/pong
     │                          │   ├── OfflineQueue  [P0]
     │                          │   │   └── localStorage
     │                          │   └── Reconnect (exponential backoff)
     │                          │
     │                          │   ▼
     │                          │ messageProcessor.ts  [P0]
     │                          │   ├── 类型路由
     │                          │   ├── 循环检测  [P0]
     │                          │   ├── 去重缓存  [P0]
     │                          │   └── 状态机转换  [P0]
     │                          │
     │                          │   ▼
     │                          │ queryClient.invalidateQueries
     │                          │   ├── threadQueries
     │                          │   ├── runQueries
     │                          │   └── agentQueries  [P2]
     │                          │
     │                          │   ▼
     │                          │ Zustand（客户端状态更新）
     │                          │   ├── runStore（isStreaming, runState）
     │                          │   ├── connectionStore（latency, connected）
     │                          │   └── diffViewerStore（lineComments）[P2]
     │                          │
     │                          │   ▼
     │                          │ React 组件树（selector 重渲染）[P0]
     │                          │   ├── ChatView
     │                          │   ├── RightPanel
     │                          │   ├── ContextUsage
     │                          │   └── StatusBar
     │                          │
     │  ◄────────────────────────┤ Transport.send()
     │  (user message,           │   ├── permission_decide
     │   permission decision,    │   ├── cancel
     │   model change)           │   └── user_message
     │                          │
```

### 4.4 设计令牌系统

#### 当前已完成（tokens.css Phase 1）

```css
/* 已完成 — 不做修改 */
--fontSizeXs: 0.75rem    /* 12px — caption, tooltip */
--fontSizeSm: 0.8125rem  /* 13px — secondary text */
--fontSizeBase: 0.875rem /* 14px — body */
--fontSizeMd: 0.9375rem  /* 15px — title, input */
--fontSizeLg: 1.125rem   /* 18px — heading */
--fontSizeXl: 1.5rem     /* 24px — hero */
--fontSizeXxl: 2rem      /* 32px — banner */

/* 表面色 4 层 */
--surfaceDefault / --surfaceRaised / --surfaceSunken / --surfaceOverlay

/* 文字色 4 档 + 2 链接 */
--textPrimary / --textSecondary / --textTertiary / --textDisabled
--textLink / --textLinkHover

/* 动画 */
--animFadeIn / --animSlideInRight / --animProgressIndeterminate
```

#### Phase 2 planned additions

```css
/* P2: OKLCH 高级色系 */
--oklch-accent-base: oklch(65% 0.22 260);  /* 主色调 */
--oklch-accent-hover: oklch(72% 0.22 260);
--oklch-success: oklch(65% 0.18 145);      /* 成功绿 */
--oklch-danger: oklch(58% 0.22 25);        /* 危险红 */
--oklch-warning: oklch(75% 0.15 85);       /* 警告黄 */

/* P1: 微交互动画 */
--animScaleIn: scale-in 150ms ease-out;
--animShimmer: shimmer 2s infinite;
--animCollapse: collapse 200ms ease-out;
--animHighlight: highlight-flash 600ms ease-out;

/* P1: 更细粒度阴影 */
--shadowTooltip / --shadowDropdown / --shadowModal / --shadowSidebar
```

### 4.5 性能策略

| 策略 | 实施阶段 | 方法 | 参考 |
|------|:--:|------|------|
| 虚拟滚动 | P0 | @tanstack/react-virtual，>200 消息时启用 | CCViewer / LibreChat |
| React.memo 审计 | P2 | 关键路径组件 memo + Profiler 验证 | OpenCode |
| Zustand selector | P0 | subscribeWithSelector + 细粒度 selector | Roo-Code |
| 代码块懒加载 | P2 | IntersectionObserver + 按需展开 | OpenCode |
| TanStack Query 缓存 | P0 | staleTime 30s, gcTime 5min, 乐观更新 | Multica |
| 图片/图表懒加载 | P2 | Mermaid 延迟渲染 + loading="lazy" | OpenCode |
| Bundle 分割 | P0 | React.lazy + Suspense 路由级分割 | 现有实现 |
| 流式文本 16ms 批处理 | 现有 | useStreamingText 已实现字符级 batch | Kanna 16ms debounce |

---

## 5. 不构建的内容

基于对比 21 个参考项目的架构验证：

| 决定 | 原因 | 参考验证 |
|------|------|------|
| 不用 protobuf（保持 JSON） | protobuf 对桌面客户端过重 | cline proto → AgentHub 规模用 JSON 足够 |
| 不用自研编辑器（保持 CodeMirror/Monaco？） | 当前 textarea 够用；P1 MentionInput 是轻量增强 | OpenCode Monaco → 过于复杂 |
| 不用 Service Worker 离线 | Tauri 原生离线能力替代 | CCViewer PWA → Tauri 不需要 |
| 不用 WebRTC P2P | Yjs WebSocket 协议足够 | LibreChat → 不需要 |
| 不构建 ChatView 永不卸载 | cline 模式为 VSCode webview 约束 | AgentHub Tauri 没有此限制 |
| 不构建多窗口 | Tauri 多窗口是未来可选功能 | OpenCode → 推迟到 P3+ |
| 不用 CSS Module（仅 Tailwind） | tokens.css + Tailwind 足够；CSS Module 增加维护成本 | LobeHub / OpenCode Tailwind 策略 |
| 不急于 OKLCH 全量迁移 | 当前设计令牌已覆盖 80% 需求 | P2 作为增强 |
| 不引入 Redux/Zustand 之外的状态库 | Zustand + TanStack Query 覆盖全部场景 | Multica 验证 |
| 不构建插件系统（当前） | 先完成核心 UX 打磨 | OpenCode 19 Hook → 6 Hook 提炼 |

---

## 6. 参考引用索引

### 主要参考（按引用频率）

| 项目 | 主要价值 | 文件 |
|------|------|------|
| **cline** | TaskState、loop detection、file dedup、permission controller | `projects/ai-coding-tools/01-source-adoption-map.md` |
| **Roo-Code** | AgentLoopState 状态机、三层架构分离、transport-agnostic、9 ask types | `projects/ai-coding-tools/01-source-adoption-map.md` |
| **Multica** | TanStack Query+Zustand 分离、WSClient 离线队列、Task 生命周期 | `projects/multica/03-source-adoption-map.md` |
| **command-centers** (7 projects) | 非受控输入、草稿持久化、视图注册表 | `projects/command-centers/01-source-adoption-map.md` |
| **LibreChat** | 消息树 buildTree、Fork 4 模式、子代理调度、3 栏布局 | `projects/librechat/03-source-adoption-map.md` |
| **OpenCode** | Token 用量、工具时间线、185 组件 UI、DiffViewer | `projects/opencode/03-ui-adoption.md` + `04-source-adoption-map.md` |
| **aider** | 编辑格式协商、模型别名、prompt caching、斜杠命令 | `projects/ai-coding-tools/01-source-adoption-map.md` |
| **CCViewer** | FTS5 搜索、side-by-side diff、行评论、Git commit UI | `projects/claude-code-viewer/01-overview.md` |
| **Kanna** | KannaSocket 心跳、16ms debounce、AgentCoordinator | `projects/kanna/04-source-adoption-map.md` |
| **LobeHub** | Agent 市场、模型选择器、主题系统、消息类型 | `projects/lobehub/02-full-borrow-list.md` + `03-source-adoption-map.md` |

### 跨项目对比

| 文档 | 用途 |
|------|------|
| `cross-comparison/00-synthesis.md` | 6 大收敛模式、P0 优先列表（6 items, ~21d）、组件到项目映射表 |
| `cross-comparison/02-im-ux.md` | IM/UX 设计、3 栏布局、渐进式信息披露 4 级、Authority 可视化 |
| `cross-comparison/08-ui-beautify-plan.md` | 3 轮美化计划（~18d）、设计令牌升级、组件逐个美化、空状态模板 |
| `cross-comparison/10-best-practices-playbook.md` | 8 组件区最佳实践、优先级/引用计数/工作量/依赖表 |

---

## 7. 总结

### 工作量总计

| 阶段 | 天数 | 任务数 | 核心交付 |
|------|:--:|:--:|------|
| Phase 0: 基础打磨 | 14 | 12 | TanStack Query 基础、非受控输入、循环检测、连接健壮性、虚拟滚动 |
| Phase 1: 竞争 UX | 15 | 12 | 消息树、子 Agent 视图、@提及、斜杠命令、Token 实时、工具时间线、线程分组 |
| Phase 2: 差异化 | 20 | 13 | side-by-side diff、行评论、Agent 通信图、Agent 市场、实时协作、Git 集成、a11y |
| **总计** | **49** | **37** | |

### 关键路径

```
P0 状态架构 (5d) → P0 输入体验 (4d) → P0 连接健壮 (3d) → P0 性能 (2d)
                                            ↓
                    P1 多 Agent 聊天 (5d) → P1 富文本 (4d) → P1 可观测性 (3d) → P1 线程管理 (3d)
                                                                                       ↓
                    P2 Diff 进阶 (5d) → P2 Agent 协作 (5d) → P2 实时协作 (4d) → P2 工作区 (3d) → P2 性能 (3d)
```

### 优先级速查

| 优先级 | 数量 | 代表项 |
|:--:|:--:|------|
| **P0** | 12 | TanStack Query、非受控输入、循环检测、去重、心跳、虚拟滚动、状态机 |
| **P1** | 12 | 消息树、@提及、斜杠命令、子 Agent 视图、Token 实时、时间线、线程分组 |
| **P2** | 13 | side-by-side diff、行评论、Agent 通信图、Agent 市场、协作、Git 集成、a11y |
