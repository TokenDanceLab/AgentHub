# AgentHub 全局搜索 -- 设计规格

> 跨仓库分析: claude-code-viewer（FTS5 + TreeWalker）、librechat（消息搜索）、cloudcli（文件树搜索）、
> design-eventstore-memory（FTS5 schema）、design-keyboard-shortcuts（Ctrl+K）。
> 日期: 2026-05-21 | 状态: 草稿 v1.0

---

## 1. 跨仓库要点

Claude Code Viewer 提供了成熟的双层架构：SQLite FTS5（porter tokenizer）用于跨会话搜索 + DOM TreeWalker（`document.createRange`）用于页内高亮。LibreChat 贡献了带分类过滤的会话范围搜索。CloudCLI 增加了带自动展开匹配目录的文件树搜索。现有工具中没有同时覆盖多提供商会话、authority 感知过滤或 Artifact 类型搜索的——这些是 AgentHub 的差异化需求。

**核心借鉴**：FTS5 外部内容表 + BM25 排序（claude-code-viewer）、Ctrl+K Command Palette 入口（design-keyboard-shortcuts）、文件树内容搜索（cloudcli）、用于结果预览的 `snippet()`（claude-code-viewer）。

---

## 2. 搜索架构

### 2.1 四级搜索范围

```
Tier 1: 页内（Ctrl+F）
  当前 Thread 视口。纯前端 DOM TreeWalker + Range 高亮。
  无 FTS5 依赖。最多重试 6 帧 rAF 以应对异步渲染。

Tier 2: 当前会话（Ctrl+K 默认）
  活跃会话内的所有 thread/turn/message。
  在 messages_fts 上执行 FTS5 MATCH，WHERE thread_id IN（活跃会话 thread）。

Tier 3: 跨会话 / 项目（Ctrl+K，范围切换）
  当前项目下所有会话。
  在 messages_fts 上执行 FTS5 MATCH，WHERE project_id = ?。
  结果按会话分组，带片段预览。

Tier 4: 全局（Ctrl+K，范围切换）
  AgentHub 已知的所有项目。跨所有项目索引的 FTS5（UNION 或多 attach）。
  结果按项目 -> 会话分组。
```

### 2.2 FTS5 索引 Schema

扩展自 `design-eventstore-memory.md` S3.6。关键新增：`agent_name`、`authority`、`artifact_type` 列用于过滤维度。

```sql
CREATE TABLE messages (
    id           INTEGER PRIMARY KEY,
    event_seq    INTEGER NOT NULL,
    project_id   TEXT NOT NULL,
    thread_id    TEXT NOT NULL,
    turn_id      TEXT,
    sender_type  TEXT NOT NULL,       -- 'user' | 'agent' | 'system'
    agent_name   TEXT,                -- 'claude-code' | 'codex' | ...
    authority    TEXT,                -- 'hub' | 'edge-xxx' | 'shared'
    content      TEXT NOT NULL,
    artifact_type TEXT,               -- 'code' | 'markdown' | 'diff' | 'file' | NULL
    created_at   INTEGER NOT NULL     -- Unix 毫秒
);

CREATE VIRTUAL TABLE messages_fts USING fts5(
    content,
    sender_type UNINDEXED, agent_name UNINDEXED,
    authority UNINDEXED,   artifact_type UNINDEXED,
    content='messages', content_rowid='rowid',
    tokenize='porter unicode61'
);

CREATE TRIGGER messages_ai AFTER INSERT ON messages BEGIN
    INSERT INTO messages_fts(rowid, content, sender_type, agent_name, authority, artifact_type)
    VALUES (new.rowid, new.content, new.sender_type, new.agent_name, new.authority, new.artifact_type);
END;
```

EventStore `Append()` 驱动 INSERT 到 `messages`；FTS5 触发器自动处理索引同步。

### 2.3 带权重的 BM25 排序

以 FTS5 BM25 为基础，在 ORDER BY 子句中应用乘数加权：

| 信号 | 权重 | 理由 |
|--------|--------|-----------|
| 用户消息 | 1.2x | 直接意图信号（claude-code-viewer 已验证） |
| Agent 消息（基线） | 1.0x | 默认 |
| Artifact 消息（code/diff/file） | 1.3x | 高价值产出 |
| 系统消息 | 0.6x | 内部管理，搜索价值低 |

