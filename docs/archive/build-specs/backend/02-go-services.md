> 状态: 🔄 进行中 — 基础模块结构已建立 (edge-server/runner/hub-server)，持久化层 M2 推进中

# AgentHub Go Services -- 完整工程化设计

> 日期：2026-05-21
> 2026-05-22 更新：本文是 Go 服务拆包和工程化参考，目录示例里的 `proto/`、`packages/`、`apps/` 已不是当前主线。当前仓库结构以根目录 `hub-server/`、`edge-server/`、`runner/`、`app/`、`api/` 为准，协议入口以 `api/openapi.yaml` 和 `api/events.md` 为准。
> 2026-05-22 数据库决策：Hub Server → PostgreSQL 16，Edge Server → SQLite (modernc.org/sqlite)。Hub 为中心权威数据源（JSONB + 全文搜索 + 事务 DDL），Edge 为本地缓存 + 离线队列。同步模型为 cursor-based 增量同步。
> 基于：architecture.md, cross-analysis-adapters.md, cross-analysis-sandbox-tools.md, cross-analysis-orchestration.md, opencode.md, openhands.md, codex-cli.md
> Web 调研补充：go project layout 2025/2026, modernc.org/sqlite FTS5, coder/websocket hub, ConnectRPC buf monorepo, Wire vs Fx

---

## 1. Go Module 结构

### 1.1 决策：单 module + 可选 go.work

参考 OpenCode 的 22 packages monorepo 模式，AgentHub 采用**单 Go module**：

```
D:\Code\AgentHub\
├── go.mod                          # module github.com/agenthub/agenthub
├── go.sum
├── buf.yaml                        # Protobuf schema registry
├── buf.gen.yaml                    # Code generation: Go + TypeScript
├── proto/                          # 共享 proto 定义
│   └── agenthub/v1/
│       ├── conversation.proto
│       ├── message.proto
│       ├── runner.proto
│       └── sync.proto
├── gen/                            # 生成代码
│   ├── go/                         # connectrpc 生成的 Go 代码
│   └── ts/                         # connect-es 生成的 TypeScript 代码
├── cmd/
│   ├── hub/main.go
│   ├── edge/main.go
│   └── runner/main.go
├── packages/                       # 共享 Go 包（11 个）
│   ├── protocol/                   # [Schema] 生成类型 + 编解码
│   ├── agent-core/                 # Agent/Thread/Turn/Item 共享模型
│   ├── im-core/                    # Conversation/Message/Thread 共享逻辑
│   ├── workspace-core/             # Workspace/worktree/patch 元数据
│   ├── checkpoint-core/            # Checkpoint 数据模型 + 内容寻址
│   ├── tool-core/                  # Tool 注册 + 审批门控
│   ├── sync-core/                  # EdgeEvent/Sync/Ack/Relay 协议
│   ├── memory-core/                # Memory/ContextBuilder 共享逻辑
│   ├── artifact-core/              # Artifact 类型和索引
│   ├── approval-core/              # ApprovalRequest/Decision/policy 元数据
│   ├── transport/                  # Local/SSH/Tailscale/Hub-relay transport
│   └── adapters/                   # ClaudeCode/Codex/OpenCode 适配层
├── hub/                            # Hub Server
│   ├── internal/                   # 详细见 3.1
│   └── config.go
├── edge/                           # Edge Server
│   ├── internal/                   # 详细见 3.2
│   └── config.go
├── runner/                         # Runner
│   ├── internal/                   # 详细见 3.3
│   └── config.go
├── apps/                           # Web UI（React, 独立 workspace）
│   └── web/                        # package.json + tsconfig + vite
├── scripts/
│   └── migrate.go                  # SQLite 迁移工具
└── vendor/                         # Go vendor（可选，CI 用）
```

**理由**：
- OpenCode 用 22 packages 在单个 Bun workspace 内部分层清晰，AgentHub 的 11 个共享包量级相近，单 module 避免跨 module 版本同步开销
- `go.work` 可选：如需引入外部 Go 工具或实验性 fork，用 `go.work` 做多 module 桥接（当前不需要）
- `cmd/` 三个入口是推荐做法（golang-standards/project-layout 中少数被 Go 团队认可的目录）
- 共享包放 `packages/` 而非 `pkg/`，避免无意义的 import path 段（标准库没有 `pkg/`，cobra/viper/chi/gin 都不用）

### 1.2 go.mod 配置

```go
// go.mod
module github.com/agenthub/agenthub

go 1.24

tool (
    github.com/bufbuild/buf/cmd/buf
    github.com/golangci/golangci-lint/cmd/golangci-lint
    honnef.co/go/tools/cmd/staticcheck
)

require (
    // WebSocket
    github.com/coder/websocket v1.8.13

    // SQLite (pure Go, FTS5 built-in, no CGO)
    modernc.org/sqlite v1.38.2

    // ConnectRPC
    connectrpc.com/connect v1.19.1
    google.golang.org/protobuf v1.36.6

    // HTTP 路由 (stdlib net/http Go 1.22+ routing first, chi 作为补充)
    github.com/go-chi/chi/v5 v5.2.1

    // 结构化日志 (stdlib slog)
    // go 1.24 slog 内建 — 零依赖

    // 测试
    github.com/google/go-cmp v0.7.0
)

// modernc.org/sqlite 已内置 FTS5，无需额外构建标签
```

### 1.3 cmd/ 入口设计

```go
// cmd/hub/main.go
package main

import (
    "context"
    "log/slog"
    "os"
    "os/signal"
    "syscall"

    "github.com/agenthub/agenthub/hub"
)

func main() {
    ctx, cancel := signal.NotifyContext(context.Background(),
        syscall.SIGINT, syscall.SIGTERM)
    defer cancel()

    cfg := hub.LoadConfig()
    srv := hub.NewServer(cfg)
    if err := srv.Start(ctx); err != nil {
        slog.Error("hub start failed", "error", err)
        os.Exit(1)
    }
    <-ctx.Done()
    srv.Shutdown(context.Background())
}
```

```go
// cmd/edge/main.go
package main

import (
    "context"
    "log/slog"
    "os"
    "os/signal"
    "syscall"

    "github.com/agenthub/agenthub/edge"
)

func main() {
    ctx, cancel := signal.NotifyContext(context.Background(),
        syscall.SIGINT, syscall.SIGTERM)
    defer cancel()

    cfg := edge.LoadConfig()
    srv := edge.NewServer(cfg)
    if err := srv.Start(ctx); err != nil {
        slog.Error("edge start failed", "error", err)
        os.Exit(1)
    }
    <-ctx.Done()
    srv.Shutdown(context.Background())
}
```

```go
// cmd/runner/main.go
package main

import (
    "context"
    "log/slog"
    "os"
    "os/signal"
    "syscall"

    "github.com/agenthub/agenthub/runner"
)

func main() {
    ctx, cancel := signal.NotifyContext(context.Background(),
        syscall.SIGINT, syscall.SIGTERM)
    defer cancel()

    cfg := runner.LoadConfig()
    srv := runner.NewServer(cfg)
    if err := srv.Start(ctx); err != nil {
        slog.Error("runner start failed", "error", err)
        os.Exit(1)
    }
    <-ctx.Done()
    srv.Shutdown(context.Background())
}
```

---

## 2. 共享包依赖图

### 2.1 分层架构（参考 OpenCode 的 core->llm->opencode）

```
                    ┌──────────────────────────────────────────┐
                    │         adapters/  (适配层，顶层)          │
                    │     import: agent-core, tool-core,        │
                    │              workspace-core                │
                    ├──────────────────────────────────────────┤
                    │        im-core/   sync-core/              │
                    │   import: agent-core, protocol            │
                    ├──────────────────────────────────────────┤
                    │  agent-core/   memory-core/               │
                    │  workspace-core/   checkpoint-core/       │
                    │  artifact-core/   approval-core/          │
                    │  tool-core/                               │
                    │  import: protocol                         │
                    ├──────────────────────────────────────────┤
                    │     protocol/  transport/  (基础层)        │
                    │     import: stdlib only                   │
                    └──────────────────────────────────────────┘
```

### 2.2 完整依赖矩阵（禁止循环依赖）

```
Layer 0 -- 零依赖包（只能 import stdlib）
  protocol/         → encoding/json, time, net
  transport/        → net, context, errors

Layer 1 -- 只依赖 Layer 0
  agent-core/       → protocol/
  im-core/          → protocol/
  workspace-core/   → protocol/
  checkpoint-core/  → protocol/
  tool-core/        → protocol/
  memory-core/      → protocol/
  artifact-core/    → protocol/
  approval-core/    → protocol/
  sync-core/        → protocol/

Layer 2 -- 依赖 Layer 0 + Layer 1
  adapters/         → agent-core/, tool-core/, workspace-core/
```

**循环依赖检测规则**：
1. Layer N 的包不能 import Layer N+1 或更高层的包
2. 同层包之间可以互相 import（如 `im-core` → `agent-core`）
3. `packages/` 下的所有包都不能 import `hub/internal/`、`edge/internal/`、`runner/internal/`
4. `adapters/` 是唯一的 Layer 2 包，它为 `runner/internal/executor/` 提供统一 Agent 接口

### 2.3 各服务使用的共享包

| 共享包 | Hub | Edge | Runner | 说明 |
|--------|:---:|:----:|:------:|------|
| `protocol/` | yes | yes | yes | 所有服务共享生成类型 |
| `transport/` | yes | yes | - | Hub 不直连 Runner |
| `im-core/` | yes | yes | - | Runner 不管 IM |
| `agent-core/` | yes | yes | yes | Agent/Turn 模型 |
| `workspace-core/` | - | yes | yes | workspace 元数据 |
| `checkpoint-core/` | - | yes | yes | Checkpoint 数据模型 |
| `tool-core/` | - | - | yes | Tool 注册由 Runner 完成 |
| `sync-core/` | yes | yes | - | Hub-Edge 同步协议 |
| `memory-core/` | - | yes | - | Edge 管理 Memory |
| `artifact-core/` | yes | yes | yes | Artifact 索引共享 |
| `approval-core/` | - | yes | yes | Hub 不做审批 |
| `adapters/` | - | - | yes | Agent CLI 适配层 |

### 2.4 服务各自的 internal/ 对外零泄露

```
hub/internal/    → 只能被 hub/ 自身的 .go import
edge/internal/   → 只能被 edge/ 自身的 .go import
runner/internal/ → 只能被 runner/ 自身的 .go import
```

Go 编译器强制执行 `internal/` 的包可见性（Go 1.4+）。

---

## 3. 各服务 internal/ 包设计

### 3.1 hub/internal/

