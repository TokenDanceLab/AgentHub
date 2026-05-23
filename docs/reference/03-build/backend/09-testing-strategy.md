> 状态: ✅ 已落地 — Go test/Vitest/Playwright/smoke 四层测试已覆盖 M1 核心链路

# AgentHub 测试策略

> 日期：2026-05-21
> 基于：design-go-services.md, cross-analysis-adapters.md, deep-dive-kanna-orchestrator-mapping.md, design-desktop-ux.md, scaffold-go-services.md
> 状态：Draft v1.0

---

## 0. 概述

### 0.1 五层测试金字塔

```
           ┌──────────────┐
           │  对抗测试     │  5-10 场景，每个发布运行
           │  （Agent）    │
          ┌┴──────────────┴┐
          │      E2E       │  15-25 场景，每个 PR merge 运行
          │  （Playwright） │
         ┌┴────────────────┴┐
         │    前端测试       │  60-100 测试，每次 commit 运行
         │  （Vitest + RTL） │
        ┌┴──────────────────┴┐
        │   Go 集成测试       │  40-60 测试，每次 commit 运行
        │  （真实 SQLite/WS） │
       ┌┴────────────────────┴┐
       │     Go 单元测试        │  120-180 测试，每次 commit 运行
       │  （table-driven, -race)│
       └──────────────────────┘
```

### 0.2 测试基础设施配置

根据 `scaffold-go-services.md` 和 `design-go-services.md` 附录 B：

**Go 测试工具链**（来自 go.mod）：
- Go 1.24 配合 `testing/synctest`（标准库测试时钟）
- `github.com/google/go-cmp v0.7.0` 用于基于 diff 的断言（不使用 testify）
- CI 中启用 `-race` 标志（`go test ./... -race -count=1`）

**CI 流水线**（来自 `.github/workflows/ci.yml`）：
- `lint` 作业：golangci-lint（errcheck, gosimple, govet, ineffassign, staticcheck, unused, revive）
- `test` 作业：`go test ./... -race -count=1`
- `build` 作业：编译 hub/edge/runner 二进制文件
- `buf-breaking` 作业：protobuf schema 兼容性检查

**前端测试工具链**：
- Vitest（快速，Vite 原生，Jest 兼容 API）
- @testing-library/react 用于组件测试
- @testing-library/user-event 用于交互模拟
- msw（Mock Service Worker）用于 HTTP mock，或 fetch-mock 用于 Edge API
- Playwright 用于 E2E（Chromium + Firefox，CI 中 headed 模式）

**测试目录约定**：
- Go：`*_test.go` 与源码同目录（标准 Go 模式）
- 前端：`__tests__/` 按功能划分，或 `*.test.tsx` 与源码同目录
- E2E：项目根目录下的 `e2e/`

---

## 1. Go 单元测试

### 1.1 protocol/ -- 类型序列化/反序列化

**目标包**：`packages/protocol/`

**测什么**——每个跨服务边界使用的生成类型必须具有往返 JSON 稳定性。`AgentEvent` 联合类型（11 个变体，来自 `cross-analysis-adapters.md` 第 2.2 节）是最高风险面。

| 测试文件 | 覆盖范围 | 关键技术 |
|---------|---------|---------|
| `protocol/agent_event_test.go` | 全部 11 个 `AgentEventType` 变体：`system_init`、`assistant_text`、`reasoning`、`tool_call`、`tool_result`、`tool_progress`、`result`、`stream_event`、`approval_request`、`approval_decision`、`status_change` | 表驱动往返：`json.Marshal` -> `json.Unmarshal` -> `go-cmp.Diff`。验证每个字段在周期中存活。 |
| `protocol/start_request_test.go` | `StartRequest` 全部 30 个字段（model, thinking, maxTokens, tools, MCPConfig, sandbox, forkFrom 等） | 测试零值 omitempty 行为。测试 `ProviderExtras map[string]any` 透传。 |
| `protocol/usage_info_test.go` | `UsageInfo`、`CostInfo`、`ResultPayload` 数值边界 | 边界情况：0 tokens, max int64, 负数（应拒绝）。 |
| `protocol/approval_types_test.go` | `ToolPermissionRequest`、`PermissionDecision`、`ApprovalRequestPayload` | 验证 `ToolInput` map[string]any 在嵌套 JSON（例如嵌套对象、数组）中存活。 |

**测试模式**（表驱动，无外部依赖）：

```go
func TestAgentEvent_RoundTrip(t *testing.T) {
    tests := []struct {
        name  string
        event AgentEvent
    }{
        {
            name: "system_init",
            event: AgentEvent{
                Type: EventSystemInit,
                Payload: SystemInitPayload{
                    Model: "claude-sonnet-4-6",
                    Tools: []ToolDef{{Name: "Bash", IsDestructive: true}},
                },
            },
        },
        // ... 全部 11 个变体
    }
    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            data, err := json.Marshal(tt.event)
            if err != nil {
                t.Fatalf("marshal: %v", err)
            }
            var got AgentEvent
            if err := json.Unmarshal(data, &got); err != nil {
                t.Fatalf("unmarshal: %v", err)
            }
            if diff := cmp.Diff(tt.event, got); diff != "" {
                t.Errorf("round-trip mismatch (-want +got):\n%s", diff)
            }
        })
    }
}
```

**Go 1.24 优势**：对时间相关字段（`Timestamp int64`）使用 `testing/synctest`：

```go
func TestAgentEvent_Timestamp(t *testing.T) {
    synctest.Test(t, func(t *testing.T) {
        // time.Now() 在 synctest 气泡中返回假时钟
        evt := AgentEvent{Timestamp: time.Now().UnixMilli()}
        // ...
    })
}
```

### 1.2 security/ -- PolicyEngine 23 项安全检查

**目标包**：`runner/internal/security/` 和 `edge/internal/security/`

**测什么**：两个安全模块各有不同的职责：

**A. `runner/internal/security/path_guard_test.go`** -- PathGuard（design-go-services.md 第 3.3 节）：

| 检查编号 | 测试场景 | 预期 |
|---------|--------|------|
| 1 | 路径在允许的根目录内 | `ValidatePath("/worktree/src/main.go")` -> nil |
| 2 | 路径穿越到根目录之上 | `ValidatePath("/worktree/../../etc/passwd")` -> error |
| 3 | 根目录外的绝对路径 | `ValidatePath("/etc/passwd")` -> error |
| 4 | 符号链接逃逸（如果符号链接存在） | 在 worktree 中创建指向外部的符号链接，验证解析 -> error |
| 5 | 空路径 | `ValidatePath("")` -> error |
| 6 | 相对路径正确解析 | `ValidatePath("src/../src/main.go")` -> 在根目录内解析 |
| 7 | 多个允许的根目录 | `ResolvePath(worktree, relative)` 选择正确的根目录 |
| 8 | Unicode 路径 | 对 CJK/非 ASCII 文件名验证有效 |
| 9 | NTFS 备用数据流（Windows） | `ValidatePath("file.txt:hidden")` -> error |
| 10 | 超长路径（>260 Windows, >4096 Linux） | 优雅处理，不 panic |

**B. `runner/internal/security/command_approval_test.go`** -- CommandApprovalPolicy：

