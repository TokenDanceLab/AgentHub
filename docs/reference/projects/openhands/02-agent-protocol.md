# OpenHands Agent Server 通信协议深度剖析

> 来源：`D:\Code\AgentHub\reference\OpenHands` (v1.7.0 monorepo)
> 外部 SDK 包：`openhands-agent-server==1.22.1`, `openhands-sdk==1.22.1`, `openhands-tools==1.22.1`
> 日期：2026-05-21

---

## 1. 三层通信架构总览

```
┌──────────────────────────────────────────────────────────────────┐
│  前端 (React SPA, browser)                                       │
│  - WebSocket 实时事件流                                           │
│  - REST API 消息发送 (fallback)                                   │
│  - Zustand stores (UI 状态) + React Query (服务端数据)             │
└───────────┬──────────────────────────┬───────────────────────────┘
            │ WebSocket                │ REST
            │ ws://agent-server:8000   │ /api/v1/app-conversations
            ▼                          ▼
┌──────────────────────────────────────────────────────────────────┐
│  App Server (FastAPI, port 3000)                                 │
│  - SandboxService: 管理 Docker/Process 沙箱生命周期                 │
│  - EventService: 事件持久化 (DB/S3/GCS)                            │
│  - EventCallbackService: 回调处理 (auto-title, analytics)          │
│  - PendingMessageService: 待发送消息队列                           │
│  - 鉴权：SetAuthCookieMiddleware + X-Session-API-Key              │
└───────────┬──────────────────────────┬───────────────────────────┘
            │ HTTP (httpx proxy)       │ Webhook (反向推送)
            │ X-Session-API-Key        │ POST /api/v1/webhooks/events
            ▼                          ▼
┌──────────────────────────────────────────────────────────────────┐
│  Agent Server (Python Uvicorn, port 8000, inside Sandbox)        │
│  - Conversation CRUD REST API                                    │
│  - WebSocket 事件推送 (/sockets/events/{id})                      │
│  - Agent 运行时 (LLM loop + tool execution)                       │
│  - Health check (/health)                                        │
│  - Skills / Hooks 端点                                           │
└──────────────────────────────────────────────────────────────────┘
```

**关键安全边界**：App Server **从不直接操作** Sandbox 内的文件系统或 Agent 进程。所有与 Agent 的交互都通过 Agent Server 的 HTTP/WebSocket API，鉴权依赖 `X-Session-API-Key`（沙箱启动时生成的 32 字节 base62 随机 token）。

---

## 2. 通信流 1：会话创建

### 2.1 流程（`live_status_app_conversation_service.py:241-422`）

```
Frontend                    App Server                    Agent Server (Sandbox)
   │                           │                               │
   │ POST /api/v1/             │                               │
   │   app-conversations       │                               │
   │──────────────────────────>│                               │
   │                           │ start_sandbox()               │
   │                           │ (Docker/Process)              │
   │                           │──────────────────────────────>│ (容器启动)
   │                           │                               │
   │                           │ wait_for_sandbox_running()    │
   │                           │ GET /health ◄─────────────────│
   │                           │                               │
   │                           │ run_setup_scripts()           │
   │                           │ (clone repo, setup.sh,        │
   │                           │  git hooks, load skills)      │
   │                           │                               │
   │                           │ POST /api/conversations       │
   │                           │──────────────────────────────>│
   │                           │  StartConversationRequest {   │
   │                           │    agent: Agent {             │
   │                           │      llm: LLM(...)            │
   │                           │      tools: [...],            │
   │                           │      condenser: ...,           │
   │                           │      agent_context: {         │
   │                           │        skills, secrets,       │
   │                           │        system_message_suffix  │
   │                           │      }                        │
   │                           │    },                         │
   │                           │    workspace: LocalWorkspace, │
   │                           │    initial_message?,          │
   │                           │    conversation_id,           │
   │                           │    hook_config?,              │
   │                           │    plugins?                   │
   │                           │  }                            │
   │                           │                               │
   │                           │ ◄──── ConversationInfo ───────│
   │                           │                               │
   │ (polling)                 │                               │
   │◄── AppConversationStartTask (status: WORKING →            │
   │    WAITING_FOR_SANDBOX → PREPARING_REPOSITORY →           │
   │    RUNNING_SETUP_SCRIPT → SETTING_UP_GIT_HOOKS →          │
   │    SETTING_UP_SKILLS → STARTING_CONVERSATION →            │
   │    READY [app_conversation_id, agent_server_url])         │
```