```
hub/
├── server.go                    # NewServer, Start, Shutdown — 顶层编排
├── config.go                    # LoadConfig: 从环境变量 + YAML 加载
├── internal/
│   ├── auth/
│   │   ├── auth.go              # UserSession, LoginRequest, OAuthFlow
│   │   │   import: github.com/agenthub/agenthub/packages/protocol
│   │   │   type UserSession struct {
│   │   │       UserID    string
│   │   │       Token     string
│   │   │       DeviceID  string
│   │   │       ExpiresAt time.Time
│   │   │   }
│   │   │   type AuthService interface {
│   │   │       Login(ctx context.Context, req LoginRequest) (*UserSession, error)
│   │   │       ValidateToken(ctx context.Context, token string) (*UserSession, error)
│   │   │       RefreshToken(ctx context.Context, refreshToken string) (*UserSession, error)
│   │   │       Logout(ctx context.Context, sessionID string) error
│   │   │   }
│   │   └── oauth.go            # OAuth2 适配：GitHub/Google/自定义
│   │
│   ├── user/
│   │   ├── user.go              # User 领域模型
│   │   │   type User struct {
│   │   │       ID          string
│   │   │       DisplayName string
│   │   │       AvatarURL   string
│   │   │       Email       string
│   │   │       CreatedAt   time.Time
│   │   │   }
│   │   │   type UserStore interface {
│   │   │       Get(ctx context.Context, id string) (*User, error)
│   │   │       Create(ctx context.Context, u *User) error
│   │   │       Update(ctx context.Context, u *User) error
│   │   │       List(ctx context.Context, offset, limit int) ([]*User, error)
│   │   │   }
│   │   └── store_sqlite.go      # SQLite 实现
│   │
│   ├── device/
│   │   ├── device.go            # Device 注册 + Edge 绑定
│   │   │   type Device struct {
│   │   │       ID         string
│   │   │       UserID     string
│   │   │       EdgeID     string
│   │   │       Name       string
│   │   │       Platform   string   // "desktop", "cloud", "mobile"
│   │   │       LastSeenAt time.Time
│   │   │       Status     DeviceStatus // "online", "offline"
│   │   │   }
│   │   │   type DeviceService interface {
│   │   │       Register(ctx context.Context, d *Device) error
│   │   │       Heartbeat(ctx context.Context, deviceID string) error
│   │   │       ListByUser(ctx context.Context, userID string) ([]*Device, error)
│   │   │       UpdateStatus(ctx context.Context, deviceID string, status DeviceStatus) error
│   │   │   }
│   │   └── store_sqlite.go
│   │
│   ├── contact/
│   │   ├── contact.go           # 好友关系 + Agent 联系人
│   │   │   type Contact struct {
│   │   │       ID         string
│   │   │       UserID     string
│   │   │       TargetID   string    // 好友 user ID 或 Agent ID
│   │   │       Type       ContactType // "user", "agent"
│   │   │       Nickname   string
│   │   │       CreatedAt  time.Time
│   │   │   }
│   │   │   type ContactService interface {
│   │   │       Add(ctx context.Context, c *Contact) error
│   │   │       Remove(ctx context.Context, userID, contactID string) error
│   │   │       List(ctx context.Context, userID string) ([]*Contact, error)
│   │   │   }
│   │   └── store_sqlite.go
│   │
│   ├── im/
│   │   ├── conversation.go      # Conversation CRUD
│   │   │   import: github.com/agenthub/agenthub/packages/im-core
│   │   │   type ConversationService interface {
│   │   │       Create(ctx context.Context, conv *imcore.Conversation) error
│   │   │       Get(ctx context.Context, id string) (*imcore.Conversation, error)
│   │   │       ListByUser(ctx context.Context, userID string) ([]*imcore.Conversation, error)
│   │   │       AddMessage(ctx context.Context, convID string, msg *imcore.Message) error
│   │   │       GetMessages(ctx context.Context, convID string, before string, limit int) ([]*imcore.Message, error)
│   │   │   }
│   │   ├── group.go             # 群聊管理
│   │   │   type GroupService interface {
│   │   │       Create(ctx context.Context, g *imcore.Group) error
│   │   │       AddMember(ctx context.Context, groupID, userID string) error
│   │   │       RemoveMember(ctx context.Context, groupID, userID string) error
│   │   │       ListMembers(ctx context.Context, groupID string) ([]*imcore.Member, error)
│   │   │   }
│   │   └── store_sqlite.go
│   │
│   ├── sync/
│   │   ├── edge_sync.go         # Edge 同步接收
│   │   │   import: github.com/agenthub/agenthub/packages/sync-core
│   │   │   type EdgeSyncService interface {
│   │   │       // Edge 注册/心跳/同步入口
│   │   │       HandleRegister(ctx context.Context, edgeID string, info EdgeInfo) error
│   │   │       HandleHeartbeat(ctx context.Context, edgeID string) error
│   │   │       SyncConversation(ctx context.Context, edgeID string, batch []synccore.ConversationDelta) error
│   │   │       SyncRunStatus(ctx context.Context, edgeID string, status synccore.RunStatus) error
│   │   │   }
│   │   └── delta_store.go       # 增量同步存储（cursor-based）
│   │       type DeltaStore interface {
│   │           Append(ctx context.Context, edgeID string, delta synccore.EdgeEvent) error
│   │           Poll(ctx context.Context, edgeID, cursor string) ([]synccore.EdgeEvent, string, error)
│   │       }
│   │
│   ├── relay/
│   │   ├── relay.go             # Hub↔Edge 命令中继
│   │   │   type RelayService interface {
│   │   │       // 云端 → Edge（远程指令）
│   │   │       SendToEdge(ctx context.Context, edgeID string, cmd sync.Command) error
│   │   │       // Edge → 云端（上行消息）
│   │   │       ReceiveFromEdge(ctx context.Context, edgeID string) (<-chan sync.Event, error)
│   │   │   }
│   │   └── ws_relay.go          # WebSocket 实现（连接管理在 wsgateway/ 完成）
│   │
│   ├── orchestrator/
│   │   ├── orchestrator.go      # 云端调度器
│   │   │   type Orchestrator interface {
│   │   │       // 收到用户消息后决定：
│   │   │       // 1. 纯 IM 回复（无 Agent 参与）
│   │   │       // 2. 委派给某个 Edge 上的 Runner
│   │   │       // 3. Supervisor 多 Agent 协作
│   │   │       RouteMessage(ctx context.Context, msg *ChatMessage) (*RoutingDecision, error)
│   │   │   }
│   │   │   type RoutingDecision struct {
│   │   │       Action    RouteAction // "direct_im", "delegate_edge", "supervisor"
│   │   │       EdgeID    string      // 目标 Edge（delegate_edge 时）
│   │   │       AgentIDs  []string    // 目标 Agent（supervisor 时）
│   │   │   }
│   │   └── supervisor.go        # Supervisor 模式：LLM 路由 Worker
│   │
│   ├── runner_registry/
│   │   ├── registry.go          # Edge/Runner 注册状态
│   │   │   type RunnerRegistry interface {
│   │   │       RegisterRunner(ctx context.Context, edgeID string, info RunnerInfo) error
│   │   │       ListByEdge(ctx context.Context, edgeID string) ([]RunnerInfo, error)
│   │   │       GetStatus(ctx context.Context, runnerID string) (RunnerStatus, error)
│   │   │       UpdateStatus(ctx context.Context, runnerID string, status RunnerStatus) error
│   │   │   }
│   │   └── store_sqlite.go
│   │
│   ├── artifact/
│   │   └── artifact.go          # 云端 Artifact 索引
│   │       type ArtifactService interface {
│   │           Index(ctx context.Context, a *artifactcore.Artifact) error
│   │           Query(ctx context.Context, q ArtifactQuery) ([]*artifactcore.Artifact, error)
│   │       }
│   │
│   ├── memory/
│   │   └── memory.go            # 云端 Memory 聚合
│   │       type CloudMemoryService interface {
│   │           SyncFromEdge(ctx context.Context, edgeID string, mem memorycore.MemoryBatch) error
│   │           Query(ctx context.Context, projectID, query string) ([]memorycore.MemoryEntry, error)
│   │       }
│   │
│   ├── wsgateway/
│   │   ├── gateway.go           # Web/Mobile WSS 入口
│   │   │   type WebSocketGateway struct {
│   │   │       hub    *WSHub                    // 见 5. WebSocket Hub 设计
│   │   │       auth   auth.AuthService
│   │   │       relay  relay.RelayService
│   │   │   }
│   │   └── client.go            # WSClient: 一个 Web/Mobile 连接
│   │
│   └── store/
│       ├── db.go                # *sql.DB 工厂 (modernc.org/sqlite)
│       ├── migrate.go           # 迁移引擎
│       └── fts.go               # FTS5 辅助函数
```

### 3.2 edge/internal/

