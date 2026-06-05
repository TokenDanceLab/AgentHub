# AgentHub Data Portability -- 导入/导出与会话共享设计

> 基于: design-eventstore-memory.md (JSONL 唯一事实源), deep-dive-librechat-message-tree.md (Fork/UUID 重生成),
> roadmap-research-to-implementation.md (P0-P4), design-cli-wizard.md (agenthub config)
>
> 目标: 会话导出、项目迁移、Session 分享、Agent 配置导入/导出的端到端方案。

---

## 1. 数据全景图

AgentHub 数据分布在四个层级，每层有不同的同步与迁移策略：

| 层 | 位置 | 内容 | Git | 同步方式 |
|---|------|------|:---:|---|
| Global Config | `~/.agenthub/config.yaml` | Agent 列表、workspace | 否 | 手动迁移 |
| Global Secrets | `~/.agenthub/secrets.yaml` | API Key (0600) | 否，永不外发 | 手动迁移 |
| Global Memory | `~/.agenthub/memory/` | preferences/, conventions/ | 可 | git-backed |
| Project Memory | `{project}/.agenthub/` | AGENTS.md, memory/, agents/ | 是 | 随项目 git |
| EventStore | `~/.agenthub/data/{project}/` | events.jsonl, snapshot.json.zst, index.db | 否 | seq-based sync (P2) |
| Content Pool | `~/.agenthub-runtime/.../.checkpoints/` | SHA-256 + zstd 文件快照 | 否 | 不迁移 |
| Agent Runtime | `~/.agenthub/runtime/` | PID/临时 socket | 否 | 不迁移 |

**核心原则**: JSONL 是唯一事实源。所有导出格式从 JSONL 派生，所有迁移以 JSONL 为最小可传输单元。

---

## 2. 会话导出格式

```
agenthub export <thread-id> [flags]

Flags:
  -f, --format <fmt>     jsonl | markdown | html (default: markdown)
  -o, --output <path>    输出文件路径
  --branches             包含所有兄弟分支（默认只导出活跃路径）
  --anonymize            脱敏
```

### 2.1 JSONL（机器可读，唯一事实源子集）

从 `events.jsonl` 提取指定 Thread 的全部 Event，保持原始结构。导入时通过 `agenthub import <file.jsonl>` 回放事件。使用场景：跨机器迁移、Hub 同步、程序化分析。

### 2.2 Markdown（人类可读，默认格式）

```
# Debug auth bug
**Thread**: th_abc | **Agent**: claude-code | **Turns**: 3

## Turn 1
**User** (10:00:01): Find the null pointer in auth.go
**Claude Code** (10:00:03): Found in auth.go:42 -- nil dereference before guard.
  Files: auth.go (+3/-1)

## Turn 2
**User** (10:00:15): Also add a test
**Claude Code** (10:00:20): Created auth_test.go with table-driven tests.
```

生成算法: EventStore 加载 Thread Events -> `buildTree()` 构建消息树 -> 按 Turn 分组渲染。

### 2.3 HTML（富文本分享）

单文件 HTML，自包含 CSS/JS，支持消息气泡、分支折叠、代码高亮、Diff 卡片。内联完整 JSONL 数据 -- 接收方可双击浏览器查看或通过 `agenthub import` 回灌。

---

## 3. 项目迁移（换电脑 / 重装系统）

### 3.1 迁移命令

```
agenthub migrate [flags]
  --export <dir>       导出到目录（生成 tarball）
  --import <file>      从 tarball 导入
  --project <name>     指定项目（默认全部）
  --dry-run            预览迁移内容
```

### 3.2 导出流程

1. 扫描 `~/.agenthub/data/` 下所有 project，复制 `events.jsonl`（或先 trigger compaction）
2. 收集 Global Memory（`~/.agenthub/memory/`）
3. 打包 `tar czf agenthub-migration-{date}.tar.gz`，输出清单（项目数、事件数、大小）

### 3.3 导入流程

1. 解压 tarball -> 逐 project 复制 `events.jsonl` -> `replayLogs()` 回放 -> 重建 FTS5 索引
2. 合并 Global Memory（同名文件提示冲突）
3. 验证: `agenthub doctor --json`

### 3.4 FTS5 索引策略

目标机器的 `index.db` 可选复制或重建。推荐复制以保留搜索历史；若只传 `events.jsonl`，导入后从事件流全量重建（Go 端逐行回放，message_appended 触发 FTS5 触发器）。

### 3.5 迁移清单速览

```
源机器                               目标机器
~/.agenthub/                         ~/.agenthub/
├── config.yaml          ──复制──▶   config.yaml (检查路径)
├── secrets.yaml         ──复制──▶   secrets.yaml (0600)
├── memory/              ──复制──▶   memory/ (可选，或 git clone)
└── data/{project}/      ──导出──▶   data/{project}/
    ├── events.jsonl                   ├── events.jsonl
    └── index.db                       └── index.db (或重建)

{project}/.agenthub/    ──git──▶    {project}/.agenthub/
```

不迁移: `runtime/` (临时文件), `logs/` (滚动日志), Content Pool (随项目 git), Hub 连接状态 (重连自建)。

---

## 4. Session 分享

### 4.1 三种模式

