# OpenHands -> AgentHub 源码级采用映射

> 基于 OpenHands v1.7.0 monorepo + AgentHub edge-server 当前源码
> 映射日期：2026-05-24
> 覆盖维度：沙箱隔离 / Agent 事件协议

---

## Part A: 沙箱隔离 (Sandbox Isolation)

### A.1 架构对应总览

OpenHands Sandbox 是经典 **ABC 策略模式**：`SandboxService` 抽象基类定义生命周期契约，Docker/Process/Remote 三种实现独立满足接口。AgentHub 的沙箱模型不同——它以 **subprocess executor** 为中心，没有抽象 ABC，而是通过 `Adapter` 模式解耦 CLI 后端。

| 维度 | OpenHands (Python) | AgentHub (Go) |
|------|-------------------|---------------|
| 抽象接口 | `SandboxService` ABC (7 个抽象方法) | `RunExecutor` interface (2 个方法) |
| 核心实现 | `DockerSandboxService`, `ProcessSandboxService` | `ProcessExecutor` |
| 隔离单元 | Sandbox (container/process + port + session key) | Run (subprocess + stdin/stdout pipe) |
| 状态机 | STARTING/RUNNING/PAUSED/ERROR/MISSING | queued/started/finished/failed/cancelled |
| 启停控制 | start/resume/pause/delete | Start/Cancel |
| 鉴权 | `X-Session-API-Key` (base62 32B random) | JWT Bearer token (middleware) |
| 环境注入 | `OH_*` env vars + `LLM_*` 前缀转发 | `SanitizedEnv` whitelist + `AGENTHUB_*` runtime vars |
| 健康检查 | `GET /alive` or `/health` | N/A (os/exec.Wait) |

---

### A.2 每项映射 (file:line level)

#### A.2.0 抽象接口

| ID | OpenHands 源位置 | 说明 | AgentHub 对应位置 | 接口/结构体 | 优先级 |
|----|-----------------|------|------------------|------------|--------|
| S-0a | `sandbox_service.py:29-232` | `SandboxService` ABC (7 methods: search, get, start, resume, pause, delete, wait) | `lifecycle/executor.go:6-16` | `RunExecutor` interface (Start + Cancel only) | **P0** |
| S-0b | `sandbox_service.py:232` | `SandboxServiceInjector` (DI discriminator) | 无直接对应 | AgentHub 通过 func constructor 注入 (`NewProcessExecutor`) | P2 |

**差距**: AgentHub 的 `RunExecutor` 仅是 Start/Cancel 两个方法，缺少 OpenHands 的 search/get/pause/resume/delete/batch 等全生命周期操作。AgentHub 的 Run 状态管理位于 `store.RunLifecycleStore`（`store/store.go:79-83`），与 executor 解耦。**如果 AgentHub 需要暂停/恢复/查询运行中 Agent，建议在 `RunExecutor` 上新增这些方法。**

#### A.2.1 沙箱/Process 启动