```
edge/
├── server.go                    # NewServer, Start, Shutdown
├── config.go
├── internal/
│   ├── local_api/
│   │   ├── router.go            # REST API 路由 (chi)
│   │   │   import: github.com/go-chi/chi/v5
│   │   │   type APIRouter struct {
│   │   │       conversations *conversation.Handler
│   │   │       runner        *runner_handler.Handler
│   │   │       checkpoint    *checkpoint.Handler
│   │   │       artifact      *artifact.Handler
│   │   │   }
│   │   ├── conversation.go      # GET/POST /api/conversations
│   │   ├── runner.go            # POST /api/runs, GET /api/runs/:id/status
│   │   ├── checkpoint.go        # POST /api/checkpoints, GET /api/checkpoints/:id
│   │   └── artifact.go          # GET /api/artifacts
│   │
│   ├── local_ws/
│   │   ├── gateway.go           # Desktop UI WebSocket
│   │   │   type LocalWSGateway struct {
│   │   │       hub        *WSHub
│   │   │       dispatcher *event.Dispatcher
│   │   │   }
│   │   └── client.go            # WebSocket 客户端连接
│   │
│   ├── event/
│   │   ├── dispatcher.go        # Event 分发中心
│   │   │   type Dispatcher struct {
│   │   │       subscribers map[string][]chan Event // conversationID → subscribers
│   │   │       mu          sync.RWMutex
│   │   │   }
│   │   │   func (d *Dispatcher) Publish(convID string, event Event)
│   │   │   func (d *Dispatcher) Subscribe(convID string) <-chan Event
│   │   │   func (d *Dispatcher) Unsubscribe(convID string, ch <-chan Event)
│   │   ├── event.go              # Event 类型定义
│   │   │   import: github.com/agenthub/agenthub/packages/sync-core
│   │   │   type Event struct {
│   │   │       ID             string
│   │   │       ConversationID string
│   │   │       Type           EventType
│   │   │       Payload        any
│   │   │       Timestamp      time.Time
│   │   │   }
│   │   │   type EventType string
│   │   │   const (
│   │   │       EventMessage       EventType = "message"
│   │   │       EventRunStatus     EventType = "run_status"
│   │   │       EventAgentEvent    EventType = "agent_event"
│   │   │       EventCheckpoint    EventType = "checkpoint"
│   │   │       EventArtifact      EventType = "artifact"
│   │   │       EventApproval      EventType = "approval"
│   │   │   )
│   │   └── bus.go               # 内部事件总线（decouple 模块间通信）
│   │       type Bus struct {
│   │           handlers map[EventType][]EventHandler
│   │       }
│   │
│   ├── im_lite/
│   │   ├── conversation.go      # 本地 Conversation CRUD
│   │   │   import: github.com/agenthub/agenthub/packages/im-core
│   │   │   // 与 Hub 的区别：Edge 的 Conversation 可能以 Edge 为 Authority
│   │   │   type LocalConversationStore interface {
│   │   │       Save(ctx context.Context, conv *imcore.Conversation) error
│   │   │       Get(ctx context.Context, id string) (*imcore.Conversation, error)
│   │   │       List(ctx context.Context, filter ConversationFilter) ([]*imcore.Conversation, error)
│   │   │       AppendMessage(ctx context.Context, convID string, msg *imcore.Message) error
│   │   │       GetMessages(ctx context.Context, convID string, opts MessageQuery) ([]*imcore.Message, error)
│   │   │   }
│   │   └── store_sqlite.go
│   │
│   ├── hub_client/
│   │   ├── client.go            # Wire/Hub 通信
│   │   │   type HubClient interface {
│   │   │       Connect(ctx context.Context) error       // Reverse WSS
│   │   │       Register(ctx context.Context, info EdgeInfo) error
│   │   │       SendHeartbeat(ctx context.Context) error
│   │   │       SyncConversation(ctx context.Context, batch []synccore.ConversationDelta) error
│   │   │       SyncRunStatus(ctx context.Context, status synccore.RunStatus) error
│   │   │       ReceiveCommand(ctx context.Context) (<-chan sync.Command, error)
│   │   │   }
│   │   └── ws_client.go         # WebSocket 实现
│   │       import: github.com/coder/websocket
│   │       type WSClient struct {
│   │           conn      *websocket.Conn
│   │           sendCh    chan []byte
│   │           recvCh    chan []byte
│   │           reconnect BackoffStrategy
│   │       }
│   │
│   ├── sync_client/
│   │   ├── syncer.go            # 增量同步引擎
│   │   │   type Syncer interface {
│   │   │       Start(ctx context.Context) error
│   │   │       PushMessage(ctx context.Context, msg *imcore.Message) error
│   │   │       PullCommands(ctx context.Context) ([]sync.Command, error)
│   │   │   }
│   │   └── cursor.go            # Cursor-based 增量同步
│   │       type CursorStore interface {
│   │           GetLastCursor(ctx context.Context, stream string) (string, error)
│   │           SetLastCursor(ctx context.Context, stream, cursor string) error
│   │       }
│   │
│   ├── local_orchestrator/
│   │   ├── orchestrator.go      # 本地调度
│   │   │   type LocalOrchestrator interface {
│   │   │       // 接收消息 → 决定是否需要 Agent 处理
│   │   │       ProcessMessage(ctx context.Context, msg *imcore.Message) (*RoutingDecision, error)
│   │   │       // Supervisor（同 OpenCode 的 Supervisor agent 模式）
│   │   │       Supervise(ctx context.Context, task SupervisorTask) error
│   │   │   }
│   │   │   type RoutingDecision struct {
│   │   │       NeedsAgent   bool
│   │   │       AgentID      string
│   │   │       RunnerID     string
│   │   │   }
│   │   └── loop_guard.go        # 防循环：祖先追踪 + 深度限制 + 时间预算
│   │       type LoopGuard struct {
│   │           maxDepth       int           // 默认 5
│   │           maxDuration    time.Duration // 默认 300s
│   │           ancestors      []string      // 委派链路径
│   │       }
│   │       func (lg *LoopGuard) ValidateDelegation(targetID string) error
│   │
│   ├── runner_manager/
│   │   ├── manager.go           # Runner 生命周期管理
│   │   │   type RunnerManager interface {
│   │   │       Register(ctx context.Context, r *RunnerInfo) error
│   │   │       StartRun(ctx context.Context, req RunRequest) (*Run, error)
│   │   │       CancelRun(ctx context.Context, runID string) error
│   │   │       GetStatus(ctx context.Context, runID string) (*RunStatus, error)
│   │   │       ListLocal(ctx context.Context) ([]*RunnerInfo, error)
│   │   │   }
│   │   │   type RunRequest struct {
│   │   │       ConversationID string
│   │   │       ThreadID       string
│   │   │       AgentID        string
│   │   │       Prompt         string
│   │   │       Model          string
│   │   │       Tools          []string
│   │   │       WorkspaceID    string
│   │   │       PermissionMode string
│   │   │   }
│   │   └── transport.go         # local / ssh / hub-relay transport
│   │       import: github.com/agenthub/agenthub/packages/transport
│   │       type RunnerTransport interface {
│   │           Connect(ctx context.Context, addr string) (RunnerClient, error)
│   │       }
│   │
│   ├── context_builder/
│   │   ├── builder.go            # 上下文构造
│   │   │   type ContextBuilder interface {
│   │   │       Build(ctx context.Context, spec ContextSpec) (*AssembledContext, error)
│   │   │   }
│   │   │   type ContextSpec struct {
│   │   │       ConversationID string
│   │   │       ThreadID       string
│   │   │       ProjectPath    string
│   │   │       MaxTokens      int
│   │   │       SummarizeEarlier bool
│   │   │   }
│   │   │   type AssembledContext struct {
│   │   │       SystemPrompt    string
│   │   │       Messages        []imcore.Message
│   │   │       ProjectFiles    []FileContext   // .agenthub/ 下的文件
│   │   │       MemoryEntries   []memorycore.MemoryEntry
│   │   │       TokenCount      int
│   │   │   }
│   │   └── summarizer.go        # 上下文压缩（参考 LibreChat reserveRatio + EMA 校准）
│   │
│   ├── artifact_index/
│   │   └── indexer.go           # 本地产物索引
│   │       import: github.com/agenthub/agenthub/packages/artifact-core
│   │       type ArtifactIndexer interface {
│   │           Index(ctx context.Context, a *artifactcore.Artifact) error
│   │           Search(ctx context.Context, q string) ([]*artifactcore.Artifact, error)
│   │           GetByRunID(ctx context.Context, runID string) ([]*artifactcore.Artifact, error)
│   │       }
│   │
│   ├── memory/
│   │   ├── manager.go           # .agenthub/ Markdown Memory 管理
│   │   │   type MemoryManager interface {
│   │   │       Load(ctx context.Context, projectPath string) (*ProjectMemory, error)
│   │   │       Save(ctx context.Context, projectPath string, mem *ProjectMemory) error
│   │   │       SyncToHub(ctx context.Context, batch memorycore.MemoryBatch) error
│   │   │   }
│   │   │   type ProjectMemory struct {
│   │   │       ProjectID   string
│   │   │       Preferences map[string]string
│   │   │       Conventions []Convention
│   │   │       Checklists  []Checklist
│   │   │   }
│   │   └── markdown_parser.go   # .agenthub/ 文件解析
│   │
│   ├── security/
│   │   └── security.go          # 本地权限检查
│   │       type LocalAuthorizer interface {
│   │           CanAccessProject(userID, projectPath string) bool
│   │           CanApprove(userID string, approval approvalcore.ApprovalRequest) bool
│   │       }
│   │
│   └── store/
│       ├── db.go
│       ├── migrate.go
│       └── fts.go
```

### 3.3 runner/internal/

