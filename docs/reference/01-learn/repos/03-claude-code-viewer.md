# Claude Code Viewer 深度调研报告

> Repository: `d-kimuson/claude-code-viewer` v0.7.5 | License: MIT | 1,150+ stars
> Tech: Vite + React 19 + TanStack Router + TanStack Query / Hono + Effect-TS
> Read paths: `~/.claude/projects/*.jsonl` (SSOT), cache at `~/.claude-code-viewer/`

---

## 1. 会话历史回放与日志可视化

### 1.1 JSONL 数据管道

**Schema 定义** (`src/lib/conversation-schema/index.ts:18-34`): 使用 Zod `z.union` 定义 15 种入口类型：
- `UserEntry` / `AssistantEntry` / `SystemEntry` / `SummaryEntry`
- `FileHistorySnapshotEntry` / `QueueOperationEntry` / `ProgressEntry`
- `CustomTitleEntry` / `AiTitleEntry` / `AgentNameEntry` / `AgentSettingEntry`
- `PermissionModeEntry` / `PrLinkEntry` / `LastPromptEntry` / `AttachmentEntry`

每种入口都有独立的 Schema 文件（如 `AssistantEntrySchema.ts`），包含 `uuid`、`parentUuid`、`isSidechain`、`timestamp` 等通用字段和类型特定字段。

**读取 + 校验** (`src/server/core/claude-code/functions/parseJsonl.ts:4-37`): 纯函数，逐行 `JSON.parse` + `ConversationSchema.safeParse`。校验失败时返回 `{ type: "x-error", line, lineNumber }`，**不抛异常**，保证部分解析不会阻塞整体加载。

**Session 文件读取** (`src/server/core/session/infrastructure/SessionRepository.ts:22-70`):
- 验证 sessionId 仅含安全字符
- 验证 projectPath 在 `claudeProjectsDirPath` 内（路径遍历防护）
- `fs.readFileString` -> `split("\n")` -> `parseJsonl()` -> 提取 `stat.mtime`
- 通过 `SessionMetaService` 获取 session 元数据（title、cost、token usage 等）

**缓存层** (`src/server/hono/middleware/config.middleware.ts`): `~/.claude-code-viewer/` 目录用作缓存，通过 SSE 事件 `sessionChanged` / `sessionListChanged` 触发 TanStack Query `invalidateQueries` 自动失效。

### 1.2 Session 元数据系统

**SessionMetaService** (`src/server/core/session/services/SessionMetaService.ts`): 提供 `getSessionMeta(projectId, sessionId)` 返回：
- `title`: 从第一个有效用户消息提取
- `tokenUsage`: 聚合所有 assistant message 的 `usage` 字段
- `cost`: 基于 model pricing 表计算（见 1.3）
- `lastModifiedAt`: 文件修改时间

**Agent Session 支持** (`src/server/core/agent-session/`):
- `agent-*.jsonl` 文件存储 subagent 会话日志（新版 Claude Code 格式）
- `AgentSessionRepository`: 按 `agentId` 查找关联的 agent session
- 前端通过 `useSidechain()` hook 将 agent session 数据注入主会话视图

### 1.3 成本计算

**Model Pricing** (`src/server/core/session/constants/pricing.ts:36-79`): 硬编码 Anthropic 官方定价表，覆盖 7 种模型（opus-4.5 / opus-4.1 / sonnet-4.5 / 3.5-sonnet / haiku-4.5 / 3-opus / 3-haiku）。

**Normalize** (`src/server/core/session/functions/calculateSessionCost.ts:63-107`): 将 Anthorpic API 返回的完整 model name（如 `claude-opus-4-5-20251101`）标准化为定价表 key（`claude-opus-4.5`），未知模型 fallback 到 `claude-3.5-sonnet`。

**Cost Breakdown**: 分别计算 `inputTokens` / `outputTokens` / `cacheCreationTokens` / `cacheReadTokens` 四类成本，汇总为 USD。

### 1.4 前端会话渲染

