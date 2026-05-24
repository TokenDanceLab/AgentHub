> 状态: 🔄 进行中 — M1 内存 bus 已实现，持久 EventStore 列入 M2

# AgentHub EventStore & Memory -- 最终设计

> 基于 8 仓库深度对比，为 AgentHub 持久化层提供最终决策。
> 前置阅读：kanna.md, claude-code-viewer.md, librechat.md, opcode.md, chatdev.md, openhands.md, flowise.md, design-go-services.md

---

## 1. Event Sourcing 模式对比

### 1.1 对比矩阵

| 仓库 | 事件存储方式 | 优点 | 缺点 | AgentHub 适合度 |
|------|------------|------|------|:---:|
| Kanna | 5 个 JSONL + 内存 Snapshot | 简单/可回放/writeChain 串行化 | 单机 | **9/10** |
| Claude Code Viewer | JSONL 唯一事实源 + SQLite FTS5 索引 | 可搜索/轻量/porter tokenizer | 无增量同步 | **8/10** |
| Opcode | SHA-256 + zstd + content_pool | 去重/压缩/内容寻址 | 复杂度高 | **7/10** (文件层) |
| LibreChat | MongoDB 全量存储 | 分布式 | 重依赖 | **3/10** |
| **AgentHub 方案** | **JSONL + content_pool + FTS5 混合** | **三者之长** | - | - |

### 1.2 各仓库深度分析

#### Kanna (src/server/event-store.ts)

**核心机制**：
```
writeChain: Promise<void>   -- 串行化所有写入，保证事件顺序
appendFile(path, payload)   -- 原子追加，不破坏已有数据
applyEvent(event)           -- 写入后立即更新内存 state
```

**JSONL 格式**：
```jsonl
{"v":2,"type":"project_opened","timestamp":1700000000000,"projectId":"uuid","localPath":"/path"}
{"v":2,"type":"chat_created","timestamp":1700000000001,"chatId":"uuid","projectId":"uuid"}
```

**Snapshot Compaction**：
- 触发条件：5 个 JSONL 文件总大小 >= 2MB
- 流程：createSnapshot() -> Bun.write(snapshot.json) -> 清空所有 JSONL
- 启动恢复：loadSnapshot() -> replayLogs() -> shouldCompact()

**Fork 实现**：
- 复制 transcript 到新 chat 的 `transcripts/<chatId>.jsonl`
- 设 `pendingForkSessionToken` 复用源 session
- SDK 原生 forkSession 参数

**对 AgentHub 价值**：JSONL + Snapshot + writeChain 模式可直接移植到 Go。单文件 append + 版本标记是正确方向。

#### Claude Code Viewer (src/server/core/search/)

**FTS5 模式**：
```sql
CREATE VIRTUAL TABLE session_messages_fts USING fts5(
    content,
    session_id UNINDEXED,
    content='messages',
    content_rowid='rowid',
    tokenize='porter unicode61'
);
```

**关键设计**：
- JSONL 仍是唯一事实源，FTS5 仅存索引
- BM25 排序，用户消息权重 1.2x
- `snippet()` 函数生成高亮摘要
- 外部内容表 + 触发器自动同步

**对 AgentHub 价值**：FTS5 作为 JSONL 的索引增强，不替代 JSONL。搜索是 AgentHub 的核心竞争力（跨 Thread/Turn 搜索）。

#### Opcode (src-tauri/src/checkpoint/)

**内容寻址存储**：
```
~/.claude/projects/{project_id}/.timelines/{session_id}/
├── files/
│   ├── content_pool/        # {sha256_hash} → zstd 压缩文件内容
│   └── refs/                # {checkpoint_id}/{safe_filename}.json → {path, hash}
```

**压缩**：zstd level 3，消息和文件内容均压缩

**垃圾回收**：
- 遍历所有 refs 收集被引用的 hash 集合
- 删除 content_pool 中未被引用的文件
- cleanup_old_checkpoints() 后自动触发

**对 AgentHub 价值**：content_pool 机制用于 checkpoint 的文件快照存储（不是 event 流）。去重 + 压缩在实际项目中节省大量空间。

#### LibreChat

**不适合的原因**：
- MongoDB 重依赖，AgentHub 用 SQLite (design-go-services.md 已决策)
- 全量存储模型与 AgentHub 的 Edge-local-first + Hub-sync 架构不符
- summarization reserveRatio 思想可借鉴，但存储方式不可复用