### 2.2 StartConversationRequest 结构

```python
# 来自 openhands.agent_server.models (SDK 包)
class StartConversationRequest:
    agent: Agent                  # see below
    conversation_id: UUID
    workspace: LocalWorkspace     # working_dir
    initial_message: SendMessageRequest | None
    hook_config: HookConfig | None
    plugins: list[PluginSource] | None

class Agent:
    llm: LLM                     # model, base_url, api_key, usage_id
    tools: list[Tool]            # 工具集
    condenser: Condenser | None  # LLMSummarizingCondenser
    agent_context: AgentContext | None  # skills, secrets, system_message_suffix
    security_analyzer: SecurityAnalyzerBase | None
    max_iterations: int
    confirmation_mode: bool
    agent_kind: "openhands" | "acp"  # discriminator
```

### 2.3 App Server → Agent Server 的 HTTP 调用

```python
# live_status_app_conversation_service.py:337-342
response = await self.httpx_client.post(
    f'{agent_server_url}/api/conversations',
    json=start_conversation_request.model_dump(
        mode='json', context={'expose_secrets': True}
    ),
    headers={'X-Session-API-Key': sandbox.session_api_key},
    timeout=self.sandbox_startup_timeout,  # 默认 120s
)
```

---

## 3. 通信流 2：GUI ↔ Agent 实时通信（WebSocket）

### 3.1 WebSocket URL 构建（`websocket-url.ts:78-95`）

```
ws://{agent_server_host}:{port}/sockets/events/{conversationId}
   ?resend_all=true
   &session_api_key={key}
```

其中 `agent_server_host:port` 从 `conversation_url` 提取（例如 `http://localhost:55313/api/conversations/abc` → `localhost:55313`）。支持代理部署场景下的路径前缀（例如 `/runtime/55313`）。

### 3.2 WebSocket 连接建立（`conversation-websocket-context.tsx`）

```typescript
// 主连接 WebSocket options
const mainWebsocketOptions = {
  queryParams: {
    resend_all: true,            // 重连时重放所有历史事件
    session_api_key: sessionApiKey
  },
  reconnect: { enabled: true },  // 自动重连 (3s 延迟)
  onOpen: async () => {
    // 获取 event count 用于 history loading 检测
    const count = await EventService.getEventCount(
      conversationId, conversationUrl, sessionApiKey
    );
    setExpectedEventCountMain(count);
  },
  onMessage: handleMainMessage,  // 处理每个事件
};
```

**双连接模式**：Planning Agent 使用单独的子对话连接 `planningAgentWsUrl`，两个 WebSocket 并行管理。

### 3.3 前端通过 WebSocket 发送消息

```typescript
// conversation-websocket-context.tsx:835-878
const sendMessage = async (message: V1SendMessageRequest) => {
  if (ws.readyState !== WebSocket.OPEN) {
    // Fallback: 通过 REST 将消息排入 pending-messages 队列
    await PendingMessageService.queueMessage(conversationId, {
      role: "user",
      content: message.content,
    });
    return { queued: true };
  }
  // 正常路径：直接通过 WebSocket 发送 JSON
  ws.send(JSON.stringify(message));
  return { queued: false };
};
```

### 3.4 WebSocket 消息格式

**发送（前端 → Agent Server）**：

```typescript
interface V1SendMessageRequest {
  role: "user" | "system" | "assistant" | "tool";
  content: (V1TextContent | V1ImageContent)[];
}

interface V1TextContent {
  type: "text";
  text: string;
}

interface V1ImageContent {
  type: "image";
  image_urls: string[];
}
```

**接收（Agent Server → 前端）**：每个 WebSocket 消息是一个 JSON 序列化的 Event 对象：

```typescript
interface BaseEvent {
  id: EventID;           // ULID/UUID
  timestamp: string;     // ISO string
  source: "agent" | "environment";
  kind: string;          // discriminator
}
```

### 3.5 事件类型全景