```
runner/
├── server.go                    # NewServer, Start, Shutdown
├── config.go
├── internal/
│   ├── service/
│   │   ├── router.go            # Runner HTTP API (chi)
│   │   │   type RunnerAPIRouter struct {
│   │   │       executor  *executor.Executor
│   │   │       workspace *workspace.WorkspaceManager
│   │   │       checkpoint *checkpoint.CheckpointManager
│   │   │       diff      *diff.Differ
│   │   │       preview   *preview.PreviewServer
│   │   │   }
│   │   ├── run.go               # POST /runs, GET /runs/:id, DELETE /runs/:id
│   │   ├── stream.go            # GET /runs/:id/stream (SSE)
│   │   ├── checkpoint.go        # POST /checkpoints, GET /checkpoints/:id
│   │   └── workspace.go         # POST /workspaces, DELETE /workspaces/:id
│   │
│   ├── executor/
│   │   ├── executor.go          # 子进程管理
│   │   │   import: github.com/agenthub/agenthub/packages/adapters
│   │   │   type Executor struct {
│   │   │       adapter   adapters.AgentAdapter
│   │   │       running   map[string]*RunSession // runID → session
│   │   │       mu        sync.RWMutex
│   │   │   }
│   │   │   func (e *Executor) Start(ctx context.Context, req adapters.StartRequest) (*RunSession, error)
│   │   │   func (e *Executor) Cancel(ctx context.Context, runID string) error
│   │   │   func (e *Executor) AttachStream(ctx context.Context, runID string) (<-chan adapters.AgentEvent, error)
│   │   │   type RunSession struct {
│   │   │       ID        string
│   │   │       Session   *adapters.AgentSession
│   │   │       StartTime time.Time
│   │   │       Status    RunStatus
│   │   │   }
│   │   ├── process.go           # 子进程注册表（参考 Opcode ProcessRegistry）
│   │   │   type ProcessRegistry struct {
│   │   │       processes map[string]*os.Process // runID → process
│   │   │       mu        sync.RWMutex
│   │   │   }
│   │   │   func (pr *ProcessRegistry) Register(runID string, p *os.Process)
│   │   │   func (pr *ProcessRegistry) Get(runID string) (*os.Process, bool)
│   │   │   func (pr *ProcessRegistry) GracefulShutdown(runID string, timeout time.Duration) error
│   │   │   func (pr *ProcessRegistry) KillAll()
│   │   ├── output_buffer.go     # 实时输出缓冲（参考 Opcode append_live_output）
│   │   │   type OutputBuffer struct {
│   │   │       buffer   []adapters.AgentEvent
│   │   │       capacity int
│   │   │       mu       sync.RWMutex
│   │   │       notify   chan struct{} // 新事件通知
│   │   │   }
│   │   │   func (ob *OutputBuffer) Append(event adapters.AgentEvent)
│   │   │   func (ob *OutputBuffer) Tail(n int) []adapters.AgentEvent
│   │   │   func (ob *OutputBuffer) Subscribe() <-chan struct{}
│   │   └── permission_broker.go # 权限回调桥接
│   │       import: github.com/agenthub/agenthub/packages/approval-core
│   │       type PermissionBrokerBridge struct {
│   │           pending   map[string]chan *adapters.PermissionDecision
│   │           mu        sync.RWMutex
│   │       }
│   │       func (b *PermissionBrokerBridge) OnApprovalRequest(sessionID string, req adapters.ToolPermissionRequest) (*adapters.PermissionDecision, error)
│   │
│   ├── workspace/
│   │   ├── provider.go          # WorkspaceProvider 接口 + 统一抽象
│   │   │   import: github.com/agenthub/agenthub/packages/workspace-core
│   │   │   type Provider interface {
│   │   │       Create(ctx context.Context, spec workspacecore.WorkspaceSpec) (*workspacecore.WorkspaceInfo, error)
│   │   │       Start(ctx context.Context, id string) (*workspacecore.WorkspaceInfo, error)
│   │   │       Stop(ctx context.Context, id string) error
│   │   │       Destroy(ctx context.Context, id string) error
│   │   │       Get(ctx context.Context, id string) (*workspacecore.WorkspaceInfo, error)
│   │   │       WaitReady(ctx context.Context, id string, timeout time.Duration) (*workspacecore.WorkspaceInfo, error)
│   │   │       GetDiff(ctx context.Context, id string) (*workspacecore.DiffResult, error)
│   │   │       ApplyPatch(ctx context.Context, id string, patch workspacecore.PatchSpec) error
│   │   │       Discard(ctx context.Context, id string) error
│   │   │   }
│   │   ├── git_worktree.go      # Level 1: Git Worktree 隔离（P0 默认）
│   │   │   type GitWorktreeProvider struct {
│   │   │       repoRoot string
│   │   │   }
│   │   │   // 实现 Provider 接口: worktree add/create/diff/apply/discard
│   │   ├── process_sandbox.go   # Level 2: Process 隔离（中级风险）
│   │   │   type ProcessSandboxProvider struct {
│   │   │       // 独立子进程 + 端口绑定（参考 OpenHands ProcessSandboxService）
│   │   │   }
│   │   └── docker_sandbox.go    # Level 3: Docker 隔离（高风险，P2+）
│   │       type DockerSandboxProvider struct {
│   │           client *docker.Client
│   │       }
│   │       // 参考 OpenHands DockerSandboxService ABC
│   │
│   ├── adapters/                 # [runner-specific] 三个 Agent CLI 适配实现
│   │   ├── claude_code.go        # ClaudeCodeAdapter 实现
│   │   │   import: github.com/agenthub/agenthub/packages/adapters
│   │   │   type ClaudeCodeAdapter struct {
│   │   │       binaryPath string
│   │   │       sessions   map[string]*claudeSession
│   │   │       mu         sync.RWMutex
│   │   │   }
│   │   │   // 子进程模式: --output-format stream-json --verbose
│   │   │   // Workaround 1: stdout guard → 只解析 stdout NDJSON，stderr 单独收集
│   │   │   // Workaround 2: exit code 不可信 → 检查 result.is_error
│   │   │   // Workaround 3: --verbose 强制开启
│   │   │   // Workaround 5: 权限模式 → bypassPermissions 或 stdin can_use_tool
│   │   ├── codex.go             # CodexAdapter 实现
│   │   │   import: github.com/agenthub/agenthub/packages/adapters
│   │   │   type CodexAdapter struct {
│   │   │       binaryPath string
│   │   │       dataDir    string  // $CODEX_HOME
│   │   │       sessions   map[string]*codexSession
│   │   │   }
│   │   │   // 方案 B: exec 模式 + rollout trace 回放
│   │   │   // Workaround 1: 无 stream → 从 state/rollout 读取 RolloutItem 回放
│   │   │   // Workaround 4: 自动生成 config.toml
│   │   ├── opencode.go          # OpenCodeAdapter 实现
│   │   │   import: github.com/agenthub/agenthub/packages/adapters
│   │   │   type OpenCodeAdapter struct {
│   │   │       serverURL string // http://localhost:4096
│   │   │       sessions  map[string]*opencodeSession
│   │   │   }
│   │   │   // HTTP + SSE: POST /api/session + GET /api/session/:id/events
│   │   │   // Workaround 1: server 生命周期管理（spawn opencode 子进程 → 健康检查 → HTTP）
│   │   │   // Workaround 3: 16 LLMEvent → 11 AgentEvent 映射
│   │   ├── event_normalizer.go  # 三种 CLI 事件 → AgentEvent 统一归一化
│   │   │   func NormalizeCCEvent(raw json.RawMessage) (*adapters.AgentEvent, error)
│   │   │   func NormalizeCodexItem(item RolloutItem) (*adapters.AgentEvent, error)
│   │   │   func NormalizeOpenCodeEvent(sse []byte) (*adapters.AgentEvent, error)
│   │   ├── config_gen.go        # Codex config.toml 自动生成
│   │   │   func GenerateCodexConfig(mcpConfig *adapters.MCPConfig, model string) ([]byte, error)
│   │   └── tool_normalizer.go   # MCP 工具名规范化 mcp__<server>__<tool>
│   │       func NormalizeToolName(provider, server, tool string) string
│   │
│   ├── diff/
│   │   ├── differ.go            # Git diff / patch 生成
│   │   │   type Differ struct {
│   │   │       worktreeDir string
│   │   │   }
│   │   │   func (d *Differ) Diff(ctx context.Context) (*DiffResult, error)
│   │   │   func (d *Differ) ApplyPatch(ctx context.Context, patch []byte) error
│   │   │   func (d *Differ) Discard(ctx context.Context) error
│   │   │   type DiffResult struct {
│   │   │       Files    []FileDelta
│   │   │       Summary  DiffSummary
│   │   │   }
│   │   │   type FileDelta struct {
│   │   │       Path      string
│   │   │       AddedLines   int
│   │   │       DeletedLines int
│   │   │       Patch        []byte
│   │   │   }
│   │   └── patch.go
│   │
│   ├── preview/
│   │   ├── server.go            # Dev server preview 管理
│   │   │   type PreviewServer struct {
│   │   │       servers map[string]*PreviewInstance // runID → instance
│   │   │       portRange PortRange                 // 5100-5199
│   │   │   }
│   │   │   type PreviewInstance struct {
│   │   │       RunID   string
│   │   │       Port    int
│   │   │       URL     string
│   │   │       Process *os.Process
│   │   │   }
│   │   │   func (ps *PreviewServer) StartPreview(ctx context.Context, runID, cmd string) (*PreviewInstance, error)
│   │   │   func (ps *PreviewServer) StopPreview(ctx context.Context, runID string) error
│   │   └── port_allocator.go
│   │       type PortAllocator struct {
│   │           start int // 5100
│   │           end   int // 5199
│   │           used  map[int]bool
│   │           mu    sync.Mutex
│   │       }
│   │
│   ├── checkpoint/
│   │   ├── manager.go           # Checkpoint 管理器
│   │   │   import: github.com/agenthub/agenthub/packages/checkpoint-core
│   │   │   type CheckpointManager struct {
│   │   │       storage    *ContentAddressedStorage
│   │   │       tracker    *FileTracker
│   │   │       timelinestore *TimelineStore
│   │   │   }
│   │   │   func (cm *CheckpointManager) Create(ctx context.Context, spec checkpointcore.CreateSpec) (*checkpointcore.Checkpoint, error)
│   │   │   func (cm *CheckpointManager) Restore(ctx context.Context, threadID, checkpointID string) (*checkpointcore.Checkpoint, error)
│   │   │   func (cm *CheckpointManager) Fork(ctx context.Context, threadID, checkpointID string) (*checkpointcore.Checkpoint, error)
│   │   │   func (cm *CheckpointManager) Diff(ctx context.Context, fromID, toID string) (*checkpointcore.CheckpointDiff, error)
│   │   │   func (cm *CheckpointManager) Cleanup(ctx context.Context, threadID string, keepCount int) error
│   │   ├── storage.go           # 内容寻址存储（SHA-256 + zstd）
│   │   │   type ContentAddressedStorage struct {
│   │   │       contentDir string // .agenthub-runtime/projects/:id/files/content_pool/
│   │   │       refsDir    string // .agenthub-runtime/projects/:id/files/refs/
│   │   │   }
│   │   │   func (cas *ContentAddressedStorage) Store(content []byte) (hash string, err error)
│   │   │   func (cas *ContentAddressedStorage) Load(hash string) ([]byte, error)
│   │   │   func (cas *ContentAddressedStorage) GC(ctx context.Context, activeRefs []string) error
│   │   ├── file_tracker.go      # 文件状态追踪
│   │   │   type FileTracker struct {
│   │   │       files map[string]FileInfo // path → hash + mtime
│   │   │       mu    sync.RWMutex
│   │   │   }
│   │   │   func (ft *FileTracker) Snapshot(worktreePath string) ([]FileSnapshot, error)
│   │   │   func (ft *FileTracker) Diff(previous *FileTracker) *FileDiff
│   │   ├── timeline.go          # 时间线管理
│   │   │   type TimelineStore struct {
│   │   │       rootDir string // .agenthub-runtime/projects/:id/.timelines/
│   │   │   }
│   │   │   func (ts *TimelineStore) Load(threadID string) (*checkpointcore.ThreadTimeline, error)
│   │   │   func (ts *TimelineStore) Save(tl *checkpointcore.ThreadTimeline) error
│   │   └── gc.go                # 孤儿文件 GC
│   │
│   ├── logs/
│   │   └── collector.go         # stdout/stderr 收集
│   │       type LogCollector struct {
│   │           writer  io.Writer
│   │           buffer  *bytes.Buffer
│   │           maxSize int64
│   │       }
│   │       func (lc *LogCollector) Tee(r io.Reader) io.Reader
│   │
│   ├── tool_engine/
│   │   ├── engine.go            # ToolEngine: Dispatch/Stream/Approve
│   │   │   import: github.com/agenthub/agenthub/packages/tool-core
│   │   │   type Engine struct {
│   │   │       registry *Registry
│   │   │       runtime  *Runtime
│   │   │   }
│   │   │   func (e *Engine) Dispatch(ctx context.Context, name string, params map[string]any, rt *Runtime) (*toolcore.ToolResult, error)
│   │   ├── registry.go          # ToolRegistry: Register/List/Resolve/Validate
│   │   │   type Registry struct {
│   │   │       tools map[string]*toolcore.ToolDescriptor
│   │   │       mu    sync.RWMutex
│   │   │   }
│   │   │   func (r *Registry) Register(d *toolcore.ToolDescriptor)
│   │   │   func (r *Registry) List(filter ToolFilter) []*toolcore.ToolDescriptor
│   │   │   func (r *Registry) Resolve(name string) (*toolcore.ToolDescriptor, error)
│   │   ├── runtime.go           # ToolRuntime: workspace/credentials/approval gate
│   │   │   type Runtime struct {
│   │   │       WorkspaceID   string
│   │   │       RunID         string
│   │   │       TurnID        string
│   │   │       WorkingDir    string
│   │   │       Env           map[string]string
│   │   │       ApprovalGate  ApprovalCallback
│   │   │   }
│   │   ├── builtin_provider.go  # BuiltinToolProvider: CLI 原生工具注册
│   │   │   type BuiltinToolProvider struct {}
│   │   │   func (p *BuiltinToolProvider) Tools() []*toolcore.ToolDescriptor
│   │   │   // 注册: read, write, edit, bash, glob, grep, web_fetch, web_search
│   │   ├── mcp_provider.go      # MCPToolProvider: mcp-go SDK 集成
│   │   │   import: github.com/mark3labs/mcp-go
│   │   │   type MCPToolProvider struct {
│   │   │       servers map[string]*MCPServerConnection
│   │   │   }
│   │   │   // 不通过 CLI 桥接（避免 Opcode 的 claude mcp 依赖）
│   │   │   // 直接用 mcp-go SDK 管理 stdio/sse transport
│   │   ├── api_provider.go      # APIToolProvider: REST API 封装工具
│   │   └── approval_gate.go     # Tool 执行审批门控
│   │       type ApprovalGate struct {
│   │           policy approvalcore.Policy
│   │           pending map[string]chan approvalcore.ApprovalDecision
│   │       }
│   │
│   ├── security/
│   │   ├── path_guard.go        # 路径守卫：限制 Agent 在 worktree 内
│   │   │   type PathGuard struct {
│   │   │       allowedRoots []string
│   │   │   }
│   │   │   func (pg *PathGuard) ValidatePath(path string) error
│   │   │   func (pg *PathGuard) ResolvePath(worktree, relative string) (string, error)
│   │   └── command_approval.go  # 命令审批白名单
│   │       type CommandApprovalPolicy struct {
│   │           allowRules []CommandRule
│   │           denyRules  []CommandRule
│   │       }
│   │
│   └── store/
│       ├── db.go
│       ├── migrate.go
│       └── fts.go
```

---

## 4. 数据库 Schema

### 4.1 Hub / Edge 共享 Schema（SQLite）

所有表用 `TEXT` 做 UUID/varchar 主键，`INTEGER` 做 Unix 毫秒时间戳。

