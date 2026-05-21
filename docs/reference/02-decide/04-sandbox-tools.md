# AgentHub Runner Sandbox + Workspace + Tool Registry -- 跨仓库综合设计

> 综合来源：`openhands.md`、`opcode.md`、`dify.md`、`chatdev.md`
> 目标：为 AgentHub 的 Runner 安全沙箱、Workspace 隔离、Tool Registry 提供综合设计方案
> 日期：2026-05-21

---

## 1. Sandbox / Workspace 隔离方案横比

### 1.1 四种隔离模式对比

四仓库各有不同的隔离思路，按隔离强度从弱到强排列：

| 维度 | Git Worktree (AgentHub P0) | Process (OpenHands) | Docker (OpenHands) | 混合模式 |
|------|---------------------------|---------------------|---------------------|----------|
| **代表** | AgentHub workspace.md、Opcode | OpenHands `ProcessSandboxService` | OpenHands `DockerSandboxService` | 综合分析 |
| **隔离级别** | 文件系统级（目录隔离） | 进程级（独立子进程+端口） | 操作系统级（cgroup/namespace） | 策略可选 |
| **安全边界** | 弱：同一用户空间，共享文件系统 | 中：独立进程，但共享内核 | 强：容器 namespace + cgroup | 按风险分级 |
| **启动速度** | <100ms（本地 worktree add） | <500ms（fork + bind port） | 1-5s（镜像缓存后） | 默认 worktree，需要时升级 |
| **资源开销** | 极低（仅目录 + .git 元数据） | 低（进程 + 端口） | 中等（~100MB+/容器） | 按需分配 |
| **环境一致性** | 依赖宿主机 | 依赖宿主机 | 完全一致（镜像固化） | 分层：worktree 依赖宿主，Docker 镜像固化 |
| **端口隔离** | N/A（不启动服务） | 手动绑定独立端口 | 自动映射宿主机端口 | worktree 无服务端口，Docker 有 |
| **Git 集成** | 天然支持（worktree = 分支） | 需额外操作 | 需额外 Hook | worktree 直接操作 Git |
| **多租户** | 不适用（同一用户） | 不支持 | 天然支持（session key） | Docker 层可加多租户 |
| **清理** | `git worktree remove` + `git branch -D` | SIGTERM + 清理端口 | 容器删除 + Volume 清理 | 统一 cleanup 接口 |
| **依赖管理** | 共享全局或 worktree 内 venv | 共享环境 | 镜像内独立安装 | worktree 可配 Docker 兜底 |
| **VS Code / IDE** | 可外挂 code-server | 不支持 | 内置 VS Code Server | 不需要（AgentHub 无 IDE） |

### 1.2 AgentHub 推荐：三级沙箱策略

AgentHub 的 P0 场景是本地桌面 coding-agent，不是多租户 SaaS。直接照搬 OpenHands 的 Docker 沙箱会过度设计。推荐三级策略：

```
Level 1 -- Worktree 隔离（默认，覆盖 90% 场景）
  适用：本地 AgentRun，CLI Agent 操作项目文件
  机制：git worktree add → Agent 在 worktree 内执行 → diff → apply/discard
  安全：路径守卫限制在 worktree 根目录内
  优势：零额外依赖、Git 原生集成、极快启动

Level 2 -- Process 隔离（中级风险场景）
  触发条件：Agent 需安装依赖 / 运行 dev server / 执行不可信脚本
  机制：借鉴 OpenHands ProcessSandboxService，子进程 + 独立工作目录 + 端口绑定
  安全：独立进程空间 + 网络限制（可选）
  优势：比 Docker 轻量，比 worktree 多一层进程边界

Level 3 -- Docker 隔离（高风险场景）
  触发条件：用户显式请求 / 运行不受信第三方代码 / 全云端 P3 部署
  机制：借鉴 OpenHands DockerSandboxService 的 ABC 设计
  安全：完整容器隔离 + cgroup 限制 + 只读根文件系统（可选）
  优势：最强安全保证，生产级隔离
```

