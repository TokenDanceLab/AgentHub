# Claude Code Web UI 深度调研报告

> 调研仓库：[sugyan/claude-code-webui](https://github.com/sugyan/claude-code-webui)
> 调研日期：2026-05-21
> 仓库状态：MIT License, TypeScript, ~1076 stars, 活跃维护中

---

## 1. 三层拆分架构（精确到行号）

### 1.1 总体架构概览

```
claude-code-webui/
├── shared/          # 纯类型定义层，零运行时依赖
│   └── types.ts     # 54 行，前后端共享的 API 契约
├── backend/         # Hono 服务端，runtime-agnostic
│   ├── app.ts       # 应用组装，路由注册
│   ├── handlers/    # API 处理器（chat, abort, projects, histories, conversations）
│   ├── runtime/     # 平台抽象层 (Deno/Node.js)
│   ├── middleware/   # 配置中间件
│   ├── history/     # 会话历史解析与加载
│   ├── cli/         # CLI 入口 + 参数解析
│   └── utils/       # 文件系统、日志、系统工具
└── frontend/        # React SPA (Vite + SWC + TailwindCSS)
    ├── src/
    │   ├── hooks/          # 8 个专项 hooks（streaming, chat, permissions）
    │   ├── components/     # UI 组件树（chat, messages, settings）
    │   ├── utils/          # 统一消息处理器、类型守卫、工具解析
    │   ├── config/         # API 端点配置
    │   └── contexts/       # React context (Settings)
    └── vite.config.ts      # Vite 代理配置（开发模式 /api -> backend:8080）
```

### 1.2 Shared 层：API 契约（`shared/types.ts`）

**文件**: `shared/types.ts` (54行)

| 类型 | 行号 | 用途 | 关键字段 |
|---|---|---|---|
| `StreamResponse` | L1-5 | SSE/NDJSON 流式响应信封 | `type: "claude_json" \| "error" \| "done" \| "aborted"`, `data`, `error` |
| `ChatRequest` | L7-14 | 前端发往后端的请求体 | `message`, `sessionId?`, `requestId`, `allowedTools?`, `workingDirectory?`, `permissionMode?` |
| `AbortRequest` | L16-18 | 中止请求 | `requestId` |
| `ProjectInfo` | L20-23 | 项目目录信息 | `path`, `encodedName` |
| `ConversationSummary` | L30-36 | 会话摘要列表 | `sessionId`, `startTime`, `lastTime`, `messageCount`, `lastMessagePreview` |
| `ConversationHistory` | L45-53 | 完整会话历史 | `sessionId`, `messages: unknown[]`, `metadata` |

设计要点：
- `ChatRequest` 包含 `permissionMode` 字段 (L13)，支持 `"default" | "plan" | "acceptEdits"` 三种模式，前后端共享枚举。
- `ConversationHistory.messages` 类型为 `unknown[]` (L47, L49)，刻意避免前后端类型循环依赖，实际运行时是 `TimestampedSDKMessage[]`。
- 整个 shared 层仅 54 行，没有运行时代码，最大限度降低维护负担。

### 1.3 Backend 层：运行时抽象与 Claude SDK 封装

#### 1.3.1 应用入口（`backend/app.ts`）

**文件**: `backend/app.ts` (102行)

- L8: 使用 **Hono** 框架（轻量级 Web 框架，支持 Deno/Node/Bun 多运行时）
- L33-46: CORS 全开 `origin: "*"`，方法限 `GET/POST/OPTIONS`
- L58-73: **API 路由注册**，请求到具体的 handler：

| 路由 | Handler | 用途 |
|---|---|---|
| `GET /api/projects` (L59) | `handleProjectsRequest` | 列举 Claude CLI 项目目录 |
| `GET /api/projects/:encodedProjectName/histories` (L61) | `handleHistoriesRequest` | 会话历史列表 |
| `GET /api/projects/:encodedProjectName/histories/:sessionId` (L65) | `handleConversationRequest` | 单个会话详情 |
| `POST /api/abort/:requestId` (L69) | `handleAbortRequest` | 中止当前请求 |
| `POST /api/chat` (L73) | `handleChatRequest` | 核心：发送消息 + 流式响应 |

- L35: `requestAbortControllers: Map<string, AbortController>` 是所有请求共享的中止控制器存储。
- L77-99: **SPA fallback**：非 `/api/*` 请求统一返回 `index.html`，支持前端路由。

#### 1.3.2 Runtime 抽象（`backend/runtime/types.ts`, L1-37）

```typescript
export interface Runtime {
  runCommand(command, args, options?): Promise<CommandResult>;
  findExecutable(name): Promise<string[]>;
  serve(port, hostname, handler): void;
  createStaticFileMiddleware(options): MiddlewareHandler;
}
```

只有 4 个方法，覆盖：
- 进程执行 (`runCommand`, `findExecutable`)
- HTTP 服务 (`serve`)
- 静态文件 (`createStaticFileMiddleware`)

**Node.js 实现** (`backend/runtime/node.ts`, L1-135): 使用 `@hono/node-server` 的 `serve` + `serveStatic` 中间件。
**Deno 实现** (`backend/runtime/deno.ts`): 使用 Deno 原生 API。

#### 1.3.3 Chat Handler：流式响应的核心（`backend/handlers/chat.ts`, L1-141）

**`executeClaudeCommand`** (L18-84) - AsyncGenerator 模式：
- L30-36: 处理以 `/` 开头的命令（去掉 `/` 前缀）。
- L39-40: 为每个请求创建独立的 `AbortController`。
- L42-53: **调用 Claude Code SDK** 的 `query()` 函数：
  ```typescript
  for await (const sdkMessage of query({
    prompt: processedMessage,
    options: {
      abortController,
      executable: "node",
      pathToClaudeCodeExecutable: cliPath,
      ...(sessionId ? { resume: sessionId } : {}),     // L49: 会话续接
      ...(allowedTools ? { allowedTools } : {}),        // L50: 工具白名单
      ...(workingDirectory ? { cwd: workingDirectory } : {}), // L51: 工作目录
      ...(permissionMode ? { permissionMode } : {}),   // L52: 权限模式
    },
  })) { yield { type: "claude_json", data: sdkMessage }; }
  ```
- L64: 流结束后 `yield { type: "done" }`。
- L78-83: finally 块清理 AbortController。

**`handleChatRequest`** (L92-141) - HTTP 响应：
- L96: 解析 `ChatRequest` JSON body。
- L104-131: 创建 `ReadableStream`，逐行 NDJSON 编码：
  - L117: `JSON.stringify(chunk) + "\n"` -- 每行一个 JSON 对象。
  - L134-140: 响应头 `Content-Type: application/x-ndjson` + `Cache-Control: no-cache` + `Connection: keep-alive`。

**关键设计**：使用 **NDJSON (Newline Delimited JSON)** 而非 SSE，不需要 `data:` 前缀，前端解析更简单。

### 1.4 Frontend 层：React 组件树与 Hooks 架构

#### 1.4.1 路由与页面结构（`frontend/src/App.tsx`, L1-40）

- L2: `BrowserRouter`, 2 个主路由 + 1 个仅开发模式的 Demo 路由。
- L22: `/` → `ProjectSelector`（项目选择页）
- L23: `/projects/*` → `ChatPage`（主聊天页，通配符捕获路径为 working directory）
- L24-33: `/demo` → `DemoPage`（仅开发模式，lazy loaded）

#### 1.4.2 Vite 代理配置（`frontend/vite.config.ts`, L24-29）

```typescript
server: {
  port: 3000,
  proxy: {
    "/api": { target: `http://localhost:${apiPort}`, changeOrigin: true }
  }
}
```

开发模式下，前端 `/api/*` 请求全部代理到后端 8080 端口。生产模式中，Hono 后端直接 serve 构建后的前端静态资源（SPA fallback）。

#### 1.4.3 API 客户端配置（`frontend/src/config/api.ts`, L1-44）

只使用相对路径，所有 `/api/*` 端点由 Vite proxy (开发) 或 SPA fallback (生产) 处理。无需跨域配置。

#### 1.4.4 ChatPage：状态聚合中枢（`frontend/src/components/ChatPage.tsx`, L1-593）

组合 6 个 hooks：
| Hook | 职责 |
|---|---|
| `useClaudeStreaming` | 流式行解析入口 |
| `useChatState` | 消息列表、输入、加载状态 |
| `usePermissions` | 工具权限请求状态管理 |
| `usePermissionMode` | 运行模式 (default/plan/acceptEdits) |
| `useAbortController` | 请求中止 |
| `useAutoHistoryLoader` | 会话历史自动加载 |

**流式数据管道** (ChatPage L170-227)：
```
fetch('/api/chat') → response.body.getReader() → TextDecoder → 
split("\n") → processStreamLine(line, context) → UnifiedMessageProcessor
```

**权限交互闭环** (ChatPage L130-371)：
- 工具权限被拒 → `handlePermissionError` → `showPermissionRequest` → UI 显示 3 按钮面板 → 用户选择 allow/deny/allowPermanent → 自动 `sendMessage("continue", updatedTools, true)` 继续执行
- Plan 模式完成 → `showPlanModeRequest` → UI 显示 3 按钮面板 → 用户选择 acceptWithEdits/acceptDefault/keepPlanning → 继续或保持计划模式

---

## 2. 流式输出与权限管理实现

### 2.1 流式输出全链路

```
Claude SDK query() 
  → AsyncGenerator<SDKMessage> 
  → backend yield StreamResponse { type: "claude_json", data: sdkMessage }
  → ReadableStream → NDJSON encode → HTTP Response
  → frontend fetch() → reader.read() → TextDecoder
  → split("\n") → JSON.parse → StreamResponse
  → useStreamParser.processStreamLine() 
  → UnifiedMessageProcessor.processMessage()
  → React setState → UI re-render
```

#### 2.1.1 前端入口：`useClaudeStreaming`（`frontend/src/hooks/useClaudeStreaming.ts`, L1-10）

仅 10 行的极简包装，直接委托给 `useStreamParser().processStreamLine`。

#### 2.1.2 流解析器：`useStreamParser`（`frontend/src/hooks/streaming/useStreamParser.ts`, L1-133）

- L22: 使用 `useMemo` 创建单一 `UnifiedMessageProcessor` 实例，避免重复创建。
- L53-94 `processClaudeData`: 按 Claude SDK 消息类型 (`system`/`assistant`/`result`/`user`) 分发处理。
- L96-128 `processStreamLine`: 逐行解析：
  - `claude_json` 类型 → 提取 `data` 字段作为 `SDKMessage` → 送入 `processClaudeData`
  - `error` 类型 → 构造 `ErrorMessage` 并 `addMessage`
  - `aborted` 类型 → 构造 `AbortMessage`，清除 `currentAssistantMessage`

#### 2.1.3 统一消息处理器：`UnifiedMessageProcessor`（`frontend/src/utils/UnifiedMessageProcessor.ts`, L1-543）

设计亮点：**同一处理器同时服务 streaming 和 batch history 两种场景**，通过 `ProcessingOptions.isStreaming` 标志区分。

关键消息处理路径：

| 消息类型 | 方法 | 行号 | 行为 |
|---|---|---|---|
| `system` | `processSystemMessage` | L279-301 | init 消息仅首次显示；非 init 始终显示 |
| `assistant` | `processAssistantMessage` | L307-387 | 流式中逐块追加文本 (L342)；批量模式收集后统一排版 |
| `result` | `processResultMessage` | L392-405 | 转换并添加；流式模式清除 currentAssistantMessage |
| `user` | `processUserMessage` | L409-463 | 处理 `tool_result` 和普通文本 |

**assistant 消息的流式文本拼接** (L201-224)：
```typescript
// 首次文本片段 → 创建新消息
messageToUpdate = { type: "chat", role: "assistant", content: "", timestamp };
context.addMessage(messageToUpdate);

// 后续文本片段 → 更新最后一条消息的 content
const updatedContent = (messageToUpdate.content || "") + contentItem.text;
context.updateLastMessage?.(updatedContent);
```

**特殊工具处理** (L228-273):
- `ExitPlanMode` → 创建 `PlanMessage`（显示完整计划文本）
- `TodoWrite` → 创建 `TodoMessage`（渲染待办列表）
- 其他工具 → 创建 `ToolMessage`（显示工具调用详情）

**权限错误检测** (L70-72, L112-138):
- 检测 `tool_result.is_error && !tool_use_error`（区分工具执行错误和权限错误）
- 自动 `onAbortRequest()` 中止当前请求
- 从 `toolUseCache` 提取工具名和参数 → 生成 `allowedTools` patterns → 回调 `onPermissionError`

### 2.2 权限管理模式

#### 2.2.1 三种权限模式（`frontend/src/types.ts`, L173）

```typescript
type PermissionMode = "default" | "plan" | "acceptEdits";
```
- `default`: 标准模式，显示工具级权限询问
- `plan`: 计划模式，Claude 只规划不执行；完成后显示计划审批面板
- `acceptEdits`: 自动接受代码编辑

**切换方式**：`Ctrl+Shift+M` 快捷键 (ChatInput L100-110) 或点击状态栏按钮。

#### 2.2.2 工具权限面板：`PermissionInputPanel`（`frontend/src/components/chat/PermissionInputPanel.tsx`, L1-307）

三个按钮：
- **Yes** (allow)：临时授权，会后失效
- **Yes, and don't ask again for X command** (allowPermanent)：永久授权，存储在 `allowedTools` state
- **No** (deny)：拒绝

**键盘操作**：方向键上/下选择，Enter 确认，ESC 拒绝 (L126-168)。

**命令提取** (L6-75)：从 `Bash(ls:*)` 这样的 pattern 中提取可读命令名如 `ls`。

**状态管理** (`frontend/src/hooks/chat/usePermissions.ts`, L1-109):
- `allowedTools: string[]` 存储已授权的工具 patterns
- `permissionRequest` 控制面板显示
- `allowToolTemporary` vs `allowToolPermanent` 区别临时/永久授权

#### 2.2.3 计划模式面板：`PlanPermissionInputPanel`（`frontend/src/components/chat/PlanPermissionInputPanel.tsx`, L1-229）

三个按钮：
- **Yes, and auto-accept edits** → `permissionMode = "acceptEdits"`
- **Yes, and manually approve edits** → `permissionMode = "default"`
- **No, keep planning** → `permissionMode = "plan"` 保持不变

### 2.3 暗黑/亮色主题切换

#### 实现链路（4 个文件）

| 文件 | 行号 | 职责 |
|---|---|---|
| `types/settings.ts` | L1-32 | `AppSettings.theme: "light" \| "dark"` 类型定义 |
| `utils/storage.ts` | L40-89 | localStorage 持久化，含从 legacy key 迁移逻辑 |
| `contexts/SettingsContext.tsx` | L20-28 | `root.classList.add("dark")` / `remove("dark")` |
| `components/settings/GeneralSettings.tsx` | L35-58 | 主题切换按钮 UI（SunIcon/MoonIcon） |

**具体机制**：
- `index.css` (L1-4)：
  ```css
  @import "tailwindcss";
  @variant dark (.dark &);
  ```
  所有 `dark:*` 类依赖 `<html>` 上的 `.dark` class。
- `SettingsContext` (L23-28)：当 `settings.theme === "dark"` 时，`document.documentElement.classList.add("dark")`。
- `settings.storage.ts` (L59-89)：首次加载时检测 `prefers-color-scheme: dark` 媒体查询作为系统默认。
- `GeneralSettings.tsx` (L35-58)：使用 `role="switch"` + `aria-checked` 提供无障碍支持。

---

## 3. 最轻量包装模式的价值

### 3.1 设计哲学

claude-code-webui 的核心设计哲学是 **"最小可行 Web 壳"**：

1. **不造轮子**：不重新实现 Claude 的任何能力（prompt 工程、工具调用、会话管理），完全透传 Claude Code SDK 的 `query()` 输出。
2. **极薄后端**：`backend/handlers/chat.ts` 不足 150 行，核心逻辑是 `for await (const msg of query(...))` 的循环包装。
3. **纯展示前端**：不做任何 AI 逻辑，只做 UI 渲染和用户交互。所有推理、工具调用、上下文管理都由 Claude SDK 完成。
4. **单二进制分发**：生产模式中后端 serve 前端构建产物，不需要分开部署。
5. **零认证**：定位为本地开发工具，默认绑定 `127.0.0.1`，不做用户认证。

### 3.2 技术选型对比

| 维度 | claude-code-webui | siteboon/claudecodeui | sunpix/claude-code-web |
|---|---|---|---|
| 运行时 | Deno/Node.js 双运行时 | Node.js | Node.js (Nuxt 4) |
| 前端框架 | React + Vite | React | Nuxt 4 (Vue) |
| 后端框架 | Hono | Express | Nitro |
| 流式协议 | NDJSON over HTTP | SSE | SSE |
| 移动端 | 响应式 Tailwind | 响应式 | PWA + 响应式 |
| 分发方式 | npm + 单二进制 | npm + Docker | npm |
| 语音输入 | 不支持 | 不支持 | 支持 (TTS/STT) |
| 拖拽图片 | 不支持 | 不支持 | 支持 |
| MCP 集成 | Playwright MCP (测试) | 不明确 | 不明确 |

### 3.3 移动端自适配策略（`frontend/` 全面使用 Tailwind Responsive）

| 布局特点 | 实现方式 | 文件示例 |
|---|---|---|
| 最大宽度限制 | `max-w-6xl mx-auto` | ChatPage L438 |
| 自适应内边距 | `p-3 sm:p-6` | ChatPage L438 |
| 自适应字体 | `text-lg sm:text-3xl` | ChatPage L466 |
| 自适应间距 | `mb-4 sm:mb-8` | ChatPage L440 |
| 移动端全屏 | `h-screen flex flex-col` | ChatPage L438 |
| 输入框高度自适应 | `max-h-[...] resize-none` + JS auto-resize | ChatInput L79-91 |

移动端不隐藏任何功能，所有桌面功能在手机上通过触控友好布局可用。

### 3.4 轻量化的量化指标

| 指标 | 数值 |
|---|---|
| Backend 代码行数 | ~1,600 行 TypeScript（不含 node_modules） |
| Frontend 代码行数 | ~4,000 行 TypeScript/TSX（不含 node_modules） |
| Shared 代码行数 | **54 行** |
| 后端 API 端点 | **5 个** |
| 前端路由 | **3 个**（项目选择、聊天、Demo） |
| 前端 Hooks | **8 个** |
| NPM 包大小 | ~2MB (compressed) |
| 单二进制大小 | ~50MB (含 Deno runtime) |

---

## 4. 对 AgentHub 的具体建议

### 4.1 可复用模式

1. **NDJSON 流式协议**
   - 比 SSE 更简洁（无 `data:` 前缀解析），比 WebSocket 更轻量
   - 实现成本：1 行 `JSON.stringify(chunk) + "\n"` + 前端 `split("\n")`
   - 建议 AgentHub 的 Agent 通信层优先采用此模式

2. **Runtime Abstraction（Hono + Runtime 接口）**
   - 仅 4 个方法的 `Runtime` 接口实现了 Deno/Node 双运行时
   - 如果 AgentHub 需要支持多种部署环境，这个模式值得直接复用

3. **Shared Types 层**
   - 54 行的纯类型文件作为前后端契约，零运行时依赖
   - AgentHub 的 API 契约也用单一 shared types 文件维护，降低前后端类型不一致风险

4. **UnifiedMessageProcessor 模式**
   - Streaming 和 Batch History 共用同一消息处理器
   - AgentHub 的消息渲染管道应设计为双模式兼容

5. **Permission 交互的 UI 模式**
   - 工具级 "临时/永久/拒绝" 三选一 + 键盘导航 + 外部 Demo 控制接口
   - AgentHub 的 Agent 权限审批 UI 可直接参考此设计

### 4.2 可改进之处（AgentHub 应做得更好）

1. **无认证机制** -- 这是一个显著短板。AgentHub 作为多用户平台，必须内置认证。
2. **无 WebSocket 支持** -- HTTP NDJSON 是单向流（服务端到客户端），客户端仍需新 HTTP 请求发送消息。AgentHub 应考虑 WebSocket 实现真正的双向流。
3. **无数据库** -- 历史存储完全依赖 Claude CLI 的 JSONL 文件。AgentHub 需要持久化存储层（PostgreSQL）。
4. **无 Agent 编排** -- 仅包装单个 Claude 实例。AgentHub 的核心价值是多 Agent 协作编排。
5. **CORS 全开** (`origin: "*"`) -- 本地工具可接受，但 AgentHub 必须严格限制。

### 4.3 差异化价值主张

| 维度 | claude-code-webui | AgentHub 应做到的 |
|---|---|---|
| 定位 | 单用户本地 Claude 包装器 | 多用户多 Agent 协作平台 |
| 协议层 | NDJSON over HTTP | WebSocket + NDJSON |
| 持久化 | JSONL 文件 | PostgreSQL + 对象存储 |
| 认证 | 无 | OAuth2/OIDC |
| Agent 管理 | 单实例 | 多实例编排 + 生命周期管理 |
| 权限模型 | CLI 工具级 | 用户级 + 项目级 + Agent 级 |
| 前端框架 | React + Vite | 推荐 React（生态成熟度最高） |
