# AgentHub Global Search -- Design Specification

> Cross-repo analysis: claude-code-viewer (FTS5 + TreeWalker), librechat (message search), cloudcli (file-tree search),
> design-eventstore-memory (FTS5 schema), design-keyboard-shortcuts (Ctrl+K).
> Date: 2026-05-21 | Status: Draft v1.0

---

## 1. Cross-Repository Takeaway

Claude Code Viewer provides the proven dual-layer architecture: SQLite FTS5 (porter tokenizer) for cross-session search + DOM TreeWalker (`document.createRange`) for in-page highlight. LibreChat contributes conversation-scoped search with category filtering. CloudCLI adds file-tree search with auto-expand matching directories. No existing tool covers multi-provider sessions, authority-aware filtering, or artifact-type search simultaneously -- those are AgentHub's differentiated needs.

**Core borrowings**: FTS5 external content table + BM25 ranking (claude-code-viewer), Ctrl+K Command Palette entry (design-keyboard-shortcuts), file-tree content search (cloudcli), `snippet()` for result previews (claude-code-viewer).

---

## 2. Search Architecture

### 2.1 Four-Tier Search Scope

```
Tier 1: In-Page (Ctrl+F)
  Current thread viewport. Pure frontend DOM TreeWalker + Range highlights.
  No FTS5 dependency. Retry up to 6 rAF frames for async rendering.

Tier 2: Current Session (Ctrl+K default)
  All threads/turns/messages within the active session.
  FTS5 MATCH on messages_fts WHERE thread_id IN (active session threads).

Tier 3: Cross-Session / Project (Ctrl+K, scope toggle)
  All sessions under the current project.
  FTS5 MATCH on messages_fts WHERE project_id = ?.
  Results grouped by session with snippet preview.

Tier 4: Global (Ctrl+K, scope toggle)
  All projects known to AgentHub. FTS5 across all project indexes (UNION or multi-attach).
  Results grouped by project -> session.
```

### 2.2 FTS5 Index Schema

Extended from `design-eventstore-memory.md` S3.6. Key additions: `agent_name`, `authority`, `artifact_type` columns for filter dimensions.

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
    created_at   INTEGER NOT NULL     -- Unix milliseconds
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

EventStore `Append()` drives INSERT into `messages`; the FTS5 trigger handles index sync automatically.

### 2.3 BM25 Ranking with Weights

FTS5 BM25 as base, with multiplier boosts applied in the ORDER BY clause:

| Signal | Weight | Rationale |
|--------|--------|-----------|
| User messages | 1.2x | Direct intent signal (claude-code-viewer validated) |
| Agent messages (baseline) | 1.0x | Default |
| Artifact messages (code/diff/file) | 1.3x | High-value produced output |
| System messages | 0.6x | Housekeeping, low search value |

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

### 2.4 Snippet / Highlight Strategy

| Context | Method |
|---------|--------|
| Search result list | FTS5 `snippet()` with `<b>` tags; rendered as `<mark>` in UI. 40-char window, 2 surrounding tokens. |
| Message expanded view | DOM TreeWalker + `document.createRange()`. Walk text nodes, create Range per match, wrap in `<mark>`. Retry up to 6 rAF frames for virtual-scroll rendering. |
| File artifact content | Monaco `deltaDecorations` -- highlight without modifying document model. |

---

## 3. Command Palette UI (Ctrl+K)

### 3.1 Activation Rules

- `Ctrl+K` opens palette (global layer, per `design-keyboard-shortcuts.md` S3.1). `Ctrl+Shift+F` as alternate.
- **Blocked** when textarea/editor is focused (`document.activeElement` tag check) -- falls through to Monaco "delete line".
- `Escape`: clear query if dirty, otherwise close palette. Two-stage for muscle-memory safety.

### 3.2 Palette Layout

```
┌───────────────────────────────────────────────────────────┐
│ > search query here...                                    │
│ SCOPE: [Current Session]  Project  Global                 │
│ AGENT: [All v]  DATE: [7d v]  TYPE: [All v]  AUTH: [v]   │
│                                                           │
│ ── Sessions (3) ────────────────────────────────────      │
│ ● user  "deploy fails with 403"                           │
│   ~/my-project  session-abc123  claude-code  2h ago       │
│                                                           │
│ ── Messages (5) ────────────────────────────────────      │
│ ● agent  "The <b>403 error</b> is caused by..."           │
│   Turn #3  claude-code  artifact:markdown  2h ago         │
│                                                           │
│ ── Artifacts (2) ───────────────────────────────────      │
│ ■ deploy.sh    ~/my-project/scripts/deploy.sh             │
│   Matched "deploy" in file content                        │
│                                                           │
│ ── Actions (when query empty or matches label) ──         │
│ ⚡ Toggle Sidebar    Ctrl+B    ⚡ Toggle Panel    Ctrl+J   │
│───────────────────────────────────────────────────────────│
│ [Enter] open  [Ctrl+Enter] new tab  [Esc] close           │
└───────────────────────────────────────────────────────────┘
```

### 3.3 Result Group Ordering & Limits