### 1.3 统一抽象：WorkspaceProvider 接口

借鉴 OpenHands `SandboxService` ABC 的设计，AgentHub Runner 定义统一的 `WorkspaceProvider` 接口，屏蔽三种实现差异：

```go
// packages/workspace-core/workspace_provider.go

type WorkspaceProvider interface {
    // Lifecycle
    Create(ctx context.Context, spec WorkspaceSpec) (*WorkspaceInfo, error)
    Start(ctx context.Context, id string) (*WorkspaceInfo, error)
    Stop(ctx context.Context, id string) error
    Destroy(ctx context.Context, id string) error

    // State
    Get(ctx context.Context, id string) (*WorkspaceInfo, error)
    List(ctx context.Context, filter WorkspaceFilter) ([]*WorkspaceInfo, error)
    WaitReady(ctx context.Context, id string, timeout time.Duration) (*WorkspaceInfo, error)

    // File operations (worktree-specific)
    GetDiff(ctx context.Context, id string) (*DiffResult, error)
    ApplyPatch(ctx context.Context, id string, patch PatchSpec) error
    Discard(ctx context.Context, id string) error
}

type WorkspaceSpec struct {
    ProjectID   string
    RunID       string
    Provider    WorkspaceProviderType // "worktree" | "process" | "docker"
    Image       string                // Docker image (仅 Level 3)
    ExposedPorts []ExposedPort        // 需要暴露的端口 (Level 2/3)
    Env         map[string]string     // 注入环境变量
    WorkingDir  string                // 工作目录
}

type WorkspaceInfo struct {
    ID           string
    RunID        string
    Status       WorkspaceStatus // CREATING | READY | RUNNING | STOPPED | ERROR
    RootPath     string          // workspace 根路径
    ExposedURLs  []ExposedURL    // 暴露的服务 URL
    SessionToken string          // 鉴权 token
    CreatedAt    time.Time
}

type WorkspaceStatus string
const (
    WorkspaceCreating WorkspaceStatus = "creating"
    WorkspaceReady    WorkspaceStatus = "ready"
    WorkspaceRunning  WorkspaceStatus = "running"
    WorkspaceStopped  WorkspaceStatus = "stopped"
    WorkspaceError    WorkspaceStatus = "error"
)
```

### 1.4 关键设计决策

**OpenHands 直接借鉴项**：
- `ExposedUrl` 模式：将 workspace 内服务（dev server preview、Jupyter 等）抽象为命名 URL，类似 OpenHands 的 `AGENT_SERVER` / `VSCODE` / `WORKER_N`
- `StartupGracePeriod`：避免启动中的 workspace 被误判为 ERROR，借鉴 OpenHands 的 15s 默认值
- `SessionAPIKey`：workspace 鉴权 token，Runner 生成、Edge 持有、Agent CLI 使用
- 环境变量转发：以 `AGENTHUB_` 前缀自动注入 workspace，类似 OpenHands 的 `LLM_*` 模式

**OpenHands 不建议照搬**：
- Docker 优先级：AgentHub P0 默认 worktree，Docker 作为可选升级路径，不是默认
- 复杂的 SandboxSpec 模板系统：AgentHub 的 worktree 场景不需要 image tag 管理
- 内置 VS Code Server：AgentHub 是 CLI Agent 平台，不需要 IDE 接入

**Opcode 直接借鉴项**：
- 进程注册表（`ProcessRegistry`）：Runner 管理多个 Agent CLI 子进程的状态，注册 + 优雅关闭（SIGTERM -> 超时 -> SIGKILL）
- 实时输出流：`append_live_output` / `get_live_output` 模式，Runner 缓冲 stdout 并通过 WebSocket 推送给 Edge

---

## 2. Tool 注册与审批的通用模式