**ConversationList** (`src/web/app/projects/[projectId]/sessions/[sessionId]/components/conversationList/ConversationList.tsx`):
- **过滤与分组**: `shouldRenderConversation()` 过滤进度、标题、agent name/setting 等元数据入口；`buildRenderableConversationRows()` 构建渲染行
- **Sidechain 支持**: `isRootSidechain` / `getSidechainConversations` — 区分主会话与子 agent 会话
- **Turn Duration**: 计算每轮对话的用户消息到最后一个 assistant 消息的时间差
- **Agent Session 链接**: `toolUseIdToAgentIdMap` 通过 `toolUseResult.agentId` 将 Task tool 调用链接到 agent session

**ConversationItem** 按消息类型分发到不同的 visualization 组件：
- `AssistantConversationContent`: Markdown 渲染 + thinking block（collapsible）+ tool_use block
- `UserConversationContent`: 用户消息（支持 text/image/document 多模态）
- `ToolVisualizers`: 10 种工具专用渲染器（`BashVisualizer.tsx`, `EditVisualizer.tsx`, `ReadVisualizer.tsx`, `WriteVisualizer.tsx`, `TaskVisualizer.tsx`, `TodoWriteVisualizer.tsx` 等）

### 1.5 实时更新 (SSE + EventBus)

**EventBus** (`src/server/core/events/services/EventBus.ts:8-66`): 基于 Effect-TS 的发布/订阅总线。

**File Watcher** (`src/server/core/events/services/fileWatcher.ts`): 监听 `~/.claude/projects/*.jsonl` 文件变更，触发 `sessionChanged` 事件。

**SSE 端点** (`/api/sse`): 类型安全的 SSE（`TypeSafeSSE`），推送事件类型包括：
- `sessionChanged` / `sessionListChanged` — 会话内容变更
- `agentSessionChanged` — agent 会话变更
- `permissionRequested` / `permissionResolved` — 权限请求
- `questionRequested` / `questionResolved` — AskUserQuestion
- `notificationCreated` / `notificationConsumed` — 通知

**前端消费** (`src/web/app/components/SSEEventListeners.tsx:16-91`): 每个事件类型对应一个 `useServerEventListener` hook，收到事件后 invalidate 对应 TanStack Query cache。

---

## 2. Diff/Git 面板实现（精确到行号）

### 2.1 Git Service 层 (Effect-TS)

**GitService** (`src/server/core/git/services/GitService.ts:280-751`):

| 方法 | 行号 | 说明 |
|------|------|------|
| `execGitCommand` | 285-313 | 通用 git 命令执行器，使用 `Command.make("git", ...args)` + `Command.workingDirectory(absoluteCwd)` + `Command.env({ PATH })` |
| `getDiff` | 368-491 | **核心 diff 实现**。执行 `git diff --numstat` + `git diff --unified=5`，使用 `parse-git-diff` 库解析 unified diff，fallback 到正则解析 `diff --git` 头。**处理 untracked files**：通过 `git status --short` 检测 `??` 文件，读取内容构造 synthetic diff |
| `stageFiles` | 494-507 | `git add -- <files>` |
| `commit` | 509-535 | `git commit -m <message>`，从输出解析 commit SHA，fallback `git rev-parse HEAD` |
| `push` | 537-589 | `git push origin HEAD`，60s 超时，`Command.exitCode` 检查成功 |
| `findBaseBranch` | 680-713 | 分页扫描 commit graph，找到当前分支的 base 分支 |
| `checkout` | 728-733 | `git checkout <branchName>` |

**GitController** (`src/server/core/git/presentation/GitController.ts:12-370`):
- `getGitDiff` (12-46): `parseDiffError` 将 Effect 错误转为结构化响应（`NOT_A_REPOSITORY` / `BRANCH_NOT_FOUND` / `PARSE_ERROR` / `COMMAND_FAILED`）
- `commitFiles` (48-104): stage -> commit 两步，区分 `HOOK_FAILED` vs `GIT_COMMAND_ERROR`
- `pushCommits` (106-150): 解析 push 错误码（`NO_UPSTREAM` / `NON_FAST_FORWARD` / `AUTH_FAILED` / `NETWORK_ERROR` / `TIMEOUT`）
- `commitAndPush` (152-195): 原子 commit+push，失败时保留 commit SHA 供 retry
- `getCurrentRevisions` (197-286): 获取 base branch、current branch、commits 列表，用于 UI 分支选择
- `getBranches` (288-326) / `checkoutBranch` (328-359)

