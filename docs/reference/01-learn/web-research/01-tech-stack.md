# AgentHub 技术栈 Web 调研

> 调研日期：2026-05-21
> 调研目的：为 AgentHub（Go + React + Tauri）+ Hub-Edge-Runner 架构选择具体技术栈

---

## 1. Go + Tauri Sidecar 模式

### 推荐方案

**Tauri 2 Shell Plugin + HTTP localhost IPC**

### 具体实现

#### 1.1 Sidecar 二进制打包

Go binary 放在 `src-tauri/binaries/`，文件名遵循 Tauri 命名约定：
```
binary-name-{target_triple}{.exe}
```

示例：
- Windows: `agent-hub-x86_64-pc-windows-msvc.exe`
- macOS Intel: `agent-hub-x86_64-apple-darwin`
- macOS Apple Silicon: `agent-hub-aarch64-apple-darwin`
- Linux: `agent-hub-x86_64-unknown-linux-gnu`

**获取 target triple**：
```bash
rustc --print host-tuple
# 或：rustc -Vv | grep host | cut -f2 -d' '
```

在 `tauri.conf.json` 中注册：
```json
{
  "bundle": {
    "externalBin": ["binaries/agent-hub"]
  }
}
```

#### 1.2 权限配置

在 `src-tauri/capabilities/default.json` 中添加 shell 权限：
```json
{
  "permissions": [
    "core:default",
    {
      "identifier": "shell:allow-execute",
      "allow": [
        {
          "name": "binaries/agent-hub",
          "sidecar": true
        }
      ]
    }
  ]
}
```

#### 1.3 启动方式：推荐 HTTP localhost 而非 stdin/stdout

**推荐方案：Go 启动 HTTP server，Tauri 通过 localhost 通信**