### 1.3 最终决策：AgentHub EventStore 混合方案

**方案概述**：Kanna JSONL（事件流）+ Opcode content_pool（文件快照）+ Claude Code Viewer FTS5（搜索索引）

**三层职责**：

```
Layer 1: JSONL Event Log（唯一事实源，append-only）
  ~/.agenthub/data/{project}/
    ├── events.jsonl              # 所有事件流（project/thread/turn/message）
    ├── snapshot.json.zst         # Compacted state snapshot（zstd 压缩）
    └── seq                       # 单调递增序列号（用于增量同步）

Layer 2: Content Pool（文件快照，内容寻址）
  ~/.agenthub-runtime/projects/{project}/.checkpoints/
    ├── content_pool/{sha256}     # zstd 压缩的文件内容
    └── refs/{checkpoint_id}/     # 引用 → {path, hash, is_deleted}

Layer 3: FTS5 Index（搜索加速，关联查询）
  ~/.agenthub/data/{project}/
    └── index.db                  # SQLite: FTS5 + metadata 表
```

**为什么不是纯 SQLite？**
- JSONL append-only 比 SQLite INSERT 更轻量、更可审计
- 多 Edge 同步时 JSONL 行级 diff 远比 SQL 表 diff 简单
- 历史 event 回放（replay）在 JSONL 上是线性扫描，在 SQL 表上需要复杂的时间排序
- 但 SQLite FTS5 的全文搜索能力极强，作为 JSONL 的读加速层是完美互补

---

## 2. Memory 系统对比

### 2.1 对比矩阵

| 仓库 | Memory 分层 | 存储方式 | 检索 |
|------|-----------|---------|------|
| ChatDev | 4 层 (Simple/File/Blackboard/Mem0) | JSON + FAISS + Embedding | Embedding + FTS |
| Flowise | Agent Memory | BaseCheckpointSaver (SQLite/Postgres/MySQL) | LangGraph Checkpoint |
| LibreChat | Conversation Memory | MongoDB + summary compaction | reserveRatio pruning |
| **AgentHub 方案** | **4 层 MD + FTS5** | Markdown 文件 + SQLite FTS5 索引 | FTS5 BM25 |

### 2.2 各仓库深度分析

#### ChatDev (entity/configs/node/memory.py)

**四层体系**：

| Store | 类 | 存储 | 检索 | 适用场景 |
|-------|-----|------|------|---------|
| `simple` | SimpleMemoryConfig | 单文件 JSON | 可选 embedding | 轻量 session 记忆 |
| `file` | FileMemoryConfig | 索引本地目录 | FAISS 向量 | 代码库语义检索 |
| `blackboard` | BlackboardMemoryConfig | JSON append-only | 按时间裁剪 | 多 Agent 共享上下文 |
| `mem0` | Mem0MemoryConfig | 云端托管 | Mem0 API | 长期跨 session 记忆 |

**Memory 生命周期**：
1. **Pre-Gen Retrieval**：thinking 阶段前检索
2. **Gen Stage Retrieval**：生成前检索，插入 conversation
3. **Post-Gen Retrieval**：生成后再次检索（reflection）
4. **Update**：执行后写入 (input, output)

**Agent 挂载**：
```yaml
memories:
  - name: code_index
    retrieve_stage: [gen]
    top_k: 3
    similarity_threshold: -1.0
    read: true
    write: true
```

**对 AgentHub 价值**：四层分级思想可直接复用。但 ChatDev 的 FAISS + embedding 管道对 AgentHub 过重 -- AgentHub 的 Memory 主要是 Markdown 文件的语义组织，FTS5 足够。

#### Flowise (nodes/memory/AgentMemory/AgentMemory.ts)

**BaseCheckpointSaver 接口**：
- LangGraph 的 Checkpoint 序列化协议
- 支持父子 Checkpoint 链，实现分支/回滚
- 三种后端：SQLite / PostgreSQL / MySQL

**关键数据模型**：
```typescript
CheckerTuple = { config, checkpoint, metadata, parentConfig }
```

**标记为 DEPRECATING**：Flowise 正在迁移记忆架构，AgentHub 应从起点设计稳定接口。