| ID | OpenHands 源位置 | 说明 | AgentHub 对应位置 | 接口/结构体 | 优先级 |
|----|-----------------|------|------------------|------------|--------|
| S-1a | `docker_sandbox_service.py:360-493` | `start_sandbox()`: 限制检查 -> spec 解析 -> 生成 sandbox_id + session_key -> 注入环境变量 -> 端口映射 -> `docker_client.containers.run()` | `lifecycle/process_executor.go:79-101` | `ProcessExecutor.Start()`: 验证状态 -> 注册 running map -> `go e.run(ctx, ...)` | **P0** |
| S-1b | `process_sandbox_service.py:290-344` | `start_sandbox()`: 生成 base62 ID + session key -> 找空闲端口 -> 创建目录 -> subprocess.Popen -> 等待 /alive | `lifecycle/process_executor.go:140-229` | `ProcessExecutor.run()`: 解析 adapter -> BuildCommand -> exec.CommandContext -> cmd.Start() | **P0** |
| S-1c | `docker_sandbox_service.py:387-392` | `sandbox_id = base62.encodebytes(os.urandom(16))` + `session_api_key = base62.encodebytes(os.urandom(32))` | 无核心对应 | AgentHub 的 run ID / session ID 由上游 API 生成，executor 不负责 ID 生成 | P1 |
| S-1d | `docker_sandbox_service.py:395-398` | 注入 `OH_SESSION_API_KEYS_0`, `OH_WEBHOOKS_0_BASE_URL` 到容器环境变量 | `lifecycle/process_executor.go:300-320` | `envForRun()`: 注入 `AGENTHUB_RUN_ID`, `AGENTHUB_PROJECT_ID`, `AGENTHUB_THREAD_ID` | **P0** |
| S-1e | `docker_sandbox_service.py:469` | `working_dir=sandbox_spec.working_dir` 容器工作目录 | `lifecycle/process_executor.go:191` | `cmd.Dir = workDir` | P1 |
| S-1f | `docker_sandbox_service.py:374` | `pause_old_sandboxes(max_num_sandboxes - 1)` 启动前淘汰旧沙箱 | 无对应 | AgentHub 无并发 Run 数量限制，无自动淘汰机制 | P2 |

**关键差异**: OpenHands 在启动时自动生成鉴权 token 并注入沙箱内部；AgentHub 的鉴权 token 在 Edge Server middleware 层（JWT）而非 Runner 进程层。AgentHub 缺少进程启动前的并发数量限制和旧进程自动淘汰。

#### A.2.2 进程生命周期控制 (Stop/Cancel)

| ID | OpenHands 源位置 | 说明 | AgentHub 对应位置 | 接口/结构体 | 优先级 |
|----|-----------------|------|------------------|------------|--------|
| S-2a | `docker_sandbox_service.py:529-554` | `delete_sandbox()`: 容器 stop + remove + volume 清理 | `lifecycle/process_executor.go:103-138` | `Cancel()`: 先发送 adapter 中断信号 (stdin), 再 cancel context | **P0** |
| S-2b | `process_sandbox_service.py:374-410` | `delete_sandbox()`: terminate -> wait(10s) -> kill -> wait(5s) -> rmtree | `lifecycle/process_executor.go:114-128` | `Cancel()` 写入 `control_request` interrupt 到 stdin + `cancel()` ctx | **P0** |
| S-2c | `docker_sandbox_service.py:515-527` | `pause_sandbox()`: `container.pause()` | 无对应 | AgentHub 无暂停机制 — context cancel 后进程直接终止 | P2 |
| S-2d | `docker_sandbox_service.py:496-513` | `resume_sandbox()`: `container.unpause()` 或 `container.start()` | 无对应 | AgentHub 无恢复机制 | P2 |

**关键差异**: AgentHub 的 Cancel 更加优雅——它先通过 `control_request interrupt` 让 Agent CLI 有机会保存状态/刷新会话，然后才 kill 进程。OpenHands 的 Docker pause/unpause 对 AgentHub 的 subprocess 模型不适用。

#### A.2.3 状态机

| ID | OpenHands 源位置 | 说明 | AgentHub 对应位置 | 接口/结构体 | 优先级 |
|----|-----------------|------|------------------|------------|--------|
| S-3a | `sandbox_models.py:9-16` | `SandboxStatus`: STARTING / RUNNING / PAUSED / ERROR / MISSING | `store/store.go:34` | `Run.Status` (string): "queued" / "started" / "finished" / "failed" / "cancelled" / "cancelling" | **P0** |
| S-3b | `docker_sandbox_service.py:114-126` | Docker 状态转 `SandboxStatus` 映射: running->RUNNING, paused->PAUSED, exited->PAUSED, created->STARTING, dead->ERROR | `store/store.go:306-352` | `SetRunStatus()` / `SetRunStatusIf()`: CAS 风格状态转换 | **P0** |
| S-3c | `sandbox_models.py:86-90` | `startup_grace_seconds` = 15s: 启动后宽限期内无响应视为 STARTING，超时视为 ERROR | `lifecycle/process_executor.go:77` | `defaultRunTimeout = 30 * time.Minute`: 硬超时 | P1 |

