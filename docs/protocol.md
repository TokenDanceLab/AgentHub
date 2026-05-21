# AgentHub 协议

日期：2026-05-21

## 原则

AgentHub 使用 **proto-first 协议**。

```text
proto/agenthub/v1      = 唯一协议源头
packages/protocol/ts   = 生成的 TypeScript 类型
packages/protocol/go   = 生成的 Go struct
```

`proto/agenthub/v1` 下的 Protobuf 定义是权威协议定义。TypeScript 和 Go 类型必须从 proto 生成，避免 UI、Hub、Edge 和 Runner 之间类型漂移。OpenAPI / AsyncAPI 文档可以后续生成或派生，但不是主要协议源。

Hub Server、Edge Server 和 Runner 是 Go 服务。TypeScript 协议输出仅供 UI 和客户端代码使用。

## 包布局

```text
packages/protocol/
  ts/
    generated/
  go/
    generated/
```

P0 可以先用手写的 `.proto` 文件，生成类型可以在第一批事件形态稳定后加入。proto 文件始终是契约，即使生成尚未自动化。

## 协议面

| 面 | 方向 | 用途 |
|---|---|---|
| UI <-> Edge | Desktop UI 到本地 Edge | 本地会话、本地 run、本地 artifact |
| UI <-> Hub | Web/Mobile 到 Hub | 云端会话、远程控制、设备状态 |
| Edge <-> Hub | reverse WSS + sync API | 注册、同步、中继、远程命令 |
| Edge <-> Runner | local/direct/relay transport | 启动 run、流式事件、取消、读取 artifact |

运行时通信在合适位置使用 JSON-RPC 风格的 request/response/notification 信封：

```text
UI <-> Edge      JSON-RPC over WebSocket
Edge <-> Runner  JSON-RPC over local HTTP/WebSocket/stdio
Edge <-> Hub     JSON-RPC over reverse WSS
Hub <-> Web      JSON-RPC over WebSocket + REST 处理简单读操作
```

## Method Surface

```text
project/list
project/open

thread/create
thread/list
thread/read

turn/start
turn/interrupt
turn/resume

item/subscribe
item/created
item/updated

approval/decide

artifact/list
artifact/read
artifact/apply
artifact/discard

runner/list
runner/status

hub/connect
hub/sync
```

## 核心类型

```ts
type NodeId = string
type ConversationId = string
type MessageId = string
type RunId = string
type ArtifactId = string
```

### Conversation

```ts
type Conversation = {
  id: ConversationId
  type: "direct" | "group"
  title: string
  projectId?: string
  authority: ConversationAuthority
  execution?: ExecutionAuthority
  pinned: boolean
  archived: boolean
  lastMessageAt: string
}
```

### Message

```ts
type Message = {
  id: MessageId
  conversationId: ConversationId
  senderType: "user" | "agent" | "system" | "runner"
  senderId: string
  content: string
  mentions: string[]
  status: "sending" | "streaming" | "done" | "failed"
  artifactIds: ArtifactId[]
  createdAt: string
}
```

### Runner Command

```ts
type RunnerCommand =
  | { type: "run.start"; runId: RunId; agentId: string; workspaceId: string; prompt: string }
  | { type: "run.cancel"; runId: RunId }
  | { type: "artifact.read"; artifactId: ArtifactId }
```

### Runner Event

```ts
type RunnerEvent =
  | { type: "run.started"; runId: RunId; runnerId: string; startedAt: string }
  | { type: "run.output"; runId: RunId; stream: "stdout" | "stderr"; text: string }
  | { type: "artifact.created"; runId: RunId; artifact: Artifact }
  | { type: "run.finished"; runId: RunId; status: "succeeded" | "failed" | "cancelled"; endedAt: string }
```

### Server Event

```ts
type ServerEvent =
  | { type: "message.created"; message: Message }
  | { type: "message.delta"; messageId: MessageId; delta: string }
  | { type: "run.event"; runId: RunId; event: RunnerEvent }
  | { type: "artifact.created"; artifact: Artifact }
```

### Edge Event

```ts
type EdgeEvent = {
  id: string
  edgeId: string
  seq: number
  type:
    | "message.created"
    | "run.started"
    | "run.status.changed"
    | "artifact.created"
    | "memory.updated"
    | "summary.updated"
  payload: unknown
  createdAt: string
  syncStatus: "pending" | "synced" | "failed"
}
```

### Edge-Hub Relay

```ts
type EdgeToHubEvent =
  | { type: "edge.register"; edgeId: string; deviceName: string; capabilities: string[] }
  | { type: "edge.heartbeat"; edgeId: string; runners: RunnerStatus[] }
  | { type: "sync.events"; edgeId: string; events: EdgeEvent[] }
  | { type: "run.event"; edgeId: string; runId: RunId; event: RunnerEvent }
  | { type: "artifact.metadata"; edgeId: string; artifact: Artifact }

type HubToEdgeCommand =
  | { type: "run.start"; targetRunnerId: string; command: RunnerCommand }
  | { type: "run.stop"; runId: RunId }
  | { type: "message.deliver"; conversationId: ConversationId; message: Message }
  | { type: "sync.ack"; edgeId: string; lastSeq: number }
  | { type: "preview.request"; runId: RunId }
```

## 版本化

每条协议消息最终应携带：

```ts
type ProtocolEnvelope<T> = {
  version: "v1"
  id: string
  traceId?: string
  sentAt: string
  payload: T
}
```

P0 本地 API 可以省略信封，但 Edge-Hub relay 应从第一天使用。

## P0 范围

P0 只需要：

- UI <-> Edge 消息 API。
- Edge <-> Runner `run.start`、`run.output`、`artifact.created`、`run.finished`。
- 本地 Artifact 引用。
- Hub 注册类型的占位定义。

Hub relay、生成的客户端和完整 OpenAPI/AsyncAPI 自动化可以在本地循环稳定后加入。