```
Event (discriminated by `kind`)
│
├─ source = "agent"
│  ├─ Action events (tool call)
│  │  ├─ ExecuteBashAction       { action: { command } }
│  │  ├─ FileEditorAction        { action: { path, content, ... } }
│  │  ├─ StrReplaceEditorAction  { action: { path, old_str, new_str } }
│  │  ├─ BrowserNavigateAction   { action: { url } }
│  │  ├─ BrowserClickAction
│  │  ├─ BrowserTypeAction
│  │  ├─ BrowserScrollAction
│  │  ├─ ThinkAction
│  │  ├─ FinishAction
│  │  ├─ MCPToolAction
│  │  ├─ TaskTrackerAction
│  │  ├─ PlanningFileEditorAction
│  │  ├─ GlobAction
│  │  └─ GrepAction
│  │
│  ├─ Observation events (tool result)
│  │  ├─ ExecuteBashObservation  { observation: { content: [...], exit_code } }
│  │  ├─ FileEditorObservation
│  │  ├─ BrowserObservation      { observation: { screenshot_data, url } }
│  │  ├─ TerminalObservation
│  │  └─ ...
│  │
│  ├─ MessageEvent               { llm_message: { role, content, tool_calls } }
│  └─ AgentErrorEvent            { error, tool_name, tool_call_id }
│
├─ source = "environment"
│  ├─ ConversationStateUpdateEvent
│  │  ├─ key = "execution_status"  { value: V1ExecutionStatus }
│  │  ├─ key = "stats"             { value: ConversationStats }
│  │  └─ key = "full_state"        { value: ConversationState }
│  ├─ ConversationErrorEvent     { code, detail }
│  ├─ ServerErrorEvent           { code, detail }
│  ├─ HookExecutionEvent
│  ├─ PauseEvent
│  └─ CondensationEvent
```

### 3.6 前端事件处理管线（`handleMainMessage`）

```
WebSocket message (JSON)
  → JSON.parse → Event
  → isV1Event(event) ?                  # type guard
  → addEvent(event)                     # 写入 Zustand event store
  → handleNonErrorEvent(event)          # 清除 error banner
  → 事件分发：
      isDisplayableErrorEvent  → setErrorMessage()
      isAgentErrorEvent        → trackError() + setErrorMessage()
      isUserMessageEvent       → removeOptimisticUserMessage()
      isActionEvent            → cache invalidation (React Query)
      isConversationStateUpdateEvent → setExecutionStatus() / updateMetricsFromStats()
      isExecuteBashActionEvent → appendInput(command)  # terminal
      isExecuteBashObservationEvent → appendOutput(text)
      isBrowserObservationEvent → setScreenshotSrc()
      isBrowserNavigateActionEvent → setUrl()
      isPlanningFileEditorObservationEvent → readConversationFile(PLAN.md)
```

---

## 4. 通信流 3：REST 消息发送（Fallback 路径）

### 4.1 send-message 端点（`app_conversation_router.py:425-586`）

当前端 WebSocket 未连接时，使用 REST 路径：

```
Frontend                          App Server                     Agent Server
   │ POST /api/v1/                  │                              │
   │   app-conversations/{id}/      │                              │
   │   send-message                 │                              │
   │───────────────────────────────>│                              │
   │  AppSendMessageRequest {       │                              │
   │    role: "user",               │                              │
   │    content: [...],             │ POST /api/conversations/{id}/ │
   │    run: true                   │      events                  │
   │  }                             │─────────────────────────────>│
   │                                │  { role, content, run }      │
   │                                │                              │
   │                                │ ◄──── 200 OK ────────────────│
   │◄── AppSendMessageResponse ────│                              │
```

**App Server 作为 thin proxy**：不做额外处理，直接转发到 Agent Server 的 `/api/conversations/{id}/events`。

### 4.2 Pending Message 队列（`pending_message_router.py`）

```python
# 前端可以在 conversation READY 之前就提交消息
POST /api/v1/conversations/{conversation_id}/pending-messages
{
  "role": "user",
  "content": [{"type": "text", "text": "..."}]
}

# 限制：每个 conversation 最多 10 条 pending message
# 当 conversation READY 后自动投递到 Agent Server 并清除
```

---

## 5. 通信流 4：Agent Server → App Server 反向推送（Webhook）

### 5.1 事件持久化 Webhook（`webhook_router.py:406-452`）

Agent Server 在事件生成后，**批量推送**到 App Server：