**关键差异**: OpenHands 有 PAUSED 和 ERROR 中间态，AgentHub 走向更简单（没有暂停态）。AgentHub 的 `SetRunStatusIf` 使用 CAS（compare-and-swap）模式，比 OpenHands 的状态转换更严格。两者的 "grace period" 概念不同：OpenHands 指代理服务器启动宽限期，AgentHub 指整体运行超时。

#### A.2.4 安全隔离 (Environment Sanitization)

| ID | OpenHands 源位置 | 说明 | AgentHub 对应位置 | 接口/结构体 | 优先级 |
|----|-----------------|------|------------------|------------|--------|
| S-4a | `docker_sandbox_service.py:395-416` | 仅注入 `OH_SESSION_API_KEYS_0`, `OH_WEBHOOKS_0_BASE_URL`, `OH_ALLOW_CORS_ORIGINS_*` + Spec 定义的 `initial_env` | `lifecycle/env_sanitizer.go:20-28` | `SanitizedEnv()`: 白名单过滤 + 密文检测 | **P0** |
| S-4b | `sandbox_spec_service.py:74-133` | `LLM_*` / `LMNR_*` 前缀自动转发 | `lifecycle/env_sanitizer.go:99-224` | `isWhitelistedEnvKey()`: 大范围白名单（200+ keys） | **P0** |
| S-4c | 无显式密文检测 | 依赖 Docker 容器隔离作为安全边界 | `lifecycle/env_sanitizer.go:32-95` | `IsSensitiveEnvKey()`: 基于后缀/全名匹配的密文检测 | **P0** |

**关键差异**: OpenHands 依赖 Docker 容器边界保证安全——环境变量即使泄露也限于容器内。AgentHub 因为使用 subprocess（无容器隔离），必须严格执行环境变量白名单 + 密文过滤。`IsSensitiveEnvKey` 覆盖了 90+ 种密文模式，这是 AgentHub 相对 OpenHands 的**安全性增强**。

#### A.2.5 端口与服务暴露

| ID | OpenHands 源位置 | 说明 | AgentHub 对应位置 | 接口/结构体 | 优先级 |
|----|-----------------|------|------------------|------------|--------|
| S-5a | `docker_sandbox_service.py:583-613` | 四个 `ExposedPort`: AGENT_SERVER(8000), VSCODE(8001), WORKER_1(8011), WORKER_2(8012) | 无对应 | AgentHub subprocess 无网络服务暴露概念 | P2 |
| S-5b | `sandbox_models.py:18-23` | `ExposedUrl` 模型: name, url, port | 无对应 | AgentHub 使用 WebSocket/NDJSON 流，不暴露 HTTP 端点 | P2 |
| S-5c | `docker_sandbox_service.py:421-431` | bridge 网络: 随机端口映射; host 网络: 容器端口直通 | 无对应 | 不适用 (subprocess 共享 host network) | P2 |

**结论**: 端口暴露是 Docker 特有需求，AgentHub 的 subprocess 模型不需要。但如果 AgentHub 将来支持 Jupyter/Web Preview 等需要 HTTP 的工作区，就需要类似 OpenHands 的 `ExposedUrl` 抽象。

#### A.2.6 健康检查 (Health Check)

| ID | OpenHands 源位置 | 说明 | AgentHub 对应位置 | 接口/结构体 | 优先级 |
|----|-----------------|------|------------------|------------|--------|
| S-6a | `sandbox_service.py:127-150` | `_check_agent_server_alive()`: `GET {url}/alive`, 5s timeout | 无对应 | AgentHub 通过 `cmd.Wait()` 获取进程退出状态，不需要 HTTP 健康检查 | P2 |
| S-6b | `docker_sandbox_service.py:233-280` | `_container_to_checked_sandbox_info()`: 健康检查超 `startup_grace_seconds` 标记 ERROR | 无对应 | AgentHub 的 `defaultRunTimeout` 是整体超时，不做进程内部健康探测 | P2 |
| S-6c | `process_sandbox_service.py:160-176` | `_wait_for_server_ready()`: 轮询 `/alive`，30s timeout | 无对应 | 同上 | P2 |