**对 AgentHub 价值**：LangGraph checkpoint pattern 用于 Agent 执行状态恢复（不止 Memory）。但 AgentHub 的 Memory 主要是项目知识管理，不需要 LangGraph 级别的细粒度 checkpoint。

#### LibreChat (packages/api/src/agents/run.ts)

**Summarization Engine**：
```typescript
effectiveMaxContextTokens = computeEffectiveMaxContextTokens(
    summarization.reserveRatio,      // 默认 0.05
    agent.baseContextTokens,
    agent.maxContextTokens,
);
```

**Context Pruning**：
- `calibrationRatio` -- 上次运行的 EMA 校准
- Token counter 实时跟踪
- 超出 maxContextTokens 触发自动摘要

**对 AgentHub 价值**：reserveRatio + EMA calibration 的 Context Compaction 模式值得借鉴。在 Context Builder 中用于历史消息裁剪。

### 2.3 最终决策：AgentHub Memory 四层模型

```
Layer 1: Global Memory（跨项目持久知识）
  ~/.agenthub/memory/
    ├── preferences/           # 用户偏好（语言/风格/工具链）
    │   ├── code-style.md
    │   └── tool-preference.md
    ├── conventions/           # 编码约定
    │   ├── go-patterns.md
    │   └── commit-format.md
    └── checklists/            # 可复用检查清单
        └── pre-commit.md

Layer 2: Project Memory（项目级上下文）
  {project}/.agenthub/
    ├── AGENTS.md              # 项目指令（唯一事实源）
    ├── memory/                # Markdown 记忆文件
    │   ├── architecture.md    # 架构决策记录
    │   ├── patterns.md        # 项目特有模式
    │   └── decisions.md       # 历史决策日志
    └── checklists/
        └── deploy.md

Layer 3: Agent Memory（Agent 实例记忆）
  {project}/.agenthub/agents/{agent-name}/
    ├── CLAUDE.md              # Agent 专属指令
    ├── skills/                # Agent Skills
    └── memory/                # Agent 特定记忆
        └── session-summary.md

Layer 4: Conversation Memory（会话上下文）
  ~/.agenthub/data/{project}/
    └── index.db               # SQLite
        ├── memory_entries     # 结构化记忆条目
        └── memory_fts         # FTS5 全文搜索
```

**为什么是 Markdown 文件 + SQLite FTS5 而非 embedding？**

1. **可读性**：Markdown 文件人可直接阅读/编辑，git 可 diff/merge
2. **FTS5 足够好**：porter tokenizer + BM25 对 Markdown 的知识检索精度不输 embedding
3. **同步简单**：Markdown 文件随项目 git clone；FTS5 索引本地重建
4. **ChatDev 简化版**：去掉 FAISS/embedding 管道（太重），去掉 Mem0（不引入外部服务），只保留 Simple + Blackboard 的思想映射到 Markdown 文件系统

---

## 3. EventStore 完整设计

### 3.1 目录结构

```
~/.agenthub/
├── data/
│   └── {project}/
│       ├── events.jsonl          # 事件日志（唯一事实源）
│       ├── snapshot.json.zst     # Compaction 快照（zstd 压缩）
│       ├── seq                    # 单调递增序列号
│       └── index.db              # FTS5 搜索 + metadata 表
└── memory/
    ├── preferences/
    ├── conventions/
    └── checklists/

{project}/.agenthub/
├── AGENTS.md
├── memory/
│   ├── architecture.md
│   ├── patterns.md
│   └── decisions.md
├── checklists/
└── agents/{agent-name}/
    ├── CLAUDE.md
    ├── skills/
    └── memory/
```

### 3.2 Event Schema

```go
// packages/eventstore/types.go

// Event 是所有事件的基类
type Event struct {
    Version   int    `json:"v"`            // 2
    Seq       int64  `json:"seq"`          // 单调递增序列号
    Type      string `json:"type"`         // 事件类型
    Timestamp int64  `json:"timestamp"`    // Unix 毫秒
    Payload   any    `json:"payload"`      // 类型特定数据
}

// 事件类型常量
const (
    EventProjectOpened    = "project_opened"
    EventThreadCreated    = "thread_created"
    EventTurnStarted      = "turn_started"
    EventMessageAppended  = "message_appended"
    EventTurnCompleted    = "turn_completed"
    EventThreadArchived   = "thread_archived"
    EventSnapshotCreated  = "snapshot_created"
)
```