### 2.1 三仓库 Tool 体系对比

| 维度 | OpenHands | Dify | ChatDev |
|------|-----------|------|---------|
| **Tool 定义** | `openhands-tools` pip 包，preset 模式 | `Tool(ABC)` 基类 + 6 种 Provider | `AgentConfig.tooling[]` + MCP/funciton 两种 |
| **注册方式** | 编译期 import preset（`default` / `planning`） | 运行时 `ToolManager` 动态匹配 Provider | YAML 声明 `tooling` 列表，schema registry 发现 |
| **分发机制** | Agent 启动时注入 tool list | `ToolEngine.agent_invoke()` 统一分发 | Agent node 执行时注入 tool definitions |
| **凭据管理** | 无（工具不涉及外部凭据） | 加密存储 + OAuth 刷新，`ToolRuntime` 注入 | `${API_KEY}` 占位符 + 环境变量 |
| **MCP 集成** | `app_server/mcp/` Tavily 代理 | 完整 MCPToolProviderController，自动 schema 转换 | `mcp_remote` tooling type |
| **扩展方式** | 新增 preset 或 tool 实现 | 新增 ProviderController 或 Plugin | 新增 tooling config class + schema registry |
| **审批/门控** | 无（Agent 自由调用） | 无显式审批（workflow 节点级权限） | 无显式审批（YAML 配置即授权） |

### 2.2 Dify Tool Provider 模式（核心参考）

Dify 的 `ToolManager` 是四仓库中设计最成熟的 Tool Registry，其 6 种 Provider 类型的 `match` 分派模式值得 AgentHub 直接迁移：

```
ToolProviderType:
  BUILT_IN           → BuiltinToolProviderController + PluginToolProviderController
  API                → ApiToolProviderController
  WORKFLOW           → WorkflowToolProviderController (workflow as tool)
  APP                → (预留)
  PLUGIN             → PluginToolProviderController
  MCP                → MCPToolProviderController
  DATASET_RETRIEVAL  → 独立路径 (RAG)
```

### 2.3 AgentHub Tool Registry 设计方案

#### 2.3.1 三层架构

借鉴 Dify 的 ToolManager + ToolEngine + ToolRuntime 三层，以及 OpenHands 的 Injector DI 模式：

```
┌─────────────────────────────────────────────┐
│  ToolRegistry (Runner 内建)                  │
│  - Register(provider)                        │
│  - List(filter) → []ToolDescriptor           │
│  - Resolve(name) → ToolInstance              │
│  - Validate(name, params) → ValidationResult │
└───────────┬─────────────────────────────────┘
            │ 调用
┌───────────▼─────────────────────────────────┐
│  ToolEngine (Runner 内建)                    │
│  - Dispatch(name, params) → ToolResult       │
│  - Stream(name, params) → <-chan ToolEvent   │
│  - Approve(name, params) → ApprovalRequest   │
└───────────┬─────────────────────────────────┘
            │ 每个 Tool 实例
┌───────────▼─────────────────────────────────┐
│  ToolRuntime (per-invocation 上下文)          │
│  - WorkspaceID, RunID, TurnID                │
│  - Credentials (加密注入)                     │
│  - WorkingDir, Env                           │
│  - ApprovalGate (回调)                       │
└─────────────────────────────────────────────┘
```

#### 2.3.2 ToolDescriptor 模型

```go
// packages/tool-core/tool_descriptor.go

type ToolDescriptor struct {
    Name        string              // "read", "write", "bash", "mcp/github"
    DisplayName string              // 用户可见名称
    Description string              // LLM 可见描述
    Provider    ToolProviderType    // builtin | mcp | api | plugin
    Schema      ToolSchema          // JSON Schema 参数定义
    RiskLevel   RiskLevel           // low | medium | high
    RequiresApproval bool           // 是否需要用户审批
    ApprovalKind     ApprovalKind   // "once" | "per_thread" | "per_session"
    Enabled     bool                // 当前 Run 是否启用
}
```