#### A.2.7 工作区/目录隔离

| ID | OpenHands 源位置 | 说明 | AgentHub 对应位置 | 接口/结构体 | 优先级 |
|----|-----------------|------|------------------|------------|--------|
| S-7a | `docker_sandbox_service.py:439-444` | `volumes` 挂载: host_path -> container_path (VolumeMount) | `lifecycle/process_executor.go:191` | `cmd.Dir = workDir`: 直接使用宿主文件系统目录 | **P0** |
| S-7b | `process_sandbox_service.py:103-107` | `_create_sandbox_directory()`: 为每个 sandbox 创建 `{base_dir}/{sandbox_id}` 子目录 | `lifecycle/process_executor.go:191` | `cmd.Dir = workDir`: 由调用方传入工作目录 | P1 |
| S-7c | `docker_sandbox_service.py:543-549` | 删除 sandbox 时清理对应的 Docker volume | 无对应 | AgentHub 不在 executor 层清理工作目录——由上层调用方管理 | P2 |

---

### A.3 Sandbox 映射总结与建议

| 差距 | 严重度 | 建议 |
|------|--------|------|
| 缺少 SandboxService 全生命周期 ABC | **P0** | 扩展 `RunExecutor` interface 增加 `GetRun()`, `ListRuns()`, `Pause()`, `Resume()`, `Delete()` |
| 环境变量注入粒度不同 | **P0** | 保留 AgentHub 的 `SanitizedEnv` 白名单方式（已优于 OpenHands 的 bare env 继承） |
| 缺少并发限制 + 自动淘汰 | P1 | 在 `ProcessExecutor` 增加 `maxConcurrentRuns` 配置 + `enforceRunLimit()` |
| 缺少 ExposedUrl 抽象 | P2 | 当 AgentHub 需要 Web Preview/Jupyter 时引入 |
| 缺少进程级健康检查 | P2 | 当 AgentHub Runner 暴露 HTTP 服务时引入 `/health` |

---

## Part B: Agent 事件协议 (Agent Protocol Events)

### B.1 通信架构总览

OpenHands 的事件协议是**三层架构**：前端 WebSocket 直连 Agent Server，App Server 作为中间 proxy 和事件持久化。AgentHub 是**两层架构**：前端 WebSocket 直连 Edge Server，Edge 内部的 Event Bus 在进程内消费 Runner 输出。

```
OpenHands:
  Browser <--WebSocket--> Agent Server (sandbox)
  Browser <--REST-------> App Server
  App Server <--httpx---> Agent Server (sandbox)
  Agent Server --Webhook--> App Server (reverse push)

AgentHub:
  Browser <--WebSocket--> Edge Server (REST API)
  Edge Server ---EventBus---> ProcessExecutor (in-process)
  ProcessExecutor <--stdin/stdout--> Agent CLI (subprocess)
```

| 维度 | OpenHands | AgentHub |
|------|----------|----------|
| 传输协议 | WebSocket (直连 Agent Server) | WebSocket (连 Edge Server, 内部 EventBus) |
| 消息格式 | 自定义 JSON 事件 (type discriminator) | EventEnvelope (统一信封, 类型字符串) |
| 事件分类 | source="agent" (action/observation/message) vs "environment" (state update) | 全部通过 EventBus, scope 路由 |
| 双向通信 | WebSocket 双向 (前端发消息, 后端推事件) | REST API 发消息, WebSocket 推事件 |
| 重放机制 | `resend_all=true` query param | cursor-based seq replay |
| 控制协议 | 无独立控制通道 (通过 WebSocket) | `ControlMessage` stdin/stdout 通道 (NDJSON) |

---

### B.2 每项映射 (file:line level)