### 2.2 Diff Viewer 前端

**DiffViewer** (`src/web/app/projects/[projectId]/sessions/[sessionId]/components/diffModal/DiffViewer.tsx`):

| 组件 | 行号 | 功能 |
|------|------|------|
| `DiffViewer` (主组件) | 466-527 | memoized 组件，接收 `FileDiff` + 可选 `reviewSessionId`。binary 文件特殊处理。collapsible 文件头。 |
| `FileHeader` | 365-441 | 显示文件名 + 状态图标 (A/D/R/M) + 行数统计 (+X/-X)。sticky top。支持点击复制文件名。 |
| `DiffBody` | 337-356 | 左右分栏：左侧行号 gutter（`DiffHunkComponent`）+ 右侧代码（`DiffContentRows`） |
| `DiffHunkComponent` | 212-247 | 网格布局 `grid-cols-[2.5rem_2.5rem]` 显示 old/new 行号，hunk 行号对齐 |
| `DiffContentRows` | 250-327 | 渲染代码行，支持 **line-level code review comments**（见 2.3） |
| `CommentButton` | 155-210 | 行内评论按钮，Popover 展示评论表单 |
| `CommentForm` | 71-128 | Markdown textarea + 保存，Ctrl+Enter 提交 |

**颜色方案** (行 46-52, 55-62):
- `added`: `bg-green-50` / `bg-green-950/30` (dark)
- `deleted`: `bg-red-50` / `bg-red-950/30` (dark)
- `hunk header`: `bg-blue-50` / `bg-blue-950/30` (dark)

### 2.3 Git 操作 UI -- DiffModal

**DiffModal** (`src/web/app/projects/[projectId]/sessions/[sessionId]/components/diffModal/DiffModal.tsx:120-621`):

- **Ref 选择器** (171-213): 将 git revisions 转换为 `GitRef[]` — `working`（未提交更改）、`HEAD`、`branch:`（base/current branch）、`commit:`（commit SHA）
- **Compare from/to** (373-402): 双 Select 下拉，支持 branch:commit/working/HEAD 任意组合
- **Commit UI** (433-585): 仅当 `compareTo === "working"` 时显示
  - 文件选择：checkbox 列表，默认全选，支持 Select All / Deselect All
  - Commit message textarea
  - 三个操作按钮：Commit / Push / Commit+Push
  - `commitAndPush` 失败时区分 commit 成功/push 失败，提供 Retry Push 按钮
- **错误处理**: `NO_UPSTREAM` / `NON_FAST_FORWARD` / `AUTH_FAILED` / `NETWORK_ERROR` / `TIMEOUT` 错误码各自有专门的用户提示

### 2.4 内建终端

**TerminalPanel** (`src/web/app/components/TerminalPanel.tsx`):

- 使用 `@xterm/xterm` + `@xterm/addon-fit` 实现完整终端仿真
- **WebSocket 通信** (`ws://host/ws/terminal?sessionId=xxx&cwd=xxx`):
  - `type: "hello"` — 握手，获取 sessionId
  - `type: "output"` — 终端输出
  - `type: "snapshot"` — 初始化时发送历史缓冲区
  - `type: "exit"` — 进程退出
  - `type: "input"` / `type: "signal"` (SIGINT) — 客户端发送
  - `type: "resize"` — 窗口大小变更
- **Session 持久化** (行 13-55): `localStorage` 存储 `terminalSessionId:{cwd}`，重连时恢复
- **Ctrl+C 拦截** (行 201-207): `terminal.onKey` 拦截 `Ctrl+C` -> `sendJson({ type: "signal", name: "SIGINT" })`
- **移动端触摸滚动** (行 221-244): `touchstart`/`touchmove` 事件处理，逐行滚动
- **Ping 保活** (行 215-219): 20s 间隔心跳

### 2.5 PWA 与移动访问

