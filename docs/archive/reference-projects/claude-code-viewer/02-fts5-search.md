# Claude Code Viewer FTS5 & JSONL -- 实现模式深度提取

> 从源码级提取 Claude Code Viewer 的 FTS5 搜索和 JSONL 解析模式，供 AgentHub 实现参考。
> 源码路径：`D:\Code\AgentHub\reference\claude-code-viewer\`
> 对比基线：`design-eventstore-memory.md` 中引用的 cc-viewer 模式描述存在偏差，本文以前者为准。

---

## 1. 核心纠正：源码 vs 设计文档

`design-eventstore-memory.md` 第 49-67 行对 cc-viewer FTS5 的引用存在三处不准确：

| 项目 | 设计文档描述 | 实际源码 | 影响 |
|------|------------|---------|------|
| Tokenizer | `porter unicode61` | `trigram` | CJK 搜索能力完全不同 |
| 同步方式 | external content + triggers | DELETE + INSERT (每 session 全量替换) | 无触发器依赖 |
| content=/content_rowid= | 有 external content 绑定 | 无，直接 INSERT 到 fts 表 | FTS5 表独立运行 |

**AgentHub 决策影响**：AgentHub `design-eventstore-memory.md` 第 474-502 行规划的 FTS5 schema 使用 `porter unicode61` + external content + triggers，这是有意识的选择（面向英文技术文档为主），但应知悉 cc-viewer 实际用 trigram（面向多语言会话日志，含 CJK 代码注释/变量名）。若 AgentHub 后续需要 CJK 搜索，应参考 cc-viewer 的 trigram 方案。

---

## 2. FTS5 表结构（精确到列）

### 2.1 DDL

```sql
-- 来源: src/server/lib/db/DrizzleService.ts:13-22
CREATE VIRTUAL TABLE IF NOT EXISTS session_messages_fts USING fts5(
    session_id UNINDEXED,
    project_id UNINDEXED,
    role UNINDEXED,
    content,
    conversation_index UNINDEXED,
    tokenize='trigram'
);
```

**关键设计决策**：

1. **No external content table**: FTS5 表是独立的，不与任何物理表绑定。这意味着 content 被存储了两次（FTS5 内部 + 可选外部表），但查询时无需 JOIN 回源表即可获取 snippet。

2. **4 个 UNINDEXED 列**：`session_id`, `project_id`, `role`, `conversation_index` 都标记为 UNINDEXED，它们不参与全文匹配但作为过滤和排序的 metadata。content 是唯一被索引的列。

3. **No `prefix` index**: 没有定义 prefix 索引，意味着前缀搜索（如 `prefix: "foo*"`）不可用。这是有意为之——trigram tokenizer 对短前缀匹配效果差，且该应用场景只需子串匹配。

4. **trigram tokenizer 选型原因**（推断自 mode 是会话日志）：
   - `porter` 是英文词干提取，对代码标识符（camelCase/snake_case）和 CJK 文本无效
   - `trigram` 做 3-gram 切分，对任意 Unicode 字符序列都可用，适合混排中英日代码的搜索
   - 代价是索引体积更大（每个 token 是 3-char slice）

### 2.2 表初始化时机

```typescript
// src/server/lib/db/DrizzleService.ts:24-34
const initDbAtPath = (cacheDbPath: string) => {
    const sqlite = new DatabaseSync(cacheDbPath);
    sqlite.exec("PRAGMA journal_mode = WAL");
    sqlite.exec("PRAGMA foreign_keys = ON");

    const db = drizzle({ client: sqlite, schema });
    migrate(db, { migrationsFolder });   // Drizzle ORM migrations first
    sqlite.exec(FTS5_DDL);               // FTS5 DDL after (not managed by Drizzle)

    return { db, rawDb: sqlite };
};
```

**注意**：FTS5 DDL 不在 Drizzle migration 中管理，而是用原生 SQL `exec()` 执行。原因是 Drizzle ORM 不支持 FTS5 virtual table 的 DDL 生成。测试层 (`testDrizzleServiceLayer.ts:13-22`) 使用完全相同的 DDL 字符串（in-memory SQLite），通过 `sqlite.exec()` 执行。

### 2.3 DB 故障恢复

```typescript
// src/server/lib/db/DrizzleService.ts:62-84
// 如果 migration 失败，删除 cache.db + WAL/SHM，重建
if (dbResult._tag === "Right") {
    return dbResult.right;
}
// 关闭损坏的 DB
new DatabaseSync(dbPath).close();
// 删除 db + wal + shm
for (const suffix of ["", "-wal", "-shm"]) {
    yield* fs.remove(`${dbPath}${suffix}`, { force: true });
}
// 重新初始化
return initDbAtPath(dbPath);
```

**对 AgentHub 的价值**：FTS5 索引是可重建的（JSONL 是唯一事实源），因此 DB 损坏时直接删除重建比修复更简单可靠。

---

## 3. BM25 排序 + Snippet/Highlight 实现

### 3.1 搜索查询构造

```typescript
// src/server/core/search/services/SearchService.ts:48-80
const search = (query: string, limit = 20, projectId?: string) =>
    Effect.gen(function* () {
        if (!query.trim()) {
            return { results: [] };
        }

        const ftsQuery = escapeFtsQuery(query);  // 转义 → 双引号包裹

        let drizzleQuery = sql`
            SELECT
                fts.session_id,
                fts.project_id,
                p.name as project_name,
                fts.role,
                fts.content,
                CAST(fts.conversation_index AS INTEGER) as conversation_index,
                fts.rank,
                s.last_modified_at
            FROM session_messages_fts fts
            LEFT JOIN projects p ON p.id = fts.project_id
            LEFT JOIN sessions s ON s.id = fts.session_id
            WHERE session_messages_fts MATCH ${ftsQuery}
        `;

        // 可选：限定 project
        if (projectId !== undefined) {
            drizzleQuery = sql`${drizzleQuery} AND fts.project_id = ${projectId}`;
        }

        // rank 排序 + 双重取样（为后续 role 过滤留余量）
        drizzleQuery = sql`${drizzleQuery} ORDER BY rank LIMIT ${limit * 2}`;
    });