#### B.2.0 事件信封 (Event Envelope)

| ID | OpenHands 源位置 | 说明 | AgentHub 对应位置 | 接口/结构体 | 优先级 |
|----|-----------------|------|------------------|------------|--------|
| E-0a | `event.ts:1-19` (frontend types) | `BaseEvent`: id, timestamp, source, kind | `events/bus.go:10-19` | `EventEnvelope`: version, id, seq, type, scope, traceId, sentAt, payload | **P0** |
| E-0b | 无 seq 概念 | 通过 `timestamp` 排序 | `events/bus.go:51-65` | 单调递增 `seq` + cursor-based replay | P1 |
| E-0c | 无 scope 概念 | conversation_id 隐式绑定 | `events/bus.go:13` | `Scope`: projectId, threadId, runId 三级路由 | **P0** |
| E-0d | `source: "agent" \| "environment"` | 二分类法 | 无 source 字段 | AgentHub 用事件类型前缀区分 (`run.agent.*` vs `run.*`) | P2 |

**关键差异**: AgentHub 的 EventEnvelope 比 OpenHands 的 BaseEvent 更丰富：`seq` (重连恢复), `scope` (多租户路由), `traceId` (链路追踪), `version` (协议演进) 都是 AgentHub 额外具备的。OpenHands 的 `source` 字段在 AgentHub 中通过类型前缀隐式表达。

#### B.2.1 WebSocket 连接建立

| ID | OpenHands 源位置 | 说明 | AgentHub 对应位置 | 接口/结构体 | 优先级 |
|----|-----------------|------|------------------|------------|--------|
| E-1a | `websocket-url.ts:78-95` | `buildWebSocketUrl()`: `ws://host:port[/path-prefix]/sockets/events/{conversationId}` | `api/events.md:6-14` | `GET /v1/events?cursor=evt_cursor`: cursor-based | **P0** |
| E-1b | `conversation-websocket-context.tsx:149-166` | WebSocket options: `resend_all: true`, `session_api_key` query param, 3s 自动重连 | `events/bus.go:89-108` | `Subscribe(cursor)`: 自动重放 cursor 之后的事件 | **P0** |
| E-1c | session_api_key 作为 query param 鉴权 | X-Session-API-Key 或 query string | `events/bus.go` | 无 WebSocket 级鉴权 (依赖 Edge Server 的 JWT middleware) | P1 |
| E-1d | `use-websocket.ts` | 通用 WebSocket hook (reconnect, onOpen, onMessage, onError) | `events/bus.go:107-108` | `Subscribe()` 返回 channel + replay slice | P1 |

**关键差异**: OpenHands 前端直连 Agent Server WebSocket，所以需要 session_api_key 鉴权。AgentHub 前端连 Edge Server，鉴权在 HTTP 升级阶段（JWT middleware），EventBus 内部不需要鉴权。

#### B.2.2 Action/Observation 事件对

| ID | OpenHands 源位置 | 说明 | AgentHub 对应位置 | 接口/结构体 | 优先级 |
|----|-----------------|------|------------------|------------|--------|
| E-2a | 类型系统 (type guards) | `ExecuteBashAction` + `ExecuteBashObservation`: bash 命令 + 输出/退出码 | `adapters/adapter.go:77-78` | `BusEventToolCall` + `BusEventToolResult`: 统一工具调用/结果 | **P0** |
| E-2b | `FileEditorAction` + `FileEditorObservation` | 文件编辑 (path, content, old_str, new_str) | `adapters/adapter.go:79` | `BusEventFileChange`: { path, kind: created/modified/deleted, diff? } | **P0** |
| E-2c | `BrowserNavigateAction`, `BrowserClickAction`, etc. | 浏览器操作 | 无对应 | AgentHub 无内嵌浏览器概念 | P2 |
| E-2d | `ThinkAction`, `FinishAction` | Agent 内部动作 | `adapters/adapter.go:76` | `BusEventThinking`: 思考/推理内容 | P1 |
| E-2e | `MCPToolAction`, `TaskTrackerAction`, `PlanningFileEditorAction` | 扩展工具 | `adapters/adapter.go:86-88` | `BusEventTaskStarted`, `BusEventTaskProgress`, `BusEventTaskNotification` | P2 |