| 模式 | 触发方式 | 接收方看到 | 阶段 |
|------|---------|-----------|:---:|
| 只读链接 | 浏览器打开导出 HTML | 静态页面，无交互 | P1 |
| Fork 分享 | `agenthub share --fork <thread-id>` | 独立可编辑副本 | P1 |
| 协作链接 | Hub 实时 sync (P2+) | 双向实时编辑 | P2 |

### 4.2 只读分享（ShareView）

参考 LibreChat `ShareView.tsx`：后端 `POST /api/threads/:id/share` 生成 256-bit share token，返回 `{ share_url, expires_at }`。前端渲染只读消息树 + 分支导航。安全约束：默认 7 天过期、禁止 fork/回复/编辑、可选密码保护。

### 4.3 Fork 分享（深度克隆 + UUID 重生成）

参考 LibreChat Fork 机制（4 种模式: `direct`/`branches`/`target`/`default`）：

```
agenthub share --fork <thread-id> [--mode <direct|branches|target>]

流程:
1. 根据 mode 选择消息子集（同 LibreChat ForkOptions）
2. 深度克隆: 重新生成 messageId (UUID v4) + 重新生成 conversationId +
   修正时间戳 (子 > 父, +1ms) + 重建 parentMessageId 引用链
3. 创建新 session 返回接收方，原始 session 不受影响
```

与 LibreChat 差异: AgentHub Fork 分享可**跨用户**（LibreChat 仅同用户内），副本自动关联接收方 `~/.agenthub/data/`。

### 4.4 协作链接（P2 Hub-Sync）

Hub 连接建立后，Thread 可设为 `visibility: "collaborative"`，指定 `collaborators` 列表。Edge 端通过 seq-based 增量同步实时拉取协作者消息。

---

## 5. Agent 配置导出/导入

### 5.1 配置层次

```
~/.agenthub/
├── config.yaml            # Agent 声明 + workspace + 端口
├── secrets.yaml           # API Key (0600, 永不导出)
{project}/.agenthub/agents/{name}/
├── CLAUDE.md              # Agent 专属指令
├── skills/                # Agent Skills
└── memory/                # Agent 专属记忆
```

### 5.2 导出命令

```
agenthub config export [flags]
  --agent <name>        指定 Agent（默认全部）
  --include-secrets     包含 secrets（需 --force + 确认，默认排除）
  --output <dir>        输出目录

导出产物（默认不含 secrets）:
  agenthub-config-export/
  ├── config.yaml
  ├── adapters/
  └── agents/{name}/
      ├── CLAUDE.md
      └── skills/
```

### 5.3 导入命令

```
agenthub config import <dir> [flags]
  --merge          合并到现有配置（默认覆盖）
  --skip-secrets   跳过 secrets 导入（默认）
  --dry-run        预览变更
```

安全检查: 二进制路径不存在则 WARN+跳过; API key 未配置则 WARN; `--merge` 下同名 Agent 提示确认; 导入后自动 `agenthub doctor --json`。

### 5.4 跨平台路径适配

导入时 `exec.LookPath` 自动适配 Windows/Unix 二进制名（`claude` / `claude.exe`）。查找失败保留原值，由用户手动修正。非破坏性。

---

## 6. 实现路线图

| 阶段 | 功能 | 优先级 | 依赖 | 预估 |
|------|------|:---:|------|:---:|
| P0 | `agenthub config export/import` (不含 secrets) | P0 | `agenthub init` | 1d |
| P0 | Markdown 导出 | P0 | EventStore 读接口 | 1d |
| P1 | `agenthub migrate --export/--import` | P1 | EventStore Compaction | 1.5d |
| P1 | Fork 分享 + UUID 重生成 | P1 | Fork API (Go) | 2d |
| P1 | 只读 ShareView (HTML + share token) | P1 | Web UI ShareView | 2d |
| P1 | JSONL 导入 + FTS5 重建 | P1 | EventStore + FTS5 | 1d |
| P2 | Hub Share URL (token + 过期) | P2 | Hub Server | 2d |
| P2 | 协作 Thread (seq-based sync) | P2 | Hub-Edge sync protocol | 3d |
| P2 | HTML 导出自包含渲染引擎 | P2 | 前端组件提取 | 1.5d |
| P3 | E2EE Share (协作链接加密) | P3 | Hub Relay | 3d |

---

## 7. 关键设计决策

| 决策 | 选择 | 依据 |
|------|------|------|
| 导出唯一事实源 | JSONL | 与 EventStore 同格式；导入即回放；增量同步天然支持 |
| Fork 克隆 | UUID v4 全量重生成 | LibreChat 验证；避免 ID 冲突；独立可编辑 |
| Secrets | 默认排除，`--include-secrets` 需确认 | 安全底线；API key 永不出现在导出产物中 |
| 迁移粒度 | 以 project 为单位 | 对应 `data/{project}/` 目录；EventStore 按 project 隔离 |
| FTS5 迁移 | 可选复制或重建 | 索引可从 JSONL 重建（幂等），复制更省时间 |
| 跨平台路径 | `exec.LookPath` 自动适配 | 非破坏性；失败保留原值由用户修正 |
| Share Token | 256-bit random + 7d 过期 | 不可猜测；默认短期降低泄露风险 |
| 配置分离 | config.yaml 可导出，secrets.yaml 不参与 | design-cli-wizard.md Sec 4.5 安全底线 |

---

*Design complete. 2026-05-21. Based on design-eventstore-memory.md, deep-dive-librechat-message-tree.md, roadmap-research-to-implementation.md, design-cli-wizard.md.*