```
Agent Server                             App Server
   │ POST /api/v1/webhooks/events/{id}    │
   │─────────────────────────────────────>│
   │  [Event, Event, ...]                  │
   │  X-Session-API-Key: {key}             │
   │                                       │ 1. save_event() 持久化到 DB/S3/GCS
   │                                       │ 2. process_stats_event() 更新 metrics
   │                                       │ 3. execute_callbacks() (如 auto-title)
   │                                       │ 4. terminal state analytics
   │◄──── 200 Success ────────────────────│
```

### 5.2 会话生命周期 Webhook（`webhook_router.py:298-403`）

```python
POST /api/v1/webhooks/conversations
{
  "id": UUID,
  "execution_status": "RUNNING" | "PAUSED" | "DELETING" | ...,
  "agent": AgentBase,     # discriminated union: Agent | ACPAgent
  "stats": {...},
  "tags": {...}
}
# App Server 据此更新 AppConversationInfo（title, llm_model, tags）
```

### 5.3 事件回调处理器体系（`event_callback_models.py`）

```
EventCallbackProcessor (ABC)
  ├─ SetTitleCallbackProcessor  # 自动生成对话标题
  ├─ LoggingCallbackProcessor   # 日志
  └─ (可扩展)
```

回调按序执行（非并发），通过 `EventCallbackService.execute_callbacks()` 调度。

---

## 6. Sandbox Service 通信协议

### 6.1 SandboxService ABC（`sandbox_service.py:29-232`）

```python
class SandboxService(ABC):
    # 生命周期
    start_sandbox(spec_id?, sandbox_id?) -> SandboxInfo
    resume_sandbox(id) -> bool
    pause_sandbox(id) -> bool
    delete_sandbox(id) -> bool
    wait_for_sandbox_running(id, timeout, poll_interval) -> SandboxInfo

    # 查询
    search_sandboxes() -> SandboxPage
    get_sandbox(id) -> SandboxInfo | None
    get_sandbox_by_session_api_key(key) -> SandboxInfo | None
    batch_get_sandboxes(ids) -> list[SandboxInfo | None]

    # 维护
    pause_old_sandboxes(max) -> list[str]
```

### 6.2 SandboxInfo 模型（`sandbox_models.py:33-56`）

```python
class SandboxInfo:
    id: str                       # base62 编码 16 字节随机
    created_by_user_id: str | None
    sandbox_spec_id: str           # Docker image tag
    status: SandboxStatus          # STARTING | RUNNING | PAUSED | ERROR | MISSING
    session_api_key: str | None    # 鉴权 bearer token（仅 RUNNING 时）
    exposed_urls: list[ExposedUrl] # 暴露的服务 URL
    created_at: datetime

class ExposedUrl:
    name: str     # AGENT_SERVER | VSCODE | WORKER_1 | WORKER_2
    url: str      # http://localhost:{mapped_port}
    port: int     # 容器内端口
```

### 6.3 三种 Sandbox 实现

| 实现 | 隔离方式 | Agent Server 位置 | 适用场景 |
|------|---------|-------------------|----------|
| `DockerSandboxService` | Docker 容器 | `ghcr.io/openhands/agent-server:1.22.1-python` | 生产部署 |
| `ProcessSandboxService` | 子进程 | 本地 Python 子进程 | 本地开发 (`RUNTIME=local`) |
| `RemoteSandboxService` | 远程 API | 托管 Agent Server | SaaS/Cloud |

### 6.4 DockerSandboxService 启动细节（`docker_sandbox_service.py:360-493`）

1. 检查沙箱数量限制（`max_num_sandboxes`，默认 5）
2. 生成 `sandbox_id`（base62，16 字节）和 `session_api_key`（32 字节）
3. 注入环境变量：
   ```
   OH_SESSION_API_KEYS_0={session_api_key}
   OH_WEBHOOKS_0_BASE_URL={app_server_url}/api/v1/webhooks
   OH_ALLOW_CORS_ORIGINS_*={frontend_origin}
   ```
4. 端口映射：bridge 网络下映射到宿主机随机端口，host 网络下直通
5. `docker_client.containers.run()` 创建容器
6. 健康检查：`httpx_client.get(agent_server_url/health)`，`startup_grace_seconds` 默认 15s

### 6.5 Agent Server 内环境变量自动转发

App Server 自动将以 `LLM_*` 和 `LMNR_*` 为前缀的环境变量注入 agent-server 容器。可通过 `OH_AGENT_SERVER_ENV` JSON 覆盖。

