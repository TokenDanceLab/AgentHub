# mindfs Source Adoption Map → AgentHub

> 从 mindfs Go 源码到 AgentHub Edge Server 的精确映射。
> 每项: mindfs file:line → AgentHub file:line → 具体变更 → P0/P1/P2。

---

## 1. ACP Protocol Adapter：批量接入 14+ Agent

### 1.1 Protocol 枚举 → Adapter Registry

```
mindfs: server/internal/agent/protocol.go:4-25
  type Protocol string
  const (ProtocolACP / ProtocolClaudeSDK / ProtocolCodexSDK)
  func DefaultProtocol(agentName string) Protocol

AgentHub: edge-server/internal/adapters/registry.go:1-92
  type Registry struct { adapters map[string]AgentAdapter }
  func (r *Registry) Register(a AgentAdapter) error
```

**差异**: AgentHub 的 `Registry` 仅按 `adapterID` 注册 (claude-code/codex/opencode)，没有协议级别的路由抽象。mindfs 的 `Protocol` 枚举允许同一 CLI 走不同协议路径（如 Claude 走 SDK 直连，Gemini 走 ACP）。

**建议 P0**: 在 `Registry` 中引入 `Protocol` 路由层。AgentHub 当前每 agent 一个 `AgentAdapter` 实现，若要接入 14+ agent 需 14 个独立 adapter 实现。引入 ACP adapter（使用 `github.com/coder/acp-go-sdk`）后，一个 ACP adapter = 支持所有实现 ACP 的 agent CLI。

```go
// edge-server/internal/adapters/registry.go 新增
type Protocol string
const (
    ProtocolNative Protocol = "native"   // CLI-specific (claude-code, codex, opencode)
    ProtocolACP    Protocol = "acp"      // Agent Client Protocol (14+ agents)
)

type AdapterEntry struct {
    Adapter  AgentAdapter
    Protocol Protocol
}
```

### 1.2 Pool Session → ProcessExecutor

```
mindfs: server/internal/agent/pool.go:17-26
  type Pool struct {
      sessions map[string]*sessionEntry  // sessionKey → session
      acp      *acp.Runtime
      claude   *claude.Runtime
      codex    *codex.Runtime
  }

AgentHub: edge-server/internal/lifecycle/process_executor.go:32-42
  type ProcessExecutor struct {
      running map[string]context.CancelFunc  // runID → cancel
      stdins  map[string]io.Writer            // runID → stdin
  }
```

**差异**: mindfs 维护 `sessions map[string]*sessionEntry` 实现 session 缓存复用（GetOrCreate 双重检查锁定）。AgentHub 的 `ProcessExecutor` 仅维护 `running map[string]context.CancelFunc`（run 生命周期），无 session 缓存。每次 `Start()` 都创建新子进程。

**建议 P0**: 在 `ProcessExecutor` 中增加 session 缓存层。长连接场景下复用已有进程可减少子进程启动开销（ACP 模式下尤其必要——一个 ACP 进程承载多个 session）。

```go
// edge-server/internal/lifecycle/process_executor.go 新增
type sessionCache struct {
    mu       sync.Mutex
    sessions map[string]*cachedSession  // sessionKey → cached session
}
```

### 1.3 GetOrCreate 双重检查锁定

```
mindfs: server/internal/agent/pool.go:107-151
  Phase 1: p.mu.Lock() → 查缓存 → p.mu.Unlock() → return (快路径)
  Phase 2: 锁外 openSession() (慢: 启动子进程/创建 SDK client)
  Phase 3: p.mu.Lock() → 复查缓存 → 若已存在则关闭刚创建的 → return existing

AgentHub: edge-server/internal/lifecycle/process_executor.go
  无等价逻辑。Start() 直接创建子进程，不检查是否有可复用的运行中进程。
```

**建议 P1**: 对同 session 的并发 `Start()` 调用实现去重。场景：用户在 WebUI 快速点击两次"发送"，若无去重会导致两个子进程同时运行。

### 1.4 Session 接口 14 个方法 → AgentAdapter 5 个方法

```
mindfs: server/internal/agent/types/types.go:11-50
  type Session interface {
      SendMessage / AnswerQuestion / CurrentModel / SetModel /
      ListModels / SetMode / ListModes / ListCommands /
      CancelCurrentTurn / OnUpdate / SessionID / ContextWindow / Close
  }

AgentHub: edge-server/internal/adapters/adapter.go:23-43
  type AgentAdapter interface {
      Metadata / Capabilities / BuildCommand / ParseStream / NeedsStdin
  }
```

**差异**: mindfs 将能力发现 (`ListModels`/`ListModes`/`ListCommands`) 和运行时交互 (`SetModel`/`SetMode`) 提升到接口层。AgentHub 将这些全部推到 CLI 协议内部——`BuildCommand` 注入 `--model` 参数后适配器不再参与运行时模型切换。