#### 2.3.3 ToolProvider 类型

```go
type ToolProviderType string
const (
    ProviderBuiltin  ToolProviderType = "builtin"   // CLI 原生工具 (read/write/bash/edit/glob/grep)
    ProviderMCP       ToolProviderType = "mcp"       // MCP 协议工具
    ProviderAPI       ToolProviderType = "api"       // REST API 封装工具
    ProviderPlugin    ToolProviderType = "plugin"    // 插件系统工具
    ProviderComposite ToolProviderType = "composite" // 组合工具（多个工具的 pipeline）
)
```

#### 2.3.4 MCP 集成路径

从 Dify 的 MCPToolProviderController 和 ChatDev 的 `mcp_remote` tooling 可提炼出通用模式：

```
1. MCP Server 注册（Edge 侧）
   - 存储 MCP 连接信息 (name, transport, command/url, env, scope)
   - 连接测试（list_tools）
   - Tools schema 自动拉取 + 缓存

2. Tool Schema 转换（Runner 侧，借鉴 Dify ToolTransformService）
   - MCP JSON Schema → AgentHub ToolSchema
   - 参数名、类型、描述、默认值映射
   - 嵌套 object/array 递归转换

3. 运行时调用（Runner 侧）
   - ToolEngine 检测 provider == "mcp"
   - 加载 MCP 客户端连接（stdio/sse transport）
   - tools/call → 返回结果
   - 结果格式化为 ToolEvent Item

4. 审批集成
   - MCP Tool 的 RiskLevel 由配置指定
   - 高风险 MCP Tool (如 github.create_pull_request) 触发审批卡
```

**区别与 Dify**：
- AgentHub 不需要 Tool Provider 凭据的 OAuth 刷新（P0 场景无第三方 OAuth tool）
- AgentHub 不需要 "Workflow as Tool" 的 recursive 发布（P0 无 workflow builder）
- AgentHub 的 MCP 集成可以更轻量：mcp-go SDK 直接管理连接，不通过 CLI 桥接（避免 Opcode 的 `claude mcp` 子命令依赖）

### 2.4 Tool 审批门控设计

综合 AgentHub 已有 `approvals.md` 和三家 Tool 系统，设计 Tool 审批流：

```
Agent CLI 请求 tool 执行
  → Runner ToolEngine 拦截
    → 查询 ToolDescriptor.RequiresApproval
      → false：直接执行，生成 ToolEvent Item
      → true：生成 ApprovalRequest Item
        → Edge 审批策略评估
          → 自动批准（白名单 / risk=low / 同 Thread 已授权）
          → 需要用户审批 → UI 显示审批卡
            → 用户选择：Accept Once / Accept for Thread / Decline
        → Runner 收到 Edge 的 approval/decide
          → accept：执行 tool
          → decline：返回拒绝原因给 Agent CLI
```

风险分类映射：
| AgentHub Approval Kind | 对应 Tool 风险 | 来源参考 |
|------------------------|---------------|----------|
| `shell_command` | `bash` 工具 | 已有 approvals.md |
| `file_write` | `write`/`edit`/`multiedit` 工具 | Dify 的 write 类操作 |
| `network` | `web_fetch`/`web_search` 等网络工具 | 新增 |
| `deploy` | `git push`/CI 触发等 | 已有 approvals.md |

### 2.5 变体配置驱动的 Tool 声明（ChatDev 模式）

ChatDev 的 `FIELD_SPECS` + `child_routes()` 机制可用于 AgentHub 的工具配置面板：

- 每种 Tool Provider 自带 `ToolConfigSchema`（定义可配置字段及 UI 控件类型）
- Runner 启动时从 Schema API 获取所有已注册 Tool 的配置 schema
- UI 无需硬编码每种 Tool 的配置表单 -- 由 Schema 驱动动态渲染
- 新增 Tool 只需注册 `ToolDescriptor` + `ToolConfigSchema`，前端自动适配