---

## 7. Agent Server 完整 REST API（沙箱内）

以下端点在 Agent Server 进程内暴露（Uvicorn，端口 8000）。App Server 通过 `httpx` 代理调用，前端通过 WebSocket 直连或经 App Server REST 转发。

| 方法 | 路径 | 说明 | 鉴权 |
|------|------|------|------|
| `POST` | `/api/conversations` | 创建会话（传入 Agent 配置） | X-Session-API-Key |
| `GET` | `/api/conversations?ids=...` | 批量获取会话状态 | X-Session-API-Key |
| `PATCH` | `/api/conversations/{id}` | 更新会话（如 title） | X-Session-API-Key |
| `DELETE` | `/api/conversations/{id}` | 删除会话 | X-Session-API-Key |
| `POST` | `/api/conversations/{id}/events` | 发送消息 (role + content + run) | X-Session-API-Key |
| `GET` | `/api/conversations/{id}/events/count` | 事件总数 | X-Session-API-Key |
| `POST` | `/api/conversations/{id}/events/respond_to_confirmation` | 确认工具执行 | X-Session-API-Key |
| `POST` | `/api/conversations/{id}/switch_llm` | 动态切换 LLM | X-Session-API-Key |
| `POST` | `/api/conversations/{id}/security_analyzer` | 设置安全分析器 | X-Session-API-Key |
| `GET` | `/api/conversations/{id}/file?file_path=...` | 读取工作区文件 | X-Session-API-Key |
| `GET` | `/api/skills` | 加载 skills（多来源合并） | X-Session-API-Key |
| `GET` | `/api/hooks` | 加载 hooks 配置 | X-Session-API-Key |
| `GET` | `/health` | 健康检查 | 无 |
| `WS` | `/sockets/events/{id}` | WebSocket 实时事件流 | X-Session-API-Key (query param) |

---

## 8. App Server REST API（FastAPI V1）

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/v1/app-conversations/search` | 分页搜索会话 |
| `GET` | `/api/v1/app-conversations/count` | 计数 |
| `POST` | `/api/v1/app-conversations` | 启动新会话（返回 StartTask） |
| `POST` | `/api/v1/app-conversations/stream-start` | 流式启动（SSE） |
| `GET` | `/api/v1/app-conversations?ids=...` | 批量获取 |
| `PATCH` | `/api/v1/app-conversations/{id}` | 更新会话元数据 |
| `POST` | `/api/v1/app-conversations/{id}/send-message` | 发送消息（REST fallback） |
| `POST` | `/api/v1/app-conversations/{id}/switch_profile` | 切换 LLM profile |
| `DELETE` | `/api/v1/app-conversations/{id}` | 删除会话 |
| `GET` | `/api/v1/app-conversations/{id}/file` | 读取工作区文件 |
| `GET` | `/api/v1/app-conversations/{id}/skills` | 获取会话 skills |
| `GET` | `/api/v1/app-conversations/{id}/hooks` | 获取会话 hooks |
| `GET` | `/api/v1/app-conversations/{id}/download` | 导出对话轨迹 (zip) |
| `GET` | `/api/v1/conversations/{id}/events/search` | 搜索事件 |
| `GET` | `/api/v1/conversations/{id}/events/count` | 事件计数 |
| `POST` | `/api/v1/conversations/{id}/events/respond_to_confirmation` | 确认工具执行 |
| `POST` | `/api/v1/sandboxes` | 启动新沙箱 |
| `GET` | `/api/v1/sandboxes/search` | 搜索沙箱 |
| `POST` | `/api/v1/sandboxes/{id}/pause` | 暂停沙箱 |
| `POST` | `/api/v1/sandboxes/{id}/resume` | 恢复沙箱 |
| `DELETE` | `/api/v1/sandboxes/{id}` | 删除沙箱 |
| `POST` | `/api/v1/webhooks/conversations` | 会话生命周期回调 |
| `POST` | `/api/v1/webhooks/events/{id}` | 事件持久化回调 |

---

## 9. 对 AgentHub Edge↔Runner 通信的参考价值

### 9.1 可借鉴模式

1. **WebSocket 作为主要实时通道**
   - AgentHub Runner 暴露 WebSocket（类似 Agent Server 的 `/sockets/events/{id}`）
   - 前端通过 WebSocket 推送用户消息、接收流式事件
   - `resend_all=true` 重连时重放历史 —— 适合 AgentHub 的对话连续性

2. **事件体系设计**
   - `id + timestamp + source + kind` 四元组基类
   - Action/Observation 配对模式（每个 tool call 都有对应 observation）
   - `ConversationStateUpdateEvent` 异步更新执行状态 —— AgentHub 可在 Thread 级别使用

3. **REST fallback + 消息队列**
   - WebSocket 断开时将消息写入 `pending_messages` 队列
   - 连接恢复后自动投递 —— 适合 AgentHub 的边缘场景

4. **Session API Key 鉴权**
   - Sandbox 启动时生成随机 token，通过 `X-Session-API-Key` header 传递
   - AgentHub Runner 可在 Agent CLI 启动时生成 session token

5. **Webhook 反向推送事件持久化**
   - Agent Server 向 App Server 推送事件批次
   - AgentHub Runner 可向 Edge 推送事件批次用于持久化和回调

6. **健康检查模式**
   - `GET /health` + `startup_grace_seconds`
   - AgentHub Runner 服务可用相同模式

### 9.2 不建议照搬

1. **App Server 作为 thin proxy 的 send-message** —— AgentHub 应让前端直连 Runner WebSocket，不经 Edge 中转
2. **Docker 容器默认隔离** —— AgentHub P0 用 Git Worktree
3. **复杂的 Callback Processor 体系** —— AgentHub 初期可用简单的事件 hook
4. **双 WebSocket 连接（main + planning）** —— AgentHub 暂无 planning agent 概念

### 9.3 协议简化建议（AgentHub 适用）

```
简化后三层：