**建议 P1**: 在 `AgentAdapter` 中增加 `RuntimeControls()` 方法返回能力集，用于前端动态显示模型/模式选择器。当前 AgentHub 前端硬编码了可用的 model 列表。

```go
// edge-server/internal/adapters/adapter.go 新增
type RuntimeCapabilities struct {
    AvailableModels  []string
    AvailableModes   []string
    CurrentModel     string
    SupportsSetModel bool
}
```

---

## 2. Delta Coalescing：文本增量缓冲

### 2.1 Claude 24 字节阈值 + 句边界

```
mindfs: server/internal/agent/claude/session.go:19,558-568
  const chunkFlushThreshold = 24
  func (s *session) appendDelta(kind deltaType, delta string) {
      pending.WriteString(delta)
      if pending.Len() >= chunkFlushThreshold ||
         strings.ContainsAny(delta, "\n.!?;:") {
          s.flushDelta(kind)
      }
  }

AgentHub: edge-server/internal/adapters/parser_ndjson.go
  NDJSON 解析器逐行读取并立即发射事件，无 buffering。
```

**差异**: AgentHub 的 `NDJSONStreamParser` 逐行读取 stream-json 输出，每行一个 JSON 消息（可能只含数字节 token）立即通过 EventEmitter 发射。每个 `conn.WriteJSON` 都有锁获取和序列化开销。

**建议 P1**: 在 `EventEmitter` 和 WebSocket 广播之间插入 delta buffer。24 字节阈值 + 句边界是高性价比的优化——减少约 75% 的 WebSocket 写入次数。

```go
// edge-server/internal/adapters/parser_ndjson.go 新增
type deltaBuffer struct {
    pending    strings.Builder
    threshold  int
    onFlush    func(string)
    punctuation map[rune]bool  // \n . ! ? ; :
}

func (b *deltaBuffer) Append(delta string) {
    b.pending.WriteString(delta)
    lastRune := rune(delta[len(delta)-1])
    if b.pending.Len() >= b.threshold || b.punctuation[lastRune] {
        b.onFlush(b.pending.String())
        b.pending.Reset()
    }
}
```

### 2.2 Codex String Diffing 策略

```
mindfs: server/internal/agent/codex/session.go:526-533
  func messageDelta(prev, next string) string {
      if strings.HasPrefix(next, prev) { return next[len(prev):] }
      return next  // 编辑修正 → 全量
  }

AgentHub: edge-server/internal/adapters/codex.go:44-80
  BuildCommand 使用 --json 批量模式，一次返回完整结果，无流式增量。
```

**建议 P2**: 当 `CodexAdapter` 升级到 Phase 2 app-server 流式模式时，优先采用 mindfs 的 string diffing 策略而非 per-event 发射。

---

## 3. Stream Hub Replay → Event Bus History

### 3.1 pendingSessions + replayStates

```
mindfs: server/internal/api/stream_hub.go:17-27,354-371
  type StreamHub struct {
      pendingSessions map[string]*SessionPendingState  // session → pending events
      replayStates    map[string]*ClientReplayState     // client → replay progress
      completed       map[string]*CompletedSessionState  // 2-min completed cache
  }

AgentHub: edge-server/internal/events/bus.go:29-36
  type Bus struct {
      history []EventEnvelope  // maxHistory cap
      subs    []subscriber     // fan-out to all
  }
```

**差异**: mindfs 的 replay 是 per-session + per-client 的细粒度追踪（每个 client 有自己的 `ReplayIndex`）。AgentHub 的 `Bus.history` 是全局单调递增序列，subscriber 通过 cursor 追赶。

**建议 P1**: 将 `Bus.history` 从全局序列拆分为 per-session 作用域。全局序列在 session 销毁后历史也丢失，per-session 历史可精准服务于 session 重连场景。

### 3.2 completed map 补发 session.done

```
mindfs: server/internal/api/stream_hub.go:226-263,689-702
  completed map 缓存 2 分钟内的已结束 session。
  ReplayPending 在切换到 live 后检查 completed，
  若 session 已结束则补发 session.done 事件。

AgentHub: 无等价物。session 结束后客户端无重连途径。
```

**建议 P1**: 在 `Bus` 中新增 `completed` map，缓存最近 N 分钟内结束的 session 的最终状态事件。实现与 mindfs 相同的 2 分钟 TTL + 自动过期清理。

---

## 4. Turn Queue 防竞态