```

**关键点**：

1. **`fts.rank`**：FTS5 的内置隐藏列，BM25 算法计算。**负值，越小（越负）越相关**。
2. **`LIMIT ${limit * 2}`**：因为后续代码会过滤掉非 user/assistant 的 role（如 custom-title、ai-title），所以需要取 2 倍余量保证最终有足够的有效结果。
3. **3 表 JOIN**：FTS5 → projects（获取 project name）→ sessions（获取 last_modified_at 时间戳）。FTS5 自身不含这些 metadata。

### 3.2 Query 转义（Trigram Tokenizer 特定）

```typescript
// src/server/core/search/services/SearchService.ts:36-39
const escapeFtsQuery = (query: string): string => {
    const escaped = query.replace(/"/g, '""');  // SQLite 双引号转义
    return `"${escaped}"`;                        // 整个查询包在双引号内
};
```

**为什么是整个查询包双引号？**

FTS5 默认分词器使用 `"` 作为短语分组符。trigram tokenizer 不做分词，所以 `"` 没有语义作用，但仍会被 FTS5 parser 解析。直接传入裸文本时，如果包含 `(`、`)`、`"` 等特殊字符，会导致 FTS5 解析错误。因此：

- 把整个 user input 包在双引号内 → 告诉 FTS5 "这是一个整体，不要解析内部语法"
- 内部双引号需要转义 → `""` 是 SQLite 的转义方式

### 3.3 手动 Snippet 提取

cc-viewer **不使用** FTS5 内置的 `snippet()` 函数，而是自己实现：

```typescript
// src/server/core/search/services/SearchService.ts:92-106
const text = row.content;
const queryLower = query.toLowerCase();
const textLower = text.toLowerCase();
const matchIndex = textLower.indexOf(queryLower);
const snippetLength = 150;

let snippet: string;
if (matchIndex !== -1) {
    const start = Math.max(0, matchIndex - 50);           // 匹配前 50 chars
    const end = Math.min(text.length, start + snippetLength);  // 总计 150 chars
    snippet = (start > 0 ? "..." : "") + text.slice(start, end) + (end < text.length ? "..." : "");
} else {
    // BM25 匹配了但 indexOf 没找到（trigram 匹配了但子串不对齐），截前 150 chars
    snippet = text.slice(0, snippetLength) + (text.length > snippetLength ? "..." : "");
}
```

**为什么不使用 `snippet()`？**

1. `snippet()` 是同步函数，在 effect 异步上下文中调用需要额外处理
2. `snippet()` 用 FTS5 的 tokenizer 决定高亮边界，但 trigram tokenizer 的 token 边界对用户不可见，产生的 snippet 截断效果不如简单的 indexOf + 前后 context
3. 手动实现可以精确控制 snippet 长度（150 chars）和偏移（前 50 chars）

### 3.4 BM25 分数变换 + 用户消息加权

```typescript
// src/server/core/search/services/SearchService.ts:108-110
// FTS5 rank is negative (BM25): larger absolute value = more relevant
// Boost user messages
const score = row.role === "user" ? -row.rank * 1.2 : -row.rank;
```

**分数公式**：
- 原始 BM25：`rank ∈ (-∞, 0)`，越小越相关
- 用户可见分数：`-(rank) * role_multiplier`，正数，越大越相关
- 用户消息系数：**1.2x**（用户的问题往往是最想找的内容）

### 3.5 结果过滤

```typescript
// src/server/core/search/services/SearchService.ts:88-91
for (const row of rows) {
    if (results.length >= limit) break;
    if (!isValidRole(row.role)) continue;  // 只保留 "user" | "assistant"
}
```

过滤掉 `custom-title`、`ai-title` 等非对话内容（这些类型的 content 也被索引了，但在搜索结果中不展示）。

### 3.6 Index Invalidation

```typescript
// src/server/core/search/services/SearchService.ts:133-134
// FTS5 always reads latest data, so invalidation is a no-op
const invalidateIndex = () => Effect.void;
```

FTS5 虚拟表在每次查询时读取最新数据，不需要像 ElasticSearch 那样的显式刷新操作。

---

## 4. JSONL 解析管道（精确到函数签名）

### 4.1 核心解析函数

```typescript
// src/server/core/claude-code/functions/parseJsonl.ts:4-37
export const parseJsonl = (content: string): ExtendedConversation[] => {
    const lines = content
        .trim()
        .split("\n")
        .filter((line) => line.trim() !== "");

    return lines.map((line, index) => {
        // Step 1: JSON.parse
        let parsed: unknown;
        try {
            parsed = JSON.parse(line);
        } catch {
            return { type: "x-error", line, lineNumber: index + 1 };
        }

        // Step 2: Zod schema validation
        const result = ConversationSchema.safeParse(parsed);
        if (!result.success) {
            return { type: "x-error", line, lineNumber: index + 1 };
        }

        return result.data;
    });
};
```

**设计要点**：
1. **双阶段校验**：先 JSON.parse（内置，快），再 Zod safeParse（schema validation，慢但安全）
2. **永不抛异常**：两种失败都返回 `ErrorJsonl` 占位对象，调用方无需 try-catch
3. **错误只记录行内容**：不记录错误信息（`error.type`、`error.issues` 等），因为 `x-error` 的语义是 "这行解析不了" 而非 "为什么解析不了"
4. **行号从 1 开始**：`lineNumber: index + 1`

### 4.2 类型定义

```typescript
// src/types/conversation.ts
export type ErrorJsonl = {
    type: "x-error";
    line: string;
    lineNumber: number;
};

export type ExtendedConversation = Conversation | ErrorJsonl;
```

**`x-error` 作为 discriminated union**：`type: "x-error"` 使得调用方可以通过 `conversation.type === "x-error"` 来安全识别错误行。

### 4.3 JSONL 读取 → 解析 → FTS 索引的完整管道

```typescript
// SyncService.ts:162-327 (parseAndUpsertSession 内部)
// Step 1: 读取文件
const content = yield* fs.readFileString(filePath);

// Step 2: 解析 JSONL
const conversations = parseJsonl(content);

// Step 3: 提取 searchable text（只取 user/assistant/custom-title/ai-title）
const ftsEntries: Array<{ role: string; content: string; index: number }> = [];
for (let i = 0; i < conversations.length; i++) {
    const conversation = conversations[i];
    if (conversation === undefined) continue;
    const text = extractSearchableText(conversation);
    if (text !== null && text.trim() !== "") {
        ftsEntries.push({
            role: conversation.type,
            content: text,
            index: i,              // conversation_index = 行号
        });
    }
}

// Step 4: DB 事务（DELETE + INSERT）
db.transaction((tx) => {
    // Upsert session metadata 到 sessions 表（略）

    // 全量替换 FTS5 索引
    rawDb.prepare("DELETE FROM session_messages_fts WHERE session_id = ?").run(sessionId);

    for (const entry of ftsEntries) {
        rawDb.prepare(
            `INSERT INTO session_messages_fts (session_id, project_id, role, content, conversation_index)
             VALUES (?, ?, ?, ?, ?)`
        ).run(sessionId, projectId, entry.role, entry.content, entry.index);
    }
});
```

### 4.4 文本提取函数

```typescript
// src/server/core/search/functions/extractSearchableText.ts:8-38
export const extractSearchableText = (conversation: ExtendedConversation): string | null => {
    if (conversation.type === "x-error")        return null;
    if (conversation.type === "user")           return extractUserText(conversation);
    if (conversation.type === "assistant")      return extractAssistantText(conversation);
    if (conversation.type === "custom-title")   return conversation.customTitle;
    if (conversation.type === "ai-title")       return conversation.aiTitle;
    // agent-name, agent-setting, system, summary, 其他类型 → null（不索引）
    return null;
};

// User text: string | Array<{ type: "text"; text: string } | ... >
// 多模态内容提取：string 直接返回，数组取 .text 字段
const extractUserText = (entry) => {
    const content = entry.message.content;
    if (typeof content === "string") return content;
    return content.map(item => {
        if (typeof item === "string") return item;
        if ("text" in item && typeof item.text === "string") return item.text;
        return "";
    }).filter(Boolean).join(" ");
};

// Assistant text: Array<{ type: "text"; text: string }>
const extractAssistantText = (entry) => {
    return entry.message.content
        .filter(item => item.type === "text" && "text" in item)
        .map(item => item.text)
        .join(" ");
};
```

**索引范围**：只有 4 种 type 被索引（user, assistant, custom-title, ai-title）。system, summary, file-history-snapshot, queue-operation, progress, permission-mode, pr-link, last-prompt, agent-name, agent-setting 等内部元数据不进入索引。

---

## 5. 与 AgentHub 设计的对照分析

### 5.1 FTS5 Schema 差异

| 维度 | Claude Code Viewer (实际) | AgentHub (design-eventstore-memory.md) |
|------|--------------------------|----------------------------------------|
| Tokenizer | `trigram` | `porter unicode61` |
| External content | 无（独立 FTS5 表） | 有（`content='messages'`, `content_rowid='rowid'`） |
| 触发器 | 无 | `CREATE TRIGGER messages_fts_ai AFTER INSERT` |
| 同步模式 | 应用层 DELETE+INSERT | 数据库层触发器自动 |
| UNINDEXED 列 | session_id, project_id, role, conversation_index | thread_id |
| 基表 | 无（FTS5 独立） | `messages( id, event_seq, thread_id, turn_id, sender_type, content, created_at )` |

### 5.2 设计权衡

**Claude Code Viewer 选择独立 FTS5 表的原因**：
- Session JSONL 文件是外部唯一事实源，不在 SQLite 中持久化
- 每个 session sync 时全量替换 FTS 条目，不需要增量触发器
- 独立的 FTS5 表使得 schema 变更时不需要处理基表迁移
- DELETE + INSERT 对单 session（几百条消息）的性能开销可忽略

**AgentHub 选择 external content + triggers 的原因**：
- AgentHub 的 messages 基表本身就是持久化层（不只是缓存）
- 增量序列号同步意味着消息逐条到达，触发器逐条同步最自然
- `porter unicode61` 对英文技术文档的搜索精度更高

### 5.3 可复用的模式

以下模式直接适用于 AgentHub：

1. **原始 rank 转正向分数**：`score = -row.rank * (role === "user" ? 1.2 : 1.0)`
2. **LIMIT * 2 + 应用层过滤**：当 FTS5 结果需要 post-filter 时，取 2 倍余量
3. **双引号包裹 + 转义**：FTS5 MATCH 的安全输入方式
4. **手动 snippet 提取**：`indexOf(queryLower) -> slice(matchIndex - 50, +150)`
5. **`fts.rank` 的 `ORDER BY rank`**：不需要 `ORDER BY rank ASC`，因为 rank 本身就是越小越相关
6. **FTS5 表不纳入 ORM migration**：用原生 SQL exec 管理
7. **DB 损坏时重建**：因为唯一事实源在 JSONL，索引重建成本低

---

## 6. AgentHub FTS5 搜索的 Go 实现参考

### 6.1 SQL schema（修正版，来自 design-eventstore-memory.md 3.6 节）

```sql
-- ~/.agenthub/data/{project}/index.db

CREATE TABLE messages (
    id         INTEGER PRIMARY KEY,
    event_seq  INTEGER NOT NULL,
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

### 6.2 Go 搜索函数签名（参考 SearchService 模式）

```go
// packages/fts5/search.go

type SearchResult struct {
    ThreadID          string
    TurnID            string
    SenderType        string  // "user" | "agent" | "system"
    Snippet           string
    Score             float64
}

// SearchMessages 执行 FTS5 全文搜索
func SearchMessages(db *sql.DB, query string, limit int, projectID string) ([]SearchResult, error) {
    if strings.TrimSpace(query) == "" {
        return nil, nil
    }

    escaped := escapeFtsQuery(query)

    sql := `
        SELECT
            m.thread_id,
            m.turn_id,
            m.sender_type,
            m.content,
            fts.rank
        FROM messages_fts fts
        JOIN messages m ON m.rowid = fts.rowid
        WHERE messages_fts MATCH ?
        ORDER BY rank
        LIMIT ?
    `

    rows, err := db.Query(sql, escaped, limit*2)
    // ... parse rows, filter sender_type, compute score, extract snippet
}

// escapeFtsQuery 转义用户输入
func escapeFtsQuery(query string) string {
    escaped := strings.ReplaceAll(query, `"`, `""`)
    return `"` + escaped + `"`
}

// extractSnippet 手动提取上下文摘要
func extractSnippet(content, query string, maxLen int) string {
    lower := strings.ToLower(content)
    qLower := strings.ToLower(query)
    idx := strings.Index(lower, qLower)
    if idx == -1 {
        if len(content) <= maxLen {
            return content
        }
        return content[:maxLen] + "..."
    }
    start := max(0, idx-50)
    end := min(len(content), start+maxLen)
    prefix := ""
    suffix := ""
    if start > 0 {
        prefix = "..."
    }
    if end < len(content) {
        suffix = "..."
    }
    return prefix + content[start:end] + suffix
}
```

### 6.3 BM25 分数处理

```go
// rawRank 是 FTS5 返回的原始 rank（负值）
// 用户消息系数 1.2
scoreMultiplier := 1.0
if senderType == "user" {
    scoreMultiplier = 1.2
}
score := -rawRank * scoreMultiplier
```

---

## 7. 关键源码索引

| 功能 | 文件 | 行号 | 说明 |
|------|------|------|------|
| FTS5 DDL | `src/server/lib/db/DrizzleService.ts` | 13-22 | `tokenize='trigram'`，独立表 |
| DB 初始化 | `src/server/lib/db/DrizzleService.ts` | 24-34 | WAL + migrations + FTS5 exec |
| DB 故障恢复 | `src/server/lib/db/DrizzleService.ts` | 62-84 | 删除重建 |
| 搜索主入口 | `src/server/core/search/services/SearchService.ts` | 48-131 | 全文搜索 + JOIN + BM25 |
| 查询转义 | `src/server/core/search/services/SearchService.ts` | 30-39 | 双引号包裹 + 内部转义 |
| BM25 分数变换 | `src/server/core/search/services/SearchService.ts` | 108-110 | `-rank * 1.2` (user boost) |
| Snippet 提取 | `src/server/core/search/services/SearchService.ts` | 92-106 | 手动 indexOf + slice |
| JSONL 解析 | `src/server/core/claude-code/functions/parseJsonl.ts` | 4-37 | JSON.parse → Zod safeParse |
| ErrorJsonl 类型 | `src/types/conversation.ts` | 3-9 | discriminated union |
| FTS 数据填充 | `src/server/core/sync/services/SyncService.ts` | 248-319 | DELETE + INSERT 全量替换 |
| 文本提取 | `src/server/core/search/functions/extractSearchableText.ts` | 1-64 | 4 种 type 可索引 |
| Session 读取 | `src/server/core/session/infrastructure/SessionRepository.ts` | 22-70 | 路径验证 + parseJsonl |
| Session 元数据 | `src/server/core/session/infrastructure/SessionRepository.ts` | 73-140 | 列表 + cursor 分页 |
| DB Schema | `src/server/lib/db/schema.ts` | 1-63 | projects, sessions, sync_state |
| 测试 DDL | `src/testing/layers/testDrizzleServiceLayer.ts` | 13-32 | in-memory FTS5 |
| 页内搜索（前端） | `src/web/app/.../ConversationList.tsx` | 430-574 | DOM TreeWalker + createRange |