**Service Worker** (`src/sw.ts`):
- **Precache** (17-18): `workbox-precaching` 预缓存 Vite build manifest
- **SPA Navigation** (21-25): NavigationRoute -> `/index.html`，排除了 `/api/` 路径
- **SSE 不缓存** (28): `/api/sse` -> `NetworkOnly`
- **API 缓存** (31-42): 其他 API -> `NetworkFirst`，最多 100 条，1 小时过期
- **Push Notifications** (51-84): `push` 事件 -> `self.registration.showNotification(title, { body, icon, badge })`；`notificationclick` -> 聚焦已有窗口或打开新窗口

**PWA Manifest** (`public/`): icon-192x192.png / icon-512x512.png

**移动端适配**:
- `useIsMobile()` hook (`src/web/hooks/useIsMobile.ts`): 基于 `window.innerWidth` 的响应式检测
- `MobileSidebar` (`.../components/sessionSidebar/MobileSidebar.tsx`): 移动端专用侧边栏
- RightPanel 在移动端自动全宽 (`isMobile ? "left-0 right-0" : "right-0 border-l"`, `RightPanel.tsx:162-167`)
- Touch swipe gesture (`useSwipeGesture`)

---

## 3. 远程访问与安全设计

### 3.1 密码保护机制

**Auth 中间件** (`src/server/hono/middleware/auth.middleware.ts`):

- **双通道认证** (行 34-67):
  1. Cookie-based: `ccv-session` cookie，与服务器端 session token 做 `timingSafeEqual` 比较
  2. Bearer token: `Authorization: Bearer <password>` header，与 `CCV_PASSWORD` env 直接比较
- **Session Token 生成** (行 19-22): `randomBytes(32).toString("hex")` — 密码不同但 token 长且固定
- **时效安全比较** (行 13-16): `timingSafeEqual(Buffer.from(a), Buffer.from(b))`，先比长度
- **API-only 保护** (行 40-42): 只拦截 `/api/*` 路径，前端路由由 `ProtectedRoute` 处理
- **Auth disabled 旁路** (行 45-47): `authEnabled === false` 时跳过所有认证

**CcvOptionsService** (`src/server/core/platform/services/CcvOptionsService.ts:41-59`):
- 密码来源: CLI `--password` > `CCV_PASSWORD` env
- 其他 CLI option: `--port` (default 3000), `--hostname` (default localhost), `--executable`, `--claude-dir`, `--terminal-disabled`, `--terminal-shell`, `--terminal-unrestricted`, `--api-only`

**前端认证流**:
- `AuthProvider` (`src/web/components/AuthProvider.tsx`): `useSuspenseQuery` 查询 `/api/auth/check` -> 设置 `authAtom`
- `ProtectedRoute` (`src/web/components/ProtectedRoute.tsx`): `!isAuthenticated` -> navigate to `/login`
- Login page (`src/web/routes/login.tsx`): 密码输入 -> `POST /api/auth/login` -> navigate to `/projects`

### 3.2 Opt-in Agent SDK 消息发送

这是 Claude Code Viewer **最关键的架构决策**，记录于 `README.md:15-31` 和 `PRIVACY.md`：

**背景**: 2026 年 4 月 Anthropic TOS 禁止使用 Agent SDK 以订阅账户发送聊天消息。

**设计响应**:
1. **Usage Mode Dialog** (`src/web/components/UsageModeDialog.tsx`): 首次启动强制选择认证模式
   - **API Key** (default): 所有功能可用，包括 chat send / resume / permission approve / AskUserQuestion
   - **Subscription**: 禁用 Agent SDK 聊天功能，chat input 切换为 **copy mode**

2. **Copy Mode**: 配置 session options 后，点击 Copy 按钮获取等效 `claude` CLI 命令，粘贴到终端运行

3. **只读功能不受影响**: 对话日志查看、session 浏览、Git 操作、搜索、文件浏览等全部独立于 Agent SDK 实现

4. **前端适配** (`src/web/hooks/useIsSubscriptionMode.ts`): `useIsSubscriptionMode()` hook 控制 UI 行为
   - Session sidebar 的 Scheduler tab 在订阅模式下隐藏 (`SessionSidebar.tsx:62-71`)
   - Chat input 在订阅模式下显示 "Copy command" 而非 "Send"

### 3.3 API Key vs 订阅边界处理

**ClaudeCodeService** (`src/server/core/claude-code/services/ClaudeCodeService.ts`): 检测 Claude Code 的认证状态（API key vs subscription），影响可用功能集。

