> 状态: ⏳ 计划中 — workspace 管理列入 M4

# AgentHub Workspace Lifecycle Design

> 综合分析：OpenHands (SandboxService)、Kanna (AgentCoordinator)、OpenCode (WorkspaceAdapter)、
> cross-analysis-sandbox-tools (三级沙箱)、design-cli-wizard (agenthub init)
> 日期：2026-05-21

---

## 1. Workspace 初始化流水线 (Detect -> Provision -> Configure -> Verify)

借鉴 OpenHands `start_sandbox` 分阶段启动 + 状态机、OpenCode `WorkspaceAdapter.create`、`agenthub init` 3-step wizard。

```
Phase 1: Detect      Phase 2: Provision    Phase 3: Configure     Phase 4: Verify
<50ms               <100ms~30s            <5s                   <1s
─────────────────   ──────────────────    ───────────────────   ────────────────
git rev-parse        worktree add/clone    Inject AGENTHUB_* env  Dir writable
git status           mkdir .agenthub/      pip/npm install (opt)   Branch correct
git worktree list    write session.json    Allocate ports          Port listenable
disk space check     write env.sh          ──► ConfigureResult     Agent CLI reachable
──► DetectionReport  ──► ProvisionResult                         ──► WorkspaceInfo
```

### Phase 1: Detect
```go
type DetectionReport struct {
    IsGitRepo, IsShallow       bool
    CurrentBranch, RemoteURL   string
    HasWorktree                bool
    DiskFreeBytes              int64
    SuggestedProvider          WorkspaceProviderType // worktree|clone|local|docker
}
```
规则：同仓库同分支→复用已有 worktree；同仓库不同分支→`git worktree add`；不同仓库→blobless clone；非 Git→直接使用本地路径。

### Phase 2: Provision

| Provider | 实现 | 耗时 | 适用场景 |
|----------|------|------|---------|
| `worktree` | `git worktree add .agenthub-worktrees/run_<id>/src <branch>` | <100ms | 已有仓库 (Level 1, 默认) |
| `clone` | `git clone --filter=blob:none <url>` | 1-30s | 首次使用新仓库 |
| `local` | 直接使用用户指定路径 | <1ms | 非 Git 目录 |
| `docker` | `docker run --detach` + volume mount | 1-5s | 高风险沙箱 (Level 3) |

Workspace 目录结构（worktree 模式）：
```
.agenthub-worktrees/run_<id>/
  src/                     ← git worktree checkout
  .agenthub/
    session.json           ← workspace ID, run ID, session token
    env.sh                 ← AGENTHUB_* 环境变量
```

### Phase 3: Configure
环境变量注入借鉴 OpenHands `LLM_*` 前缀转发模式：
- `AGENTHUB_WORKSPACE_ID`, `AGENTHUB_RUN_ID`, `AGENTHUB_PROJECT_ID`
- `AGENTHUB_SESSION_TOKEN`（32-byte random，借鉴 OpenHands `session_api_key`）
- `AGENTHUB_WORKSPACE_ROOT`, `AGENTHUB_PREVIEW_PORT`

依赖安装可选，由 `WorkspaceSpec.InstallDeps` 控制，失败不阻塞 workspace 创建。

### Phase 4: Verify
借鉴 `agenthub doctor` 的单项探测：目录可读写、Git 可用、分支正确、Agent CLI 可达（warning 非 fatal）、端口可绑定。借鉴 OpenHands `startup_grace_seconds=15s`，流水线总超时 30s。

### 状态机
```
creating ──► ready ──► running ──► stopped ──► destroyed
   │                       │
   └──────► error ◄────────┘
```
`error → creating`（retry，从失败 Phase 继续，最多 3 次）。`error → destroyed`（abandon）。

---

## 2. 多项目切换的开销优化

### 2.1 Workspace Pool（热/冷缓存）

借鉴 OpenHands `pause_old_sandboxes` 淘汰模式 + Kanna `sessionToken` 复用：

```go
type WorkspacePool struct {
    hot  map[string]*CachedWorkspace  // key: projectID_branch, max 5
    cold map[string]*CachedWorkspace  // key: workspaceID, TTL 30min
}

type CachedWorkspace struct {
    Info         WorkspaceInfo
    LastAccessAt time.Time
    RefCount     int32               // 活跃 Run 数（借鉴 Kanna activeTurns）
    FileTracker  *FileTracker
}
```

| 场景 | 操作 | 耗时 |
|------|------|------|
| 同 Project + 同 Branch (Hot Hit) | 复用 CachedWorkspace, RefCount++ | <5ms |
| 同 Project + 不同 Branch (Warm) | `git worktree add` (仅差异文件) | 100-500ms |
| 同 Project + 无缓存 (Cold) | 全量 worktree create + 可选 deps | 1-5s |
| 不同 Project (Cold) | Clone 或 worktree | 1-30s |

淘汰：热池满→`LastAccessAt` 最旧 + `RefCount==0` 降级到冷池。冷池 TTL 到期→清理。

### 2.2 端口池

借鉴 OpenHands `ExposedPort` 命名模式：范围 `5100-5199`（100 端口），每 workspace 最多 5 个命名端口（`preview`/`api`/`debug`/`static`/`extra`），workspace destroy 时自动释放。

### 2.3 Deps 共享