**关键差异**: OpenHands 用 discriminated union (每种 tool 独立 type guard)，AgentHub 用统一事件类型 + payload 区分。AgentHub 的事件类型更为统一：所有 tool call 都通过 `run.agent.tool_call` 事件，通过 `toolName` 字段区分具体工具。

#### B.2.3 流式文本增量

| ID | OpenHands 源位置 | 说明 | AgentHub 对应位置 | 接口/结构体 | 优先级 |
|----|-----------------|------|------------------|------------|--------|
| E-3a | `MessageEvent` | `{ llm_message: { role, content, tool_calls } }` | `adapters/adapter.go:74-75` | `BusEventTextDelta` + `BusEventTextBlock`: 流式增量 + 完整文本块 | **P0** |
| E-3b | 无单独 text_delta 事件 | 所有 LLM 消息作为一个 MessageEvent | `adapters/adapter.go:74` | `run.agent.text_delta`: 每个 streaming chunk | **P0** |
| E-3c | 无 thinking 事件 | N/A | `adapters/adapter.go:76` | `run.agent.thinking`: 可折叠推理内容 | P1 |

**关键差异**: AgentHub 区分 text delta（流式）和 text block（完整），对前端渲染更友好。OpenHands 将整个 LLM 消息作为单个 MessageEvent，包含 role + content + tool_calls。

#### B.2.4 会话状态事件

| ID | OpenHands 源位置 | 说明 | AgentHub 对应位置 | 接口/结构体 | 优先级 |
|----|-----------------|------|------------------|------------|--------|
| E-4a | `ConversationStateUpdateEvent` | key="execution_status": V1ExecutionStatus (RUNNING/PAUSED/...) | `adapters/adapter.go:89` | `BusEventSessionStateChanged`: idle/running/requires_action | P1 |
| E-4b | `ConversationStateUpdateEvent` | key="stats": ConversationStats (token 用量) | `adapters/adapter.go:100-101` | `BusEventSessionMetrics` + `BusEventContextUsage` | P1 |
| E-4c | `ConversationErrorEvent`, `ServerErrorEvent` | { code, detail } | `adapters/adapter.go:83` | `BusEventStatusChange` (用于错误) | P1 |
| E-4d | `CondensationEvent` | 上下文压缩 | `adapters/adapter.go:82` | `BusEventCompactBoundary`: 压缩边界标记 | P1 |

#### B.2.5 Hook/权限/安全事件

| ID | OpenHands 源位置 | 说明 | AgentHub 对应位置 | 接口/结构体 | 优先级 |
|----|-----------------|------|------------------|------------|--------|
| E-5a | `HookExecutionEvent` | Hook 执行事件 | `adapters/adapter.go:91-93` | `BusEventHookStarted`, `BusEventHookProgress`, `BusEventHookResponse` | P1 |
| E-5b | 配置级别 `confirmation_mode` | `Agent.confirmation_mode: bool` | `adapters/control_protocol.go:98-144` | `DefaultPermissionHandler.handleCanUseTool` -> `permission_requested` + `permission_decided` | **P0** |
| E-5c | `respond_to_confirmation` API | REST endpoint | `adapters/control_protocol.go:106-139` | `ControlResponseInner` JSON 通过 stdin 发送 | **P0** |

**关键差异**: AgentHub 的权限审批通过独立的 `control_request`/`control_response` 双向通道（CLI stdin/stdout），与数据事件通道（WebSocket）物理分离。OpenHands 的确认机制通过 WebSocket + REST 混合实现。AgentHub 的双通道设计更适合需要用户交互的场景。

#### B.2.6 事件发布机制