| 检查编号 | 测试场景 | 预期 |
|---------|--------|------|
| 11 | 允许的命令精确匹配 | `"git status"` 带允许规则 `"git *"` -> 允许 |
| 12 | 拒绝命令覆盖允许 | `"rm -rf /"` 带拒绝规则 `"rm *"` -> 拒绝 |
| 13 | 空 allowRules（默认全部拒绝） | 任何命令 -> 拒绝 |
| 14 | 带管道的命令通过允许 | `"cat file | grep pattern"` -> 取决于第一个命令 |
| 15 | 通过分号的命令注入 | `"git status; rm -rf /"` -> 拒绝（第二个命令） |
| 16 | 通过反引号的命令注入 | `` "echo `cat /etc/passwd`" `` -> 拒绝 |
| 17 | 环境变量覆盖 | `"ENV=evil git pull"` -> 拒绝 |
| 18 | 参数中的 Shell 元字符 | `"echo $(whoami)"` -> 拒绝 |
| 19 | 允许的命令带安全参数 | `"git diff --cached"` -> 允许 |
| 20 | 空输入 | `ValidateCommand("")` -> error |
| 21 | 极长命令字符串 | 截断安全，不 OOM |
| 22 | 正则绕过尝试 | `"git\\nrm -rf /"` -> 拒绝（换行注入） |
| 23 | 用 && 链接的命令 | `"git status && curl evil.com"` -> 拒绝 |

**测试模式**：

```go
func TestCommandApprovalPolicy(t *testing.T) {
    policy := &CommandApprovalPolicy{
        allowRules: []CommandRule{
            {Pattern: "git *"},
            {Pattern: "go *"},
            {Pattern: "npm *"},
        },
        denyRules: []CommandRule{
            {Pattern: "rm *"},
            {Pattern: "sudo *"},
        },
    }
    tests := []struct {
        name    string
        command string
        want    bool // true = 允许
    }{
        {"git status allowed", "git status", true},
        {"git push allowed", "git push origin main", true},
        {"rm denied", "rm -rf /", false},
        {"sudo denied", "sudo systemctl restart", false},
        {"chained command denied", "git status && rm file", false},
        {"injection via semicolon", "git status; cat /etc/passwd", false},
        // ... 全部 23 项检查
    }
    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            got := policy.Validate(tt.command)
            if got.Allowed != tt.want {
                t.Errorf("Validate(%q) = %v, want %v", tt.command, got.Allowed, tt.want)
            }
        })
    }
}
```

**C. `edge/internal/security/security_test.go`** -- LocalAuthorizer：

| 检查编号 | 测试场景 |
|---------|--------|
| 1 | 用户可以访问自己的项目 |
| 2 | 用户不能访问其他用户的项目 |
| 3 | CanApprove 检查目标用户权限 |
| 4 | 空/空项目路径 |

### 1.3 store/ -- EventStore JSONL 读写 + Snapshot Compaction

**目标包**：`hub/internal/store/`、`edge/internal/store/`、`runner/internal/store/`

**测什么**：基于 Kanna JSONL 模式的事件溯源持久化（deep-dive-kanna-orchestrator-mapping.md 第 6 节）：

**A. JSONL 写入链序列化**（源自 Kanna `event-store.ts:616-623`）：

```go
// packages/protocol/eventstore_test.go
func TestEventStore_AppendOrder(t *testing.T) {
    // 生成 N 个 goroutine 并发追加事件
    // 验证 JSONL 文件具有严格单调的序列号
    // 无交错行、无损坏的 JSON
}
func TestEventStore_WriteChain(t *testing.T) {
    // 模拟 writeChain 序列化：
    // 即使在并发写入下，文件完整性也保持不变
}
```

**B. JSONL 读取重放**（源自 Kanna `event-store.ts:353-374`）：

| 测试场景 | 预期 |
|---------|------|
| 重放空日志 | 空切片，无错误 |
| 重放单个事件 | 所有字段精确匹配 |
| 重放 10000 个事件 | 所有事件恢复，顺序保留 |
| 重放有损坏行的日志（写入中途崩溃） | 跳过损坏行，记录警告，继续 |
| 重放有尾部换行符的日志 | 优雅处理 |
| 重放有空行的日志 | 跳过 |
| 多源重放并按时间戳排序 | 事件按正确时间戳顺序合并 |

**C. 快照压缩**（源自 Kanna `event-store.ts:1228-1238`）：

```go
func TestEventStore_SnapshotCompaction(t *testing.T) {
    // 1. 追加事件直到日志超过 2MB 阈值
    // 2. 验证 snapshot.json 已生成
    // 3. 验证原始 JSONL 已清除/截断
    // 4. 验证从 snapshot + 剩余 JSONL 重放产生相同状态
}
func TestEventStore_SnapshotOnly(t *testing.T) {
    // 从纯 snapshot（无 JSONL）重放——压缩后的常见情况
}
func TestEventStore_CompactionIdempotent(t *testing.T) {
    // 运行压缩两次产生相同的 snapshot
}
```

**D. 版本迁移**（源自 Kanna `event-store.ts:222-225`）：

```go
func TestEventStore_VersionMismatch(t *testing.T) {
    // 写入 v1 事件，用 v2 schema 打开
    // 验证迁移函数被调用
    // 或：带警告重置数据目录
}
```

### 1.4 memory/ -- ContextBuilder Token 预算

**目标包**：`edge/internal/context_builder/`

**测什么**：ContextBuilder 的核心职责是在 token 预算内组装上下文。来自 design-go-services.md 第 3.2 节的关键参数：

| 测试场景 | 关键参数 | 预期 |
|---------|--------|------|
| 空 Conversation | `MaxTokens=100000` | 仅 SystemPrompt，TokenCount <= 预算 |
| 短 Conversation 不超预算 | 5 条消息，总计 5000 tokens | 包含所有消息 |
| 长 Conversation 超出预算 | 200 条消息，`MaxTokens=10000` | 早期消息被摘要/截断 |
| 摘要边界 | `SummarizeEarlier=true` | 压缩边界之前的消息替换为摘要 |
| 包含 Memory 条目 | 项目有 10 条 Memory 条目 | Memory 条目被包含，计入 token 预算 |
| 包含项目文件 | `.agenthub/` 有 3 个文件 | 文件内容被包含，计入 |
| 零预算 | `MaxTokens=0` | 错误或最低限度（仅 system prompt） |
| 负预算 | `MaxTokens=-1` | 错误 |
| Token 计数准确性 | 已知字符串长度 | TokenCount 匹配 tiktoken/go 估算 |
| 设计中的 ReserveRatio | `reserveRatio=0.15` | 85% 用于消息，15% 保留给回复 |

```go
func TestContextBuilder_TokenBudget(t *testing.T) {
    tests := []struct {
        name          string
        spec          ContextSpec
        messages      []imcore.Message
        wantMaxTokens int // AssembledContext.TokenCount 的上界
    }{
        {
            name:          "fits within budget",
            spec:          ContextSpec{MaxTokens: 10000},
            messages:      generateMessages(5, 500), // 5 x 500 tokens each
            wantMaxTokens: 10000,
        },
        {
            name:          "exceeds budget with summarization",
            spec:          ContextSpec{MaxTokens: 1000, SummarizeEarlier: true},
            messages:      generateMessages(50, 500),
            wantMaxTokens: 1000,
        },
        // ...
    }
}
```

### 1.5 其他单元测试目标

**A. `packages/adapters/event_normalizer_test.go`** -- 事件规范化正确性（cross-analysis-adapters.md 第 4.1 节）：

对三个 Adapter 各自测试全部 14 个原生到统一的事件映射：
- `NormalizeCCEvent`：Claude Code NDJSON 行 -> AgentEvent（验证全部 13 种 CC 消息类型）
- `NormalizeCodexItem`：Codex RolloutItem -> AgentEvent（验证 TurnItem 类型）
- `NormalizeOpenCodeEvent`：OpenCode SSE -> AgentEvent（验证 16 LLMEvent -> 11 AgentEvent 映射）
- `NormalizeToolName`：`mcp__<server>__<tool>` 规范格式

**B. `packages/transport/local_test.go`** -- 本地传输编码/解码