1. Actions (when query empty or matches label) -- Command Palette fallback mode.
2. Sessions -- grouped by project when scope is Global.
3. Messages -- BM25 ranked, within matched sessions.
4. Artifacts -- files/content matched by FTS5.

Each group: max 5 items + "Show all (N)" expander below fold. Empty query shows last 10 recent sessions + frequently used actions.

---

## 4. Filter System

### 4.1 Filter Dimensions

| Filter | Type | Source Column | UI |
|--------|------|---------------|-----|
| Agent | Multi-select | `agent_name` | Dropdown with agent icon + name |
| Date | Preset + Custom | `created_at` | Chips: 24h / 7d / 30d / All + picker |
| Artifact Type | Multi-select | `artifact_type` | `code` / `markdown` / `diff` / `file` / `none` |
| Authority | Multi-select | `authority` | `hub` / per-edge. Collapsed by default. |
| Sender | Radio | `sender_type` | All / User / Agent |

### 4.2 Go Search API

```go
type SearchOptions struct {
    Query         string
    ProjectID     string      // Empty = global scope
    ThreadIDs     []string    // Empty = all in scope
    AgentNames    []string
    SenderTypes   []string
    ArtifactTypes []string
    Authorities   []string
    Since, Until  int64       // Unix ms, 0 = unbounded
    Limit, Offset int         // Default 20 / 0
}

// SearchService wraps per-project index.db
type Service struct { db *sql.DB }
func (s *Service) Search(ctx context.Context, query string, opts SearchOptions) (*SearchResponse, error)
```

Filters translate to `WHERE` clauses; empty slices skip the condition. The `Query` field is the only one that feeds FTS5 MATCH; all others are exact column filters.

---

## 5. Scope Toggle

Default scope = `localStorage.lastUsed` (fallback: Current Session). Scope chip click re-runs the query immediately (no submit required).

| Scope | FTS5 WHERE | Note |
|-------|-----------|------|
| Current Session | `thread_id IN (<active threads>)` | Disabled when no session active (e.g., dashboard) |
| Project | `project_id = <current>` | Default if user typically works in one project |
| Global | All project index.db files | UNION or multi-attach approach |

Keyboard: `Ctrl+1/2/3` selects scope tier directly. Tab cycles through scope chips.

---

## 6. In-Page Search (Ctrl+F)

Complements Ctrl+K for within-viewport search. Opens sticky top bar on conversation view:

```
 🔍 [search term________]  3/12  [▲] [▼] [✕]
```

Implementation (claude-code-viewer S4.3 pattern):
1. `TreeWalker` over all text nodes in the conversation container.
2. `document.createRange()` per match; `getBoundingClientRect()` -> `scrollIntoView`.
3. Wrap matches in `<mark class="search-highlight">`.
4. Retry via `requestAnimationFrame` (max 6) for virtual-scroll async rendering.
5. Navigate: `Enter` = next, `Shift+Enter` = previous.
6. Cleanup: remove all `<mark>` tags on close.

Active only when message-tree layer is focused (per `design-keyboard-shortcuts.md` S2 layer scoping).

---

## 7. Keyboard Navigation

| Key | Action |
|-----|--------|
| `ArrowDown` / `j` | Next result |
| `ArrowUp` / `k` | Previous result |
| `Enter` | Open: navigate to session + scroll to message |
| `Ctrl+Enter` | Open in new tab |
| `Escape` | Clear query / close palette (two-stage) |
| `Tab` | Cycle scope chips |
| `Ctrl+1..3` | Select scope tier directly |

---

## 8. Migration Path

| Phase | Deliverable | Depends On |
|-------|------------|------------|
| P1 | FTS5 schema + triggers + `Search()` Go function | `design-eventstore-memory` Phase 2 |
| P1 | `Ctrl+K` palette UI skeleton (recent sessions when empty) | `design-keyboard-shortcuts` |
| P2 | BM25 ranking with sender/artifact boosts | P1 search |
| P2 | Filter bar (Agent/Date/Type/Authority UI + query builder) | P1 palette |
| P2 | Scope toggle (Current Session / Project / Global) | P1 search |
| P3 | `Ctrl+F` in-page TreeWalker search | In-page container refs |
| P3 | Snippet highlight rendering + scroll-to-match | P1 results |
| P3 | Artifact content search (file tree + Monaco integration) | P1 search |

---

## 9. Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Engine | SQLite FTS5 porter unicode61 | Proven in claude-code-viewer; pure Go via modernc.org/sqlite |
| Ranking | BM25 + sender/artifact boosts | User messages (1.2x) = intent signal; artifacts (1.3x) = high-value output |
| Search layers | FTS5 (cross-session) + TreeWalker (in-page) | No single approach covers both; claude-code-viewer pattern validated |
| UI entry | `Ctrl+K` Command Palette with scope chips + filters | Familiar to VS Code users; scoped search prevents result overload |
| Snippet | 40 chars, 2 tokens, `<b>` tags -> `<mark>` UI | Balance of context and scanability |
| Result order | Sessions -> Messages -> Artifacts -> Actions | Find the conversation first, then the specific content |
| Scope memory | `localStorage` last-used | Reduces friction for users with stable scope preference |
| Authority filter | Available, collapsed by default | Power-user feature; noise for single-user deployments |