| ID | OpenHands 源位置 | 说明 | AgentHub 对应位置 | 接口/结构体 | 优先级 |
|----|-----------------|------|------------------|------------|--------|
| E-6a | WebSocket server 内 `send()` | 事件直接发给 WebSocket client | `events/bus.go:51-85` | `Bus.Publish()`: 赋值 seq -> 写入 history ring buffer -> fanout 到所有 subscriber channels | **P0** |
| E-6b | 无 fanout 模式 | 一对一 WebSocket 连接 | `events/bus.go:75-83` | 非阻塞 fanout: slow subscriber 丢弃事件 | **P0** |
| E-6c | Webhook 反向推送 | Agent Server -> App Server 事件持久化 | 无对应 | AgentHub 的 EventBus 是进程内总线，无持久化/reverse push | P2 |

#### B.2.7 事件解析 (Adapter/CLI 协议转换)

| ID | OpenHands 源位置 | 说明 | AgentHub 对应位置 | 接口/结构体 | 优先级 |
|----|-----------------|------|------------------|------------|--------|
| E-7a | Agent Server 内部 SDK 直接生成 Event 对象 | Python SDK 内部，无需解析 | `adapters/adapter.go:36` | `AgentAdapter.ParseStream()`: 从 CLI stdout 解析结构化事件 | **P0** |
| E-7b | 无 adapter 解耦 | Agent Server 内置实现 | `adapters/adapter.go:17-43` | `AgentAdapter` interface: BuildCommand + ParseStream + NeedsStdin | **P0** |
| E-7c | N/A | 不需要转换 | `adapters/parser_ndjson.go` | NDJSON stream parser (Claude Code SDK protocol) | **P0** |
| E-7d | N/A | N/A | `adapters/control_protocol.go:11-54` | `ControlMessage` 双向通信：control_request/control_response | **P0** |
| E-7e | `EventEmitter` (前端 hook) | 前端消费事件 | `adapters/adapter.go:47-48` | `EventEmitter` interface: `Emit(eventType, scope, payload)` | P1 |

---

### B.3 事件协议映射总结与建议

| 差距 | 严重度 | 建议 |
|------|--------|------|
| 缺少 Webhook 反向推送 | P2 | 当 EventBus 需要持久化到 Hub 时，参考 OpenHands 的 `/api/v1/webhooks/events` 模式 |
| 事件分类法差异 | P2 | AgentHub 的类型前缀约定 (`.agent.` subtree) 已足够清晰，无需引入 source 字段 |
| 缺少 REST fallback 消息队列 | P2 | 参考 OpenHands 的 `pending_messages` 机制，当 WebSocket 断开时排队消息 |
| 双通道设计优势 | -- | AgentHub 的 Control Protocol (stdin) + EventBus (WebSocket) 分离优于 OpenHands 的混合 WebSocket 模式，**保留** |
| Adapter 模式优势 | -- | AgentHub 的 `AgentAdapter` + `ParseStream` 模式比 OpenHands 的内置 SDK 更解耦，**保留** |

---

## Part C: 综合差距矩阵 (Cross-cutting)

### C.1 可立即采用的模式

| 模式 | OpenHands 源 | AgentHub 实现策略 | 优先级 |
|------|-------------|------------------|--------|
| Sandbox Service ABC | `sandbox_service.py:29-232` | 扩展 `RunExecutor` interface 增加全生命周期方法 | **P0** |
| SandboxSpec 模板化 | `sandbox_spec_service.py` | 在 AgentHub 配置中增加 "Runner Profile" (类似 `RunnerProfile`) | P1 |
| Session API Key | `sandbox_models.py:33-56` | 已有 JWT middleware, 可增加 per-run token 隔离 | P1 |
| Startup Grace Period | `sandbox_service.py:78-125` | 兼容 `defaultRunTimeout`, 可拆分为启动超时 + 运行超时 | P2 |
| Pending Message Queue | `pending_message_router.py` | WebSocket 断开时排队消息到 Store | P2 |
| Event 持久化 Webhook | `webhook_router.py:406-452` | 当 Hub relay 引入时参考 | P2 |

### C.2 不建议采用的部分