**C. `packages/im-core/conversation_test.go`** -- Conversation 和 Message 模型验证

**D. `packages/checkpoint-core/content_addressed_test.go`** -- SHA-256 + zstd 存储往返

**E. `runner/internal/diff/differ_test.go`** -- 在临时仓库上测试 Git diff 解析和补丁应用

**F. `runner/internal/preview/port_allocator_test.go`** -- 5100-5199 范围内的端口分配，并发分配安全性

**G. `hub/internal/store/fts_test.go`** -- FTS5 查询构造器正确性（单元级别，无需数据库）

---

## 2. Go 集成测试

### 2.1 Runner + Edge 本地通信

**目标**：`runner/internal/executor/` + `edge/internal/runner_manager/`

**测什么**：Edge 的 RunnerManager 和 Runner 的 HTTP API 之间的端到端通信，使用真实运行的 Runner 进程。

```go
// runner/internal/executor/executor_integration_test.go
// Build tag: //go:build integration

func TestRunnerIntegration_StartAndStream(t *testing.T) {
    // 1. 在随机端口（127.0.0.1:0）上启动 Runner 服务器
    // 2. 用一个简单的 Claude Code 提示词 POST /runs："echo hello"
    // 3. 连接到 /runs/:id/stream（SSE）
    // 4. 验证：system_init 事件带着工具列表到达
    // 5. 验证：assistant_text 事件到达
    // 6. 验证：result 事件 is_error=false
    // 7. 验证：运行状态转换：starting -> running -> done
}

func TestRunnerIntegration_Cancel(t *testing.T) {
    // 1. 启动一个长时间运行的提示词（"sleep 30 && echo done"）
    // 2. 2 秒后，DELETE /runs/:id
    // 3. 验证运行状态 -> cancelled
    // 4. 验证子进程已终止（ProcessRegistry.KillAll）
}

func TestRunnerIntegration_MultiRunConcurrency(t *testing.T) {
    // 1. 启动 3 个并发运行
    // 2. 验证每个有独立的 session ID
    // 3. 验证输出流不交叉
    // 4. 取消一个，验证其他继续
}
```

**真实 CLI 依赖注意事项**：这些测试需要在测试运行器上安装 `claude`（或 mock echo 二进制文件）。CI 应安装一个测试夹具二进制文件，该文件发出有效 NDJSON 而不进行 API 调用：

```go
// testdata/fake-claude/main.go -- 一个最小的 NDJSON 发射器用于测试
func main() {
    fmt.Println(`{"type":"system_init","session_id":"test-1",...}`)
    fmt.Println(`{"type":"assistant","message":{"content":[{"type":"text","text":"Hello!"}]}}`)
    fmt.Println(`{"type":"result","subtype":"success","is_error":false}`)
}
```

### 2.2 SQLite FTS5 搜索

**目标**：`hub/internal/store/fts.go` + 真实 `modernc.org/sqlite`

**测什么**：使用 design-go-services.md 第 4.2 节中 FTS5 外部内容 + 触发器模式的全文搜索正确性。

```go
// hub/internal/store/fts_integration_test.go
// Build tag: //go:build integration

func TestFTS5_SearchMessages_Basic(t *testing.T) {
    db := openTestDB(t)
    defer db.Close()
    runMigrations(t, db)

    // 种子数据：插入 100 条已知内容的消息
    seedMessages(t, db, []seedMessage{
        {Content: "implement OAuth2 login flow", ConvID: "c1"},
        {Content: "fix SQL injection in user endpoint", ConvID: "c1"},
        {Content: "add unit tests for auth module", ConvID: "c2"},
        // ...
    })

    // 测试：搜索 "OAuth2"
    results := SearchMessages(ctx, db, "c1", "OAuth2", 10)
    // 验证：1 条结果，摘要包含 <mark>OAuth2</mark>
}

func TestFTS5_SearchMessages_Ranking(t *testing.T) {
    // 插入不同词频的文档
    // 验证 BM25 排序：高频词排名更高
    // 验证 snippet() 函数返回正确的上下文窗口
}

func TestFTS5_TriggerSync(t *testing.T) {
    // INSERT 一条消息 -> 验证它立即出现在 FTS5 中
    // UPDATE 一条消息 -> 验证旧内容已删除，新内容已索引
    // DELETE 一条消息 -> 验证它已从 FTS5 中删除
}

func TestFTS5_SearchMemory_CrossProject(t *testing.T) {
    // 跨 3 个项目种子 Memory 条目
    // 仅搜索项目 A -> 仅返回项目 A 的结果
    // 验证 FTS5 content_rowid 正确链接到 memory_entries
}

func TestFTS5_PorterStemming(t *testing.T) {
    // 搜索 "running" -> 匹配 "run", "runner", "running"
    // 搜索 "tests" -> 匹配 "test", "testing", "tests"
}

func TestFTS5_Unicode(t *testing.T) {
    // 搜索 CJK 字符
    // 搜索 emoji
    // 搜索混合脚本
}
```

**测试数据库设置**：

```go
func openTestDB(t *testing.T) *sql.DB {
    t.Helper()
    db, err := sql.Open("sqlite", ":memory:?_journal_mode=WAL")
    if err != nil {
        t.Fatalf("open test db: %v", err)
    }
    return db
}
```

### 2.3 WebSocket Hub 多客户端广播

**目标**：`hub/internal/wsgateway/hub.go`

**测什么**：WSHub 基于 Room 的广播模型，使用 `coder/websocket` 的真实 WebSocket 连接。

```go
// hub/internal/wsgateway/hub_integration_test.go
// Build tag: //go:build integration

func TestWSHub_JoinAndBroadcast(t *testing.T) {
    hub := NewHub()
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()
    go hub.Run(ctx)

    // 1. 用 hub.Upgrade handler 启动测试 HTTP 服务器
    srv := httptest.NewServer(hub.Upgrade("conv:test-1", noopAuth))
    defer srv.Close()

    // 2. 连接 3 个客户端
    clients := connectClients(t, srv.URL, 3)

    // 3. 客户端 1 发送消息
    sendJSON(t, clients[0], `{"type":"chat","text":"hello"}`)

    // 4. 验证：客户端 2 和 3 收到它（BroadcastExcept 排除发送者）
    msg2 := recvJSON(t, clients[1])
    msg3 := recvJSON(t, clients[2])
    assert.Equal(t, `{"type":"chat","text":"hello"}`, msg2)
    assert.Equal(t, `{"type":"chat","text":"hello"}`, msg3)

    // 5. 验证：客户端 1 不收到自己的消息
    assertNoMessage(t, clients[0], 500*time.Millisecond)
}

func TestWSHub_MultipleRoomsIsolation(t *testing.T) {
    // 客户端 A 在 room "conv:1"，客户端 B 在 room "conv:2"
    // 向 room "conv:1" 广播 -> 仅客户端 A 收到
}

func TestWSHub_ClientDisconnect(t *testing.T) {
    // 1. 加入 2 个客户端到 room
    // 2. 断开客户端 1
    // 3. 客户端计数 == 1
    // 4. 广播 -> 仅客户端 2 收到
}

func TestWSHub_RoomCleanup(t *testing.T) {
    // 1. 加入 1 个客户端到 room
    // 2. 断开客户端
    // 3. Room 计数 -> 0（room 从 map 中删除）
}

func TestWSHub_SendQueueFull(t *testing.T) {
    // 1. 创建 SendCh 容量为 1 的客户端
    // 2. 不读取地填满 channel
    // 3. 下一次写入 -> 客户端被注销（反压）
}

func TestWSHub_BroadcastExcept(t *testing.T) {
    // 1. Room 中有 3 个客户端
    // 2. BroadcastExcept 排除 ID = client2
    // 3. client1 和 client3 收到，client2 不收到
}

func TestWSHub_ConcurrentJoin(t *testing.T) {
    // 1. 生成 50 个 goroutine 并发加入 room
    // 2. 带 -race 运行
    // 3. 最终客户端计数 == 50
    // 4. 所有客户端收到广播
}
```