**ClaudeCodeSessionProcessService** (`src/server/core/claude-code/services/ClaudeCodeSessionProcessService.ts`): 管理后台 Claude Code 进程生命周期。进程在后台持续运行，支持 `initialized` -> `file_created` / `paused` -> 用户继续交互的状态机。

### 3.4 网络隔离设计

**PRIVACY.md**: 
- 仅与 localhost + Anthropic API 通信
- 无遥测、无崩溃报告、无使用统计
- 无外部网络依赖的扩展计划
- Tailscale HTTPS 用于远程访问（`--hostname 0.0.0.0 --password`）

---

## 4. Progressive Disclosure UI 原则

Claude Code Viewer 的 UI 设计贯穿了 Progressive Disclosure 理念：

### 4.1 Collapsible 层次结构

| 层级 | 组件 | 文件:行号 |
|------|------|-----------|
| **Thinking block** | Collapsible (default collapsed) | `ConversationList.tsx` (via `AssistantConversationContent`) |
| **Tool use block** | Collapsible (default collapsed)，显示 tool name + param count | `ExportService.ts:571-581` (HTML), `DiffViewer.tsx` (inline) |
| **Task/Agent block** | Collapsible，显示 prompt preview + subagent count | `ExportService.ts:694-716` |
| **Sidechain container** | Collapsible，显示子 agent 会话日志 | `ExportService.ts:671-691` |
| **Right Panel tabs** | 4 tabs: Explorer / Git / Review / Browser | `RightPanel.tsx:42-59` |
| **Session Sidebar** | 4 tabs: Sessions / MCP / Tasks / Scheduler | `SessionSidebar.tsx:38-74` |
| **Search** | Dialog overlay，Cmd/Ctrl+K 触发 | `SearchDialog.tsx` |
| **In-page Search** | Sticky search bar，Cmd/Ctrl+F 触发 | `ConversationList.tsx:682-761` |
| **Bottom Panel** | Terminal 面板，toggle 显示 | `BottomPanel.tsx` |

### 4.2 信息密度控制

1. **元数据入口过滤**: `shouldRenderConversation()` 隐藏 progress / title / agent-name / agent-setting / pr-link / last-prompt / permission-mode / custom-title / ai-title 等内部元数据
2. **Tool result 只在展开 tool use 时可见**: 避免工具输出堆满视图
3. **Sidechain 默认折叠**: 子 agent 会话藏在 Task tool 的 collapsible 内部
4. **Schema error 折叠**: 解析失败的行以 Collapsible Alert 展示，附带 "Report Issue" 链接

### 4.3 搜索作为导航关键路径

**全局搜索** (`src/server/core/search/services/SearchService.ts`):
- SQLite FTS5 + 三字文法 tokenizer (`session_messages_fts` 表)
- BM25 排序，用户消息权重 1.2x
- 搜索结果直接导航到具体 session

**页内搜索** (`ConversationList.tsx:430-574`):
- 不依赖 FTS5，纯前端搜索 `getSearchableText()` 返回的字符串
- DOM TreeWalker 定位文本节点 -> `document.createRange` 高亮
- Retry mechanism (最多 6 次 `requestAnimationFrame`) 处理异步渲染

---

## 5. 会话管理核心能力

### 5.1 会话生命周期

**Session Process 状态机** (`src/server/core/claude-code/models/CCSessionProcess.ts`):
- `initialized` -> `file_created` (JSONL 文件已创建) -> `paused` (等待用户输入/权限/rate limit)
- 进程在后台持续运行，通过 `ClaudeCodeSessionProcessService` 管理
- `sessionProcessChanged` 事件通知前端状态变更

**Rate Limit 自动续行** (`src/server/core/rate-limit/services/RateLimitAutoScheduleService.ts:90-163`):
1. 订阅 `sessionChanged` 事件
2. 检查 `autoScheduleContinueOnRateLimit` 配置项
3. 验证 session 有 live process
4. 读取 JSONL 最后一行
5. `detectRateLimitFromLastLine` 检测 rate limit 模式
6. `parseRateLimitResetTime` 解析 reset 时间
7. 创建 `reserved` 类型的 scheduler job，在 reset 时间自动 `continue`

