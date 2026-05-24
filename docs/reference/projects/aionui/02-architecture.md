# 02 - AionUi 架构深度

## 进程/服务拓扑

```
┌──────────────────────────────────────────────────────┐
│              Electron Main Process                    │
│  ┌────────────────────────────────────────────────┐  │
│  │  BrowserWindow (Renderer)                       │  │
│  │  ┌──────────────────────────────────────────┐  │  │
│  │  │  React App (Vite HMR in dev)              │  │  │
│  │  │  - pages/conversation                     │  │  │
│  │  │  - pages/team                             │  │  │
│  │  │  - pages/cron                             │  │  │
│  │  │  - pages/settings                         │  │  │
│  │  └──────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────┘  │
│                                                       │
│  ┌────────────────────────────────────────────────┐  │
│  │  Process Layer (same thread as main)            │  │
│  │                                                  │  │
│  │  ┌──────────┐ ┌──────────┐ ┌───────────────┐  │  │
│  │  │ Agent    │ │ Team     │ │ Extension     │  │  │
│  │  │ Registry │ │ Session  │ │ Registry      │  │  │
│  │  │          │ │ Service   │ │               │  │  │
│  │  └────┬─────┘ └────┬─────┘ └───────┬───────┘  │  │
│  │       │            │               │           │  │
│  │  ┌────┴────────────┴───────────────┴────────┐  │  │
│  │  │         ACP Runtime (AcpRuntime)          │  │  │
│  │  │  - Session management (AcpSession)        │  │  │
│  │  │  - Client factory (ClientFactory)         │  │  │
│  │  │  - Metrics (AcpMetrics)                   │  │  │
│  │  │  - Error normalization                    │  │  │
│  │  └────────────────────┬─────────────────────┘  │  │
│  │                       │                         │  │
│  │  ┌────────────────────┴─────────────────────┐  │  │
│  │  │              MCP Layer                    │  │  │
│  │  │  - MCP Server (Team coordination)         │  │  │
│  │  │  - MCP Client (Tool calling)              │  │  │
│  │  │  - Builtin MCP services (skills/)         │  │  │
│  │  │  - External MCP integration               │  │  │
│  │  └──────────────────────────────────────────┘  │  │
│  │                                                  │  │
│  │  ┌────────────────────────────────────────┐    │  │
│  │  │         Infrastructure                   │    │  │
│  │  │  ┌────────┐ ┌──────────┐ ┌───────────┐ │    │  │
│  │  │  │ SQLite │ │ Channels │ │ WebServer │ │    │  │
│  │  │  │(better │ │(IM bots) │ │ (Express) │ │    │  │
│  │  │  │sqlite3)│ │          │ │           │ │    │  │
│  │  │  └────────┘ └──────────┘ └───────────┘ │    │  │
│  │  └────────────────────────────────────────┘    │  │
│  └────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────┘
     │
     │ Child Process (spawn)
     ▼
┌─────────────────────────────────────────────┐
│  External CLI Agents                         │
│  ┌──────────┐ ┌───────┐ ┌──────────┐       │
│  │Claude Code│ │ Codex │ │Gemini CLI│  ...  │
│  └──────────┘ └───────┘ └──────────┘       │
│                                              │
│  All communicate via ACP (stdio/HTTP)        │
│  or custom adapters (Gemini/OpenClaw)        │
└─────────────────────────────────────────────┘
```

### 进程模型关键点

- **单进程为主**：Main Process 承载所有业务逻辑，Renderer 只做 UI
- **Worker Threads**：CPU 密集型任务（MCP 编译、benchmark）走 worker
- **Child Process**：外部 CLI Agent 通过 `child_process.spawn` 启动，stdio 通信
- **无 GPU 进程**：Electron 默认 GPU 进程存在，但无自定义 GPU 逻辑

## 核心数据流

### 用户输入 → Agent 输出的完整路径

```
1. 用户在 Renderer 输入消息
   └── ChatInput 组件 → useConversation hook

2. IPC Bridge (contextBridge)
   └── renderer → main process (ipcRenderer.invoke)

3. Process Layer: Agent Adapter
   └── AgentRegistry.getAgent(kind)
   └── AcpAdapter.sendMessage(sessionId, message)

4. ACP Runtime: Session dispatch
   └── AcpSession.handleUserMessage(message)
   └── AcpClient.sendRequest(prompt)  ← stdio/HTTP

5. External CLI Agent 处理
   └── Claude Code / Codex / Gemini CLI 执行工具调用
   └── 返回 stream (NDJSON/newline-delimited)

6. ACP Runtime: Stream parsing
   └── parseStream(chunks) → ToolCall | TextDelta | Approval
   └── emit events to SessionCallbacks

7. Process → Renderer push
   └── WebSocket / IPC push event to renderer

8. Renderer 更新 UI
   └── MessageList re-render (React state)
   └── Approval dialog (if needed)
```

### 关键数据流特点