### 3.3 Go 实现

```go
// packages/eventstore/store.go
package eventstore

import (
    "encoding/json"
    "os"
    "sync"
)

// Store 是 Event Sourcing 写端
type Store struct {
    mu         sync.Mutex
    dir        string
    logPath    string        // events.jsonl
    snapPath   string        // snapshot.json.zst
    seqPath    string        // seq
    seq        int64
    state      *StoreState   // 内存状态
    writeChain chan writeOp  // 串行化写入
}

// writeOp 是写入操作
type writeOp struct {
    event Event
    done  chan error
}

// NewStore 创建或恢复 EventStore
func NewStore(dir string) (*Store, error) {
    s := &Store{
        dir:        dir,
        logPath:    filepath.Join(dir, "events.jsonl"),
        snapPath:   filepath.Join(dir, "snapshot.json.zst"),
        seqPath:    filepath.Join(dir, "seq"),
        writeChain: make(chan writeOp, 1),
        state:      NewStoreState(),
    }

    // 1. 加载 snapshot
    if err := s.loadSnapshot(); err != nil && !os.IsNotExist(err) {
        return nil, err
    }

    // 2. 重放 JSONL 事件
    if err := s.replayLogs(); err != nil && !os.IsNotExist(err) {
        return nil, err
    }

    // 3. 读取当前序列号
    s.loadSeq()

    // 4. 启动写入协程
    go s.writeLoop()

    // 5. 检查是否需要 compact
    go s.compactIfNeeded()

    return s, nil
}

// writeLoop 串行化所有写入
func (s *Store) writeLoop() {
    for op := range s.writeChain {
        s.mu.Lock()
        s.seq++
        op.event.Seq = s.seq
        op.event.Timestamp = timeNowMs()

        // 写入 JSONL
        data, err := json.Marshal(op.event)
        if err != nil {
            s.mu.Unlock()
            op.done <- err
            continue
        }
        line := append(data, '\n')
        if _, err := s.logFile.Write(line); err != nil {
            s.mu.Unlock()
            op.done <- err
            continue
        }

        // 更新内存状态
        s.state.Apply(op.event)

        // 更新序列号
        s.saveSeq()

        s.mu.Unlock()
        op.done <- nil
    }
}

// Append 追加事件（异步）
func (s *Store) Append(eventType string, payload any) error {
    done := make(chan error, 1)
    s.writeChain <- writeOp{
        event: Event{V: 2, Type: eventType, Payload: payload},
        done:  done,
    }
    return <-done
}
```

### 3.4 Compaction 机制

```go
// Compaction 触发条件
const COMPACTION_THRESHOLD_BYTES = 2 * 1024 * 1024 // 2MB

func (s *Store) compactIfNeeded() {
    info, _ := os.Stat(s.logPath)
    if info.Size() < COMPACTION_THRESHOLD_BYTES {
        return
    }

    s.mu.Lock()
    defer s.mu.Unlock()

    // 1. 序列化当前 state
    snapshot := s.state.Serialize()
    snapshot.V = 2
    snapshot.GeneratedAt = timeNowMs()

    // 2. zstd 压缩写入
    data, _ := json.Marshal(snapshot)
    compressed := zstdCompress(data, 3)
    os.WriteFile(s.snapPath, compressed, 0644)

    // 3. 清空 JSONL
    os.Truncate(s.logPath, 0)

    // 4. 记录 compaction 事件（新 JSONL 首行）
    s.seq++
    s.Append(EventSnapshotCreated, SnapshotMeta{
        Seq:      s.seq,
        ByteSize: len(compressed),
    })
}
```

### 3.5 Incremental Sync（seq-based）

```go
// packages/sync-core/protocol.go

// SyncRequest 增量同步请求
type SyncRequest struct {
    ProjectID string `json:"project_id"`
    SinceSeq  int64  `json:"since_seq"`  // 上次同步的序列号
}

// SyncResponse 增量同步响应
type SyncResponse struct {
    Events    []Event `json:"events"`     // since_seq 之后的新事件
    LatestSeq int64   `json:"latest_seq"` // 最新序列号
    Compacted bool    `json:"compacted"`  // 是否发生了 compaction
    Snapshot  []byte  `json:"snapshot,omitempty"` // 如果 compacted，发送最新 snapshot
}

// Edge 端定期轮询 Hub 获取增量事件
// Hub 端从 sync_events 表按 cursor 查询 delta
```