```
mindfs: server/internal/agent/claude/session.go:162-193
  func (s *session) SendMessage(ctx context.Context, content string) error {
      s.sendMu.Lock()          // 串行 SendMessage
      waiter := make(chan error, 1)
      s.enqueueTurn(waiter)    // FIFO 入队
      s.stream.Send(...)       // 发送
      select {
      case err := <-waiter:    // 阻塞等 ResultMessage
      case <-turnCtx.Done():   // context 取消安全
      }
  }

AgentHub: edge-server/internal/lifecycle/process_executor.go
  Start() 仅创建子进程并立即返回 error。无 SendMessage 级别的串行化。
```

**差异**: AgentHub 没有显式的 turn 队列。多次 `Start()` 调用可能创建多个并行的子进程。

**建议 P1**: 为每个 active session 新增 `SendMessage` 串行化锁。防止同一 session 的并发消息导致子进程 stdout 交错。

```go
// edge-server/internal/lifecycle/process_executor.go 新增
type runEntry struct {
    cancel  context.CancelFunc
    stdin   io.Writer
    sendMu  sync.Mutex    // 串行化 SendMessage
}
```

---

## 5. Config 4 层合并策略

```
mindfs: server/internal/agent/config.go:55-80,121-143
  优先级: ENV 变量 > 工作目录 agents.json > ~/.mindfs/agents.json > 安装目录 > 内置默认
  合并: 用户配置覆盖同名 agent；新增的追加到列表末尾

AgentHub: edge-server/internal/lifecycle/process_executor.go:32-42
  ProcessExecutorConfig 由调用方整体传入，无分层合并逻辑。
```

**建议 P2**: 在 hub-server 配置加载逻辑中引入分层合并。允许用户级配置 (`~/.agenthub/agents.json`) 覆盖安装默认。

---

## 6. Per-Connection Write Lock

```
mindfs: server/internal/api/stream_hub.go:474-517
  connLocks map[*websocket.Conn]*sync.Mutex
  getConnLock() 使用双重检查锁定分配 per-conn Mutex

AgentHub: edge-server/internal/events/bus.go:49-80
  Publish() 使用全局 Bus.mu sync.Mutex 保护，但 WebSocket 写入层的锁管理不在 Bus 内部。
```

**建议 P2**: 在 WebSocket broadcast 层引入 per-conn lock。多个 goroutine 向同一连接并发 WriteJSON 会损坏 WebSocket 帧。`gorilla/websocket` 明确文档不保证并发安全。

---

## 7. Stderr Hint Capture

```
mindfs: server/internal/agent/acp/process.go:800-927
  streamProcessStderr goroutine → 正则提取 "message" → 缓存 5min → cancel active prompt
  wrapPromptError 将 "signal: killed" 替换为 "API key invalid"

AgentHub: edge-server/internal/lifecycle/process_executor.go
  子进程 stderr 仅日志输出，不解析结构化错误信息。
```

**建议 P2**: 在 `ProcessExecutor` 的 stderr reader 中增加 JSON error hint 提取。使用简单正则 `"message"\s*:\s*"([^"]+)"` 提取错误消息，在健康检查失败时作为诊断信息返回。

---

## 8. External Session Import

```
mindfs: server/internal/agent/importers.go:15-46
  NewExternalSessionImporter(def Definition) → 按 Protocol 路由到具体 importer
  Claude: 文件系统扫描 ~/.claude/projects/<project>/*.jsonl
  Codex: 文件系统扫描 ~/.codex/sessions/*.jsonl
  ACP:   RPC 协议查询 UnstableListSessions

AgentHub: 无等价物。Edge Server 不导入已有 CLI session 历史。
```

**建议 P2**: 在 hub-server 中新增 session 导入 API。优先实现 Claude 的文件系统扫描（JSONL 格式标准化，实现成本低），其次 Codex。ACP session 导入留待 ACP adapter 实现后跟进。

---

## 摘要：实现优先级

| # | 发现 | 优先级 | 涉及 AgentHub 文件 |
|---|------|--------|-------------------|
| 1 | ACP Protocol adapter 批量接入 | **P0** | `adapters/registry.go`, `adapters/adapter.go` |
| 2 | Session 缓存复用 (GetOrCreate) | **P0** | `lifecycle/process_executor.go` |
| 3 | Delta coalescing 24 字节阈值 | **P1** | `adapters/parser_ndjson.go` |
| 4 | Stream Hub replay per-session | **P1** | `events/bus.go` |
| 5 | Turn Queue 串行化 SendMessage | **P1** | `lifecycle/process_executor.go` |
| 6 | Session 接口能力发现 | **P1** | `adapters/adapter.go` |
| 7 | Config 4 层合并 | **P2** | hub-server config 加载 |
| 8 | Per-connection write lock | **P2** | WebSocket broadcast 层 |
| 9 | Stderr hint capture | **P2** | `lifecycle/process_executor.go` |
| 10 | External session import | **P2** | hub-server `api/` |