---

## 3. Checkpoint / 版本历史设计方案

### 3.1 三层时间线映射

AgentHub 的数据模型已有清晰的层级（`data-model.md`），Opcode 的 Checkpoint 系统可在此框架上映射增强：

```
AgentHub 层级           Opcode 对应            Checkpoint 角色
─────────────────────────────────────────────────────────────
Project                 project_id             跨 Thread 的总容器
  Conversation          无直接对应              IM 会话边界（可选 checkpoint 层级）
    Thread              session_id             单个任务分支的检查点序列
      Turn              message_index          每个 Turn 是一个检查点候选
        AgentRun        无                     实际执行实例（re-run 产生分支）
          Item          无                     流式事件单元（不单独做检查点）
```

**关键差异**：Opcode 的 "session" 是非结构化的 JSONL 流，AgentHub 的 Thread 是有结构的 Turn 序列。AgentHub 的 Turn 是天然检查点边界 -- 每个 Turn 完成时自动决策是否创建检查点。

### 3.2 Checkpoint 数据模型

综合 Opcode 的内容寻址存储和 AgentHub 的 Turn 粒度：

```go
// packages/checkpoint-core/checkpoint.go

type Checkpoint struct {
    ID                string    // UUID v4
    ProjectID         string
    ThreadID          string
    TurnID            string    // 关联的 Turn（创建检查点的 Turn）
    RunID             string    // 关联的 AgentRun
    ParentCheckpointID *string  // 父检查点（支持 fork 分支树）
    Message           string    // 用户提示摘要（前 200 字符）
    Status            CheckpointStatus // active | archived | orphaned
    Metadata          CheckpointMetadata
    CreatedAt         time.Time
}

type CheckpointMetadata struct {
    TotalTokens     int                  // 到此检查点的累计 token 数
    ModelUsed       string               // 使用的模型
    UserPrompt      string               // 完整用户 prompt
    FileCount       int                  // 快照文件数
    SnapshotSize    int64                // 快照总大小（压缩后）
    TurnCount       int                  // 累计 Turn 数
    Tags            []string             // 用户自定义标签
}

type FileSnapshot struct {
    CheckpointID string
    FilePath     string
    ContentHash  string  // SHA-256
    Size         int64
    Permissions  uint32
    IsDeleted    bool
}

type ThreadTimeline struct {
    ThreadID              string
    RootCheckpointID      string
    CurrentCheckpointID   string
    TotalCheckpoints      int
    Strategy              CheckpointStrategy
    AutoCheckpointEnabled bool
}
```

### 3.3 四种检查点策略

从 Opcode 的 4 种策略简化为 AgentHub 适用的 3 种：

| 策略 | 触发时机 | 适用场景 | 与 Opcode 对比 |
|------|---------|----------|---------------|
| `manual` | 用户手动触发 | 自由控制，开发探索 | 同 Opcode Manual |
| `per_turn` | 每个 Turn 完成后自动 | 严谨任务，需精细回溯 | 同 Opcode PerPrompt（AgentHub 用 Turn 替代 message_index） |
| `smart` (默认) | 仅在破坏性操作后 | 平衡性能与安全 | 同 Opcode Smart（检测 write/edit/bash/rm） |

Opcode 的 `PerToolUse` 策略在 AgentHub 的 Turn 粒度下过于密集（一个 Turn 内可能多次 tool_use），不建议直接采用。如需要可在 Thread 配置中作为高级选项。

### 3.4 存储设计

直接复用 Opcode 的内容寻址存储 + zstd 压缩，适配 AgentHub 的目录结构：