```sql
-- =====================================================================
-- 用户与认证
-- =====================================================================

CREATE TABLE users (
    id          TEXT PRIMARY KEY,          -- UUID v4
    display_name TEXT NOT NULL,
    avatar_url  TEXT,
    email       TEXT UNIQUE,
    created_at  INTEGER NOT NULL,          -- Unix milliseconds
    updated_at  INTEGER NOT NULL
);

CREATE TABLE user_sessions (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES users(id),
    token_hash   TEXT NOT NULL,            -- SHA-256(token)
    device_id    TEXT,
    expires_at   INTEGER NOT NULL,
    created_at   INTEGER NOT NULL
);
CREATE INDEX idx_user_sessions_token ON user_sessions(token_hash);
CREATE INDEX idx_user_sessions_user  ON user_sessions(user_id);

-- =====================================================================
-- 设备与 Edge 注册
-- =====================================================================

CREATE TABLE devices (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id),
    edge_id     TEXT NOT NULL UNIQUE,      -- Hub 分配的 Edge 标识
    name        TEXT NOT NULL,
    platform    TEXT NOT NULL,             -- "desktop", "cloud", "mobile"
    last_seen_at INTEGER NOT NULL,
    status      TEXT NOT NULL DEFAULT 'offline', -- "online", "offline"
    created_at  INTEGER NOT NULL
);
CREATE INDEX idx_devices_user   ON devices(user_id);
CREATE INDEX idx_devices_edge   ON devices(edge_id);

-- =====================================================================
-- 联系人（好友 / Agent）
-- =====================================================================

CREATE TABLE contacts (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id),
    target_id  TEXT NOT NULL,              -- 好友 user ID 或 Agent ID
    type       TEXT NOT NULL,              -- "user", "agent"
    nickname   TEXT,
    created_at INTEGER NOT NULL,
    UNIQUE(user_id, target_id, type)
);
CREATE INDEX idx_contacts_user ON contacts(user_id);

-- =====================================================================
-- Conversation（对话/群聊）
-- =====================================================================

CREATE TABLE conversations (
    id          TEXT PRIMARY KEY,           -- UUID v4
    title       TEXT,
    type        TEXT NOT NULL DEFAULT 'direct',  -- "direct", "group", "thread"
    authority   TEXT NOT NULL,              -- JSON: {type: "edge"|"hub", id: "..."}
    created_by  TEXT NOT NULL REFERENCES users(id),
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
);
CREATE INDEX idx_conv_updated ON conversations(updated_at);

-- 群聊成员（仅 type='group'）
CREATE TABLE group_members (
    group_id    TEXT NOT NULL REFERENCES conversations(id),
    user_id     TEXT NOT NULL REFERENCES users(id),
    role        TEXT NOT NULL DEFAULT 'member',  -- "owner", "admin", "member"
    joined_at   INTEGER NOT NULL,
    PRIMARY KEY (group_id, user_id)
);

-- =====================================================================
-- Message（消息）
-- =====================================================================

CREATE TABLE messages (
    id                TEXT PRIMARY KEY,          -- UUID v4
    conversation_id   TEXT NOT NULL REFERENCES conversations(id),
    parent_id         TEXT,                      -- 消息树 parent 指针
    thread_id         TEXT,                      -- 分层 Thread ID
    turn_id           TEXT,                      -- AgentHub Turn ID
    sender_type       TEXT NOT NULL,             -- "user", "agent", "system"
    sender_id         TEXT,                      -- user ID 或 agent ID
    content           TEXT NOT NULL,             -- JSON: 结构化消息内容
    content_type      TEXT NOT NULL DEFAULT 'text', -- "text", "tool_call", "tool_result", "diff", "artifact", "checkpoint"
    mentions          TEXT,                      -- JSON: ["@AgentName", ...]
    metadata          TEXT,                      -- JSON: {tokens, cost, ...}
    authority         TEXT NOT NULL,             -- JSON: ConversationAuthority
    created_at        INTEGER NOT NULL,
    edited_at         INTEGER,
    deleted           INTEGER NOT NULL DEFAULT 0 -- 软删除
);
CREATE INDEX idx_msgs_conv    ON messages(conversation_id, created_at);
CREATE INDEX idx_msgs_thread  ON messages(thread_id, created_at);
CREATE INDEX idx_msgs_parent  ON messages(parent_id);
CREATE INDEX idx_msgs_turn    ON messages(turn_id);

-- =====================================================================
-- Agent Run（执行记录）
-- =====================================================================

CREATE TABLE runs (
    id                TEXT PRIMARY KEY,          -- UUID v4
    conversation_id   TEXT NOT NULL REFERENCES conversations(id),
    thread_id         TEXT NOT NULL,
    turn_id           TEXT,                      -- 关联的 Turn
    edge_id           TEXT NOT NULL,
    runner_id         TEXT NOT NULL,
    agent_id          TEXT NOT NULL,             -- "claude-code", "codex", "opencode"
    status            TEXT NOT NULL DEFAULT 'pending', -- pending/running/completed/failed/cancelled
    prompt            TEXT NOT NULL,
    model             TEXT NOT NULL,
    workspace_id      TEXT,
    permission_mode   TEXT NOT NULL DEFAULT 'default',
    result            TEXT,                      -- JSON: ResultPayload
    usage             TEXT,                      -- JSON: UsageInfo
    duration_ms       INTEGER,
    started_at        INTEGER,
    completed_at      INTEGER,
    created_at        INTEGER NOT NULL
);
CREATE INDEX idx_runs_conv    ON runs(conversation_id);
CREATE INDEX idx_runs_thread  ON runs(thread_id);
CREATE INDEX idx_runs_edge    ON runs(edge_id);
CREATE INDEX idx_runs_status  ON runs(status);

-- =====================================================================
-- Artifact（产物元数据）
-- =====================================================================

CREATE TABLE artifacts (
    id            TEXT PRIMARY KEY,
    run_id        TEXT NOT NULL REFERENCES runs(id),
    conversation_id TEXT NOT NULL,
    type          TEXT NOT NULL,             -- "diff", "file", "image", "preview_url", "checkpoint"
    content_url   TEXT,                      -- 文件引用或 URL
    metadata      TEXT,                      -- JSON: {size, hash, mimeType, ...}
    created_at    INTEGER NOT NULL
);
CREATE INDEX idx_artifacts_run  ON artifacts(run_id);
CREATE INDEX idx_artifacts_conv ON artifacts(conversation_id, created_at);

-- =====================================================================
-- Memory（Memory 条目）
-- =====================================================================

CREATE TABLE memory_entries (
    id          TEXT PRIMARY KEY,
    project_id  TEXT NOT NULL,              -- 项目标识
    category    TEXT NOT NULL,              -- "preference", "convention", "checklist", "note"
    key         TEXT,                       -- 分类键
    content     TEXT NOT NULL,
    source      TEXT NOT NULL DEFAULT 'edge', -- "edge" | "hub"
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
);
CREATE INDEX idx_memory_project ON memory_entries(project_id, category);

-- =====================================================================
-- Sync（增量同步 cursor）
-- =====================================================================

CREATE TABLE sync_cursors (
    stream      TEXT NOT NULL,              -- "conv:{id}", "run:{id}", "memory:{project}"
    edge_id     TEXT NOT NULL,
    cursor      TEXT NOT NULL,              -- 最后同步位置
    updated_at  INTEGER NOT NULL,
    PRIMARY KEY (stream, edge_id)
);

-- =====================================================================
-- Edge 到 Hub 同步事件日志
-- =====================================================================

CREATE TABLE sync_events (
    id          TEXT PRIMARY KEY,
    edge_id     TEXT NOT NULL,
    type        TEXT NOT NULL,              -- "conversation_delta", "run_status", "artifact", "memory"
    payload     TEXT NOT NULL,              -- JSON
    cursor      TEXT NOT NULL,
    created_at  INTEGER NOT NULL
);
CREATE INDEX idx_sync_edge ON sync_events(edge_id, cursor);
```

### 4.2 FTS5 全文搜索虚拟表

```sql
-- =====================================================================
-- 消息全文搜索 (FTS5)
-- =====================================================================

-- 内容表: 权威内容表
-- messages 表（如上定义）

-- FTS5 索引表: 搜索加速
CREATE VIRTUAL TABLE messages_fts USING fts5(
    content,                              -- 搜索内容
    conversation_id UNINDEXED,            -- 用于过滤（不索引）
    sender_id UNINDEXED,
    content='messages',                   -- 指向内容表
    content_rowid='rowid',                -- messages 的隐式 rowid（或显式整数 id）
    tokenize='porter unicode61'           -- Porter 词干提取 + Unicode 6.1
);

-- 触发器: INSERT → FTS5 同步
CREATE TRIGGER messages_fts_ai AFTER INSERT ON messages BEGIN
    INSERT INTO messages_fts(rowid, content, conversation_id, sender_id)
    VALUES (new.rowid, new.content, new.conversation_id, new.sender_id);
END;

-- 触发器: DELETE → FTS5 同步
CREATE TRIGGER messages_fts_ad AFTER DELETE ON messages BEGIN
    INSERT INTO messages_fts(messages_fts, rowid, content, conversation_id, sender_id)
    VALUES ('delete', old.rowid, old.content, old.conversation_id, old.sender_id);
END;

-- 触发器: UPDATE → FTS5 同步
CREATE TRIGGER messages_fts_au AFTER UPDATE ON messages BEGIN
    INSERT INTO messages_fts(messages_fts, rowid, content, conversation_id, sender_id)
    VALUES ('delete', old.rowid, old.content, old.conversation_id, old.sender_id);
    INSERT INTO messages_fts(rowid, content, conversation_id, sender_id)
    VALUES (new.rowid, new.content, new.conversation_id, new.sender_id);
END;


-- =====================================================================
-- Memory 全文搜索 (FTS5)
-- =====================================================================

CREATE VIRTUAL TABLE memory_fts USING fts5(
    content,
    project_id UNINDEXED,
    category UNINDEXED,
    content='memory_entries',
    content_rowid='rowid',
    tokenize='porter unicode61'
);

CREATE TRIGGER memory_fts_ai AFTER INSERT ON memory_entries BEGIN
    INSERT INTO memory_fts(rowid, content, project_id, category)
    VALUES (new.rowid, new.content, new.project_id, new.category);
END;

CREATE TRIGGER memory_fts_ad AFTER DELETE ON memory_entries BEGIN
    INSERT INTO memory_fts(memory_fts, rowid, content, project_id, category)
    VALUES ('delete', old.rowid, old.content, old.project_id, old.category);
END;

CREATE TRIGGER memory_fts_au AFTER UPDATE ON memory_entries BEGIN
    INSERT INTO memory_fts(memory_fts, rowid, content, project_id, category)
    VALUES ('delete', old.rowid, old.content, old.project_id, old.category);
    INSERT INTO memory_fts(rowid, content, project_id, category)
    VALUES (new.rowid, new.content, new.project_id, new.category);
END;
```

### 4.3 Go FTS5 辅助函数

```go
// hub/internal/store/fts.go
package store

import (
    "context"
    "database/sql"
    "fmt"

    _ "modernc.org/sqlite"
)

// SearchMessages 在指定 conversation 内全文搜索消息
func SearchMessages(ctx context.Context, db *sql.DB, conversationID, query string, limit int) ([]SearchResult, error) {
    sqlQuery := `
        SELECT
            m.id,
            m.content,
            m.sender_type,
            m.created_at,
            snippet(messages_fts, 1, '<mark>', '</mark>', '…', 64) AS snippet,
            bm25(messages_fts) AS rank
        FROM messages_fts
        JOIN messages m ON m.rowid = messages_fts.rowid
        WHERE messages_fts MATCH ?
          AND messages_fts.conversation_id = ?
        ORDER BY rank
        LIMIT ?
    `
    rows, err := db.QueryContext(ctx, sqlQuery, query, conversationID, limit)
    if err != nil {
        return nil, fmt.Errorf("fts search: %w", err)
    }
    defer rows.Close()

    var results []SearchResult
    for rows.Next() {
        var r SearchResult
        if err := rows.Scan(&r.ID, &r.Content, &r.SenderType, &r.CreatedAt, &r.Snippet, &r.Rank); err != nil {
            return nil, fmt.Errorf("scan fts result: %w", err)
        }
        results = append(results, r)
    }
    return results, rows.Err()
}

type SearchResult struct {
    ID         string
    Content    string
    SenderType string
    CreatedAt  int64
    Snippet    string
    Rank       float64
}

// SearchMemory 在指定项目内全文搜索 Memory
func SearchMemory(ctx context.Context, db *sql.DB, projectID, query string, limit int) ([]SearchResult, error) {
    sqlQuery := `
        SELECT
            m.id,
            m.content,
            m.category,
            m.created_at,
            snippet(memory_fts, 0, '<mark>', '</mark>', '…', 64) AS snippet,
            bm25(memory_fts) AS rank
        FROM memory_fts
        JOIN memory_entries m ON m.rowid = memory_fts.rowid
        WHERE memory_fts MATCH ?
          AND memory_fts.project_id = ?
        ORDER BY rank
        LIMIT ?
    `
    rows, err := db.QueryContext(ctx, sqlQuery, query, projectID, limit)
    if err != nil {
        return nil, fmt.Errorf("memory fts: %w", err)
    }
    defer rows.Close()

    var results []SearchResult
    for rows.Next() {
        var r SearchResult
        if err := rows.Scan(&r.ID, &r.Content, &r.SenderType, &r.CreatedAt, &r.Snippet, &r.Rank); err != nil {
            return nil, fmt.Errorf("scan memory fts: %w", err)
        }
        results = append(results, r)
    }
    return results, rows.Err()
}
```