### 3.6 FTS5 搜索层

```sql
-- ~/.agenthub/data/{project}/index.db

CREATE TABLE messages (
    id         INTEGER PRIMARY KEY,
    event_seq  INTEGER NOT NULL,     -- 对应的 JSONL seq
    thread_id  TEXT NOT NULL,
    turn_id    TEXT,
    sender_type TEXT NOT NULL,       -- user / agent / system
    content    TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE VIRTUAL TABLE messages_fts USING fts5(
    content,
    thread_id UNINDEXED,
    content='messages',
    content_rowid='rowid',
    tokenize='porter unicode61'
);

-- 触发器自动同步
CREATE TRIGGER messages_fts_ai AFTER INSERT ON messages BEGIN
    INSERT INTO messages_fts(rowid, content, thread_id)
    VALUES (new.rowid, new.content, new.thread_id);
END;
```

### 3.7 Snapshot 结构

```go
// SnapshotFile 是 JSONL compaction 的产物
type SnapshotFile struct {
    V             int              `json:"v"`              // 2
    GeneratedAt   int64            `json:"generated_at"`   // Unix 毫秒
    Seq           int64            `json:"seq"`            // compaction 时的序列号
    Projects      []ProjectRecord  `json:"projects"`
    Threads       []ThreadRecord   `json:"threads"`
    Turns         []TurnRecord     `json:"turns"`
    PendingTurns  []PendingTurn    `json:"pending_turns,omitempty"`
}

// StoreState 是内存状态的完整镜像
type StoreState struct {
    ProjectsByID   map[string]*ProjectRecord
    ThreadsByID    map[string]*ThreadRecord
    TurnsByID      map[string]*TurnRecord
    MessagesByTurn map[string][]*MessageRecord
}
```

---

## 4. Memory 完整设计

### 4.1 四层模型详细规格

#### Layer 1: Global Memory

```
~/.agenthub/memory/
├── preferences/
│   ├── code-style.md        # "Always use Go-style error handling..."
│   ├── tool-preference.md   # "Prefer sqlc over raw SQL..."
│   └── naming.md            # "Use kebab-case for directories..."
├── conventions/
│   ├── go-patterns.md       # Repository pattern, DI conventions
│   ├── commit-format.md     # Conventional Commits
│   └── testing.md           # Table-driven tests, go-cmp
└── checklists/
    ├── pre-commit.md        # go vet, golangci-lint, tests pass
    └── pre-deploy.md        # DB migration tested, config reviewed
```

**格式规范**：每个 `.md` 文件是独立的 Markdown 文档，含 frontmatter：

```markdown
---
category: preference
key: code-style
scope: global
updated: 2026-05-21T10:00:00Z
---

# Code Style

Always format Go code with `gofumpt`.
Use `any` instead of `interface{}`.
```

**同步策略**：Global Memory 随 AgentHub 配置同步（git-backed），不通过 EventStore。

#### Layer 2: Project Memory

```
{project}/.agenthub/
├── AGENTS.md                # 项目指令（CLAUDE.md compatible）
├── memory/
│   ├── architecture.md      # "This project uses hexagonal architecture..."
│   ├── patterns.md          # "All DB access goes through Repository interface..."
│   ├── decisions.md         # "2026-05-21: Chose modernc.org/sqlite over mattn/go-sqlite3..."
│   └── api-conventions.md   # "REST endpoints follow Google API design guide..."
└── checklists/
    ├── deploy.md            # Deploy checklist
    └── review.md            # Code review checklist
```

**AGENTS.md 格式**：兼容 Claude Code 的 CLAUDE.md 格式，增加 frontmatter：

```markdown
---
project: agenthub
version: 1
updated: 2026-05-21T10:00:00Z
---

# AgentHub Development

## Build
- `go build ./cmd/hub`
- `go test ./...`

## Architecture
- Hub: central server with SQLite
- Edge: local agents with sync
- Runner: agent CLI adapters
```

**同步策略**：Project Memory 随项目 git 仓库同步，`.agenthub/` 目录纳入版本管理。

#### Layer 3: Agent Memory