```
.agenthub-runtime/
  projects/{project_id}/
    .timelines/{thread_id}/
      timeline.json              # ThreadTimeline 序列化
      checkpoints/
        {checkpoint_id}/
          metadata.json          # Checkpoint 结构体
          turns.jsonl.zst        # 关联的 Turns/Items（zstd 压缩）
      files/
        content_pool/            # SHA-256 → zstd 压缩文件内容
          {sha256_hex}
        refs/                    # 引用目录
          {checkpoint_id}/
            {safe_path}.json     # {path, hash, is_deleted, permissions, size}
```

**与 Opcode 的差异**：
- Opcode 存 `messages.jsonl`（非结构化 JSONL），AgentHub 存 `turns.jsonl.zst`（结构化 Turn + Item）
- AgentHub 增加 `TurnCount` 元数据，支持 Turn 级语义搜索（Opcode 只有文件级）
- AgentHub 的 content_pool 跨 Thread 共享（同一 Project 内），Opcode 是 per-session

### 3.5 检查点操作

```
Checkpoint 操作定义（Runner 暴露，Edge 调用）:

checkpoint/create(threadID, strategy?) → Checkpoint
  1. 收集当前 worktree 所有文件
  2. 对比上一个检查点的 file_tracker，找出变更文件
  3. 为变更文件创建 FileSnapshot（SHA-256 + 内容写入 content_pool）
  4. 收集关联 Turns 的元数据（累计 tokens, model, prompts）
  5. 构造 Checkpoint 写入 .timelines/
  6. 更新 timeline.current_checkpoint_id
  7. 重置 file_tracker 状态

checkpoint/restore(threadID, checkpointID) → Checkpoint
  1. 加载 checkpoint 数据 + file_snapshots
  2. 删除 worktree 中不属于目标检查点的文件
  3. 逐文件恢复内容（从 content_pool 解压）
  4. 清理空目录
  5. 更新 timeline.current_checkpoint_id
  6. 重建 file_tracker
  注意：恢复检查点不修改已持久化的 Turn/Item 历史 -- 只恢复文件状态

checkpoint/fork(threadID, checkpointID) → Checkpoint
  1. 加载基础检查点
  2. 恢复文件到该检查点状态
  3. 创建新检查点（parent = checkpointID）
  4. 在时间线树中作为子节点

checkpoint/diff(fromID, toID) → CheckpointDiff
  1. 加载两个检查点的文件引用
  2. 对比 file_snapshot 列表
  3. 对每个差异文件生成 file-level diff（增减行数）
  4. 返回 CheckpointDiff (ModifiedFiles, AddedFiles, DeletedFiles, TokenDelta)

checkpoint/cleanup(threadID, keepCount)
  1. 按时间排序所有检查点
  2. 保留最近 keepCount 个
  3. 删除旧检查点的 metadata + refs
  4. GC content_pool 孤儿文件（未被任何活跃检查点引用）
```

### 3.6 Turn 级语义搜索

Opcode 只有文件级 Diff。AgentHub 的 Turn 模型支持更强的搜索能力：

```go
type TurnSearchQuery struct {
    ThreadID       string
    TextQuery      string     // 语义搜索 Turn 内容
    FilePath       string     // 筛选影响过某文件的 Turns
    DateRange      [2]time.Time
    ActorID        string     // 按 Agent 筛选
    Status         []TurnStatus
    HasCheckpoint  *bool      // 只查有检查点的 Turn
    TokenRange     [2]int
}

type TurnSearchResult struct {
    Turns        []Turn
    MatchedCheckpoints []Checkpoint  // 包含该 Turn 的检查点
    Snippets     []string           // 匹配的上下文摘录
}
```

### 3.7 前端 Timeline 可视化

Opcode 的 `TimelineNavigator` 提供了良好的参考实现，AgentHub 可在此基础上增强：