### 4.4 迁移策略

```
版本号格式: YYYYMMDDNN
  20260521001 ← 第一个迁移

迁移工具: scripts/migrate.go
  - 从 go:embed 加载 SQL 文件
  - 按版本号顺序执行
  - 版本表: schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER)
  - 事务包装每个迁移
  - 幂等: IF NOT EXISTS / 检查版本表
```

```go
// scripts/migrate.go
package main

import (
    "database/sql"
    "embed"
    "fmt"
    "log/slog"
    "path/filepath"
    "sort"
    "strconv"
    "strings"

    _ "modernc.org/sqlite"
)

//go:embed migrations/*.sql
var migrationFiles embed.FS

func main() {
    dbPath := "data/agenthub.db"
    db, err := sql.Open("sqlite", dbPath+"?_journal_mode=WAL&_busy_timeout=5000")
    if err != nil {
        slog.Error("open db", "error", err)
        return
    }
    defer db.Close()

    if err := RunMigrations(db); err != nil {
        slog.Error("migrate failed", "error", err)
        return
    }
    slog.Info("migrations complete")
}

func RunMigrations(db *sql.DB) error {
    // 确保版本表存在
    _, err := db.Exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
    )`)
    if err != nil {
        return fmt.Errorf("create schema_migrations: %w", err)
    }

    // 列出所有迁移文件
    entries, err := migrationFiles.ReadDir("migrations")
    if err != nil {
        return fmt.Errorf("read migrations dir: %w", err)
    }

    // 排序
    sort.Slice(entries, func(i, j int) bool {
        return entries[i].Name() < entries[j].Name()
    })

    for _, entry := range entries {
        if !strings.HasSuffix(entry.Name(), ".sql") {
            continue
        }
        // 解析版本号: 20260521001_schema.sql → 20260521001
        versionStr := strings.SplitN(entry.Name(), "_", 2)[0]
        version, _ := strconv.ParseInt(versionStr, 10, 64)

        // 检查是否已执行
        var count int
        if err := db.QueryRow("SELECT COUNT(*) FROM schema_migrations WHERE version = ?", version).Scan(&count); err != nil {
            return fmt.Errorf("check version %d: %w", version, err)
        }
        if count > 0 {
            continue
        }

        // 读取并执行
        sql, _ := migrationFiles.ReadFile(filepath.Join("migrations", entry.Name()))
        slog.Info("applying migration", "version", version, "file", entry.Name())

        tx, err := db.Begin()
        if err != nil {
            return fmt.Errorf("begin tx for %d: %w", version, err)
        }
        if _, err := tx.Exec(string(sql)); err != nil {
            tx.Rollback()
            return fmt.Errorf("exec migration %d: %w", version, err)
        }
        if _, err := tx.Exec("INSERT INTO schema_migrations (version, applied_at) VALUES (?, unixepoch('subsec') * 1000)", version); err != nil {
            tx.Rollback()
            return fmt.Errorf("record migration %d: %w", version, err)
        }
        if err := tx.Commit(); err != nil {
            return fmt.Errorf("commit migration %d: %w", version, err)
        }
    }
    return nil
}
```

---

## 5. WebSocket Hub 设计

### 5.1 核心架构

参考 `coder/websocket` 的 chat example + Claude Code Viewer 的 SSE EventBus 模式。

```
┌──────────────────────────────────────────────────────┐
│                     WSHub (单例)                       │
│                                                       │
│   rooms: map[string]*Room                             │
│     "conv:abc123" → Room{clients: {...}}              │
│     "edge:xyz789" → Room{clients: {...}}              │
│     "conv:def456" → Room{clients: {...}}              │
│                                                       │
│   核心操作:                                            │
│     hub.Register(client, roomID)                      │
│     hub.Unregister(client, roomID)                    │
│     hub.Broadcast(roomID, msg)                        │
│     hub.BroadcastExcept(roomID, msg, excludeClient)   │
│     hub.SendToClient(clientID, msg)                   │
└──────────────────────────────────────────────────────┘
```

### 5.2 Go 实现

```go
// hub/internal/wsgateway/hub.go
package wsgateway

import (
    "context"
    "encoding/json"
    "log/slog"
    "net/http"
    "sync"
    "time"

    "github.com/coder/websocket"
)

// =====================================================================
// WSHub: 多房间 WebSocket 消息中心
// =====================================================================

type WSHub struct {
    rooms      map[string]*Room    // roomID → Room
    register   chan *ClientSubscription
    unregister chan *ClientSubscription
    broadcast  chan *BroadcastMessage
    mu         sync.RWMutex        // 保护 rooms map 的读路径
}

func NewHub() *WSHub {
    h := &WSHub{
        rooms:      make(map[string]*Room),
        register:   make(chan *ClientSubscription, 256),
        unregister: make(chan *ClientSubscription, 256),
        broadcast:  make(chan *BroadcastMessage, 1024),
    }
    return h
}

// Run 启动 Hub 的主事件循环（在 goroutine 中运行）
func (h *WSHub) Run(ctx context.Context) {
    for {
        select {
        case sub := <-h.register:
            h.handleRegister(sub)

        case sub := <-h.unregister:
            h.handleUnregister(sub)

        case msg := <-h.broadcast:
            h.handleBroadcast(msg)

        case <-ctx.Done():
            return
        }
    }
}

// =====================================================================
// Room: 一个房间（对应一个 conversation 或 edge 连接）
// =====================================================================

type Room struct {
    ID      string              // "conv:{id}" 或 "edge:{id}"
    clients map[string]*WSClient // clientID → client
    mu      sync.RWMutex
}

// =====================================================================
// WSClient: 一个 WebSocket 连接
// =====================================================================

type WSClient struct {
    ID           string
    RoomID       string
    UserID       string              // 鉴权后的用户 ID
    Conn         *websocket.Conn
    SendCh       chan json.RawMessage // 写队列
    disconnectCh chan struct{}        // 断开信号
    Metadata     map[string]any       // 附加信息（device type, edge ID 等）

    // 统计
    connectedAt time.Time
    lastPing    time.Time
    msgCount    int64
}

// =====================================================================
// ClientSubscription: 注册/注销消息
// =====================================================================

type ClientSubscription struct {
    Client *WSClient
    RoomID string
}

// BroadcastMessage: 广播消息
type BroadcastMessage struct {
    RoomID    string
    SenderID  string          // 发送者（空=系统广播）
    Payload   json.RawMessage
    ExcludeID string          // 排除的 client ID（避免回显）
}

// =====================================================================
// 注册处理
// =====================================================================

func (h *WSHub) handleRegister(sub *ClientSubscription) {
    room := h.getOrCreateRoom(sub.RoomID)
    room.mu.Lock()
    room.clients[sub.Client.ID] = sub.Client
    room.mu.Unlock()

    slog.Info("ws client joined room",
        "client", sub.Client.ID,
        "room", sub.RoomID,
        "total_clients", room.ClientCount(),
    )
}

func (h *WSHub) handleUnregister(sub *ClientSubscription) {
    room, ok := h.rooms[sub.RoomID]
    if !ok {
        return
    }

    room.mu.Lock()
    delete(room.clients, sub.Client.ID)
    empty := len(room.clients) == 0
    room.mu.Unlock()

    close(sub.Client.SendCh)

    slog.Info("ws client left room",
        "client", sub.Client.ID,
        "room", sub.RoomID,
        "total_clients", room.ClientCount(),
    )

    // 房间为空时清理
    if empty {
        h.mu.Lock()
        delete(h.rooms, sub.RoomID)
        h.mu.Unlock()
    }
}

// =====================================================================
// 广播处理
// =====================================================================

func (h *WSHub) handleBroadcast(msg *BroadcastMessage) {
    room, ok := h.rooms[msg.RoomID]
    if !ok {
        return
    }

    room.mu.RLock()
    defer room.mu.RUnlock()

    for id, client := range room.clients {
        if id == msg.ExcludeID {
            continue // 不回显发送者
        }
        select {
        case client.SendCh <- msg.Payload:
        default:
            // 客户端写队列满 → 断开
            go h.Unregister(client, msg.RoomID)
        }
    }
}

// =====================================================================
// 公开 API
// =====================================================================

func (h *WSHub) Register(client *WSClient, roomID string) {
    h.register <- &ClientSubscription{Client: client, RoomID: roomID}
}

func (h *WSHub) Unregister(client *WSClient, roomID string) {
    h.unregister <- &ClientSubscription{Client: client, RoomID: roomID}
}

func (h *WSHub) Broadcast(roomID string, payload json.RawMessage) {
    h.broadcast <- &BroadcastMessage{RoomID: roomID, Payload: payload}
}

func (h *WSHub) BroadcastExcept(roomID string, payload json.RawMessage, excludeID string) {
    h.broadcast <- &BroadcastMessage{RoomID: roomID, Payload: payload, ExcludeID: excludeID}
}

// SendToRoom 直接向房间中特定 client 发送（不走广播通道）
func (h *WSHub) SendToClient(roomID, clientID string, payload json.RawMessage) error {
    room, ok := h.rooms[roomID]
    if !ok {
        return ErrRoomNotFound
    }
    room.mu.RLock()
    client, ok := room.clients[clientID]
    room.mu.RUnlock()
    if !ok {
        return ErrClientNotFound
    }

    select {
    case client.SendCh <- payload:
        return nil
    default:
        go h.Unregister(client, roomID)
        return ErrSendQueueFull
    }
}

// RoomList 返回所有活跃房间及其客户端数
func (h *WSHub) RoomList() []RoomInfo {
    h.mu.RLock()
    defer h.mu.RUnlock()
    infos := make([]RoomInfo, 0, len(h.rooms))
    for id, room := range h.rooms {
        infos = append(infos, RoomInfo{
            ID:          id,
            ClientCount: room.ClientCount(),
        })
    }
    return infos
}

func (h *WSHub) getOrCreateRoom(roomID string) *Room {
    h.mu.Lock()
    defer h.mu.Unlock()
    if room, ok := h.rooms[roomID]; ok {
        return room
    }
    room := &Room{
        ID:      roomID,
        clients: make(map[string]*WSClient),
    }
    h.rooms[roomID] = room
    return room
}

func (r *Room) ClientCount() int {
    r.mu.RLock()
    defer r.mu.RUnlock()
    return len(r.clients)
}

// =====================================================================
// WebSocket HTTP Upgrade Handler
// =====================================================================

func (h *WSHub) Upgrade(roomID string, authenticate func(r *http.Request) (userID string, err error)) http.HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) {
        userID, err := authenticate(r)
        if err != nil {
            http.Error(w, "unauthorized", http.StatusUnauthorized)
            return
        }

        conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
            InsecureSkipVerify: false,
            OriginPatterns:     []string{"localhost:*", "127.0.0.1:*"},
        })
        if err != nil {
            slog.Error("ws accept failed", "error", err)
            return
        }

        client := &WSClient{
            ID:           newClientID(),
            RoomID:       roomID,
            UserID:       userID,
            Conn:         conn,
            SendCh:       make(chan json.RawMessage, 64),
            disconnectCh: make(chan struct{}),
            connectedAt:  time.Now(),
        }

        h.Register(client, roomID)

        // 启动读写 goroutines
        go h.readPump(client)
        go h.writePump(client)
    }
}