### 2.4 其他集成测试目标

**A. `edge/internal/hub_client/ws_client_test.go`** -- Edge 到 Hub 的 WebSocket 重连（带指数退避）

**B. `edge/internal/sync_client/syncer_test.go`** -- Edge 和 Hub 之间基于游标的增量同步

**C. `edge/internal/local_ws/gateway_test.go`** -- Desktop UI WebSocket 事件推送

**D. `runner/internal/workspace/git_worktree_test.go`** -- 在临时 git 仓库上测试真实 git worktree create/diff/apply/discard

**E. `runner/internal/checkpoint/manager_test.go`** -- 在临时 worktree 上测试 Checkpoint create/restore/fork/Diff

**F. 数据库迁移集成测试** -- 在真实 SQLite 上测试 `scripts/migrate.go`，验证所有迁移 SQL 有效

### 2.5 集成测试 Build Tags 与 CI

```go
//go:build integration

package wsgateway_test

// 集成测试使用真实网络、真实文件系统、真实数据库。
// 从 `go test ./...`（单元测试运行）中排除。
// 单独运行：`go test -tags=integration ./...`
```

CI 工作流补充：

```yaml
# .github/workflows/ci.yml（额外作业）
integration-test:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-go@v5
      with: { go-version: '1.24' }
    - run: go test -tags=integration ./... -count=1 -timeout 120s
```

---

## 3. 前端测试

### 3.1 React 组件渲染（Vitest + Testing Library）

**测试基础设施**（`apps/web/vitest.config.ts`）：

```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
  },
})
```

**组件测试目标**（源自 `design-desktop-ux.md` 第 1 节的组件树）：

| 组件 | 测试文件 | 测什么 |
|------|--------|--------|
| `MessageTree` | `MessageTree.test.tsx` | 按正确树顺序渲染消息。兄弟导航（SiblingSwitch）。虚拟化（1000+ 消息）。 |
| `MessageNode` | `MessageNode.test.tsx` | AuthorityStripe 颜色（蓝=Hub, 绿=Edge, 橙=Hybrid）。渐进披露 L0-L4。 |
| `ThinkingBlock` | `ThinkingBlock.test.tsx` | 默认折叠。切换展开/折叠。内容渲染为 Markdown。 |
| `ToolUseCard` | `ToolUseCard.test.tsx` | 默认折叠（仅标题）。展开显示 ToolParams + ToolResult。不同结果类型（Read/Write/Edit/Bash/Task）。 |
| `DiffCard` | `DiffCard.test.tsx` | 状态机：pending -> applying -> applied -> discarded。5s 窗口内 Undo。 |
| `ApprovalCard` | `ApprovalCard.test.tsx` | 渲染工具详情。Approve/ApproveOnce/Deny 按钮。自动拒绝计时器倒计时。 |
| `ComposeArea` | `ComposeArea.test.tsx` | 文本输入。@mention popover（模糊过滤）。Shift+Enter 换行 vs Enter 发送。空时 SendButton 禁用。运行中 StopButton 可见。 |
| `RightPanel` | `RightPanel.test.tsx` | Tab 切换（Files/Diff/Preview/Git/Logs/Terminal）。面板调整大小。 |
| `DiffPanel` | `DiffPanel.test.tsx` | Unified vs split view。文件列表渲染。Hunk 显示（added/deleted/context 行）。AgentDiffSource 标签。 |
| `MobileDrawer` | `MobileDrawer.test.tsx` | 打开/关闭动画。点击背景关闭。滑动手势。 |
| `MobileBottomSheet` | `MobileBottomSheet.test.tsx` | 拖拽手柄交互。高度调整。Sheet 中 Tab 切换。 |
| `Sidebar` | `Sidebar.test.tsx` | ProjectTree 渲染。ThreadCard（标题、元信息、RunIndicator）。SearchBar 带 FTS5 结果。ArchivedSection。 |
| `ChatHeader` | `ChatHeader.test.tsx` | 可编辑 Thread 标题。AgentSelector 下拉。ExecutionBadge。WorkspaceIndicator（分支 + git 状态）。 |
| `ForkDialog` | `ForkDialog.test.tsx` | 四种 ForkMode 单选按钮。Create Fork 按钮。 |

**测试模式**：

```tsx
// src/components/chat/MessageNode.test.tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect } from 'vitest'
import { MessageNode } from './MessageNode'

describe('MessageNode', () => {
  it('renders user message text', () => {
    render(<MessageNode message={mockUserMessage} />)
    expect(screen.getByText('Hello Claude!')).toBeInTheDocument()
  })

  it('renders authority stripe with correct color', () => {
    const { container } = render(
      <MessageNode message={mockEdgeMessage} authority="edge" />
    )
    const stripe = container.querySelector('[data-authority-stripe]')
    expect(stripe).toHaveClass('border-l-green-500')
  })

  it('collapses thinking block by default', () => {
    render(<MessageNode message={mockMessageWithThinking} />)
    expect(screen.queryByText('Thinking content...')).not.toBeVisible()
    expect(screen.getByText(/Thinking/)).toBeInTheDocument() // toggle button
  })

  it('expands thinking block on toggle click', async () => {
    const user = userEvent.setup()
    render(<MessageNode message={mockMessageWithThinking} />)
    await user.click(screen.getByText(/Thinking/))
    expect(screen.getByText('Thinking content...')).toBeVisible()
  })

  it('expands tool use card on click', async () => {
    const user = userEvent.setup()
    render(<MessageNode message={mockMessageWithToolUse} />)
    await user.click(screen.getByText('Read'))
    expect(screen.getByText('src/main.go')).toBeVisible()
  })

  it('navigates siblings with SiblingSwitch', async () => {
    const user = userEvent.setup()
    const onSiblingChange = vi.fn()
    render(
      <MessageNode
        message={mockMessageWithSiblings}
        siblingCount={3}
        siblingPosition={1}
        onSiblingChange={onSiblingChange}
      />
    )
    await user.click(screen.getByLabelText('Next sibling'))
    expect(onSiblingChange).toHaveBeenCalledWith(2)
  })
})
```

### 3.2 WebSocket Mock + 消息流测试

**目标**：`apps/web/src/hooks/useWebSocket.test.ts` 和 store 集成

**测什么**：来自 design-desktop-ux.md 第 2.3 节的完整 WS 事件 -> store action -> React 重渲染流水线。

```tsx
// src/hooks/useWebSocket.test.ts
import { renderHook, act } from '@testing-library/react'
import { WS } from 'vitest-websocket-mock' // 或自定义 mock

describe('useWebSocket -> Store Integration', () => {
  let server: WS

  beforeEach(() => {
    server = new WS('ws://127.0.0.1:3210/ws')
  })

  afterEach(() => {
    server.close()
  })

  it('message.created -> threadStore.appendMessage', async () => {
    const { result } = renderHook(() => useThreadStore())
    server.send(JSON.stringify({
      type: 'message.created',
      payload: { id: 'msg-1', threadId: 't1', content: 'Hello' }
    }))
    await waitFor(() => {
      expect(result.current.messageCache.get('msg-1')).toBeDefined()
    })
  })

  it('message.streaming -> 累积内容更新', async () => {
    server.send(JSON.stringify({
      type: 'message.streaming',
      payload: { messageId: 'msg-2', delta: 'Hel' }
    }))
    server.send(JSON.stringify({
      type: 'message.streaming',
      payload: { messageId: 'msg-2', delta: 'lo' }
    }))
    await waitFor(() => {
      expect(result.current.streamingContent.get('msg-2')).toBe('Hello')
    })
  })

  it('run.status_changed -> runStore.updateRunStatus', async () => {
    server.send(JSON.stringify({
      type: 'run.status_changed',
      payload: { runId: 'r1', status: 'running' }
    }))
    // ... 验证 store 更新
  })

  it('permission.requested -> approvalStore.addApprovalRequest', async () => {
    server.send(JSON.stringify({
      type: 'permission.requested',
      payload: { id: 'apr-1', toolName: 'Bash', command: 'rm -rf /' }
    }))
    // ... 验证审批卡片出现
  })

  it('带指数退避的重连', async () => {
    server.close()
    // ... 验证 connectionStore.status = 'disconnected'
    // ... 验证带延迟的重连尝试
  })
})
```