```
{project}/.agenthub/agents/{agent-name}/
├── CLAUDE.md                # Agent 专属指令
├── skills/                  # Agent Skills（可选）
│   └── SKILL.md
└── memory/
    ├── session-summary.md   # 上次 session 的 compacted 摘要
    └── patterns.md          # Agent 在项目中发现的模式
```

**Agent CLAUDE.md** 示例：

```markdown
---
agent: code-reviewer
parent: claude-code
model: claude-sonnet-4-5
updated: 2026-05-21T10:00:00Z
---

# Code Reviewer Agent

## Role
You are a senior Go code reviewer. Focus on:
1. Error handling completeness
2. Concurrency safety (mutex, channel usage)
3. Interface design (accept interfaces, return structs)

## Constraints
- Never modify code directly
- Always provide specific line references
- Suggest alternatives, not just criticisms
```

**同步策略**：Agent Memory 随项目 git 仓库同步。

#### Layer 4: Conversation Memory

存储在 SQLite `index.db` 中，是 EventStore 的 FTS5 索引层 + 结构化记忆表：

```sql
-- memory_entries 表存储提取出的结构化记忆
CREATE TABLE memory_entries (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id  TEXT NOT NULL,
    category    TEXT NOT NULL,       -- preference/convention/checklist/fact/decision
    key         TEXT,
    content     TEXT NOT NULL,
    source_turn TEXT,               -- 来源 Turn ID
    created_at  INTEGER NOT NULL,    -- Unix 毫秒
    updated_at  INTEGER NOT NULL
);
CREATE INDEX idx_memory_project ON memory_entries(project_id, category);

CREATE VIRTUAL TABLE memory_fts USING fts5(
    content,
    project_id UNINDEXED,
    category UNINDEXED,
    content='memory_entries',
    content_rowid='rowid',
    tokenize='porter unicode61'
);
```

### 4.2 Context Builder 规范

```go
// packages/memory-core/context_builder.go

// ContextSpec 定义需要构建上下文的参数
type ContextSpec struct {
    ThreadID          string   // 当前 Thread
    ProjectPath       string   // 项目路径（用于读取 .agenthub/）
    MaxTokens         int      // 最大 token 预算
    SummarizeEarlier  bool     // 是否压缩早期消息
    ReserveRatio      float64  // 预留比例（默认 0.05）
    IncludeMemories   []string // 要包含的 Memory 层 ["global", "project", "agent"]
}

// AssembledContext 是构建完成的上下文
type AssembledContext struct {
    SystemPrompt   string          // 组装后的 system prompt
    Messages       []Message       // 历史消息（可能被 compacted）
    ProjectFiles   []FileContext   // .agenthub/ 下的关键文件内容
    MemoryEntries  []MemoryEntry   // 检索到的 Memory 条目
    TokenCount     int             // 实际 token 数
    TruncatedFrom  int             // 被截断的起始消息索引
}

// ContextBuilder 构建完整上下文
type ContextBuilder interface {
    Build(ctx context.Context, spec ContextSpec) (*AssembledContext, error)
}
```

**构建流程**：

```
1. 加载 Global Memory（~/.agenthub/memory/ 下的 .md 文件）
   → 读取 preferences/ + conventions/ 中的文件
   → frontmatter 解析 category/key/scope
   → 拼接到 system prompt 的 "Global Preferences" 段

2. 加载 Project Memory（{project}/.agenthub/）
   → 读取 AGENTS.md → 作为 system prompt 核心
   → 读取 memory/*.md → 按 relevance 排序注入
   → 读取 checklists/*.md → 注入 "Checklists" 段

3. 加载 Agent Memory（{project}/.agenthub/agents/{agent-name}/）
   → 读取 CLAUDE.md → 覆盖/追加 Agent 专属指令
   → 读取 memory/session-summary.md → 注入 "Last Session Summary"

4. FTS5 检索 Conversation Memory
   → SELECT * FROM memory_fts WHERE memory_fts MATCH ? AND project_id = ?
   → BM25 排序，取 top_k = 5
   → snippet() 高亮 → 注入 "Relevant Context" 段

5. 加载历史消息
   → 从 messages 表按 thread_id + created_at 排序加载
   → 如果 SummarizeEarlier: 对早期消息做 compaction（前 N 条摘要替代原文）
   → calculateEffectiveMaxContextTokens(reserveRatio, maxTokens)
   → 超出则从最早消息开始截断

6. Token 计算
   → 粗略估算（Go 使用 tiktoken-go 或 4 char ≈ 1 token）
   → 确保总 token 数 <= maxContextTokens * (1 - reserveRatio)
```