// =====================================================================
// 读写泵
// =====================================================================

func (h *WSHub) readPump(client *WSClient) {
    defer func() {
        h.Unregister(client, client.RoomID)
        client.Conn.Close(websocket.StatusNormalClosure, "client disconnected")
    }()

    for {
        _, data, err := client.Conn.Read(context.Background())
        if err != nil {
            return
        }
        // 客户端上行消息广播给同房间其他人
        h.BroadcastExcept(client.RoomID, json.RawMessage(data), client.ID)
    }
}

func (h *WSHub) writePump(client *WSClient) {
    defer client.Conn.Close(websocket.StatusNormalClosure, "")
    ctx := context.Background()

    // 心跳定时器（15s）
    ticker := time.NewTicker(15 * time.Second)
    defer ticker.Stop()

    for {
        select {
        case msg, ok := <-client.SendCh:
            if !ok {
                return // SendCh 已关闭
            }
            if err := client.Conn.Write(ctx, websocket.MessageText, msg); err != nil {
                return
            }

        case <-ticker.C:
            // coder/websocket 内置 Ping/Pong 支持
            if err := client.Conn.Ping(ctx); err != nil {
                return
            }
            client.lastPing = time.Now()
        }
    }
}

// =====================================================================
// 多 Conversation 路由
// =====================================================================

// 房间命名约定:
//   "conv:{conversationID}"   → 一个 conversation 的所有参与者
//   "edge:{edgeID}"           → Edge 到 Hub 的专用通道（反向 WSS）
//   "user:{userID}"           → 用户所有设备（用于多端通知）

func ConversationRoom(convID string) string { return "conv:" + convID }
func EdgeRoom(edgeID string) string         { return "edge:" + edgeID }
func UserRoom(userID string) string         { return "user:" + userID }

// =====================================================================
// 错误类型
// =====================================================================

var (
    ErrRoomNotFound   = &HubError{msg: "room not found"}
    ErrClientNotFound = &HubError{msg: "client not found"}
    ErrSendQueueFull  = &HubError{msg: "client send queue full"}
)

type HubError struct{ msg string }
func (e *HubError) Error() string { return e.msg }

type RoomInfo struct {
    ID          string `json:"id"`
    ClientCount int    `json:"client_count"`
}

func newClientID() string {
    // 使用 crypto/rand + base64 生成 16 字符 client ID
    b := make([]byte, 12)
    // crypto/rand.Read(b) 在实际代码中
    return "client_placeholder"
}
```

### 5.3 Hub 侧 Edge 通道

```go
// hub/internal/wsgateway/edge_tunnel.go
package wsgateway

// EdgeTunnel 管理 Hub 端所有 Edge 的 WebSocket 连接
// 每个 Edge 在 Hub 上占用一个 "edge:{edgeID}" 房间
type EdgeTunnel struct {
    hub *WSHub
    // edges map[edgeID]*EdgeConnection
}

// 使用流程:
// 1. Edge 通过 WSS 连接 Hub
// 2. Hub 鉴权（设备 token）+ 分配到 "edge:{edgeID}" 房间
// 3. Hub 的 relay 模块通过 h.Broadcast("edge:{edgeID}", cmd) 下发指令
// 4. Edge 的 readPump 接收指令并交给 relay 处理
// 5. Edge 的 writePump 上行发送同步事件
```

---

## 6. 依赖注入方案

### 6.1 决策：Manual DI 起步，Wire 加速

参考 Wire vs Fx 2025 调研结论：

- **P0-P1**：Manual DI（零开销、无额外构建步骤、显式可调试）
- **P2+**：引入 Wire（当 3 个服务各自的依赖图超过 15 个构造函数时）

理由：
- AgentHub 的服务边界清晰（Hub/Edge/Runner 各有独立职责），各服务的依赖图不会迅速膨胀
- Manual DI 的构造函数模式与 Wire 兼容，迁移成本低
- Fx 的运行时反射开销和 "magic" 错误信息不适合 AgentHub 当前阶段

### 6.2 Hub Server 依赖组装

```go
// hub/server.go
package hub

import (
    "database/sql"
    "log/slog"
    "net/http"

    "github.com/agenthub/agenthub/hub/internal/auth"
    "github.com/agenthub/agenthub/hub/internal/user"
    "github.com/agenthub/agenthub/hub/internal/device"
    "github.com/agenthub/agenthub/hub/internal/contact"
    "github.com/agenthub/agenthub/hub/internal/im"
    "github.com/agenthub/agenthub/hub/internal/sync"
    "github.com/agenthub/agenthub/hub/internal/relay"
    "github.com/agenthub/agenthub/hub/internal/orchestrator"
    "github.com/agenthub/agenthub/hub/internal/runner_registry"
    "github.com/agenthub/agenthub/hub/internal/artifact"
    "github.com/agenthub/agenthub/hub/internal/memory"
    "github.com/agenthub/agenthub/hub/internal/wsgateway"
    "github.com/agenthub/agenthub/hub/internal/store"
    "github.com/agenthub/agenthub/packages/im-core"
    "github.com/agenthub/agenthub/packages/sync-core"
    "github.com/go-chi/chi/v5"
    _ "modernc.org/sqlite"
)

// Server 是 Hub 的顶层 DI 容器（Manual DI 风格）
type Server struct {
    Config    *Config
    DB        *sql.DB
    Router    chi.Router
    WSHub     *wsgateway.WSHub

    // Services (public for testing)
    AuthSvc         auth.AuthService
    UserSvc         user.UserService
    DeviceSvc       device.DeviceService
    ContactSvc      contact.ContactService
    ConvSvc         im.ConversationService
    GroupSvc        im.GroupService
    SyncSvc         sync.EdgeSyncService
    RelaySvc        relay.RelayService
    Orchestrator    orchestrator.Orchestrator
    RunnerRegistry  runner_registry.Registry
    ArtifactSvc     artifact.ArtifactService
    MemorySvc       memory.CloudMemoryService
}

// NewServer 用 Manual DI 构建完整的依赖图
func NewServer(cfg *Config) *Server {
    // Layer 0: 基础设施
    db := mustOpenDB(cfg.DBPath)
    if err := store.RunMigrations(db); err != nil {
        slog.Error("migration failed", "error", err)
        panic(err)
    }

    wsHub := wsgateway.NewHub()

    // Layer 1: 存储层
    userStore := user.NewSQLiteStore(db)
    deviceStore := device.NewSQLiteStore(db)
    contactStore := contact.NewSQLiteStore(db)
    convStore := im.NewSQLiteConversationStore(db)

    // Layer 2: 核心服务
    authSvc := auth.NewService(db, cfg.JWTSecret)
    userSvc := user.NewService(userStore)
    deviceSvc := device.NewService(deviceStore)
    contactSvc := contact.NewService(contactStore)
    convSvc := im.NewConversationService(convStore)
    groupSvc := im.NewGroupService(convStore)
    syncSvc := sync.NewService(db, sync.NewDeltaStore(db))
    relaySvc := relay.NewService(wsHub) // relay 依赖 wsHub 做边缘通道
    orchestratorSvc := orchestrator.New(convSvc, syncSvc)
    runnerReg := runner_registry.NewSQLiteStore(db)
    artifactSvc := artifact.NewSQLiteService(db)
    memorySvc := memory.NewSQLiteService(db)

    // Layer 3: HTTP 路由
    r := chi.NewRouter()
    RegisterRoutes(r, &RouteDeps{
        Auth:            authSvc,
        User:            userSvc,
        Device:          deviceSvc,
        Contact:         contactSvc,
        Conversation:    convSvc,
        Group:           groupSvc,
        Sync:            syncSvc,
        Relay:           relaySvc,
        Orchestrator:    orchestratorSvc,
        RunnerRegistry:  runnerReg,
        Artifact:        artifactSvc,
        Memory:          memorySvc,
        WSHub:           wsHub,
    })

    return &Server{
        Config:          cfg,
        DB:              db,
        Router:          r,
        WSHub:           wsHub,
        AuthSvc:         authSvc,
        UserSvc:         userSvc,
        DeviceSvc:       deviceSvc,
        ContactSvc:      contactSvc,
        ConvSvc:         convSvc,
        GroupSvc:        groupSvc,
        SyncSvc:         syncSvc,
        RelaySvc:        relaySvc,
        Orchestrator:    orchestratorSvc,
        RunnerRegistry:  runnerReg,
        ArtifactSvc:     artifactSvc,
        MemorySvc:       memorySvc,
    }
}

func (s *Server) Start(ctx context.Context) error {
    // 启动 WSHub 事件循环
    go s.WSHub.Run(ctx)

    // 启动 HTTP server
    s.httpServer = &http.Server{
        Addr:    s.Config.ListenAddr, // 默认 :3211
        Handler: s.Router,
    }
    go func() {
        slog.Info("hub server listening", "addr", s.Config.ListenAddr)
        if err := s.httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
            slog.Error("hub server error", "error", err)
        }
    }()
    return nil
}

func (s *Server) Shutdown(ctx context.Context) {
    s.httpServer.Shutdown(ctx)
    s.DB.Close()
}

// RouteDeps 显式声明路由层的依赖
type RouteDeps struct {
    Auth            auth.AuthService
    User            user.UserService
    Device          device.DeviceService
    Contact         contact.ContactService
    Conversation    im.ConversationService
    Group           im.GroupService
    Sync            sync.EdgeSyncService
    Relay           relay.RelayService
    Orchestrator    orchestrator.Orchestrator
    RunnerRegistry  runner_registry.Registry
    Artifact        artifact.ArtifactService
    Memory          memory.CloudMemoryService
    WSHub           *wsgateway.WSHub
}

func mustOpenDB(path string) *sql.DB {
    // 使用 WAL 模式 + 5s busy timeout 提高并发
    db, err := sql.Open("sqlite", path+"?_journal_mode=WAL&_busy_timeout=5000")
    if err != nil {
        panic("open db: " + err.Error())
    }
    db.SetMaxOpenConns(1) // SQLite 写串行化
    return db
}
```

### 6.3 Edge Server 依赖组装

```go
// edge/server.go
package edge

import (
    "database/sql"
    "log/slog"
    "net/http"

    "github.com/agenthub/agenthub/edge/internal/local_api"
    "github.com/agenthub/agenthub/edge/internal/local_ws"
    "github.com/agenthub/agenthub/edge/internal/event"
    "github.com/agenthub/agenthub/edge/internal/im_lite"
    "github.com/agenthub/agenthub/edge/internal/hub_client"
    "github.com/agenthub/agenthub/edge/internal/sync_client"
    "github.com/agenthub/agenthub/edge/internal/local_orchestrator"
    "github.com/agenthub/agenthub/edge/internal/runner_manager"
    "github.com/agenthub/agenthub/edge/internal/context_builder"
    "github.com/agenthub/agenthub/edge/internal/artifact_index"
    "github.com/agenthub/agenthub/edge/internal/memory"
    "github.com/agenthub/agenthub/edge/internal/security"
    "github.com/agenthub/agenthub/edge/internal/store"
    "github.com/agenthub/agenthub/packages/im-core"
    "github.com/agenthub/agenthub/packages/sync-core"
    "github.com/go-chi/chi/v5"
    _ "modernc.org/sqlite"
)