**Edge API mock**（用于基于 REST 的操作）：

```ts
// src/test/mocks/edge-api.ts
import { http, HttpResponse } from 'msw'

export const edgeHandlers = [
  http.get('/api/projects', () => {
    return HttpResponse.json([{ id: 'p1', name: 'AgentHub', rootPath: '/code/agenthub' }])
  }),
  http.get('/api/threads/:id/messages', ({ params }) => {
    return HttpResponse.json(mockMessages[params.id] || [])
  }),
  http.post('/api/threads/:id/messages', async ({ request }) => {
    const body = await request.json()
    return HttpResponse.json({ id: 'msg-new', ...body }, { status: 201 })
  }),
]
```

### 3.3 Zustand Store 状态转换测试

**目标**：来自 design-desktop-ux.md 第 2 节的全部 10 个 Zustand stores。

**测什么**：纯 store 逻辑（无 React 渲染），快速且确定。

**A. `threadStore`** -- 复杂度最高（因消息树）：

```ts
// src/stores/threadStore.test.ts
import { useThreadStore } from './threadStore'

describe('threadStore', () => {
  beforeEach(() => {
    useThreadStore.setState(useThreadStore.getInitialState())
  })

  it('buildMessageTree 构造正确的树', () => {
    const store = useThreadStore.getState()
    // 种子数据：5 条带 parent_id 关系的消息
    store.messageCache = new Map([
      ['m1', { id: 'm1', parentId: null, content: 'root' }],
      ['m2', { id: 'm2', parentId: 'm1', content: 'child1' }],
      ['m3', { id: 'm3', parentId: 'm1', content: 'child2' }], // m2 的兄弟
      ['m4', { id: 'm4', parentId: 'm2', content: 'grandchild' }],
    ])

    const tree = store.buildMessageTree('t1')
    expect(tree.children).toHaveLength(1) // m1
    expect(tree.children[0].children).toHaveLength(2) // m2, m3（兄弟）
    expect(tree.children[0].children[0].children).toHaveLength(1) // m4
  })

  it('forkThread 以正确模式创建新 Thread', async () => {
    // Mock API
    // 测试全部 4 种 ForkMode 值：DIRECT_PATH, INCLUDE_BRANCHES, TARGET_LEVEL, DEFAULT
  })

  it('createSibling 在正确位置添加兄弟', async () => {
    // 在节点 m2（有兄弟 m3）处创建兄弟
    // 验证：m2 的父节点现在有 3 个子节点
  })

  it('navigateSibling 在边界处回绕', () => {
    const store = useThreadStore.getState()
    store.setSiblingPosition('node-1', 0) // 3 个中的第一个
    store.navigateSibling('node-1', 'prev')
    expect(store.siblingPosition.get('node-1')).toBe(2) // 回绕到最后
    store.navigateSibling('node-1', 'next')
    expect(store.siblingPosition.get('node-1')).toBe(0) // 回到第一个
  })

  it('updateStreamingMessage 累积增量', () => {
    const store = useThreadStore.getState()
    store.streamingContent.set('msg-stream', 'Hel')
    store.updateStreamingMessage('t1', 'msg-stream', 'lo World', false)
    expect(store.streamingContent.get('msg-stream')).toBe('Hello World')
  })

  it('updateStreamingMessage 在完成时标记已结束', () => {
    const store = useThreadStore.getState()
    store.streamingContent.set('msg-stream', 'Done')
    store.updateStreamingMessage('t1', 'msg-stream', '', true)
    // streamingContent 条目已删除，messageCache 更新为最终内容
    expect(store.streamingContent.has('msg-stream')).toBe(false)
  })
})
```

**B. `runStore`** -- 运行生命周期：

```ts
// src/stores/runStore.test.ts
describe('runStore', () => {
  it('startRun 将状态设为 starting', async () => { /* ... */ })
  it('completeRun 将状态设为 completed，填充 result', async () => { /* ... */ })
  it('failRun 将状态设为 failed，填充 error', async () => { /* ... */ })
  it('stopRun 将状态设为 cancelled', async () => { /* ... */ })
  it('runStatusByThread 将 Thread 映射到当前运行', () => { /* ... */ })
  it('每个 Thread 仅一个活动运行', async () => {
    // 尝试在同一 Thread 上启动第二个运行（一个正在运行中）
    // 预期错误：Thread 已有活动运行
  })
})
```

**C. `diffStore`** -- diff 和 git 状态机：

```ts
// src/stores/diffStore.test.ts
describe('diffStore', () => {
  it('loadDiff 用 hunks 填充文件', async () => { /* ... */ })
  it('toggleFileSelection 从 selectedFiles 添加/移除', () => { /* ... */ })
  it('addComment 附加到正确的文件和行', () => { /* ... */ })
  it('带选中文件的 commit 调用 API', async () => { /* ... */ })
  it('generateCommitMessage 使用 AI 并设置 generatedMessage', async () => { /* ... */ })
  it('selectAllFiles 选择所有变更文件', () => { /* ... */ })
})
```

**D. `approvalStore`** -- 权限状态：

```ts
// src/stores/approvalStore.test.ts
describe('approvalStore', () => {
  it('addApprovalRequest 添加到 pending', () => { /* ... */ })
  it('approve 从 pending 移除，添加到 history', async () => { /* ... */ })
  it('deny with reason 记录到 history', async () => { /* ... */ })
  it('approveOnce 启用单次使用，之后恢复', async () => { /* ... */ })
  it('到期自动拒绝', async () => {
    // 将假时钟拨到 expiresAt 之后
    // 验证 pending 为空，history 中有 auto-denied 条目
  })
})
```

**E. `uiStore`** -- 布局和响应式行为：

```ts
// src/stores/uiStore.test.ts
describe('uiStore', () => {
  it('setIsMobile(true) 触发布局变更', () => { /* ... */ })
  it('sidebarWidth 钳制在 200-420 之间', () => { /* ... */ })
  it('rightPanelWidth 钳制在 280-600 之间', () => { /* ... */ })
  it('setView 在 welcome/chat/settings 之间切换', () => { /* ... */ })
  it('toggleSidebar 切换 sidebarOpen', () => { /* ... */ })
})
```

**F. `previewStore`** -- artifact 和版本管理：

```ts
// src/stores/previewStore.test.ts
describe('previewStore', () => {
  it('openArtifact 加载内容和版本', async () => { /* ... */ })
  it('setActiveVersion 切换内容', () => { /* ... */ })
  it('setActiveTab 在 code/preview/split 之间切换', () => { /* ... */ })
  it('compareAgents 返回并排对比结果', async () => { /* ... */ })
})
```

**G. `connectionStore`** -- WS 连接状态：