### 4.3 Context Compaction 策略

借鉴 LibreChat 的 reserveRatio + EMA 校准模式：

```go
// computeEffectiveMaxContextTokens 计算有效的最大上下文 token 数
func computeEffectiveMaxContextTokens(reserveRatio float64, baseTokens, maxTokens int) int {
    effective := int(float64(maxTokens) * (1.0 - reserveRatio))
    if effective < baseTokens {
        return baseTokens // 至少保留 base
    }
    return effective
}

// CompactHistory 对历史消息做摘要压缩
func CompactHistory(messages []Message, keepRecent int, summarizer Summarizer) ([]Message, error) {
    if len(messages) <= keepRecent {
        return messages, nil
    }
    // 保留最近 keepRecent 条完整消息
    // 对 older 部分生成摘要（替代原文）
    older := messages[:len(messages)-keepRecent]
    summary, err := summarizer.Summarize(older)
    if err != nil {
        return nil, err
    }
    compacted := []Message{{
        SenderType: "system",
        Content:    fmt.Sprintf("[Conversation Summary]\n%s", summary),
    }}
    compacted = append(compacted, messages[len(messages)-keepRecent:]...)
    return compacted, nil
}
```

### 4.4 Memory 同步策略

```
Global Memory（~/.agenthub/memory/）
  ├── 同步方式：随 AgentHub 配置 git 仓库同步
  ├── 权限：用户全局 Shared
  └── 频率：用户手动 or git push/pull

Project Memory（{project}/.agenthub/）
  ├── 同步方式：随项目 git 仓库同步
  ├── 权限：项目 Collaborator Shared
  └── 频率：每次 git push/pull

Agent Memory（{project}/.agenthub/agents/{agent-name}/）
  ├── 同步方式：随项目 git 仓库同步
  ├── 权限：项目 Collaborator Shared
  └── 频率：每次 session 结束后 **自动写入** session-summary.md

Conversation Memory（SQLite index.db）
  ├── 同步方式：不直接同步数据库文件
  ├── 而是通过 EventStore seq-based 增量同步 events.jsonl
  ├── 接收端从 events 重建 FTS5 索引
  └── 频率：Edge ↔ Hub 增量同步（每次 run 结束 + 定期心跳）
```

---

## 5. Go 实现架构

### 5.1 包依赖关系

```
packages/
├── eventstore/      # EventStore 核心 + Snapshot Compaction
│   import: protocol/
├── memory-core/     # ContextBuilder + MemoryManager 接口
│   import: protocol/, eventstore/
└── protocol/        # 共享类型定义（Event, Message, Thread, Turn）
    import: stdlib only
```

### 5.2 EventStore 包接口

```go
// packages/eventstore/store.go

type Store struct { ... }

// 生命周期
func NewStore(dir string) (*Store, error)
func (s *Store) Close() error

// 写入（唯一的写入口）
func (s *Store) Append(eventType string, payload any) error

// 读取
func (s *Store) GetState() *StoreState
func (s *Store) GetThread(threadID string) (*ThreadRecord, error)
func (s *Store) GetMessages(threadID string) ([]*MessageRecord, error)
func (s *Store) GetEventsSince(seq int64) ([]Event, error)

// Compaction
func (s *Store) ShouldCompact() bool
func (s *Store) Compact() error

// Recovery
func (s *Store) loadSnapshot() error
func (s *Store) replayLogs() error
```

### 5.3 MemoryManager 包接口

```go
// packages/memory-core/manager.go

type MemoryManager struct {
    globalDir   string    // ~/.agenthub/memory/
    ftsDB       *sql.DB   // SQLite FTS5 连接
}

// 生命周期
func NewMemoryManager(globalDir string, ftsDB *sql.DB) *MemoryManager

// Memory 文件操作
func (m *MemoryManager) LoadGlobalMemory() ([]MemoryFile, error)
func (m *MemoryManager) LoadProjectMemory(projectPath string) ([]MemoryFile, error)
func (m *MemoryManager) LoadAgentMemory(projectPath, agentName string) ([]MemoryFile, error)

// Memory 检索
func (m *MemoryManager) SearchMemory(projectID, query string, limit int) ([]MemoryEntry, error)
func (m *MemoryManager) SaveMemoryEntry(projectID, category, key, content string) error

// Context Building
func (m *MemoryManager) BuildContext(ctx context.Context, spec ContextSpec) (*AssembledContext, error)
```

