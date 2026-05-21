# AgentHub Protocol

Date: 2026-05-21

## Principle

AgentHub uses a **proto-first protocol**.

```text
proto/agenthub/v1      = single protocol source
packages/protocol/ts   = generated TypeScript types
packages/protocol/go   = generated Go structs
```

Protobuf definitions under `proto/agenthub/v1` are the authoritative protocol definitions. TypeScript and Go types must be generated from proto to avoid drift between UI, Hub, Edge and Runner. OpenAPI / AsyncAPI documents may be generated or derived later, but they are not the primary protocol source.

Hub Server, Edge Server and Runner are Go services. TypeScript protocol output is for UI and client code only.

## Package Layout

```text
packages/protocol/
  ts/
    generated/
  go/
    generated/
```

P0 can start with hand-written `.proto` files and generated types can be added once the first event shapes stabilize. The proto files remain the contract even before generation is automated.

## Protocol Surfaces

| Surface | Direction | Purpose |
|---|---|---|
| UI <-> Edge | Desktop UI to local Edge | local conversations, local runs, local artifacts |
| UI <-> Hub | Web/Mobile to Hub | cloud conversations, remote control, device status |
| Edge <-> Hub | reverse WSS + sync API | registration, sync, relay, remote commands |
| Edge <-> Runner | local/direct/relay transport | start run, stream events, cancel, read artifacts |

Runtime communication uses JSON-RPC style request/response/notification envelopes where appropriate:

```text
UI <-> Edge      JSON-RPC over WebSocket
Edge <-> Runner  JSON-RPC over local HTTP/WebSocket/stdio
Edge <-> Hub     JSON-RPC over reverse WSS
Hub <-> Web      JSON-RPC over WebSocket + REST for simple reads
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

## Core Types

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

## Versioning

Every protocol message should eventually carry:

```ts
type ProtocolEnvelope<T> = {
  version: "v1"
  id: string
  traceId?: string
  sentAt: string
  payload: T
}
```

P0 can omit the envelope for local APIs, but Edge-Hub relay should use it from the start.

## P0 Scope

P0 only needs:

- UI <-> Edge message APIs.
- Edge <-> Runner `run.start`, `run.output`, `artifact.created`, `run.finished`.
- Local Artifact references.
- Stub Hub registration types.

Hub relay, generated clients and full OpenAPI/AsyncAPI automation can be added after the local loop is stable.