```ts
// src/stores/connectionStore.test.ts
describe('connectionStore', () => {
  it('初始状态为 disconnected', () => { /* ... */ })
  it('connectEdge 转换为 connecting -> connected', () => { /* ... */ })
  it('recordError 设置 lastError 和 status 为 error', () => { /* ... */ })
  it('incrementReconnect 追踪尝试次数', () => { /* ... */ })
  it('resetReconnect 成功连接后重置为 0', () => { /* ... */ })
  it('setWsLatency 更新 ping/pong 时间', () => { /* ... */ })
})
```

**H. `searchStore`** -- FTS5 搜索状态：

```ts
// src/stores/searchStore.test.ts
describe('searchStore', () => {
  it('search 用片段填充结果', async () => { /* ... */ })
  it('setFilter 按项目范围过滤', () => { /* ... */ })
  it('clearSearch 重置查询和结果', () => { /* ... */ })
  it('结果按 BM25 评分排序', () => { /* ... */ })
})
```

**I. `projectStore`** -- 项目加载：

```ts
// src/stores/projectStore.test.ts
describe('projectStore', () => {
  it('loadProjects 从 Edge API 获取', async () => { /* ... */ })
  it('openProject 设置 activeProjectId', () => { /* ... */ })
  it('createProject 调用 POST /api/projects', async () => { /* ... */ })
  it('refreshWorkspaceStatus 更新 git 状态', async () => { /* ... */ })
})
```

**J. `pluginStore`** -- 插件注册表：

```ts
// src/stores/pluginStore.test.ts
describe('pluginStore', () => {
  it('loadManifests 扫描 plugins 目录', async () => { /* ... */ })
  it('loadPlugin 动态导入模块', async () => { /* ... */ })
  it('enablePlugin 设置 enabled=true', async () => { /* ... */ })
  it('pluginTabs 按 slot="tab" 过滤', () => { /* ... */ })
  it('installPlugin 从 git URL 安装', async () => { /* ... */ })
})
```

---

## 4. E2E 测试

### 4.1 Playwright 配置

```ts
// e2e/playwright.config.ts
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 60000,
  expect: { timeout: 10000 },
  fullyParallel: true,
  retries: 1,
  reporter: [['html'], ['list']],
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'mobile',
      use: { ...devices['iPhone 14'], viewport: { width: 375, height: 812 } },
    },
    {
      name: 'tablet',
      use: { ...devices['iPad Pro'], viewport: { width: 768, height: 1024 } },
    },
  ],
  webServer: [
    {
      command: 'go run ./services/edge/cmd/main.go',
      port: 3210,
      reuseExistingServer: true,
    },
    {
      command: 'pnpm --dir apps/web dev',
      port: 3000,
      reuseExistingServer: true,
    },
  ],
})
```

### 4.2 E2E 场景目录

#### 关键路径 1：完整 Agent 执行 + Diff 流程

**测试**：`e2e/agent-execution.spec.ts`

```
场景：用户发送提示词，Agent 回复，应用代码变更，用户审查 diff

  1. 打开应用，选择项目 "demo-project"
  2. 验证：Sidebar 显示 Thread 列表
  3. 点击 "New Thread" 按钮
  4. 验证：中央空聊天出现，ComposeArea 获得焦点

  5. 输入："@ClaudeCode write a function to calculate fibonacci in Go"
  6. 按 Enter

  7. 验证：用户消息出现在聊天中（乐观渲染）
  8. 验证：RunIndicator spinner 出现在 sidebar thread card 中
  9. 验证：SendButton 被 StopButton 替换

  10. 等待："system_init" 消息（工具列表出现在调试面板中）
  11. 等待：assistant text 消息出现（流式光标动画）
  12. 等待：ToolUseCard 出现（Read 或 Write 工具）
  13. 验证：ToolUseCard 显示工具名称和参数摘要

  14. 等待："result" 消息（运行完成）
  15. 验证：StopButton 被 SendButton 替换
  16. 验证：RunIndicator 显示绿色对勾然后消失

  17. 验证：DiffCard 出现在消息中（如果 Agent 修改了文件）
  18. 点击 DiffCard 中的 "View Full Diff"
  19. 验证：RightPanel 打开并显示 Diff tab
  20. 验证：新增行绿色，删除行红色

  21. 在 DiffPanel 中点击 "Apply"
  22. 验证："Applied" 确认，带 Undo 按钮
  23. 点击 "Undo"
  24. 验证：变更已恢复

  Mobile 变体（768px）：
  25. 设置 viewport 为 768x1024
  26. 验证：Sidebar 折叠（drawer 隐藏）
  27. 点击汉堡菜单
  28. 验证：MobileDrawer 从左侧滑入
  29. 验证：RightPanel 是带拖拽手柄的 bottom sheet
```

#### 关键路径 2：审批流程

**测试**：`e2e/approval-flow.spec.ts`

```
场景：Agent 请求权限，用户通过/拒绝

  1. 启动新 Thread
  2. 发送："@ClaudeCode delete all temp files"
  3. 等待：ApprovalCard 出现在聊天中
  4. 验证：ApprovalCard 显示工具名称 "Bash" 和命令详情
  5. 验证：自动拒绝倒计时器可见（5 分钟）

  6. 点击 "Approve Once"
  7. 验证：ApprovalCard 消失
  8. 验证：工具使用继续，tool_result 出现

  拒绝变体：
  9. 发送："@ClaudeCode rm -rf /tmp/*"
  10. 等待：ApprovalCard
  11. 点击 "Deny"
  12. 验证：工具调用显示 "Denied" 状态
  13. 验证：Agent 在下一条消息中确认拒绝
```

#### 关键路径 3：Thread Fork

**测试**：`e2e/fork-flow.spec.ts`

```
场景：用户在特定消息处分叉 Thread

  1. 打开有 10+ 条消息的现有 Thread
  2. 右键点击消息 #5
  3. 验证：ContextMenu 出现，有 "Fork Here" 选项
  4. 点击 "Fork Here"
  5. 验证：ForkDialog 打开，有模式选择器
  6. 选择 "DIRECT_PATH" 单选按钮
  7. 点击 "Create Fork"
  8. 验证：新 Thread 出现在同一项目下的 Sidebar 中
  9. 验证：Fork 来源横幅："Forked from Thread A / Message #5"
  10. 验证：仅显示从根到 #5 的消息
  11. 验证：ComposeArea 准备好接受新提示词
```

#### 关键路径 4：全局搜索

**测试**：`e2e/search-flow.spec.ts`

```
场景：用户跨所有 Conversation 搜索

  1. 按 Ctrl+K
  2. 验证：GlobalSearchDialog 打开，输入自动获得焦点
  3. 输入 "auth login"
  4. 验证：去抖后结果出现（带高亮片段）
  5. 验证：结果包含项目名称、Thread 标题、时间戳
  6. 点击第一条结果
  7. 验证：导航到目标 Thread，滚动到匹配的消息
  8. 验证：消息正文中匹配文本上有搜索高亮
```

#### 关键路径 5：RightPanel Tab 导航

**测试**：`e2e/right-panel.spec.ts`

```
场景：用户在 Files/Diff/Preview/Git/Logs/Terminal tab 之间切换

  1. 点击 Files tab -> FileTreePanel 渲染带目录树的文件面板
  2. 点击 Diff tab -> DiffPanel 渲染带文件列表的 diff 面板
  3. 点击 Preview tab -> PreviewPanel 渲染带 code/preview/split tabs
  4. 点击 Git tab -> GitPanel 渲染带 Changes/History/Branches 视图
  5. 点击 Logs tab -> LogsPanel 渲染带日志流
  6. 点击 Terminal tab -> TerminalPanel 渲染带 xterm 容器
```

#### 关键路径 6：多 Agent 群聊（P1+）

**测试**：`e2e/group-chat.spec.ts`