### 5.2 推送通知

**NotificationService** (`src/server/core/notification/services/NotificationService.ts:68-252`):
- 自动监听 `sessionProcessChanged(paused)` / `permissionRequested` / `questionRequested` 事件
- VAPID 密钥自动生成并持久化到 `~/.claude-code-viewer/vapid-keys.json`
- Web Push API 推送通知，含标题、正文、URL (deep link 到具体 session)
- 自动清理失效订阅（`shouldDropSubscriptionForPushError`）

### 5.3 Session 导出

**ExportService** (`src/server/core/session/services/ExportService.ts:985-1941`):
- 生成自包含 HTML 文件，含完整 CSS + collapsible JS
- 支持 Markdown 渲染（code blocks / tables / blockquotes / lists / headers / links / strikethrough）
- 递归渲染 Task/Agent tool 的 subagent 会话
- 支持 agent session 文件的 lazy load（`agentSessionRepo.getAgentSessionByAgentId`）

---

## 6. 对 AgentHub 的具体建议

### 6.1 可复用的架构决策

1. **JSONL as SSOT + Zod validation**: 直接读 Claude Code 原生日志，不做数据迁移。Schema 校验失败不阻塞，返回 `x-error` 占位。AgentHub 以 WebSocket 接收实时事件时可采用相同策略。

2. **Effect-TS 分层**: `Controller (presentation)` -> `Service (business logic)` -> `Infrastructure (data access)` -> `Schema (validation)` 的四层架构，全部通过 Effect `Layer` DI。AgentHub 后端应根据服务复杂度评估是否引入 Effect-TS（如复杂度低可用纯 async/await）。

3. **TanStack Query + SSE 失效**: 后端事件 -> EventBus -> SSE -> TanStack Query `invalidateQueries`。AgentHub 前端应复刻此模式用于实时数据同步。

4. **双通道 API 保护**: Cookie (session token) + Bearer token 同时支持，AgentHub 远程访问应实现相同策略。

### 6.2 可复用的 UI 组件模式

1. **DiffViewer + Code Review Comments**: 行级评论系统 (`reviewComments.ts` atom + `DiffViewer.tsx` 内嵌 CommentForm)，AgentHub 代码审查面板可直接参考。

2. **Progressive Disclosure 层次**: Thinking -> Tool Use -> Task/Agent -> Sidechain 的递进展开。AgentHub 的 agent 执行日志展示应采用相同信息密度控制。

3. **In-page Search + Global Search 双层**: FTS5 跨会话搜索 + DOM TreeWalker 页内高亮，互补覆盖不同用户意图。

4. **Right Panel 多 Tab**: Explorer / Git / Review / Browser 四 tab 侧边面板，AgentHub 的 agent workspace 可采用相同布局。

### 6.3 应避免的设计

1. **Agent SDK 直接发消息**: opt-in 设计说明直接依赖 Agent SDK 发送聊天存在合规风险，AgentHub 应保持对 Agent SDK 的 loose coupling。

2. **远程访问必须 HTTPS**: PWA 需要 HTTPS 才能工作，`--hostname 0.0.0.0` + Tailscale 是最简方案。

3. **不做数据迁移**: 直接读 Claude Code 原生 JSONL，不在数据库存储会话内容（FTS5 仅存索引）。AgentHub 也应优先直接消费源数据而非复制。

### 6.4 差异化机会

Claude Code Viewer 的核心定位是 **Claude Code 的 Web UI wrapper**。AgentHub 可实现差异化：

1. **多 Agent 平台对比**: Claude Code Viewer 仅支持 Claude Code。AgentHub 可统一展示 Claude Code + Codex + 其他 agent 的会话日志。

2. **Agent 编排**: Claude Code Viewer 的 scheduler 仅做 rate limit 自动续行。AgentHub 可做跨 agent 的任务编排和 pipeline。

3. **会话对比**: Claude Code Viewer 无会话对比功能。AgentHub 可实现 side-by-side session diff（同一任务不同 agent 的对比）。

4. **团队协作**: Claude Code Viewer 是单用户工具。AgentHub 可加入评论/分享/PR review 的团队协作功能。