```
TimelinePanel (右侧面板)
├── 策略选择器 (Manual / PerTurn / Smart)
├── 自动检查点开关
├── Timeline 树形视图 (递归渲染)
│   ├── 每个节点显示：
│   │   ├── Checkpoint ID (前 8 位)
│   │   ├── 相对时间戳
│   │   ├── Turn 摘要（用户 prompt 前 100 字符）
│   │   ├── Token 数 + 文件变更数 badge
│   │   └── 操作按钮：Restore | Fork | Compare
│   └── 当前活跃检查点高亮 (ring-2 + primary color)
├── Diff 对话框（Compare 触发）
│   ├── 文件级：Modified / Added / Deleted 计数
│   ├── Token 增量
│   └── 逐文件增减行数
└── 存储管理：总数 + 保留最近 N 个 + 清理按钮
```

**与 Opcode 的增强**：
- Opcode 只有单 session 内树形展示，AgentHub 可扩展到跨 Thread 的 Project 时间线
- Opcode 节点显示 `message_index` 作为标识，AgentHub 用 `Turn.Sequence` + Turn 摘要
- 增加 Turn 级语义搜索（搜索 "哪个 Turn 修改了 config.ts"）
- 增加跨 Thread 检查点引用（Thread B 可以 restore Thread A 的某个文件状态）

### 3.8 与现有 AgentHub 架构的集成点

```
Runner 新模块：packages/checkpoint-core/
  - checkpoint.go         # 数据模型
  - checkpoint_storage.go # 内容寻址存储 (SHA-256 + zstd)
  - checkpoint_manager.go # 检查点 CRUD + 恢复 + diff
  - file_tracker.go       # 文件状态跟踪
  - timeline.go           # 时间线管理
  - garbage_collector.go  # 孤儿文件 GC
  - snapshot_diff.go      # 检查点差异计算

Runner 集成：
  workspace/  ← 复用 worktree 文件操作
  executor/  ← turn 完成时触发自动检查点
  logs/      ← checkpoint 元数据日志

Edge 集成：
  checkpoint/list、checkpoint/restore、checkpoint/diff 命令
  checkpoint 元数据索引（供 UI 搜索）

UI 集成：
  TimelinePanel 组件（Thread 详情页右侧 Tab）
  CheckpointSettings 组件（Thread 设置面板）
```

---

## 4. 综合设计决策矩阵

### 4.1 各仓库对 AgentHub 的贡献权重

| 模块 | 主要参考 | 次要参考 | 不建议照搬 |
|------|---------|---------|------------|
| Workspace 隔离 ABC | OpenHands `SandboxService` | Opcode `ProcessRegistry` | Docker 作为默认 |
| Worktree 生命周期 | AgentHub 已有 `workspace.md` | Opcode 进程管理 | -- |
| Tool Provider 抽象 | Dify `ToolManager` + `ToolEngine` | OpenHands preset 模式 | Flask 单体架构 |
| MCP 集成 | Dify `MCPToolProviderController` | ChatDev `mcp_remote` | Opcode CLI 桥接 |
| Tool 审批 | AgentHub 已有 `approvals.md` | Dify 凭据管理 | -- |
| Checkpoint 存储 | Opcode `CheckpointStorage` (内容寻址) | -- | 纯文件级 Diff (需增强为 Turn 级) |
| Checkpoint 策略 | Opcode (Manual/Smart) | -- | PerToolUse (过密) |
| Timeline 可视化 | Opcode `TimelineNavigator` | -- | -- |
| 变体配置 + 动态表单 | ChatDev `FIELD_SPECS` + `child_routes` | -- | ChatDev 同步执行模型 |
| DI 框架 | OpenHands `Injector[T]` | -- | -- |
| Memory 分层 | ChatDev (simple/file/blackboard/mem0) | OpenHands memory service | -- |

### 4.2 P0 实施优先级