- **NDJSON Stream**：所有 Agent 输出统一为 NDJSON 流式格式
- **增量渲染**：每个 chunk 即时推送到 UI，不等完整响应
- **双向 IPC**：Renderer 用 `ipcRenderer.invoke`（请求-响应），Process 用 WebSocket push（事件推送）
- **MCP 工具调用**作为特殊消息类型嵌入流中，前端渲染为可展开卡片

## 关键状态机

### Agent 会话生命周期

```
                    ┌─────────────┐
                    │   IDLE      │ ← 初始状态（Agent 已连接但无活跃任务）
                    └──────┬──────┘
                           │ user message
                           ▼
                    ┌─────────────┐
                    │  THINKING   │ ← Agent 正在推理（收到文字输出）
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
              ▼            ▼            ▼
       ┌──────────┐ ┌──────────┐ ┌──────────┐
       │TOOL_CALL │ │APPROVAL  │ │RESPONDING│
       │ (执行中) │ │(等待审批)│ │ (生成中) │
       └────┬─────┘ └────┬─────┘ └────┬─────┘
            │            │            │
            │  批准/拒绝  │            │
            └────────────┴────────────┘
                           │
                           ▼
                    ┌─────────────┐
                    │  COMPLETED  │ ← 本轮结束
                    └──────┬──────┘
                           │ next user message
                           ▼
                    ┌─────────────┐
                    │   IDLE      │ ← 回到空闲
                    └─────────────┘

异常转换：
  IDLE/THINKING/TOOL_CALL → ERROR（任何阶段可触发）
  ERROR → IDLE（用户确认后重置）
  IDLE → TERMINATED（用户关闭会话）
```

### Team 会话生命周期

```
┌──────────┐    create    ┌──────────────┐
│  NONE    │ ──────────→  │ INITIALIZING │
└──────────┘              └──────┬───────┘
                                 │ MCP server started
                                 ▼
                         ┌──────────────┐
                         │   RUNNING    │ ← Leader + Teammates active
                         └──────┬───────┘
                                │
              ┌─────────────────┼────────────────┐
              │                 │                │
              ▼                 ▼                ▼
      ┌───────────┐    ┌──────────────┐  ┌──────────┐
      │PAUSED     │    │AWAITING_     │  │COMPLETED │
      │(用户暂停) │    │APPROVAL      │  │(任务完成)│
      └─────┬─────┘    └──────┬───────┘  └──────────┘
            │                 │
            └────────┬────────┘
                     │ resume
                     ▼
              ┌──────────────┐
              │   RUNNING    │
              └──────────────┘

每个 Teammate 独立维护自己的会话状态机
```

## 边界处理

### 超时处理

- Agent 连接超时：30s（`src/process/agent/acp/constants.ts`）
- ACP 请求超时：可配置，默认 120s
- Cron 任务执行超时：30min 硬限制（`CronBusyGuard`）
- WebSocket 心跳：30s 间隔

### 重试策略

- ACP 连接：最多重连 3 次，指数退避（1s → 4s → 16s）
- MCP Server 启动失败：重试 2 次后 fallback 到内置 tools 模式
- Gemini CLI stream 中断：`streamResilience.ts` 自动重连恢复

### 优雅关闭

- 主进程 SIGTERM → 通知所有 AcpSession → 等待 5s → force kill
- 子进程：先 SIGTERM，3s 后 SIGKILL
- SQLite：WAL checkpoint + `db.close()`
- WebSocket：发送 close frame，等待客户端断开

### 部分失败

- Team Mode：单个 Teammate 失败不影响其他 Teammate 继续
- Extension 加载失败：跳过问题扩展，不影响主应用启动
- MCP tool 调用失败：返回错误给 Agent，Agent 自行决定是否重试
- IM Channel 断连：仅影响该 Channel 消息推送，主应用正常

## 与 AgentHub 架构对照表

| AgentHub 组件 | AionUi 对应 | 差异 |
|---------------|-------------|------|
| Hub Server | WebServer（内置 Express） | AgentHub 独立 Go 服务，AionUi 嵌入式 |
| Edge Server | Process Layer（agent adapters） | AgentHub 独立进程，AionUi 同进程 |
| Desktop App | Electron Main + Renderer | AgentHub 用 Tauri（Rust），AionUi 用 Electron（Node.js） |
| Runner | Agent Registry + AcpSession | 概念相似，实现不同栈 |
| API Gateway | WebServer routes + WebSocket | 功能等价 |
| Workspace | workspace/ dir | 概念完全一致 |
| Agent Adapters | AgentRegistry + AcpAdapter | AionUi 使用 ACP 标准协议，AgentHub 自定义 |
| MCP Service | MCP Server/Client + builtinMcp | 功能高度重合 |
| IM Channels | Channels（Feishu, WeChat, etc.） | AgentHub 尚未实现，AionUi 已完善 |
| Cron/Scheduler | CronService | AgentHub 尚未实现 |
| Extension System | Extension Registry + Sandbox | AgentHub 尚无扩展系统 |