- Go sidecar 在随机端口启动 HTTP server，将端口号通过 stdout 打印
- Tauri Rust 端监听 stdout 获取端口号，然后通过 TCP/HTTP 通信
- 源码参考 [Evil Martians 的 Tauri + sidecar 实战文章](https://evilmartians.com/chronicles/making-desktop-apps-with-revved-up-potential-rust-tauri-sidecar)

**Tauri Rust 端启动代码（推荐结构）**：
```rust
// src-tauri/src/sidecar.rs
use tauri::AppHandle;
use tauri_plugin_shell::ShellExt;

pub async fn spawn(app_handle: &AppHandle) -> u16 {
    let command = app_handle
        .shell()
        .sidecar("agent-hub")
        .expect("couldn't get sidecar executable");

    let (mut rx, _child) = command.spawn().expect("Failed to spawn sidecar");

    // 监听 stdout 获取端口号
    while let Some(event) = rx.recv().await {
        if let CommandEvent::Stdout(line) = event {
            if line.contains("LISTEN_PORT=") {
                let port: u16 = line.trim_start_matches("LISTEN_PORT=").parse().unwrap();
                return port;
            }
        }
    }
    0
}
```

**Go sidecar 端**：
```go
func main() {
    listener, _ := net.Listen("tcp", "127.0.0.1:0")
    port := listener.Addr().(*net.TCPAddr).Port
    fmt.Printf("LISTEN_PORT=%d\n", port) // Tauri 读取这行获取端口

    http.HandleFunc("/api/...", handler)
    http.Serve(listener, nil)
}
```

#### 1.4 跨平台构建

使用 GitHub Actions matrix 策略，每个平台用原生 runner 编译（不跨编译）：

```yaml
strategy:
  matrix:
    include:
      - platform: ubuntu-22.04
        target: x86_64-unknown-linux-gnu
      - platform: macos-latest
        target: aarch64-apple-darwin
      - platform: windows-latest
        target: x86_64-pc-windows-msvc
```

Go 交叉编译脚本（构建前执行）：
```bash
GOOS=linux GOARCH=amd64 go build -o src-tauri/binaries/agent-hub-x86_64-unknown-linux-gnu
GOOS=darwin GOARCH=arm64 go build -o src-tauri/binaries/agent-hub-aarch64-apple-darwin
GOOS=windows GOARCH=amd64 go build -o src-tauri/binaries/agent-hub-x86_64-pc-windows-msvc.exe
```

#### 1.5 关键坑点

| 问题 | 解决方案 |
|------|---------|
| Windows 上 `windows_subsystem = "windows"` 会隐藏 console | 在 Go binary main.go 顶部加 `//go:build !windows` 或使用 `-ldflags -H=windowsgui` |
| Go sidecar 进程 kill 不干净 | Tauri ExitRequested 事件中调用 `child.kill()` |
| macOS 签名问题 | 确保 sidecar binary 有执行权限 (`chmod +x`) |
| 开发模式 vs 生产模式 | 开发时用系统安装的 Go binary 路径，生产时用嵌入的 sidecar |

### 关键库与版本

- `tauri` v2.11+ (当前 stable)
- `tauri-plugin-shell` v2 (随 Tauri CLI `cargo tauri add shell`)
- `@tauri-apps/plugin-shell` (前端 npm 包)

### 来源

- [Tauri 2 官方 Sidecar 文档](https://v2.tauri.app/develop/sidecar/)
- [Tauri 2 Shell Plugin 文档](https://v2.tauri.app/plugin/shell/)
- [Evil Martians: Tauri + sidecar 实战](https://evilmartians.com/chronicles/making-desktop-apps-with-revved-up-potential-rust-tauri-sidecar)
- [Tauri v2 Node.js Sidecar Guide](https://v2.tauri.app/learn/sidecar-nodejs/)
- [Tauri 2 Cross-Platform Compilation Guide (MOBZystems)](https://www.mobzsystems.com/blog/tauri-20-cross-compilation/)
- [Tauri 2 GitHub Actions Release Tutorial](https://www.youtube.com/watch?v=C7eo6qBgjg8)

---

## 2. Go SQLite 迁移最佳实践

### 推荐方案

**golang-migrate/migrate v4 + modernc.org/sqlite + go:embed**

### 理由

| 工具 | Stars | 优势 | 劣势 |
|------|-------|------|------|
| **golang-migrate** | 10.3k | 数据库无关、CLI+库、支持 go:embed via iofs | 只记录最后一个版本号 |
| **goose** | 3.2k | 支持 Go 迁移函数、完整迁移历史表、事务支持 | 仅文件系统源 |
| **Atlas** | 较新 | 声明式、自动生成迁移、有 LSP/HCL 描述 | 更多概念负担、SQLite FTS5 虚拟表有已知 bug |

**结论：选 golang-migrate。** AgentHub 是 SQLite 单实例，不需要多 DB 支持。golang-migrate 的社区成熟度最高，go:embed 集成最直接。

### 具体实现

#### 2.1 项目结构

```
internal/
  database/
    migrate.go        # 迁移入口
migrations/
  000001_create_agents.up.sql
  000001_create_agents.down.sql
  000002_fts5_search.up.sql
  000002_fts5_search.down.sql
```

#### 2.2 迁移入口代码

```go
package database

import (
    "database/sql"
    "embed"
    "fmt"

    "github.com/golang-migrate/migrate/v4"
    _ "github.com/golang-migrate/migrate/v4/database/sqlite3"
    "github.com/golang-migrate/migrate/v4/source/iofs"
    _ "modernc.org/sqlite"
)

//go:embed migrations/*.sql
var migrationsFS embed.FS

func RunMigrations(db *sql.DB, dbPath string) error {
    sourceDriver, err := iofs.New(migrationsFS, "migrations")
    if err != nil {
        return fmt.Errorf("failed to create source driver: %w", err)
    }

    m, err := migrate.NewWithInstance(
        "iofs", sourceDriver,
        "sqlite3", db,
    )
    if err != nil {
        return fmt.Errorf("failed to create migrator: %w", err)
    }

    if err := m.Up(); err != nil && err != migrate.ErrNoChange {
        return fmt.Errorf("migration failed: %w", err)
    }
    return nil
}
```

**注意**：使用 `file:` URI 启用 WAL 模式：
```go
db, err := sql.Open("sqlite", "file:./data/agenthub.db?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)")
```

#### 2.3 FTS5 虚拟表迁移写法

FTS5 虚拟表**不能放在 `CREATE TABLE IF NOT EXISTS`** 中——它应该用 `CREATE VIRTUAL TABLE ... USING fts5(...)`。

**上迁移（000002_fts5_search.up.sql）**：
```sql
-- FTS5 全文搜索虚拟表
CREATE VIRTUAL TABLE agents_fts USING fts5(
    name,
    description,
    tokenize = 'porter unicode61',
    content = 'agents',
    content_rowid = 'id'
);

-- 触发器：同步 agents 表到 FTS5
CREATE TRIGGER agents_ai AFTER INSERT ON agents BEGIN
    INSERT INTO agents_fts(rowid, name, description)
    VALUES (new.id, new.name, new.description);
END;

CREATE TRIGGER agents_ad AFTER DELETE ON agents BEGIN
    INSERT INTO agents_fts(agents_fts, rowid, name, description)
    VALUES ('delete', old.id, old.name, old.description);
END;

CREATE TRIGGER agents_au AFTER UPDATE ON agents BEGIN
    INSERT INTO agents_fts(agents_fts, rowid, name, description)
    VALUES ('delete', old.id, old.name, old.description);
    INSERT INTO agents_fts(rowid, name, description)
    VALUES (new.id, new.name, new.description);
END;
```

**下迁移（000002_fts5_search.down.sql）**：
```sql
DROP TRIGGER IF EXISTS agents_ai;
DROP TRIGGER IF EXISTS agents_ad;
DROP TRIGGER IF EXISTS agents_au;
DROP TABLE IF EXISTS agents_fts;
```

**关键注意**：
- FTS5 的 `content=` 使用外部内容模式（不复制数据，节省空间）
- `content_rowid=` 指定关联列（通常是 INTEGER PRIMARY KEY）
- FTS5 会创建 shadow tables（`_data`, `_idx`, `_content`, `_docsize`, `_config`），`DROP TABLE` 虚拟表时会自动级联删除
- SQLite 必须编译了 FTS5 支持——`modernc.org/sqlite` 默认包含 FTS5

#### 2.4 创建迁移的命令

```bash
# 使用 golang-migrate CLI 创建新迁移
go install -tags 'sqlite3' github.com/golang-migrate/migrate/v4/cmd/migrate@latest
migrate create -ext sql -dir internal/database/migrations -seq add_agents_table
```

### 关键库与版本

- `github.com/golang-migrate/migrate/v4` v4.18+
- `modernc.org/sqlite` v1.35+ (纯 Go，无需 CGO)
- Go 1.23+ (go:embed 自 1.16 起可用)

### 来源

- [golang-migrate + SQLite 实战 (DEV Community)](https://dev.to/ouma_ouma/mastering-database-migrations-in-go-with-golang-migrate-and-sqlite-3jhb)
- [Go Embed for Migrations (Oscar Forner)](https://oscarforner.com/blog/2023-10-10-go-embed-for-migrations/)
- [Go + SQLite in the Cloud (maragu.dev, FTS5 实战)](https://www.maragu.dev/blog/go-and-sqlite-in-the-cloud)
- [SQLite FTS5 官方文档](https://sqlite.org/fts5.html)
- [golang-migrate 官方仓库](https://github.com/golang-migrate/migrate)
- [How to Implement Database Migrations in Go (OneUptime)](https://oneuptime.com/blog/post/2026-01-07-go-database-migrations/view)
- [Goose vs golang-migrate (Reddit 社区讨论)](https://www.reddit.com/r/golang/comments/17whnvc/which_database_migration_tool_atlas_dbmate_goose/)

---

## 3. Go WebSocket 生产级 Hub 模式

### 推荐方案

**coder/websocket (继承自 nhooyr/websocket)**

### 理由

**必须选 coder/websocket，不能选 gorilla/websocket。** gorilla/websocket 仓库已于 2022 年底归档，不再维护。Coder 公司于 2024 年底接管了 nhooyr/websocket，更名为 `github.com/coder/websocket`，持续维护。

| 特性 | gorilla/websocket | coder/websocket |
|------|-------------------|-----------------|
| 维护状态 | 已归档 (2022) | 活跃维护 |
| 并发写 | panic 风险，需要外部同步 | 内部处理，goroutine 安全 |
| Context 支持 | 无 | 原生 `context.Context` |
| API 风格 | 回调式 | 惯用 Go |
| 使用者 | 大量存量项目 | Traefik, Vault, Cloudflare |
| WASM 支持 | 无 | 有 |

### 具体实现

#### 3.1 coder/websocket 标准 Hub 模式

```go
package ws

import (
    "context"
    "net/http"
    "sync"

    "github.com/coder/websocket"
)

// Hub 管理所有连接的客户端
type Hub struct {
    mu      sync.RWMutex
    clients map[string]*Client
}

// Client 表示一个 WebSocket 连接
type Client struct {
    ID   string
    Conn *websocket.Conn
    Send chan []byte
    Hub  *Hub
}

func NewHub() *Hub {
    return &Hub{
        clients: make(map[string]*Client),
    }
}

// Handle 处理 WebSocket 升级请求
func (h *Hub) Handle(w http.ResponseWriter, r *http.Request) {
    conn, err := websocket.Accept(w, r, nil)
    if err != nil {
        return
    }

    client := &Client{
        ID:   generateID(),
        Conn: conn,
        Send: make(chan []byte, 256), // 缓冲通道，防止慢客户端阻塞广播
        Hub:  h,
    }

    h.mu.Lock()
    h.clients[client.ID] = client
    h.mu.Unlock()

    go client.writePump()
    go client.readPump()
}

// 读取泵：从 WebSocket 读取消息
func (c *Client) readPump() {
    defer func() {
        c.Hub.mu.Lock()
        delete(c.Hub.clients, c.ID)
        c.Hub.mu.Unlock()
        c.Conn.CloseNow()
    }()

    ctx := context.Background()
    for {
        _, msg, err := c.Conn.Read(ctx)
        if err != nil {
            return
        }
        c.Hub.Broadcast(msg, c.ID)
    }
}

// 写入泵：将消息写入 WebSocket
func (c *Client) writePump() {
    defer c.Conn.CloseNow()
    ctx := context.Background()

    for msg := range c.Send {
        if err := c.Conn.Write(ctx, websocket.MessageText, msg); err != nil {
            return
        }
    }
}

// Broadcast 广播给所有客户端（排除发送者）
func (h *Hub) Broadcast(msg []byte, excludeID string) {
    h.mu.RLock()
    defer h.mu.RUnlock()

    for id, client := range h.clients {
        if id != excludeID {
            select {
            case client.Send <- msg:
            default:
                // 客户端通道满，跳过
                close(client.Send)
                go client.Conn.CloseNow()
            }
        }
    }
}
```

#### 3.2 多房间模式

按 AgentHub 的 Hub-Edge-Runner 架构，建议每个 Room/Channel 对应一个 Hub 实例：

```go
type HubManager struct {
    mu   sync.RWMutex
    hubs map[string]*Hub // key: room/channel ID
}

func (hm *HubManager) GetOrCreate(id string) *Hub {
    hm.mu.Lock()
    defer hm.mu.Unlock()
    if h, ok := hm.hubs[id]; ok {
        return h
    }
    h := NewHub()
    hm.hubs[id] = h
    return h
}
```

#### 3.3 内存优化（1000+ 连接）

- **缓冲通道大小**：默认 256，根据消息大小和速率调整；太小会阻塞写入，太大会浪费内存
- **消息大小限制**：`conn.SetReadLimit(maxMessageSize)` — 建议 64KB 默认
- **WAL 数据库模式**：确保 SQLite 使用 WAL (`PRAGMA journal_mode=WAL`)，读者不阻塞写者
- **避免 goroutine 泄漏**：每次连接 2 个 goroutine（read + write），关闭连接时必须退出两个 goroutine
- **定期 ping**：`time.NewTicker(54 * time.Second)` — 保活并清理死连接

#### 3.4 水平扩展

AgentHub 的 Edge 节点天然适合水平扩展。跨节点广播使用 Redis Pub/Sub：

```go
// Edge 节点发布到 Redis
func (h *Hub) PublishToRedis(msg []byte, roomID string) {
    h.redis.Publish(ctx, "room:"+roomID, msg)
}

// Edge 节点订阅 Redis
func (h *Hub) SubscribeRedis(roomID string) {
    sub := h.redis.Subscribe(ctx, "room:"+roomID)
    for msg := range sub.Channel() {
        h.Broadcast([]byte(msg.Payload), "") // 空 excludeID = 发给所有人
    }
}
```

### 关键库与版本

- `github.com/coder/websocket` v1.8+ (最新 stable)
- `github.com/redis/go-redis/v9` (跨 Edge 广播)
- Go 1.23+

### 来源

- [Go WebSocket Server Guide: coder/websocket vs Gorilla (WebSocket.org)](https://websocket.org/guides/languages/go/)
- [coder/websocket 官方仓库](https://github.com/coder/websocket)
- [A New Home for nhooyr/websocket (Coder Blog)](https://coder.com/blog/websocket)
- [Building a Scalable Go WebSocket Service (Leapcell)](https://leapcell.io/blog/building-a-scalable-go-websocket-service-for-thousands-of-concurrent-connections)
- [Scaling WebSocket in Go and beyond (Centrifugo)](https://centrifugal.dev/blog/2020/11/12/scaling-websocket)
- [Go WebSocket 并发写 panic 问题 (Reddit r/golang)](https://www.reddit.com/r/golang/comments/1k9olk3/which_websocket_library_to_use/)

---

## 4. Go Protobuf + Buf 工作流

### 推荐方案

**Buf CLI v2 + buf.build Remote Plugins + Connect-Go + @bufbuild/protobuf-es**

### 理由

Buf 在 2026 年的方案就是直接用 Remote Plugins——不再需要本地安装 `protoc`、`protoc-gen-go`、`protoc-gen-connect-go` 等。CI 只需要 `buf` CLI 一个二进制。

Anthropic、Cloudflare、Vault 等都在用 Connect-Go 生产环境。Connect 支持三种协议：gRPC、gRPC-Web、Connect（JSON/cURL 友好）。

### 具体实现

#### 4.1 项目结构

```
proto/
  agenthub/
    v1/
      hub.proto
      edge.proto
      runner.proto
buf.yaml
buf.gen.yaml
gen/
  go/   # 生成的 Go 代码
  ts/   # 生成的 TypeScript 代码
```

#### 4.2 buf.yaml（模块定义）

```yaml
version: v2
modules:
  - path: proto
lint:
  use:
    - STANDARD
breaking:
  use:
    - FILE
```

#### 4.3 buf.gen.yaml（代码生成）

```yaml
version: v2
managed:
  enabled: true
  override:
    - file_option: go_package_prefix
      value: github.com/yourorg/agenthub/gen/go
plugins:
  # Go: 消息类型（依赖 connect-go）
  - remote: buf.build/protocolbuffers/go:v1.36.11
    out: gen/go
    opt:
      - paths=source_relative
  # Go: Connect 服务存根
  - remote: buf.build/connectrpc/go:v1.19.2
    out: gen/go
    opt:
      - paths=source_relative
  # TypeScript: 消息类型 + Connect 服务（合一）
  - remote: buf.build/bufbuild/es:v2.5.1
    out: gen/ts
    opt:
      - target=ts
      - import_extension=js
```

#### 4.4 生成命令

```bash
# 依赖更新（如果有 deps）
buf dep update
# 代码生成
buf generate
# Lint 检查
buf lint
# 破坏性变更检查（在 CI 中运行）
buf breaking --against '.git#branch=main'
```

#### 4.5 CI 集成（GitHub Actions）

```yaml
name: Buf CI
on:
  pull_request:
    types: [opened, synchronize, reopened]
permissions:
  contents: read
  pull-requests: write
jobs:
  buf:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: bufbuild/buf-action@v1
        with:
          token: ${{ secrets.BUF_TOKEN }}
```

`buf-action@v1` 自动执行：build、lint、format、breaking change 检测、PR annotation。

#### 4.6 Connect-Go Server 生产级示例

```go
package main

import (
    "net/http"

    "connectrpc.com/connect"
    hubv1 "github.com/yourorg/agenthub/gen/go/agenthub/v1"
    "github.com/yourorg/agenthub/gen/go/agenthub/v1/hubv1connect"
    "golang.org/x/net/http2"
    "golang.org/x/net/http2/h2c"
)

type HubServer struct{}

func (s *HubServer) RegisterAgent(ctx context.Context, req *connect.Request[hubv1.RegisterAgentRequest]) (*connect.Response[hubv1.RegisterAgentResponse], error) {
    // 实现 ...
    return connect.NewResponse(&hubv1.RegisterAgentResponse{
        AgentId: "agent-123",
    }), nil
}

func main() {
    mux := http.NewServeMux()

    // 注册 Connect handler（支持 gRPC + gRPC-Web + Connect 三协议）
    path, handler := hubv1connect.NewHubServiceHandler(&HubServer{})
    mux.Handle(path, handler)

    // h2c: HTTP/2 Cleartext，同时支持 HTTP/1.1 + HTTP/2
    srv := &http.Server{
        Addr:    ":8080",
        Handler: h2c.NewHandler(mux, &http2.Server{}),
    }
    srv.ListenAndServe()
}
```

#### 4.7 前端 TypeScript 客户端

```typescript
import { createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { HubService } from "./gen/ts/agenthub/v1/hub_pb";

const transport = createConnectTransport({
  baseUrl: "http://localhost:8080",
});

const client = createClient(HubService, transport);
const res = await client.registerAgent({ name: "my-agent" });
```

### 关键库与版本

- `buf` CLI v1.54+ (via `github.com/bufbuild/buf/cmd/buf@latest`)
- `buf.build/protocolbuffers/go` v1.36.11 (Remote Plugin)
- `buf.build/connectrpc/go` v1.19.2 (Remote Plugin)
- `buf.build/bufbuild/es` v2.5.1 (Remote Plugin for TypeScript)
- `connectrpc.com/connect` v1.19.2 (Go runtime)
- `@connectrpc/connect` + `@connectrpc/connect-web` (TypeScript runtime)
- `golang.org/x/net/http2` (h2c support)

### 来源

- [Connect-Go 官方仓库](https://github.com/connectrpc/connect-go)
- [ConnectRPC 官方文档](https://connectrpc.com/)
- [Buf CI/CD with GitHub Actions](https://buf.build/docs/bsr/ci-cd/github-actions/)
- [bufbuild/buf-action 仓库](https://github.com/bufbuild/buf-action)
- [Buf Remote Plugins Usage Guide](https://buf.build/docs/bsr/remote-plugins/usage/)
- [ConnectRPC: Where is it now? (kmcd.dev 2026)](https://kmcd.dev/posts/connectrpc-where-is-it-now/)
- [ConnectRPC vs gRPC 实战对比 (Rafiul Alam)](https://alamrafiul.com/posts/connectrpc-vs-grpc/)
- [Connect Deployment Guide (h2c, CORS, timeouts)](https://connectrpc.com/docs/go/deployment/)

---

## 5. Claude Code / Codex 最新动态

### 5.1 Claude Code Agent SDK

#### 当前状态（2026 年 5 月）

**Claude Agent SDK 已全面 GA**，提供 Python 和 TypeScript 两个版本。

| 项目 | 版本 | 安装方式 |
|------|------|---------|
| TypeScript SDK | `@anthropic-ai/claude-agent-sdk` v0.3.x (npm) | `npm install @anthropic-ai/claude-agent-sdk` |
| Python SDK | `claude-agent-sdk` v0.1.x (PyPI) | `pip install claude-agent-sdk` |

**核心 API**：

```typescript
// TypeScript SDK
import { query } from "@anthropic-ai/claude-agent-sdk";

for await (const message of query({
    prompt: "Find and fix the bug in auth.py",
    options: {
        allowedTools: ["Read", "Edit", "Bash"],
        model: "claude-opus-4-7",
    }
})) {
    console.log(message);
}
```

```python
# Python SDK
from claude_agent_sdk import query, ClaudeAgentOptions

async for message in query(
    prompt="Find and fix the bug in auth.py",
    options=ClaudeAgentOptions(
        allowed_tools=["Read", "Edit", "Bash"],
        model="claude-opus-4-7",
    )
):
    print(message)
```

**关键新特性**：
- **Multi-agent / Subagents**：通过 `agents` 参数定义子 agent，父 agent 用 `Task` tool 分派任务
- **Session 持久化**：`resume` 参数恢复会话（跨多次调用保持上下文）
- **MCP Server 集成**：通过 `mcpServers` 参数连接外部工具
- **Hooks**：在 agent loop 的特定阶段插入自定义逻辑（PreToolUse、PostToolUse 等）
- **Headless Mode**：`claude -p "prompt"` 在 CI/CD 中无交互运行，支持 `--output-format json`
- **OAuth Token**：`claude setup-token` 可使用 Pro/Max 订阅免 API 费用运行 headless

**AgentHub 可用的集成点**：
- AgentHub 的 Hub/Edge/Runner 可通过 Agent SDK 调用 Claude 进行代码生成、审查
- Runner 执行环境可用 Agent SDK 驱动 Claude 作为"内部大脑"
- SDK 的 MCP 集成能力可对接 AgentHub 自己的工具系统

**V2 Session API（已移除）**：之前的 `unstable_v2_createSession()` 已从 SDK 中移除，现统一使用 `query()` + `resume` 模式。

#### 相关项目

| 项目 | 说明 |
|------|------|
| Claude Managed Agents | 托管 agent 运行时（2026-04-08 公测），通过 REST API 创建/管理 agent session，带沙箱 |
| `ant` CLI | Claude API 命令行客户端（2026-04-08 发布），支持 YAML 版本化 API resources |
| Claude Code API Gateway | 社区项目，将 Claude Code CLI 封装为 OpenAI-compatible API |

### 5.2 OpenAI Codex CLI 最新动态

#### 当前状态

**Codex CLI** 在快速迭代中，最新版本 **v0.132.0**（2026-05-18）。

| 渠道 | 版本/状态 |
|------|----------|
| Codex CLI | `npm install -g @openai/codex` (v0.132.0) |
| Codex App | macOS + Windows native app (26.429) |
| Codex IDE Extension | VS Code / Cursor / Windsurf |
| Codex Chrome Extension | 2026-05-07 发布，可跨标签页并行操作 |
| Codex Web | chatgpt.com/codex |

**关键特性**：
- 开源（Apache 2.0），95.6% Rust
- 支持本地模型（Ollama 集成）：`codex config set local_mode true`
- Python SDK：`pip install openai-codex-cli-bin`，可嵌入自定义工作流
- MCP 支持：连接外部系统
- 三种审批模式：read-only / auto / full-access
- 终端 UI 升级：更好的 tool call 和 diff 格式化
- Python SDK 支持跨平台（macOS, Linux, Windows, ARM64）

**适用场景对比**：

| 场景 | Claude Agent SDK | Codex CLI |
|------|-----------------|-----------|
| 本地 agentic coding | 强 | 强 |
| CI/CD 自动化 | `-p` headless mode | 脚本化调用 |
| 程序化嵌入 | Agent SDK (Python/TS) | Codex Python SDK + CLI subprocess |
| 离线/本地模型 | 不支持 | 支持 Ollama |
| 浏览器自动化 | MCP 集成 | Chrome Extension 原生支持 |

### 来源

- [Claude Agent SDK 官方文档](https://code.claude.com/docs/en/agent-sdk/overview)
- [Claude Agent SDK TypeScript API Reference](https://code.claude.com/docs/en/agent-sdk/typescript)
- [Claude Agent SDK Python (GitHub)](https://github.com/anthropics/claude-agent-sdk-python)
- [Claude Platform Release Notes (2026-05)](https://platform.claude.com/docs/en/release-notes/overview)
- [Claude Code Headless Mode + CI/CD](https://institute.sfeir.com/en/claude-code/claude-code-headless-mode-and-ci-cd/command-reference/)
- [OpenAI Codex CLI 仓库](https://github.com/openai/codex/releases)
- [OpenAI Codex Changelog](https://developers.openai.com/codex/changelog)
- [OpenAI Codex App 介绍](https://openai.com/index/introducing-the-codex-app/)
- [OpenAI Codex Review 2026 (Zack Proser)](https://zackproser.com/blog/openai-codex-review-2026)

---

## 汇总：AgentHub 技术栈推荐

| 层面 | 选择 | 库/版本 |
|------|------|---------|
| Desktop 框架 | Tauri 2 + Go sidecar | tauri v2.11 + Go 1.23+ |
| IPC 方式 | HTTP localhost (随机端口) | Go: `net/http` 绑定 `127.0.0.1:0` |
| 数据库 | SQLite (WAL 模式) | `modernc.org/sqlite` v1.35+ |
| 迁移工具 | golang-migrate + go:embed | `golang-migrate/migrate/v4` |
| 搜索 | FTS5 虚拟表 | SQLite 内置 FTS5 |
| WebSocket | coder/websocket | `github.com/coder/websocket` v1.8+ |
| 水平扩展 | Redis Pub/Sub | `go-redis/v9` |
| Protobuf 代码生成 | Buf Remote Plugins | Buf CLI v1.54+ |
| RPC 框架 | Connect-Go + Connect-ES | connectrpc.com/connect v1.19 |
| 前端 RPC 客户端 | Connect-Web + Protobuf-ES | `@connectrpc/connect-web` + `@bufbuild/protobuf` |
| CI Proto 检查 | Buf GitHub Action | `bufbuild/buf-action@v1` |
| Agent SDK (可选) | Claude Agent SDK | `@anthropic-ai/claude-agent-sdk` |