```
Week 1-2: Workspace 隔离
  - [ ] WorktreeProvider 实现（Git worktree create/diff/apply/discard）
  - [ ] Process 子进程注册表 + 优雅关闭
  - [ ] WorkspaceInfo 状态机（creating → ready → running → stopped → error）

Week 2-3: Tool Registry
  - [ ] ToolDescriptor + ToolProvider 接口定义
  - [ ] BuiltinToolProvider（CLI 原生工具注册）
  - [ ] ToolEngine dispatch + ToolRuntime 上下文注入
  - [ ] MCPToolProvider（mcp-go SDK 集成）

Week 3-4: Tool 审批
  - [ ] Tool 执行拦截 + ApprovalRequest 生成
  - [ ] 审批卡 UI 组件
  - [ ] 审批策略（白名单 / per-thread / per-session）

Week 4-6: Checkpoint 系统
  - [ ] 内容寻址存储（content_pool + refs + zstd）
  - [ ] CheckpointManager（create/restore/fork/diff）
  - [ ] Smart 自动检查点触发
  - [ ] Timeline 前端组件
  - [ ] GC 清理
```

### 4.3 核心原则重申

1. **Go-first**：所有核心逻辑（WorkspaceProvider、ToolEngine、CheckpointManager）用 Go 实现，TypeScript 仅用于 UI 和生成类型
2. **Worktree 优先**：P0 默认 worktree 隔离，Docker 作为可选升级路径（P2+）
3. **Schema-driven**：ToolDescriptor 和 Checkpoint 模型由 protocol schema 生成 Go/TS 类型
4. **Runner 内聚**：Tool 执行、Checkpoint 存储、Workspace 文件操作全部由 Runner 完成，Edge 只管元数据索引和调度
5. **内容寻址复用**：Opcode 的 CheckpointStorage 设计可直接翻译为 Go 实现，不重新发明轮子

---

## 附录：关键源码路径索引

| 来源仓库 | 文件 | 对 AgentHub 的价值 |
|---------|------|-------------------|
| OpenHands | `app_server/sandbox/sandbox_service.py` | WorkspaceProvider ABC 定义范本 |
| OpenHands | `app_server/sandbox/docker_sandbox_service.py` | Docker 实现细节（Level 3 参考） |
| OpenHands | `app_server/sandbox/process_sandbox_service.py` | Process 沙箱实现（Level 2 参考） |
| OpenHands | `app_server/sandbox/sandbox_models.py` | WorkspaceInfo 状态模型 |
| OpenHands | `app_server/services/injector.py` | DI 框架（服务注入参考） |
| Opcode | `src-tauri/src/checkpoint/storage.rs` | 内容寻址存储实现 |
| Opcode | `src-tauri/src/checkpoint/manager.rs` | CheckpointManager 完整逻辑 |
| Opcode | `src-tauri/src/checkpoint/mod.rs` | 数据模型定义 |
| Opcode | `src-tauri/src/process/registry.rs` | 进程注册表实现 |
| Opcode | `src-tauri/src/process/registry.rs:239-360` | 优雅关闭逻辑 |
| Opcode | `src/components/TimelineNavigator.tsx` | Timeline UI 参考 |
| Dify | `api/core/tools/tool_manager.py:98-391` | ToolManager Provider 分派模式 |
| Dify | `api/core/tools/tool_engine.py` | ToolEngine 统一调用入口 |
| Dify | `api/core/tools/__base/tool.py:20` | Tool ABC 定义 |
| Dify | `api/core/tools/__base/tool_provider.py:14` | ToolProviderController ABC |
| Dify | `api/core/tools/__base/tool_runtime.py:10` | ToolRuntime 上下文模型 |
| Dify | `api/core/tools/mcp_tool/provider.py` | MCP Tool Provider 实现 |
| ChatDev | `entity/configs/node/agent.py:323` | AgentConfig tooling/memory/skills 字段 |
| ChatDev | `entity/configs/base.py` | child_routes() 变体配置机制 |
| ChatDev | `schema_registry/registry.py` | Schema Registry + API |
| ChatDev | `entity/configs/node/memory.py:159-283` | 四种 Memory Store 定义 |