type Server struct {
    Config    *Config
    DB        *sql.DB
    Router    chi.Router
    EventBus  *event.Bus
    Dispatcher *event.Dispatcher
    WSHub     *local_ws.LocalWSHub

    ConvStore       im_lite.LocalConversationStore
    HubClient       hub_client.HubClient
    Syncer          sync_client.Syncer
    Orchestrator    local_orchestrator.LocalOrchestrator
    RunnerMgr       runner_manager.RunnerManager
    ContextBuilder  context_builder.ContextBuilder
    ArtifactIndexer artifact_index.ArtifactIndexer
    MemoryMgr       memory.MemoryManager
    Authorizer      security.LocalAuthorizer
}

func NewServer(cfg *Config) *Server {
    // Layer 0
    db := mustOpenDB(cfg.DBPath)
    store.RunMigrations(db)

    evtBus := event.NewBus()
    dispatcher := event.NewDispatcher()
    wsHub := local_ws.NewHub(dispatcher)

    // Layer 1
    convStore := im_lite.NewSQLiteStore(db)
    hubClient := hub_client.NewWSClient(cfg.HubURL, cfg.EdgeID, cfg.EdgeSecret)
    syncer := sync_client.New(db, hubClient, convStore)
    orchestrator := local_orchestrator.New(convStore)
    runnerMgr := runner_manager.New(cfg.RunnerTransport)
    ctxBuilder := context_builder.New(convStore)
    artifactIdx := artifact_index.NewSQLiteIndexer(db)
    memoryMgr := memory.NewManager(cfg.ProjectRoots)
    authorizer := security.NewLocalAuthorizer()

    // Layer 2
    r := chi.NewRouter()
    local_api.RegisterRoutes(r, &local_api.RouteDeps{
        ConvStore:       convStore,
        RunnerMgr:       runnerMgr,
        Orchestrator:    orchestrator,
        ContextBuilder:  ctxBuilder,
        ArtifactIndexer: artifactIdx,
        MemoryMgr:       memoryMgr,
        Authorizer:      authorizer,
        Dispatcher:      dispatcher,
        WSHub:           wsHub,
    })

    return &Server{
        Config:          cfg,
        DB:              db,
        Router:          r,
        EventBus:        evtBus,
        Dispatcher:      dispatcher,
        WSHub:           wsHub,
        ConvStore:       convStore,
        HubClient:       hubClient,
        Syncer:          syncer,
        Orchestrator:    orchestrator,
        RunnerMgr:       runnerMgr,
        ContextBuilder:  ctxBuilder,
        ArtifactIndexer: artifactIdx,
        MemoryMgr:       memoryMgr,
        Authorizer:      authorizer,
    }
}

func (s *Server) Start(ctx context.Context) error {
    // Hub 连接（reverse WSS）
    if s.Config.HubURL != "" {
        if err := s.HubClient.Connect(ctx); err != nil {
            slog.Warn("hub connection failed, operating offline", "error", err)
        } else {
            if err := s.HubClient.Register(ctx, hub_client.EdgeInfo{
                ID:   s.Config.EdgeID,
                Name: s.Config.EdgeName,
            }); err != nil {
                slog.Warn("hub register failed", "error", err)
            }
            go s.Syncer.Start(ctx)
        }
    }

    // WSHub
    go s.WSHub.Run(ctx)
    go s.Dispatcher.Run(ctx)

    // HTTP
    s.httpServer = &http.Server{
        Addr:    s.Config.ListenAddr, // :3210
        Handler: s.Router,
    }
    go s.httpServer.ListenAndServe()
    slog.Info("edge server listening", "addr", s.Config.ListenAddr)
    return nil
}

func (s *Server) Shutdown(ctx context.Context) {
    s.httpServer.Shutdown(ctx)
    s.DB.Close()
}
```

### 6.4 Runner Server 依赖组装

```go
// runner/server.go
package runner

import (
    "log/slog"
    "net/http"

    "github.com/agenthub/agenthub/runner/internal/service"
    "github.com/agenthub/agenthub/runner/internal/executor"
    "github.com/agenthub/agenthub/runner/internal/workspace"
    "github.com/agenthub/agenthub/runner/internal/checkpoint"
    "github.com/agenthub/agenthub/runner/internal/diff"
    "github.com/agenthub/agenthub/runner/internal/preview"
    "github.com/agenthub/agenthub/runner/internal/logs"
    "github.com/agenthub/agenthub/runner/internal/tool_engine"
    "github.com/agenthub/agenthub/runner/internal/security"
    "github.com/agenthub/agenthub/runner/internal/adapters" // runner-internal adapters
    "github.com/agenthub/agenthub/packages/adapters"         // shared adapter interfaces
    "github.com/agenthub/agenthub/packages/workspace-core"
    "github.com/go-chi/chi/v5"
)

type Server struct {
    Config      *Config
    Router      chi.Router
    Executor    *executor.Executor
    WsProvider  workspace.Provider       // 默认 GitWorktreeProvider
    Checkpoints *checkpoint.CheckpointManager
    Differ      *diff.Differ
    Preview     *preview.PreviewServer
    LogCollector *logs.Collector
    ToolEngine  *tool_engine.Engine
    ToolRegistry *tool_engine.Registry
    PathGuard   *security.PathGuard
    CmdPolicy   *security.CommandApprovalPolicy
}

func NewServer(cfg *Config) *Server {
    // Layer 0: 基础设施
    pathGuard := security.NewPathGuard(cfg.AllowedRoots)
    cmdPolicy := security.NewCommandApprovalPolicy(cfg.AllowCommands, cfg.DenyCommands)

    // Layer 1: 工具注册
    toolReg := tool_engine.NewRegistry()
    tool_engine.RegisterBuiltinTools(toolReg) // read, write, edit, bash, glob, grep
    if cfg.MCPEnabled {
        tool_engine.RegisterMCPTools(toolReg, cfg.MCPServers)
    }
    toolEng := tool_engine.NewEngine(toolReg, pathGuard, cmdPolicy)

    // Layer 2: Workspace 提供者（P0: Git Worktree）
    wsProvider := workspace.NewGitWorktreeProvider(cfg.RepoRoot)

    // Layer 3: Checkpoint
    checkpointMgr := checkpoint.NewManager(
        cfg.CheckpointDir, // .agenthub-runtime/
        wsProvider,
    )

    // Layer 4: Diff + Preview
    differ := diff.New()
    previewSrv := preview.New(preview.PortRange{Start: 5100, End: 5199})

    // Layer 5: Log 收集
    logCollector := logs.NewCollector(1024 * 1024) // 1MB buffer

    // Layer 6: Executor（注入 Agent Adapter）
    ccAdapter := adapters.NewClaudeCodeAdapter(cfg.ClaudeCodeBinary)
    codexAdapter := adapters.NewCodexAdapter(cfg.CodexBinary, cfg.CodexDataDir)
    opencodeAdapter := adapters.NewOpenCodeAdapter(cfg.OpenCodeURL)

    exec := executor.New(executor.AdapterSet{
        "claude-code": ccAdapter,
        "codex":       codexAdapter,
        "opencode":    opencodeAdapter,
    }, toolEng)

    // Layer 7: HTTP 路由
    r := chi.NewRouter()
    service.RegisterRoutes(r, &service.RouteDeps{
        Executor:    exec,
        Workspace:   wsProvider,
        Checkpoints: checkpointMgr,
        Diff:        differ,
        Preview:     previewSrv,
        ToolEngine:  toolEng,
        ToolRegistry: toolReg,
        Logs:        logCollector,
    })

    return &Server{
        Config:       cfg,
        Router:       r,
        Executor:     exec,
        WsProvider:   wsProvider,
        Checkpoints:  checkpointMgr,
        Differ:       differ,
        Preview:      previewSrv,
        LogCollector: logCollector,
        ToolEngine:   toolEng,
        ToolRegistry: toolReg,
        PathGuard:    pathGuard,
        CmdPolicy:    cmdPolicy,
    }
}

func (s *Server) Start(ctx context.Context) error {
    s.httpServer = &http.Server{
        Addr:    s.Config.ListenAddr, // :39731
        Handler: s.Router,
    }
    go s.httpServer.ListenAndServe()
    slog.Info("runner listening", "addr", s.Config.ListenAddr)
    return nil
}

func (s *Server) Shutdown(ctx context.Context) {
    // 优雅关闭：先终止所有运行中的 Agent 进程
    s.Executor.ShutdownAll(5 * time.Second)
    s.httpServer.Shutdown(ctx)
}
```

### 6.5 未来 Wire 迁移路径（P2+）

当 manual DI 的 `NewServer` 超过 40 行构造函数调用时，引入 Wire：

```go
// hub/wire.go (Wire 注入器，将来创建)
//go:build wireinject
// +build wireinject

package hub

import "github.com/google/wire"

func InitializeServer(cfg *Config) (*Server, error) {
    wire.Build(
        // Providers
        mustOpenDB,
        wsgateway.NewHub,
        auth.NewService,
        user.NewSQLiteStore,
        user.NewService,
        // ... 其余 providers

        // Wire 自动解析依赖图并生成 wire_gen.go
    )
    return nil, nil
}
```

Wire 生成的代码与 manual DI 等价，零运行时开销，可随时切换。

---

## 附录 A：关键设计决策汇总

| 决策 | 选择 | 依据 |
|------|------|------|
| Module 结构 | 单 module | OpenCode 22 packages monorepo 已验证 |
| Hub Server 数据库 | **PostgreSQL 16** | JSONB + 全文搜索 + 事务 DDL + Go 生态（pgx） |
| Edge Server 数据库 | **SQLite** (modernc.org/sqlite) | 嵌入式、离线可用、零配置、FTS5 全文搜索 |
| Hub-Edge 同步 | Cursor-based 增量同步 | Hub 为 Source of Truth，Edge 为本地副本 |
| 共享包目录 | `packages/` | 避免 `pkg/` 的无意义路径段 |
| 共享包目录 | `packages/` | 避免 `pkg/` 的无意义路径段 |
| `internal/` 使用 | 每个服务独立 `internal/` | Go 编译器强制隔离 |
| 依赖注入 | Manual DI (P0-P1), Wire (P2+) | 社区共识 + Wire 编译时安全 |
| WebSocket 库 | coder/websocket | 纯 Go、并发写、内置 Ping/Pong |
| SQLite 驱动 | modernc.org/sqlite | 纯 Go、FTS5 内置、无 CGO |
| FTS5 模式 | External Content + Triggers | 内容表为唯一事实源，FTS 为索引 |
| HTTP 路由 | chi（P0），stdlib（Go 1.22+ 增强路由） | chi 中间件生态成熟 |
| RPC 协议 | ConnectRPC + Buf（P2+） | P0 用 JSON/SSE 足够 |
| 日志 | slog（Go 1.24 stdlib） | 零依赖结构化日志 |
| 测试 | stdlib testing + go-cmp | testify 的 testify/assert 已不推荐新项目 |
| Go 版本 | 1.24 | iter.Seq2, testing/synctest, tool directive, errors.Join |

## 附录 B：编译验证最小骨架

三个 `cmd/` 入口编译通过的最小依赖链条：

```
cmd/hub/main.go
  → hub/server.go
    → hub/internal/wsgateway/hub.go
    → hub/internal/store/db.go
    → github.com/coder/websocket
    → modernc.org/sqlite
    → github.com/go-chi/chi/v5

cmd/edge/main.go
  → edge/server.go
    → edge/internal/hub_client/ws_client.go
    → github.com/coder/websocket
    → modernc.org/sqlite
    → github.com/go-chi/chi/v5

cmd/runner/main.go
  → runner/server.go
    → runner/internal/executor/executor.go
    → runner/internal/workspace/git_worktree.go
    → packages/adapters/
    → github.com/go-chi/chi/v5
```

这些 import 链均无循环依赖，Go 编译器强制验证。