```sql
SELECT m.id, m.thread_id, snippet(messages_fts, 2, '<b>', '</b>', '...', 40) AS snippet,
       bm25(messages_fts, 1.0, 0.75) AS rank,
       m.sender_type, m.agent_name, m.artifact_type, m.created_at
FROM messages_fts JOIN messages m ON m.rowid = messages_fts.rowid
WHERE messages_fts MATCH ? AND m.project_id = ?
ORDER BY CASE m.sender_type
    WHEN 'user'   THEN rank * 1.2
    WHEN 'agent'  THEN CASE WHEN m.artifact_type IS NOT NULL THEN rank * 1.3 ELSE rank END
    ELSE rank * 0.6
END DESC
LIMIT 20;
```

### 2.4 片段 / 高亮策略

| 上下文 | 方法 |
|---------|--------|
| 搜索结果列表 | FTS5 `snippet()` 使用 `<b>` 标签；在 UI 中渲染为 `<mark>`。40 字符窗口，2 个上下文 token。 |
| 消息展开视图 | DOM TreeWalker + `document.createRange()`。遍历文本节点，为每个匹配创建 Range，包裹在 `<mark>` 中。最多重试 6 帧 rAF 以应对虚拟滚动渲染。 |
| 文件 Artifact 内容 | Monaco `deltaDecorations` -- 高亮而不修改文档模型。 |

---

## 3. Command Palette UI（Ctrl+K）

### 3.1 激活规则

- `Ctrl+K` 打开面板（全局层，依据 `design-keyboard-shortcuts.md` S3.1）。`Ctrl+Shift+F` 作为备用。
- 当 textarea/编辑器获得焦点时**阻止**（`document.activeElement` 标签检查）——穿透到 Monaco "删除行"。
- `Escape`：如果查询有内容则清除，否则关闭面板。两阶段设计确保肌肉记忆安全。

### 3.2 面板布局

```
┌───────────────────────────────────────────────────────────┐
│ > search query here...                                    │
│ SCOPE: [Current Session]  Project  Global                 │
│ AGENT: [All v]  DATE: [7d v]  TYPE: [All v]  AUTH: [v]   │
│                                                           │
│ ── Sessions（3）────────────────────────────────────      │
│ ● user  "deploy fails with 403"                           │
│   ~/my-project  session-abc123  claude-code  2h ago       │
│                                                           │
│ ── Messages（5）────────────────────────────────────      │
│ ● agent  "The <b>403 error</b> is caused by..."           │
│   Turn #3  claude-code  artifact:markdown  2h ago         │
│                                                           │
│ ── Artifacts（2）───────────────────────────────────      │
│ ■ deploy.sh    ~/my-project/scripts/deploy.sh             │
│   Matched "deploy" in file content                        │
│                                                           │
│ ── Actions（查询为空或匹配标签时）──                       │
│ ⚡ Toggle Sidebar    Ctrl+B    ⚡ Toggle Panel    Ctrl+J   │
│───────────────────────────────────────────────────────────│
│ [Enter] open  [Ctrl+Enter] new tab  [Esc] close           │
└───────────────────────────────────────────────────────────┘
```

### 3.3 结果分组排序与限制

1. Actions（查询为空或匹配标签时）-- Command Palette 回退模式。
2. Sessions -- 全局范围时按项目分组。
3. Messages -- BM25 排序，在匹配的会话内。
4. Artifacts -- 文件/内容由 FTS5 匹配。

每组分项：最多 5 项 + 折叠下方 "Show all (N)" 展开器。空查询显示最近 10 个会话 + 常用操作。

---

## 4. 过滤系统

### 4.1 过滤维度

| 过滤器 | 类型 | 来源列 | UI |
|--------|------|---------------|-----|
| Agent | 多选 | `agent_name` | 带 agent 图标 + 名称的下拉框 |
| Date | 预设 + 自定义 | `created_at` | 芯片：24h / 7d / 30d / All + 日期选择器 |
| Artifact Type | 多选 | `artifact_type` | `code` / `markdown` / `diff` / `file` / `none` |
| Authority | 多选 | `authority` | `hub` / 每个 edge。默认折叠。 |
| Sender | 单选 | `sender_type` | All / User / Agent |

### 4.2 Go 搜索 API

```go
type SearchOptions struct {
    Query         string
    ProjectID     string      // 空 = 全局范围
    ThreadIDs     []string    // 空 = 范围内的全部
    AgentNames    []string
    SenderTypes   []string
    ArtifactTypes []string
    Authorities   []string
    Since, Until  int64       // Unix 毫秒，0 = 无限制
    Limit, Offset int         // 默认 20 / 0
}

// SearchService 封装每个项目的 index.db
type Service struct { db *sql.DB }
func (s *Service) Search(ctx context.Context, query string, opts SearchOptions) (*SearchResponse, error)
```