| 模式 | 原因 |
|------|------|
| Docker 容器作为默认隔离 | AgentHub P0 阶段 subprocess 足够，Docker 增加部署复杂度 |
| WebSocket 作为双向命令通道 | AgentHub 的 Control Protocol (stdin/stdout) + EventBus (pub/sub) 分离更好 |
| App Server 作为 thin proxy | AgentHub 让 Edge Server 直连 Runner 更简洁 |
| Docker Volume Mount 文件共享 | AgentHub subprocess 直接操作文件系统更快 |
| VSCode Server 内嵌 | AgentHub 课设场景不需要，可作为可选插件 |

### C.3 架构优势保留

AgentHub 在以下方面已优于 OpenHands:

1. **环境变量安全**: `SanitizedEnv` + `IsSensitiveEnvKey` 比 OpenHands 的 bare env 继承更安全
2. **事件协议**: EventEnvelope 的 seq/scope/traceId 比 BaseEvent 的 id/timestamp 更完整
3. **控制通道**: Control Protocol (stdin/stdout) 与数据通道 (EventBus) 分离比 OpenHands 的混合 WebSocket 更清晰
4. **Adapter 解耦**: `AgentAdapter` interface 比 OpenHands 的内置 Agent Server SDK 更灵活
5. **状态转换安全**: `SetRunStatusIf` (CAS) 比 OpenHands 的直接状态赋值更严格

---

## 附录: 完整文件索引

### OpenHands 关键文件
| 文件 | 行数 | 核心内容 |
|------|------|---------|
| `openhands/app_server/sandbox/sandbox_service.py` | 234 | SandboxService ABC (7 abstract methods) |
| `openhands/app_server/sandbox/sandbox_models.py` | 79 | SandboxInfo, SandboxStatus, ExposedUrl |
| `openhands/app_server/sandbox/docker_sandbox_service.py` | 694 | DockerSandboxService 完整实现 |
| `openhands/app_server/sandbox/process_sandbox_service.py` | 462 | ProcessSandboxService 子进程实现 |
| `openhands/app_server/sandbox/sandbox_router.py` | 218 | `/api/v1/sandboxes` REST API |
| `frontend/src/contexts/conversation-websocket-context.tsx` | ~900 | WebSocket 事件处理管线 |
| `frontend/src/utils/websocket-url.ts` | 96 | WebSocket URL 构建 + 代理前缀提取 |

### AgentHub 关键文件
| 文件 | 行数 | 核心内容 |
|------|------|---------|
| `edge-server/internal/lifecycle/executor.go` | 16 | RunExecutor interface |
| `edge-server/internal/lifecycle/process_executor.go` | 373 | ProcessExecutor 完整实现 (subprocess + adapter) |
| `edge-server/internal/lifecycle/mock_executor.go` | 235 | MockExecutor 测试实现 |
| `edge-server/internal/lifecycle/env_sanitizer.go` | 243 | SanitizedEnv + IsSensitiveEnvKey + isWhitelistedEnvKey |
| `edge-server/internal/lifecycle/process_profile.go` | 172 | RunnerProfile + CommandTemplate 模板引擎 |
| `edge-server/internal/events/bus.go` | 124 | EventBus: EventEnvelope + Publish + Subscribe (cursor replay) |
| `edge-server/internal/events/id.go` | 14 | 事件 ID 生成 (random 8 bytes) |
| `edge-server/internal/adapters/adapter.go` | 110 | AgentAdapter interface + EventEmitter + 事件类型常量 |
| `edge-server/internal/adapters/control_protocol.go` | 220 | ControlMessage + PermissionHandler + stdin/stdout 控制通道 |
| `edge-server/internal/store/store.go` | 437 | Store: Project/Thread/Run/Item CRUD + RunLifecycleStore |
| `edge-server/internal/runnerctx/context.go` | 37 | RunProcessContext 共享上下文 |
| `api/events.md` | 194 | WebSocket EventEnvelope 规范 + 完整事件目录 |