- Python venv：默认各 worktree 独立。`WorkspaceSpec.SharedVenv=true` 时同 Project 共享。
- node_modules：默认独立安装，可配 symlink 共享（只读场景）。

---

## 3. Workspace 清理策略

### 3.1 三种模式

| 模式 | 触发 | 机制 |
|------|------|------|
| **Auto** | Run 完成 + `KeepAfter=auto` | `RefCount==0` → worktree remove + 端口释放 + 目录删除 |
| **Manual** | `agenthub workspace clean` CLI | 指定 workspace/project/run 清理，支持 `--dry-run` / `--force` |
| **Scheduled** | 后台 5min ticker | TTL 过期 + 磁盘压力保护 |

### 3.2 Config

```yaml
workspace:
  cleanup:
    auto_enabled: true
    cold_ttl: 30m
    hot_max: 5
    min_disk_free_gb: 5
    schedule_interval: 5m
    keep_checkpoints: 10
```

### 3.3 安全保障

- **RefCount > 0 绝不清除**（借鉴 Kanna `activeTurns` Map）。
- **Checkpoint 先行**：Auto cleanup 前保存 Checkpoint（如启用）。
- **Git 保护**：worktree remove 前检查分支无未推送 commit。
- **Dry-run**：CLI `--dry-run` 预览清理效果。
- **磁盘压力**：`freeBytes < 5GB` → 淘汰最旧非活跃 workspace 直到达标。

---

## 4. WorkspaceManager 设计

借鉴 OpenHands `SandboxService` ABC (7 ops)、OpenCode `WorkspaceAdapter` (create/remove/target)、cross-analysis §1.3 接口草案。

```go
type WorkspaceManager struct {
    pool              *WorkspacePool
    providers         map[WorkspaceProviderType]WorkspaceProvider
    checkpointManager *CheckpointManager
    portPool          *PortPool
    dataRoot          string   // ~/.agenthub/runtime/workspaces/
}

// 生命周期
func (wm *WorkspaceManager) CreateOrReuse(ctx, spec WorkspaceSpec) (*WorkspaceInfo, error)
func (wm *WorkspaceManager) Prepare(ctx, wsID string, turnSpec TurnSpec) error
func (wm *WorkspaceManager) Release(ctx, wsID string) error
func (wm *WorkspaceManager) Destroy(ctx, wsID string, force bool) error

// 查询
func (wm *WorkspaceManager) Get(ctx, wsID string) (*WorkspaceInfo, error)
func (wm *WorkspaceManager) List(ctx, filter WorkspaceFilter) ([]*WorkspaceInfo, error)
func (wm *WorkspaceManager) ListByProject(ctx, projectID string) ([]*WorkspaceInfo, error)

// 文件操作
func (wm *WorkspaceManager) GetDiff(ctx, wsID string) (*DiffResult, error)
func (wm *WorkspaceManager) Discard(ctx, wsID string) error

// 清理
func (wm *WorkspaceManager) Cleanup(ctx, spec CleanupSpec) (*CleanupResult, error)
func (wm *WorkspaceManager) StartScheduledCleanup()

// 统计
func (wm *WorkspaceManager) Stats() WorkspaceStats
```

### WorkspaceProvider 接口

```go
type WorkspaceProvider interface {
    Name() WorkspaceProviderType      // "worktree"|"clone"|"docker"|"local"
    Detect(ctx, spec WorkspaceSpec) (*DetectionReport, error)
    Provision(ctx, spec WorkspaceSpec, detect DetectionReport) (*ProvisionResult, error)
    Configure(ctx, spec WorkspaceSpec, prov ProvisionResult) (*ConfigureResult, error)
    Verify(ctx, spec WorkspaceSpec, prov ProvisionResult) (*VerifyResult, error)
    GetDiff(ctx, rootPath string) (*DiffResult, error)
    Destroy(ctx, rootPath string) error
}
```

### Runner 集成

```
POST /runs → runner.createRun()
  ├─ WorkspaceManager.CreateOrReuse() → WorkspaceInfo (含 SessionToken)
  ├─ AgentCoordinator.StartTurn() → 传 WorkspaceInfo
  └─ Agent CLI 子进程: cwd=RootPath, env=AGENTHUB_*

Turn complete →
  ├─ WorkspaceManager.Release() → RefCount--
  ├─ CheckpointManager.Save() (如启用)
  └─ RefCount==0 && KeepAfter==auto → autoCleanup()
```

### 安全边界

| 数据 | 存储 | 保护 |
|------|------|------|
| Worktree 文件 | `.agenthub-worktrees/run_<id>/src/` | Agent CLI `--workspace` 限定 RootPath 内 |
| Session Token | `.agenthub/session.json` | 0600，仅 env 传递 |
| 端口 | `127.0.0.1:51xx` | 仅本地回环 |
| Secrets | `~/.agenthub/secrets.yaml` | 0600，由 Runner 注入子进程 env |

---

## 实施路线

| 阶段 | 内容 | 周 |
|------|------|-----|
| 1 | 核心生命周期: WorktreeProvider + CreateOrReuse + 状态机 + 端口池 | 1-2 |
| 2 | 池化: hot/cold pool + 淘汰 + 增量更新 + Deps 共享 | 2-3 |
| 3 | 清理: auto/manual/scheduled + 磁盘保护 + 安全保障 | 3-4 |
| 4 | 高级 Provider: CloneProvider + DockerProvider + LocalProvider | 4-6 |