过滤器转换为 `WHERE` 子句；空切片跳过条件。只有 `Query` 字段输入 FTS5 MATCH；所有其他字段为精确列过滤。

---

## 5. 范围切换

默认范围 = `localStorage.lastUsed`（回退：当前会话）。点击范围芯片立即重新运行查询（无需提交）。

| 范围 | FTS5 WHERE | 备注 |
|-------|-----------|------|
| Current Session | `thread_id IN (<活跃 thread>)` | 无活跃会话时禁用（如仪表板） |
| Project | `project_id = <当前>` | 用户通常在一个项目中工作时为默认 |
| Global | 所有项目 index.db 文件 | UNION 或多 attach 方式 |

键盘：`Ctrl+1/2/3` 直接选择范围层级。Tab 在范围芯片间循环。

---

## 6. 页内搜索（Ctrl+F）

补充 Ctrl+K 的视口内搜索。在会话视图上打开粘性顶部栏：

```
 🔍 [search term________]  3/12  [▲] [▼] [✕]
```

实现（claude-code-viewer S4.3 模式）：
1. `TreeWalker` 遍历会话容器内所有文本节点。
2. 每个匹配 `document.createRange()`；`getBoundingClientRect()` -> `scrollIntoView`。
3. 在 `<mark class="search-highlight">` 中包裹匹配项。
4. 通过 `requestAnimationFrame` 重试（最多 6 次）以应对虚拟滚动异步渲染。
5. 导航：`Enter` = 下一个，`Shift+Enter` = 上一个。
6. 清理：关闭时移除所有 `<mark>` 标签。

仅在消息树层获得焦点时激活（依据 `design-keyboard-shortcuts.md` S2 层范围）。

---

## 7. 键盘导航

| 按键 | 操作 |
|-----|--------|
| `ArrowDown` / `j` | 下一结果 |
| `ArrowUp` / `k` | 上一结果 |
| `Enter` | 打开：导航到会话 + 滚动到消息 |
| `Ctrl+Enter` | 在新标签页中打开 |
| `Escape` | 清除查询 / 关闭面板（两阶段） |
| `Tab` | 在范围芯片间循环 |
| `Ctrl+1..3` | 直接选择范围层级 |

---

## 8. 迁移路径

| 阶段 | 交付物 | 依赖 |
|-------|------------|------------|
| P1 | FTS5 schema + 触发器 + `Search()` Go 函数 | `design-eventstore-memory` Phase 2 |
| P1 | `Ctrl+K` 面板 UI 骨架（空查询时显示最近会话） | `design-keyboard-shortcuts` |
| P2 | 带 sender/artifact 加权的 BM25 排序 | P1 搜索 |
| P2 | 过滤栏（Agent/Date/Type/Authority UI + 查询构建器） | P1 面板 |
| P2 | 范围切换（当前会话 / 项目 / 全局） | P1 搜索 |
| P3 | `Ctrl+F` 页内 TreeWalker 搜索 | 页内容器 ref |
| P3 | 片段高亮渲染 + 滚动到匹配项 | P1 结果 |
| P3 | Artifact 内容搜索（文件树 + Monaco 集成） | P1 搜索 |

---

## 9. 设计决策

| 决策 | 选择 | 理由 |
|----------|--------|-----------|
| 引擎 | SQLite FTS5 porter unicode61 | 在 claude-code-viewer 中已验证；纯 Go 通过 modernc.org/sqlite |
| 排序 | BM25 + sender/artifact 加权 | 用户消息（1.2x）= 意图信号；artifact（1.3x）= 高价值产出 |
| 搜索层 | FTS5（跨会话）+ TreeWalker（页内） | 单一方案无法同时覆盖；claude-code-viewer 模式已验证 |
| UI 入口 | 带范围芯片 + 过滤器的 `Ctrl+K` Command Palette | VS Code 用户熟悉；范围搜索防止结果过载 |
| 片段 | 40 字符，2 个 token，`<b>` 标签 -> `<mark>` UI | 在上下文量与可扫描性之间平衡 |
| 结果顺序 | Sessions -> Messages -> Artifacts -> Actions | 先找到会话，再找到具体内容 |
| 范围记忆 | `localStorage` 上次使用值 | 减少有稳定范围偏好用户的摩擦 |
| Authority 过滤器 | 可用，默认折叠 | 高级用户功能；单用户部署时为噪音 |