```
场景：用户在群组中与多个 Agent 对话

  1. 打开有 @ClaudeCode 和 @Codex 的群聊 Conversation
  2. 发送："Both of you: review this function"
  3. 验证：两个 Agent 都回复
  4. 验证：Claude 的回复带有 Authority 标签 [Edge:us1]
  5. 验证：Codex 的回复带有 Authority 标签 [Edge:us1]
```

### 4.3 Mobile 768px 断点测试

**测试**：`e2e/mobile.spec.ts`

```
场景：在 768px 断点处布局变换

  1. 设置 viewport 为 800x600（高于断点）
  2. 验证：三栏布局（sidebar + center + right panel）

  3. 调整大小为 700x600（低于断点）
  4. 验证：单栏布局（仅中央聊天）
  5. 验证：Sidebar 隐藏，ChatHeader 中汉堡菜单可见
  6. 验证：RightPanel 隐藏，底部 tab 栏

  7. 点击汉堡菜单
  8. 验证：MobileDrawer 从左侧滑入，背景模糊
  9. 点击背景
  10. 验证：Drawer 关闭

  11. 点击底部栏中的 RightPanel tab 图标
  12. 验证：MobileBottomSheet 从底部滑上来
  13. 验证：Sheet 顶部可见拖拽手柄
  14. 在手柄上向下滑超过 35% 阈值
  15. 验证：Bottom sheet 关闭

  iOS 键盘测试（iPhone 14 viewport）：
  16. 点击 ComposeArea textarea
  17. 验证：ComposeArea 保持在键盘上方（visualViewport）
  18. 输入消息并发送
  19. 验证：键盘收起，聊天滚动到底部
```

### 4.4 E2E 测试辅助函数

```ts
// e2e/helpers.ts
import { Page, expect } from '@playwright/test'

export async function startNewThread(page: Page, projectName: string) {
  await page.click(`text=${projectName}`)
  await page.click('[data-testid="new-thread-button"]')
  await expect(page.locator('[data-testid="compose-area"]')).toBeVisible()
}

export async function sendMessage(page: Page, text: string) {
  const textarea = page.locator('[data-testid="compose-textarea"]')
  await textarea.fill(text)
  await page.keyboard.press('Enter')
}

export async function waitForRunComplete(page: Page, timeout = 30000) {
  await page.waitForSelector('[data-testid="send-button"]', { timeout })
}

export async function waitForMessageContaining(page: Page, text: string, timeout = 30000) {
  await page.waitForSelector(`[data-testid="message-body"]:has-text("${text}")`, { timeout })
}
```

---

## 5. Agent 对抗测试

AgentHub 独有的测试维度：**Claude Code 产出输出；Codex 审查它；人类做最终决定。**

### 5.1 测试架构

```
┌──────────────────────────────────────────────────────────┐
│                 对抗测试 Harness                           │
│                                                           │
│  ┌───────────┐    ┌───────────┐    ┌───────────┐         │
│  │ 生产者      │    │ 审查者      │    │ 仲裁者      │        │
│  │ （Claude    │───>│ （Codex）   │───>│ （人类或     │        │
│  │  Code）     │    │            │    │  规则集）    │        │
│  └───────────┘    └───────────┘    └───────────┘         │
│       │                │                  │               │
│       ▼                ▼                  ▼               │
│  ┌───────────────────────────────────────────────────┐   │
│  │              结果收集器                              │   │
│  │  - Accepted（被审查者接受）                          │   │
│  │  - Rejected（带原因）                                │   │
│  │  - Modified（经人类仲裁修改）                         │   │
│  │  - Regressions（审查者是否漏掉了什么）                │   │
│  └───────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────┘
```

### 5.2 测试场景

每个场景走完整流水线：生产者生成 -> 审查者评价 -> 人类/规则集仲裁。每个场景收集指标。

#### 代码生成场景

| # | 场景 | 生产者任务 | 审查者任务 | 预期审查发现 |
|---|------|----------|----------|------------|
| 1 | **安全：SQL 注入** | "编写一个 Go 函数按 email 从数据库查询用户" | "审查此代码的 SQL 注入漏洞" | 应标记字符串拼接 SQL，建议参数化查询 |
| 2 | **安全：路径穿越** | "编写一个函数读取用户提供的文件名对应的文件" | "审查此代码的路径穿越漏洞" | 应标记缺失路径清理，建议使用 PathGuard |
| 3 | **错误处理** | "编写一个读取配置、连接数据库并返回用户计数的函数" | "审查此代码的错误处理" | 应标记未包装的错误、缺失 nil 检查、panic 倾向代码 |
| 4 | **并发** | "编写一个支持并发读写的缓存" | "审查竞态条件" | 应标记未同步的 map 访问，建议使用 sync.RWMutex |
| 5 | **资源泄露** | "编写一个读取目录中所有文件并处理它们的函数" | "审查资源泄露" | 应标记未关闭的文件句柄、缺失 defer close |
| 6 | **性能** | "编写一个在大型字符串切片中查找重复项的函数" | "审查性能问题" | 应标记 O(n^2) 算法，建议使用基于 map 的 O(n) 方法 |
| 7 | **API 设计** | "为用户 CRUD 操作设计 REST API handler" | "审查 API 设计" | 应标记缺失输入验证、不一致的错误响应、缺失分页 |
| 8 | **测试质量** | "为 user service 编写单元测试" | "审查测试覆盖和质量" | 应标记缺失边界情况、过度 mock、无表驱动测试 |
| 9 | **风格一致性** | "按照项目模式实现设备注册流程" | "审查与现有代码的风格一致性" | 应标记命名约定违规、缺失接口合规 |
| 10 | **文档** | "编写一个带文档的公开函数" | "审查文档完整性" | 应标记缺失 Go doc 注释、不清晰的参数描述 |

#### Diff 审查场景

| # | 场景 | 生产者任务 | 审查者任务 | 预期决策 |
|---|------|----------|----------|---------|
| 11 | **低风险变更** | "在认证流程中添加一条日志语句" | "审查此 diff" | 接受（低风险，装饰性） |
| 12 | **高风险变更** | "重构权限检查逻辑" | "审查此 diff" | 请求人类审查（涉及安全路径） |
| 13 | **破坏性变更** | "将公开 API 端点从 /users 重命名为 /accounts" | "审查此 diff" | 拒绝（无迁移的破坏性 API 变更） |
| 14 | **不完整变更** | "实现登录但跳过错误处理" | "审查此 diff" | 拒绝（不完整，缺失错误路径） |
| 15 | **无关变更** | "修复登录 bug，同时也重构数据库层" | "审查此 diff" | 请求拆分（一个 diff 中包含无关变更） |

### 5.3 自动化架构

```go
// test/adversarial/harness_test.go
// Build tag: //go:build adversarial

func TestAdversarial_RunScenario(t *testing.T) {
    tests := []AdversarialScenario{
        {
            Name: "SQL 注入检测",
            ProducerPrompt: "编写一个 Go 函数 QueryUserByEmail(db *sql.DB, email string) (*User, error) 按 email 查询 users 表",
            ReviewerPrompt: "审查此代码的安全漏洞，特别是 SQL 注入",
            ExpectedFinding: SecurityFinding{
                Severity: "high",
                Type:     "sql_injection",
                MustContain: []string{"parameterized", "placeholders", "sql injection"},
            },
        },
        // ... 全部 15 个场景
    }

    for _, tt := range tests {
        t.Run(tt.Name, func(t *testing.T) {
            // 阶段 1：生产者生成代码
            producerResult := runAgent(t, "claude-code", tt.ProducerPrompt)

            // 阶段 2：审查者审查代码
            reviewResult := runAgent(t, "codex",
                fmt.Sprintf("%s\n\nHere is the code to review:\n```go\n%s\n```",
                    tt.ReviewerPrompt, producerResult.Code))

            // 阶段 3：评估审查质量
            score := evaluateReview(t, reviewResult, tt.ExpectedFinding)

            // 记录结果供人类分析
            t.Logf("Producer output: %s", producerResult.Code)
            t.Logf("Reviewer output: %s", reviewResult.Content)
            t.Logf("Review score: %d/100", score)

            // 最低门槛：审查者必须标记高严重程度问题
            if tt.ExpectedFinding.Severity == "high" && score < 50 {
                t.Errorf("Reviewer failed to detect high-severity issue: score=%d", score)
            }
        })
    }
}
```