Edge (React)  ──WebSocket──>  Runner (Go)  ──stdio/pipe──>  Agent CLI (Python/Go)
               直连，不解耦                 本地子进程

关键差异：
- AgentHub 不需要中间 App Server 层（Runner 直接管理 Agent CLI 子进程）
- 用 Unix socket/pipe 替代 HTTP REST（Runner 和 Agent CLI 在同一机器）
- Webhook 方向简化为 Runner → Edge (事件持久化 + UI 更新)
```

---

## 附录：关键源码路径索引

| 组件 | 路径 | 说明 |
|------|------|------|
| App Server 入口 | `openhands/app_server/app.py` | FastAPI 实例化 |
| V1 路由聚合 | `openhands/app_server/v1_router.py` | 所有 router 注册 |
| 会话路由 | `openhands/app_server/app_conversation/app_conversation_router.py` | `/api/v1/app-conversations` |
| 会话服务 (Live) | `openhands/app_server/app_conversation/live_status_app_conversation_service.py` | 会话创建 + Agent Server 调用 |
| 会话模型 | `openhands/app_server/app_conversation/app_conversation_models.py` | 请求/响应模型 |
| 事件路由 | `openhands/app_server/event/event_router.py` | 事件查询 |
| Webhook 路由 | `openhands/app_server/event_callback/webhook_router.py` | Agent Server 事件回推 |
| Sandbox 路由 | `openhands/app_server/sandbox/sandbox_router.py` | 沙箱 CRUD |
| Sandbox 服务 ABC | `openhands/app_server/sandbox/sandbox_service.py` | 沙箱生命周期抽象 |
| Docker 实现 | `openhands/app_server/sandbox/docker_sandbox_service.py` | DockerSandboxService |
| 前端 WebSocket hook | `frontend/src/hooks/use-websocket.ts` | 通用 WebSocket hook |
| 会话 WebSocket 上下文 | `frontend/src/contexts/conversation-websocket-context.tsx` | 事件处理管线 |
| WebSocket URL 构建 | `frontend/src/utils/websocket-url.ts` | URL 构建 + host 提取 |
| 事件 API Service | `frontend/src/api/event-service/event-service.api.ts` | EventService |
| 会话 API Types | `frontend/src/api/conversation-service/v1-conversation-service.types.ts` | 前端类型 |
| 事件基础类型 | `frontend/src/types/v1/core/base/event.ts` | BaseEvent, Message |
| 事件类型索引 | `frontend/src/types/v1/core/events/index.ts` | 所有事件类型导出 |
| Pending Message 路由 | `openhands/app_server/pending_messages/pending_message_router.py` | 消息排队 |