### 5.4 关键设计决策

| 决策 | 选择 | 依据 |
|------|------|------|
| Event Log 格式 | JSONL append-only | Kanna 验证可行，简单可审计，Go 实现容易 |
| File Compression | zstd level 3 | Opcode 验证有效，Go 有标准库 `github.com/klauspost/compress/zstd` |
| Search 索引 | SQLite FTS5 porter unicode61 | Claude Code Viewer 验证足够好，modernc.org/sqlite 纯 Go |
| Compaction 阈值 | 2MB | Kanna 确定的值，足够小保证低延迟，足够大避免频繁 compact |
| Memory 存储 | Markdown 文件系统 + FTS5 | ChatDev 简化版，可读可 git-diff，不需要 embedding |
| Incremental Sync | seq-based cursor | 简单可靠，比时间戳更精确，没有时钟偏移问题 |
| Content Addressing | SHA-256 + content_pool | Opcode 验证，文件快照去重的标准方案 |
| forkSession | 复制 transcript + pending token | Kanna 验证，SDK 原生 forkSession 支持 |
| Context Compaction | reserveRatio + EMA | LibreChat 验证，简单有效的 token 预算管理 |

---

## 6. 迁移路径

### Phase 1: EventStore (P0)
1. 实现 `packages/eventstore/` -- JSONL + writeChain + Snapshot
2. 实现 `packages/protocol/` -- Event/Thread/Turn/Message 类型
3. 验证：写入 10000 条 event -> 触发 compaction -> 重启恢复 -> 验证 state 一致

### Phase 2: FTS5 Index (P0)
1. 实现 SQLite `index.db` -- messages + messages_fts
2. 实现触发器自动同步 JSONL event -> FTS5
3. 实现 `SearchMessages()` / `SearchMemory()` Go 函数
4. 验证：插入消息 -> FTS5 MATCH 查询 -> snippet + BM25 排序正确

### Phase 3: Memory Layers (P1)
1. 实现 `~/.agenthub/memory/` 目录结构 + frontmatter 解析
2. 实现 `{project}/.agenthub/` 文件读取 + AGENTS.md 解析
3. 实现 `MemoryManager` + `ContextBuilder`
4. 验证：给定 ContextSpec -> AssembledContext 输出正确

### Phase 4: Incremental Sync (P1)
1. 实现 seq-based SyncRequest/SyncResponse 协议
2. 实现 Hub 端 delta 存储（sync_events 表）
3. 实现 Edge 端 Syncer 定期 poll + 增量应用
4. 验证：Edge offline 10 分钟后 reconnect，只拉取 delta events

### Phase 5: Content Pool (P2)
1. 实现 `ContentAddressedStorage` -- SHA-256 + zstd + content_pool
2. 集成到 Runner 的 CheckpointManager
3. 实现 GC（引用计数 -> 清理孤儿文件）
4. 验证：多个 checkpoint 共享相同文件内容时去重正确

---

## 附录：8 仓库调研贡献度矩阵

| 仓库 | EventStore 贡献 | Memory 贡献 | 可复用代码/模式 |
|------|:---:|:---:|------|
| **Kanna** | 核心（JSONL + Snapshot + writeChain） | - | writeChain, compaction, fork, replayLogs |
| **Claude Code Viewer** | FTS5 索引模式 | - | FTS5 external content, BM25, snippet() |
| **Opcode** | content_pool 文件存储 | - | SHA-256 + zstd + refs + GC |
| **LibreChat** | - | reserveRatio pruning | summarizationConfig, EMA calibration |
| **ChatDev** | - | 四层分级思想 | Memory lifecycle (Pre/Gen/Post/Update) |
| **OpenHands** | - | - | ABC 抽象模式（参考而非直接复用） |
| **Flowise** | - | BaseCheckpointSaver 接口 | LangGraph checkpoint pattern（执行状态，非 Memory） |
| **design-go-services** | 存储载体（SQLite） | FTS5 辅助函数 + Schema | messages_fts, memory_fts, SearchMessages, migrate |