### 5.4 人类在回路中的工作流

对于自动化评估不足的场景（代码质量、设计决策），harness 生成一份**决策报告**供人类审查：

```markdown
## 对抗测试报告 — 2026-05-21

### 场景：SQL 注入检测
- **生产者（Claude Code）**：用原始字符串格式化生成了 `QueryUserByEmail`
- **审查者（Codex）**：标记了 SQL 注入，建议 `db.Query("SELECT ... WHERE email = ?", email)`
- **自动评分**：90/100（正确识别 + 正确修复）

### 场景：API 设计审查
- **生产者（Claude Code）**：设计了不一致错误形态的 REST 端点
- **审查者（Codex）**：标记了不一致，建议统一的 `{"error": {"code": "...", "message": "..."}}`
- **自动评分**：N/A（需要人类设计判断）
- **操作**：[ ] 接受生产者  [ ] 接受审查者  [ ] 混合方案：___
```

### 5.5 CI 集成

对抗测试对每次 commit 的 CI 来说太昂贵。调度：

```yaml
# .github/workflows/adversarial.yml
name: Adversarial Test Suite
on:
  schedule:
    - cron: '0 6 * * 1,4'  # 周一和周四早上 6 点
  workflow_dispatch:         # 手动触发

jobs:
  adversarial:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with: { go-version: '1.24' }
      - name: 安装 Agent CLI
        run: |
          npm install -g @anthropic-ai/claude-code
          # codex install（可用时）
      - name: 运行对抗测试
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: go test -tags=adversarial ./test/adversarial/... -v -timeout 25m
```

### 5.6 对抗测试指标面板

随时间追踪：

| 指标 | 目标 | 测量方式 |
|------|------|---------|
| 问题检测率 | 高严重程度 >90% | （正确标记数）/（已知问题总数） |
| 误报率 | <10% | （错误标记数）/（总标记数） |
| 审查质量评分 | >70/100 | 加权：检测（40%）+ 修复质量（30%）+ 解释清晰度（30%） |
| 生产者通过率（变更被审查者接受） | 60-80% | （接受数）/（总产出数） |
| 人类覆盖比率 | <10% | （人类修改数）/（总决策数） |

---

## 6. 测试执行与 CI 流水线汇总

### 6.1 CI 作业矩阵

| 作业 | 触发 | 命令 | 超时 |
|------|------|------|------|
| `lint` | 每次 push/PR | `golangci-lint run ./...` | 5min |
| `go-test` | 每次 push/PR | `go test ./... -race -count=1` | 10min |
| `go-integration` | PR 到 main | `go test -tags=integration ./... -timeout 120s` | 5min |
| `frontend-test` | 每次 push/PR | `pnpm --dir apps/web test` | 5min |
| `frontend-lint` | 每次 push/PR | `pnpm --dir apps/web lint` | 3min |
| `build` | 每次 push/PR | `go build ./...` + `pnpm build` | 5min |
| `buf-breaking` | PR 到 main | `buf breaking --against origin/main` | 2min |
| `e2e` | PR 到 main | `pnpm --dir e2e test` | 15min |
| `e2e-mobile` | PR 到 main | `pnpm --dir e2e test --project=mobile --project=tablet` | 10min |
| `adversarial` | 定时 + 手动 | `go test -tags=adversarial ./test/adversarial/...` | 30min |

### 6.2 Pre-commit Hooks（本地）

```yaml
# .pre-commit-config.yaml
repos:
  - repo: local
    hooks:
      - id: go-test
        name: Go 单元测试
        entry: go test ./... -count=1 -short
        language: system
        files: '\.go$'
        pass_filenames: false
      - id: go-lint
        name: golangci-lint
        entry: golangci-lint run ./...
        language: system
        files: '\.go$'
        pass_filenames: false
```

### 6.3 测试覆盖率目标

| 层 | 初始目标（P0） | 成熟目标（P2+） |
|---|---------------|----------------|
| Go 包 `protocol/` | 95% | 98% |
| Go 包 `security/` | 90% | 95% |
| Go 包 `store/` | 85% | 90% |
| Go 包 `adapters/` | 80% | 90% |
| Go 包总体 | 70% | 85% |
| 前端组件 | 60% | 80% |
| 前端 stores | 85% | 95% |
| E2E 关键路径 | 10 场景 | 25 场景 |
| 对抗场景 | 5 场景 | 15 场景 |

### 6.4 测试数据与夹具

```
test/
├── testdata/
│   ├── fake-claude/             # 最小 NDJSON 发射器（Go）
│   │   └── main.go
│   ├── fake-codex/              # 最小 rollout trace 生成器（Go）
│   │   └── main.go
│   ├── fake-opencode/           # 最小 SSE 服务器（Go）
│   │   └── main.go
│   ├── repos/                   # 用于工作空间测试的临时 git 仓库
│   │   └── sample-repo/         # 用于 worktree 测试的预构建裸仓库
│   ├── sql/                     # 用于数据库测试的种子 SQL
│   │   ├── seed_conversations.sql
│   │   ├── seed_messages.sql
│   │   └── seed_fts.sql
│   └── events/                  # 夹具事件 JSONL 文件
│       ├── session_small.jsonl  # 10 个事件
│       ├── session_large.jsonl  # 10000 个事件
│       └── session_corrupt.jsonl # 包含故意损坏
├── adversarial/
│   └── harness_test.go
└── integration/
    └── testhelpers/
        └── db.go                # openTestDB, runMigrations 辅助函数
```

---

## 附录 A：Go 测试模式参考

### A.1 表驱动测试（主要模式）

```go
func TestXxx(t *testing.T) {
    tests := []struct {
        name    string
        input   InputType
        want    OutputType
        wantErr bool
    }{
        {name: "happy path", input: validInput, want: expectedOutput},
        {name: "edge case empty", input: emptyInput, wantErr: true},
        // ...
    }
    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            got, err := FunctionUnderTest(tt.input)
            if tt.wantErr {
                require.Error(t, err)
                return
            }
            require.NoError(t, err)
            if diff := cmp.Diff(tt.want, got); diff != "" {
                t.Errorf("mismatch (-want +got):\n%s", diff)
            }
        })
    }
}
```

### A.2 Golden File 测试（用于复杂输出）

```go
func TestDiffOutput(t *testing.T) {
    got := generateDiff(testRepo)
    golden := filepath.Join("testdata", "expected.diff")
    if *update {
        os.WriteFile(golden, []byte(got), 0644)
    }
    want, _ := os.ReadFile(golden)
    if diff := cmp.Diff(string(want), got); diff != "" {
        t.Errorf("diff output changed (-want +got):\n%s", diff)
    }
}
```

### A.3 测试辅助函数

```go
// test/integration/testhelpers/db.go
func OpenTestDB(t *testing.T) *sql.DB {
    t.Helper()
    db, err := sql.Open("sqlite", ":memory:?_journal_mode=WAL")
    if err != nil {
        t.Fatalf("open test db: %v", err)
    }
    t.Cleanup(func() { db.Close() })
    RunMigrations(t, db)
    return db
}
```

---

*测试策略文档。2026-05-21.*
