# AgentHub 桌面指挥中心 —— UI/UX 工程规格

> 基于：`cross-analysis-im-ux.md`、`opcode.md`、`cloudcli.md`、`claude-code-viewer.md`、`librechat.md`、`architecture.md`、`product-model.md`、`data-model.md`、`authority.md`、`README.md`
> 日期：2026-05-21
> 状态：Draft v1.0

---

## 1. 组件树（完整嵌套层级与 Props 接口）

```
App  (ZustandProvider + ThemeProvider + TabContext + PluginsContext)
├── AuthGate                          (P1+, stub in P0)
│   └── LoginView
├── ProjectSelector                   (welcome / picker view)
│   ├── RecentProjectList             (last 10, localStorage cached)
│   ├── ProjectCard                   (name + path + lastOpened + agentCount)
│   ├── NewProjectDialog              (name + rootPath + template)
│   └── OpenFolderButton              (Tauri dialog.open or browser fallback)
│
├── MainLayout                        (three-column shell, P0 core)
│   ├── ResizeHandle                  (horizontal, sidebar↔center, min 200px/max 420px)
│   │
│   ├── LeftSidebar  (w=280px default, collapsible to 48px icon-strip)
│   │   ├── SidebarToolbar
│   │   │   ├── NewThreadButton
│   │   │   ├── ToggleArchiveButton
│   │   │   └── SettingsGear
│   │   ├── SearchBar                 (FTS5 global + in-sidebar highlight)
│   │   │   ├── SearchInput           (Ctrl+K to open, debounced 300ms)
│   │   │   ├── AuthorityFilterChips  ([All] [Hub] [Edge:us1] [Edge:us2] [MCP])
│   │   │   └── SearchResultsDropdown (virtualized list, max 20 items)
│   │   ├── ProjectTree
│   │   │   └── ProjectNode  (recursive)
│   │   │       ├── ProjectHeader     (name + collapseChevron + threadCount)
│   │   │       └── ThreadList        (grouped by date: Today/Yesterday/Older)
│   │   │           └── ThreadCard
│   │   │               ├── AgentIcon (model icon: Claude/Codex/OpenCode)
│   │   │               ├── ThreadTitle (AI-generated or first user prompt)
│   │   │               ├── ThreadMeta (messageCount + relativeTime)
│   │   │               ├── AuthorityBadge ([Hub] / [Edge:us1] / [Hybrid])
│   │   │               ├── RunIndicator (spinner pulse when running)
│   │   │               └── ContextMenu (Rename | Archive | Duplicate | Delete subtree)
│   │   ├── ArchivedSection           (collapsed by default)
│   │   │   └── ArchivedThreadList
│   │   ├── SidebarPluginSlot         (slot="sidebar", bottom region)
│   │   └── SidebarFooter
│   │       ├── ConnectionStatus      (Edge WS state: green/yellow/red dot + latency)
│   │       └── UserAvatar            (P1+ Hub login)
│   │
│   ├── CenterChat  (flex=1, min-w=400px)
│   │   ├── ChatHeader
│   │   │   ├── ThreadTitleBar        (editable inline)
│   │   │   ├── ExecutionBadge        ("Edge: us1-desktop / Runner #3")
│   │   │   ├── AgentSelector         (dropdown: available agents on this Edge)
│   │   │   ├── WorkspaceIndicator    (branch name + git status dot)
│   │   │   └── ToolbarPluginSlot     (slot="toolbar")
│   │   ├── MessageTree               (virtualized, react-virtual)
│   │   │   ├── MessageNode  (recursive)
│   │   │   │   ├── AuthorityStripe   (colored left border: blue=Hub, green=Edge, orange=Hybrid)
│   │   │   │   ├── MessageHeader
│   │   │   │   │   ├── ActorAvatar   (user/agent icon)
│   │   │   │   │   ├── ActorName     ("You" / "Claude 4.5" / "Codex")
│   │   │   │   │   ├── AuthorityLabel ("[Hub]" / "[Edge:us1]" / "[Hybrid]")
│   │   │   │   │   └── Timestamp     (relative: "2m ago", absolute on hover)
│   │   │   │   ├── MessageBody
│   │   │   │   │   ├── TextContent   (Markdown via react-markdown + remark-gfm)
│   │   │   │   │   ├── ThinkingBlock (L1: collapsed by default)
│   │   │   │   │   │   ├── ThinkingToggle  ("Thinking... (3s)" → "Thinking (collapsed)")
│   │   │   │   │   │   └── ThinkingContent (Markdown, dimmed text, max-h-48 scroll)
│   │   │   │   │   ├── ToolUseCard   (L1: collapsed by default)
│   │   │   │   │   │   ├── ToolHeader     (icon + toolName + param summary)
│   │   │   │   │   │   ├── ToolParams     (expandable JSON/code)
│   │   │   │   │   │   └── ToolResult     (L2: visible only when expanded)
│   │   │   │   │   │       ├── ReadResult     (file path + line count + [View Diff →])
│   │   │   │   │   │       ├── WriteResult    (diff preview inline + [Open in RightPanel →])
│   │   │   │   │   │       ├── EditResult     (diff preview inline + [Open in RightPanel →])
│   │   │   │   │   │       ├── BashResult     (collapsible stdout/stderr + exitCode badge)
│   │   │   │   │   │       ├── TaskResult     (subagent summary + [Expand Sidechain →])
│   │   │   │   │   │       └── GenericResult  (raw JSON/string, truncated at 10k chars)
│   │   │   │   │   ├── SubagentSidechain (L3: visible when TaskResult expanded)
│   │   │   │   │   │   ├── SidechainHeader ("code-reviewer: 3 tools, 2 findings")
│   │   │   │   │   │   └── SidechainMessages (recursive MessageNode for subagent, L4)
│   │   │   │   │   ├── DiffCard       (inline diff preview)
│   │   │   │   │   │   ├── DiffHeader (filePath + +X/-X + [View Full Diff →])
│   │   │   │   │   │   ├── DiffInline  (first 3 hunks, truncated at 15 lines)
│   │   │   │   │   │   └── DiffFooter ([Apply] [Discard] [Open Full Diff])
│   │   │   │   │   ├── PreviewCard    (iframe artifact preview)
│   │   │   │   │   │   ├── PreviewTabs  (Code | Preview)
│   │   │   │   │   │   ├── CodeView    (Monaco editor, read-only)
│   │   │   │   │   │   └── PreviewFrame (sandboxed iframe, 127.0.0.1:51xx)
│   │   │   │   │   └── ApprovalCard  (permission request inline)
│   │   │   │   │       ├── ApprovalHeader ("Claude wants to run: pip install torch")
│   │   │   │   │       ├── ApprovalDetail (command + args + path sanitization)
│   │   │   │   │       └── ApprovalActions ([Approve] [Approve Once] [Deny])
│   │   │   │   └── SiblingSwitch        (visible when siblingCount > 1)
│   │   │   │       ├── SiblingNav        ("← 2 / 5 →" with left/right arrow buttons)
│   │   │   │       └── SiblingLabel      ("5 responses at this point")
│   │   │   └── MessageContextMenu
│   │   │       ├── ForkHere        → ForkDialog (mode selector)
│   │   │       ├── Retry           → creates sibling
│   │   │       ├── CopyToEdge      → selects target Edge
│   │   │       ├── CopyText        → clipboard
│   │   │       └── DeleteSubtree   → confirm dialog
│   │   ├── JumpToBottomButton      (floating, visible when scrolled up)
│   │   └── ComposeArea
│   │       ├── AttachmentPreview   (files/images queued for upload)
│   │       ├── MentionPopover      (@mention agent/user list, fuzzy filter)
│   │       ├── RichTextInput       (textarea + Shift+Enter newline, Enter send)
│   │       │   ├── InlineCodeButton
│   │       │   └── FileUploadButton
│   │       ├── ModeIndicator       ("@ClaudeCode on Edge:us1" / "Group chat via Hub")
│   │       ├── SendButton          (icon: ArrowUp, disabled when empty)
│   │       └── StopButton          (visible when thread.status === "running", icon: Square)
│   │
│   ├── RightPanel  (w=420px default, collapsible, resizable 280px-600px)
│   │   ├── PanelTabBar             (horizontal tabs, scrollable overflow→gradient mask)
│   │   │   ├── Tab: Files          (FileTree icon)
│   │   │   ├── Tab: Diff           (GitBranch icon)
│   │   │   ├── Tab: Preview        (Eye icon)
│   │   │   ├── Tab: Git            (GitCommit icon)
│   │   │   ├── Tab: Logs           (ScrollText icon)
│   │   │   ├── Tab: Terminal       (Terminal icon)
│   │   │   ├── PluginTabs[]        (dynamic, from plugin registry, slot="tab")
│   │   │   └── PanelCloseButton
│   │   │
│   │   ├── FileTreePanel  (Tab: Files)
│   │   │   ├── FileTreeToolbar
│   │   │   │   ├── ViewModeSwitch   (Tree | Detailed | Compact, three-icon toggle)
│   │   │   │   ├── SearchInput      (filters by filename, auto-expands matching dirs)
│   │   │   │   ├── NewFileButton
│   │   │   │   ├── NewFolderButton
│   │   │   │   └── RefreshButton
│   │   │   ├── FileTreeBody         (virtualized tree)
│   │   │   │   ├── FileTreeDirectory  (recursive, expand/collapse chevron)
│   │   │   │   └── FileTreeItem       (icon+name+size+modified, double-click to open diff)
│   │   │   ├── FileContextMenu        (Rename | Delete | Copy Path | Open in Editor)
│   │   │   └── FileDropOverlay        (drag-and-drop upload, blue dashed border)
│   │   │
│   │   ├── DiffPanel  (Tab: Diff)
│   │   │   ├── DiffToolbar
│   │   │   │   ├── RefFromSelector   (dropdown: working | HEAD | branch:* | commit:SHA)
│   │   │   │   ├── RefToSelector     (dropdown: same options)
│   │   │   │   ├── FileFilterInput   (filters diff files by path)
│   │   │   │   └── DiffViewSettings  (unified vs split, context lines: 3/5/10)
│   │   │   ├── DiffFileList          (collapsed when single file, scrollable when many)
│   │   │   │   ├── DiffFileHeader    (sticky, filename + icon + +X/-X + expandChevron)
│   │   │   │   └── DiffFileBody      (expandable)
│   │   │   │       ├── DiffHunk      (unified or split view, color-coded)
│   │   │   │       │   ├── HunkHeader  (@@ -a,b +c,d @@ context)
│   │   │   │       │   ├── AddedLine   (bg-green-50 dark:bg-green-950/30, "+" prefix)
│   │   │   │       │   ├── DeletedLine (bg-red-50 dark:bg-red-950/30, "-" prefix)
│   │   │   │       │   ├── ContextLine (unchanged, no bg)
│   │   │   │       │   └── CommentLine (inline review comment toggle button per line)
│   │   │   │       └── CommentPopover
│   │   │   │           ├── CommentForm     (Markdown textarea, Ctrl+Enter to submit)
│   │   │   │           └── CommentThread   (previous comments + resolve button)
│   │   │   ├── AgentDiffSource     ("Generated by Claude · Tool: Edit · Session #42")
│   │   │   └── AgentDiffCompare    ("Compare with Codex output" button, side-by-side)
│   │   │
│   │   ├── PreviewPanel  (Tab: Preview)
│   │   │   ├── ArtifactHeader
│   │   │   │   ├── ArtifactTitle     (filename or generation description)
│   │   │   │   ├── VersionSelector   (dropdown: v1, v2, v3... based on agent iterations)
│   │   │   │   └── ArtifactTrace     ("Generated by Claude · Session #42 · Prompt: 'Build...'")
│   │   │   ├── PreviewTabs           ([Code] [Preview] [Split])
│   │   │   │   ├── CodeEditor        (Monaco, read-only, syntax-highlighted)
│   │   │   │   ├── PreviewFrame      (sandboxed iframe @ 127.0.0.1:51xx or inline HTML)
│   │   │   │   ├── MermaidPreview    (standalone mermaid render, when artifact is .mmd)
│   │   │   │   └── SplitView         (code+preview side-by-side, draggable divider)
│   │   │   ├── ArtifactActions
│   │   │   │   ├── CopyButton
│   │   │   │   ├── DownloadButton
│   │   │   │   ├── OpenInEditorButton
│   │   │   │   └── ViewFullSessionButton (navigate to originating thread+turn)
│   │   │   └── AgentProductCompare   (side-by-side if multiple agents produced artifacts)
│   │   │
│   │   ├── GitPanel  (Tab: Git)
│   │   │   ├── GitPanelHeader
│   │   │   │   ├── CurrentBranch     (branch name + remote status: ahead/behind)
│   │   │   │   └── ActionButtons     ([Fetch] [Pull] [Push] [Revert])
│   │   │   ├── GitViewTabs           (Changes | History | Branches)
│   │   │   │   ├── ChangesView
│   │   │   │   │   ├── StageStatus   (staged vs unstaged sections)
│   │   │   │   │   ├── ChangeItem    (checkbox + filePath + status icon + +X/-X)
│   │   │   │   │   └── CommitArea
│   │   │   │   │       ├── FileCheckboxList  ([Select All] [Deselect All])
│   │   │   │   │       ├── CommitMessageInput
│   │   │   │   │       ├── GenerateMessageButton (AI-generated conventional commit)
│   │   │   │   │       └── CommitActions  ([Commit] [Push] [Commit + Push])
│   │   │   │   ├── HistoryView
│   │   │   │   │   ├── CommitList   (virtualized, message + SHA + author + relativeDate)
│   │   │   │   │   └── CommitDiff   (expandable per commit)
│   │   │   │   └── BranchesView
│   │   │   │       ├── LocalBranches   (current highlighted, checkout/del/merge actions)
│   │   │   │       └── RemoteBranches  (fetch status, checkout tracking)
│   │   │   └── GitErrorState           (not a repo | auth failed | conflicts, typed messages)
│   │   │
│   │   ├── LogsPanel  (Tab: Logs)
│   │   │   ├── LogToolbar
│   │   │   │   ├── LogFilter         (dropdown: All | stdout | stderr | system)
│   │   │   │   ├── LogSearch         (incremental search, highlights matches)
│   │   │   │   ├── AutoScrollToggle  (pin to bottom / manual)
│   │   │   │   └── ClearButton
│   │   │   └── LogStream            (virtualized, SSE tail, monospace, ANSI color support)
│   │   │       └── LogLine           (timestamp prefix + level badge + text)
│   │   │
│   │   └── TerminalPanel  (Tab: Terminal)
│   │       ├── XtermContainer        (@xterm/xterm + addon-fit, WebSocket-backed)
│   │       ├── TerminalStatusBar     (sessionId + cwd + exit code on completion)
│   │       └── TerminalActions       ([New Terminal] [Kill] [Clear])
│   │
│   └── OverlaySlot                   (modal layer, e.g., ForkDialog, SearchDialog, Settings)
│
├── GlobalSearchDialog                (Ctrl+K overlay, FTS5 cross-session)
│   ├── SearchInput                   (auto-focused, debounced 200ms)
│   ├── SearchFilters                 (by project | by authority | by date range)
│   ├── SearchResults                 (virtualized list)
│   │   └── SearchResultItem          (session title + matched snippet + score + click→navigate)
│   └── EmptyState                    ("No results" or "Type to search across all sessions")
│
├── SettingsPanel                     (P0: local preferences, P1+: sync with Hub)
│   ├── GeneralSettings               (theme: dark/light/system, language, font size)
│   ├── AgentSettings                 (default agents, per-project agent config)
│   ├── MCPSettings                   (MCP server CRUD, test connection, import/export)
│   ├── CheckpointSettings            (strategy: Manual|PerPrompt|PerToolUse|Smart, keep_count)
│   ├── PluginSettings                (installed plugins, enable/disable, marketplace)
│   ├── ShortcutSettings              (keybinding overrides)
│   └── UsageDashboard                (token cost, sessions, models, per-project breakdown)
│
├── PluginContainer                   (dynamic import via Blob URL, lifecycle: mount/unmount)
│   └── PluginContent                 (rendered by plugin JS, receives PluginAPI context)
│
└── ToastContainer                    (global toast notifications, stacked, auto-dismiss 4s)
```

---

## 2. 状态管理设计（Zustand Store）

### 2.1 Store 架构

遵循 opcode 的 Zustand v5 + `subscribeWithSelector` + CloudCLI 的双缓存模式，并结合 LibreChat 的消息树模型：

```
WebSocket Events ──→ EdgeEventBus ──→ Store Actions ──→ React re-render
                                          │
REST API (history) ──→ Store Loaders ──→ merged (deduped)
                                          │
TanStack Query ──→ Server State (cache + invalidation on WS events)
```

### 2.2 Store 定义

#### 2.2.1 `projectStore` -- 项目与工作区

```ts
// src/stores/projectStore.ts
interface ProjectState {
  // Data
  projects: Project[]
  activeProjectId: string | null
  projectLoading: boolean
  projectError: string | null

  // Workspace metadata
  workspaceStatus: Record<string, {
    branch: string
    gitStatus: { modified: number; added: number; deleted: number; untracked: number }
    lastFetched: number
  }>

  // Computed (via selectors)
  // activeProject: Project | null
  // projectThreads: Thread[]  (filtered by activeProjectId)
}

interface ProjectActions {
  loadProjects: () => Promise<void>                   // GET /api/projects from Edge
  createProject: (name: string, rootPath: string) => Promise<Project>
  openProject: (projectId: string) => void
  closeProject: () => void
  refreshWorkspaceStatus: (projectId: string) => Promise<void>
  archiveProject: (projectId: string) => Promise<void>
}

// Store creation
// create<ProjectState & ProjectActions>()(
//   subscribeWithSelector((set, get) => ({ ... }))
// )
```

#### 2.2.2 `threadStore` -- Thread 树与消息树

```ts
// src/stores/threadStore.ts
import { buildTree, type TreeNode } from '../lib/message-tree'

interface ThreadState {
  // Thread list (for sidebar)
  threads: Map<string, Thread>          // keyed by threadId
  threadOrder: string[]                  // ordered IDs for rendering
  threadGroups: {                       // derived: Today | Yesterday | Older
    today: string[]
    yesterday: string[]
    older: string[]
    archived: string[]
  }
  activeThreadId: string | null
  threadsLoading: boolean

  // Message tree (for center chat)
  messageTrees: Map<string, TreeNode>    // threadId → root TreeNode
  messageCache: Map<string, Message>     // all messages keyed by id

  // Streaming state
  streamingThreads: Set<string>          // threads with active streaming
  streamingContent: Map<string, string>  // messageId → accumulating text

  // Sibling navigation
  siblingPosition: Map<string, number>   // nodeId → current siblingIdx

  // Selection
  selectedMessageId: string | null
}

interface ThreadActions {
  // Thread CRUD
  loadThreads: (projectId: string) => Promise<void>
  createThread: (projectId: string, opts?: { title?: string; agentId?: string }) => Promise<Thread>
  archiveThread: (threadId: string) => Promise<void>
  renameThread: (threadId: string, title: string) => Promise<void>
  deleteThread: (threadId: string) => Promise<void>
  setActiveThread: (threadId: string | null) => void

  // Message loading
  loadMessages: (threadId: string) => Promise<void>       // REST history + buildTree
  appendMessage: (threadId: string, msg: Message) => void  // from WS or local optimistic
  updateStreamingMessage: (threadId: string, msgId: string, delta: string, isComplete: boolean) => void

  // Message tree operations (LibreChat patterns)
  buildMessageTree: (threadId: string) => TreeNode
  createSibling: (threadId: string, parentNodeId: string) => Promise<string>  // returns new messageId
  forkThread: (threadId: string, fromNodeId: string, mode: ForkMode) => Promise<string>  // returns new threadId
  deleteSubtree: (threadId: string, nodeId: string) => Promise<void>

  // Sibling navigation
  setSiblingPosition: (nodeId: string, idx: number) => void
  navigateSibling: (nodeId: string, direction: 'prev' | 'next') => void

  // Selection
  selectMessage: (messageId: string | null) => void
}

// ForkMode (from LibreChat)
type ForkMode = 'DIRECT_PATH' | 'INCLUDE_BRANCHES' | 'TARGET_LEVEL' | 'DEFAULT'
```

#### 2.2.3 `runStore` -- AgentRun 生命周期

```ts
// src/stores/runStore.ts
interface RunState {
  activeRuns: Map<string, AgentRun>       // runId → AgentRun
  runHistory: AgentRun[]                  // recent runs, capped at 50
  runStatusByThread: Map<string, string>  // threadId → current runId
}

interface RunActions {
  startRun: (threadId: string, opts: RunOptions) => Promise<AgentRun>
  stopRun: (runId: string) => Promise<void>
  pauseRun: (runId: string) => Promise<void>
  resumeRun: (runId: string) => Promise<void>

  // Called by WS event handlers
  updateRunStatus: (runId: string, status: RunStatus) => void
  attachRunOutput: (runId: string, item: Item) => void
  completeRun: (runId: string, result: RunResult) => void
  failRun: (runId: string, error: RunError) => void
}

interface RunOptions {
  threadId: string
  agentId: string                        // e.g., "claude-code", "codex"
  executionAuthority?: ExecutionAuthority
  model?: string
  contextOptions?: {
    summarizationEnabled?: boolean
    reserveRatio?: number
    maxContextTokens?: number
  }
}

type RunStatus = 'queued' | 'starting' | 'running' | 'awaiting_approval' | 'completed' | 'failed' | 'cancelled'
```

#### 2.2.4 `diffStore` -- Diff 与 Git 状态

```ts
// src/stores/diffStore.ts
interface DiffState {
  // Active diff view
  currentDiff: {
    projectId: string
    compareFrom: string       // "working" | "HEAD" | "branch:main" | "commit:abc123"
    compareTo: string
    files: FileDiff[]
    loading: boolean
    error: DiffError | null
  } | null

  // Inline review comments (Claude Code Viewer pattern)
  reviewComments: Map<string, Comment[]>   // key: `${filePath}:${lineNumber}`
  activeCommentForm: { filePath: string; lineNumber: number } | null

  // File selection for commit
  selectedFiles: Set<string>

  // Commit state
  commitMessage: string
  commitLoading: boolean
  commitError: CommitError | null

  // AI-generated message
  generatedMessage: string | null
  generatingMessage: boolean
}

interface DiffActions {
  // Diff loading
  loadDiff: (projectId: string, from: string, to: string) => Promise<void>
  loadDiffForFile: (projectId: string, filePath: string, from: string, to: string) => Promise<FileDiff>

  // File selection
  toggleFileSelection: (filePath: string) => void
  selectAllFiles: () => void
  deselectAllFiles: () => void

  // Reviews
  addComment: (filePath: string, lineNumber: number, text: string) => Promise<void>
  resolveComment: (filePath: string, lineNumber: number, commentId: string) => Promise<void>
  openCommentForm: (filePath: string, lineNumber: number) => void
  closeCommentForm: () => void

  // Commit
  setCommitMessage: (msg: string) => void
  generateCommitMessage: (projectId: string, files: string[]) => Promise<void>
  commit: (projectId: string) => Promise<CommitResult>
  push: (projectId: string) => Promise<PushResult>
  commitAndPush: (projectId: string) => Promise<{ commit: CommitResult; push: PushResult }>

  // Branch operations
  fetch: (projectId: string) => Promise<void>
  pull: (projectId: string) => Promise<PullResult>
  checkout: (projectId: string, branch: string) => Promise<void>
  createBranch: (projectId: string, name: string) => Promise<void>
  revertCommit: (projectId: string) => Promise<void>
}

interface FileDiff {
  filePath: string
  status: 'added' | 'deleted' | 'modified' | 'renamed'
  oldPath?: string
  additions: number
  deletions: number
  hunks: DiffHunk[]
  agentSource?: { agentName: string; toolUseId: string; threadId: string }
}

interface DiffHunk {
  header: string            // "@@ -a,b +c,d @@"
  lines: DiffLine[]
}

interface DiffLine {
  type: 'added' | 'deleted' | 'context'
  oldLineNumber?: number
  newLineNumber?: number
  content: string
  comments?: Comment[]
}

type DiffError = 'NOT_A_REPOSITORY' | 'BRANCH_NOT_FOUND' | 'PARSE_ERROR' | 'COMMAND_FAILED'
type CommitError = 'HOOK_FAILED' | 'GIT_COMMAND_ERROR' | 'NOTHING_TO_COMMIT'
type PushError = 'NO_UPSTREAM' | 'NON_FAST_FORWARD' | 'AUTH_FAILED' | 'NETWORK_ERROR' | 'TIMEOUT'
type PullError = 'CONFLICT' | 'UNSTAGED_CHANGES' | 'AUTH_FAILED' | 'NETWORK_ERROR'
```

#### 2.2.5 `previewStore` -- Artifact 与预览

```ts
// src/stores/previewStore.ts
interface PreviewState {
  activeArtifact: {
    id: string
    title: string
    type: 'code' | 'html' | 'react' | 'mermaid' | 'markdown' | 'image' | 'other'
    content: string
    versions: ArtifactVersion[]
    activeVersionIndex: number
    source: {
      agentName: string
      threadId: string
      turnId: string
      toolUseId: string
      prompt: string
    } | null
    previewUrl?: string        // local dev server URL if available
  } | null

  splitRatio: number          // 0-100, percentage for code panel width in split mode
  activeTab: 'code' | 'preview' | 'split'
}

interface PreviewActions {
  openArtifact: (artifactId: string) => Promise<void>
  closeArtifact: () => void
  setActiveVersion: (index: number) => void
  setActiveTab: (tab: 'code' | 'preview' | 'split') => void
  setSplitRatio: (ratio: number) => void

  // Agent product comparison (AgentHub unique)
  compareAgents: (threadId: string, prompt: string) => Promise<AgentComparison>
  downloadArtifact: (artifactId: string) => Promise<void>
}

interface ArtifactVersion {
  version: number
  timestamp: string
  content: string
  generatedBy: string          // agent name
  toolUseId: string
}

interface AgentComparison {
  prompt: string
  results: {
    agentName: string
    artifactId: string
    content: string
    duration: number
    tokenUsage: number
  }[]
}
```

#### 2.2.6 `approvalStore` -- 权限与审批

```ts
// src/stores/approvalStore.ts
interface ApprovalState {
  pendingApprovals: ApprovalRequest[]
  approvalHistory: ApprovalDecision[]  // capped at 100
}

interface ApprovalActions {
  // Called by WS event: permission_requested
  addApprovalRequest: (req: ApprovalRequest) => void

  // User actions
  approve: (requestId: string) => Promise<void>
  approveOnce: (requestId: string) => Promise<void>       // single-use approval
  deny: (requestId: string, reason?: string) => Promise<void>

  // Policy management
  setAutoApprovePolicy: (pattern: string, action: 'always_approve' | 'always_deny') => Promise<void>
  removeAutoApprovePolicy: (pattern: string) => Promise<void>
}

interface ApprovalRequest {
  id: string
  threadId: string
  runId: string
  type: 'command' | 'file_write' | 'file_delete' | 'network' | 'deploy'
  detail: {
    command?: string
    filePath?: string
    action?: string
    args?: string[]
  }
  agent: string
  requestedAt: string
  expiresAt: string            // auto-deny after timeout (default 5min)
}
```

#### 2.2.7 `uiStore` -- 布局与面板状态

```ts
// src/stores/uiStore.ts
interface UIState {
  // Layout
  view: View                    // 'welcome' | 'chat' | 'settings'
  sidebarOpen: boolean          // true on desktop, toggled on mobile
  sidebarCollapsed: boolean     // icon-strip mode (48px)
  rightPanelOpen: boolean
  rightPanelActiveTab: string   // 'files' | 'diff' | 'preview' | 'git' | 'logs' | 'terminal' | pluginTabId

  // Panel dimensions
  sidebarWidth: number          // default 280, min 200, max 420
  rightPanelWidth: number       // default 420, min 280, max 600

  // Theme
  theme: 'dark' | 'light' | 'system'

  // Mobile
  isMobile: boolean             // window.innerWidth < 768
  keyboardHeight: number        // CSS var --keyboard-height (iOS)
  isPWA: boolean                // display-mode: standalone

  // Modals
  searchDialogOpen: boolean
  forkDialogOpen: boolean
  forkContext: { threadId: string; nodeId: string } | null
  settingsOpen: boolean
  commandPaletteOpen: boolean   // Ctrl+K
}

interface UIActions {
  setView: (view: View) => void
  toggleSidebar: () => void
  setSidebarCollapsed: (collapsed: boolean) => void
  toggleRightPanel: () => void
  setRightPanelTab: (tab: string) => void
  setSidebarWidth: (width: number) => void
  setRightPanelWidth: (width: number) => void
  setTheme: (theme: 'dark' | 'light' | 'system') => void
  setIsMobile: (isMobile: boolean) => void
  setKeyboardHeight: (height: number) => void
  openSearchDialog: () => void
  closeSearchDialog: () => void
  openForkDialog: (threadId: string, nodeId: string) => void
  closeForkDialog: () => void
  setSettingsOpen: (open: boolean) => void
  setCommandPaletteOpen: (open: boolean) => void
}

type View = 'welcome' | 'chat' | 'settings'
```

#### 2.2.8 `connectionStore` -- Edge/WS 连接

```ts
// src/stores/connectionStore.ts
interface ConnectionState {
  edgeStatus: 'disconnected' | 'connecting' | 'connected' | 'error'
  edgeId: string | null
  wsLatency: number | null          // ms, updated by ping/pong heartbeat
  reconnectAttempt: number
  lastError: string | null

  // Hub (P1+)
  hubStatus: 'disconnected' | 'connecting' | 'connected' | 'error'
  hubAuthenticated: boolean
}

interface ConnectionActions {
  connectEdge: (url?: string) => void       // default ws://127.0.0.1:3210/ws
  disconnectEdge: () => void
  setEdgeStatus: (status: ConnectionState['edgeStatus']) => void
  setWsLatency: (latency: number) => void
  recordError: (error: string) => void
  incrementReconnect: () => void
  resetReconnect: () => void
}
```

#### 2.2.9 `searchStore` -- 全局搜索（FTS5）

```ts
// src/stores/searchStore.ts
interface SearchState {
  query: string
  results: SearchResult[]
  searching: boolean
  filters: {
    projectIds: string[]
    authorityTypes: ('hub' | 'edge' | 'hybrid')[]
    dateRange: { from?: string; to?: string }
  }
}

interface SearchActions {
  setQuery: (query: string) => void
  search: (query: string, filters?: SearchState['filters']) => Promise<void>
  clearSearch: () => void
  setFilter: <K extends keyof SearchState['filters']>(key: K, value: SearchState['filters'][K]) => void
}

interface SearchResult {
  threadId: string
  threadTitle: string
  projectName: string
  messageId: string
  snippet: string           // highlighted match snippet
  score: number             // BM25
  timestamp: string
  authority: 'hub' | 'edge' | 'hybrid'
}
```

#### 2.2.10 `pluginStore` -- 插件注册表

```ts
// src/stores/pluginStore.ts
interface PluginState {
  plugins: Plugin[]
  loadedPlugins: Map<string, PluginModule>   // name → loaded JS module
  pluginTabs: Plugin[]                        // plugins with slot="tab"
  sidebarPlugins: Plugin[]                    // plugins with slot="sidebar"
  toolbarPlugins: Plugin[]                    // plugins with slot="toolbar"
  overlayPlugins: Plugin[]                    // plugins with slot="overlay"
  artifactRenderers: Plugin[]                  // plugins with slot="artifact-renderer"
}

interface PluginActions {
  loadManifests: () => Promise<void>               // scan plugins dir
  loadPlugin: (name: string) => Promise<void>      // dynamic import via Blob URL
  unloadPlugin: (name: string) => void
  enablePlugin: (name: string) => Promise<void>
  disablePlugin: (name: string) => Promise<void>
  installPlugin: (url: string) => Promise<void>    // git clone + verify
  uninstallPlugin: (name: string) => Promise<void>
}

interface Plugin {
  name: string
  displayName: string
  version: string
  description?: string
  author?: string
  icon?: string                    // Lucide icon name
  type: 'react' | 'module'
  slot: 'tab' | 'sidebar' | 'toolbar' | 'overlay' | 'artifact-renderer'
  entry: string                    // relative path to JS entry
  server?: string                  // optional backend entry
  permissions: string[]
  enabled: boolean
  status: 'loaded' | 'loading' | 'error' | 'not_loaded'
  error?: string
}

interface PluginModule {
  mount: (container: HTMLElement, api: PluginAPI) => void
  unmount: (container: HTMLElement) => void
}

interface PluginAPI {
  get context(): PluginContext
  onContextChange(cb: (ctx: PluginContext) => void): () => void
  rpc(method: string, path: string, body?: unknown): Promise<unknown>
}

interface PluginContext {
  theme: 'dark' | 'light'
  project: { name: string; path: string } | null
  thread: { id: string; title: string } | null
}
```

### 2.3 WebSocket 事件到 Store 的数据流

```
Edge Server (Go) ──WebSocket──→ wsClient.ts (browser)
                                    │
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
            ServerEvent     ServerEvent       ServerEvent
           "message.created"  "run.status"   "permission.requested"
                    │               │               │
                    ▼               ▼               ▼
          threadStore        runStore         approvalStore
          .appendMessage()   .updateRunStatus() .addApprovalRequest()
                    │               │               │
                    ▼               ▼               ▼
             buildTree()     updateThreadStatus()  render ApprovalCard
                    │
                    ▼
            React re-render (MessageTree)
```

**WebSocket 事件类型到 Store 的映射**：

| WS 事件 | Store | Action |
|----------|-------|--------|
| `message.created` | `threadStore` | `appendMessage()` → `buildTree()` |
| `message.streaming` | `threadStore` | `updateStreamingMessage()` |
| `message.streaming_done` | `threadStore` | `updateStreamingMessage(msgId, null, true)` |
| `run.started` | `runStore` | `startRun()` 设置状态 |
| `run.status_changed` | `runStore` | `updateRunStatus()` |
| `run.item` | `runStore` / `threadStore` | `attachRunOutput()` + `appendMessage()` |
| `run.completed` / `run.failed` | `runStore` | `completeRun()` / `failRun()` |
| `permission.requested` | `approvalStore` | `addApprovalRequest()` |
| `permission.resolved` | `approvalStore` | 从 pending 移除，推入 history |
| `artifact.created` | `previewStore` | `openArtifact()` 或通知 |
| `artifact.updated` | `previewStore` | 更新版本列表 |
| `workspace.changed` | `projectStore` | `refreshWorkspaceStatus()` |
| `session.changed` | `threadStore` | 如活跃 thread 受影响则 `loadMessages()` |
| `edge.connection_status` | `connectionStore` | `setEdgeStatus()` / `setWsLatency()` |
| `edge.pong` | `connectionStore` | `setWsLatency(Date.now() - sentAt)` |

---

## 3. 关键交互流程（含状态转换表）

### 3.1 用户发送 @mention 消息 → Agent 回复（完整前端流程）

```
步骤  状态                      用户/系统动作                            动作后状态
────  ──────────────────────  ─────────────────────────────────  ──────────────────────
 1    Thread 活跃，空闲         用户在 ComposeArea.textarea         ComposeArea 中有文本
                                中键入 "@ClaudeCode write..."
 2    文本已输入                 用户按 Enter（或点击 SendButton）    ─
 3    ─                       ComposeArea.onSubmit() 被调用         ─
 4    ─                       乐观更新：将用户 Message             threadStore.messageCache[id]=msg
                                追加到 messageCache + buildTree()   threadStore.activeThread 现在包含用户消息
 5    ─                       重置 ComposeArea.textarea            ComposeArea 置空
 6    ─                       POST /api/threads/:id/messages       ─
                                → Edge Server
 7    ─                       Edge：持久化消息                      ─
 8    ─                       Edge：local-orchestrator 分发         ─
 9    ─                       Edge → Runner：POST /runs/new        ─
 10   Thread 活跃，运行中        Runner：spawn claude 子进程          runStore.startRun() → status="starting"
                                Edge → WS：run.started              threadStore.streamingThreads.add(id)
 11   运行中                    Runner stdout：content_block_start   Edge → WS：run.item(content_block)
                                                                  → threadStore.appendMessage(agentMsg)
 12   运行中                    Runner stdout：content_block_delta   Edge → WS：message.streaming
                                                                  → threadStore.updateStreamingMessage()
 13   运行中                    （流式持续……）                       UI：MessageBubble 文本增长，
                                                                    光标在末尾闪烁，自动滚动
 14   运行中                    Runner stdout：tool_use (Read)      Edge → WS：run.item(tool_use)
                                                                  → threadStore.appendMessage(toolMsg)
                                                                    UI：ToolUseCard 出现，折叠状态
 15   运行中                    Runner stdout：tool_result           Edge → WS：run.item(tool_result)
                                                                    UI：ToolResult 显示在 ToolUseCard 下（L2）
 16   运行中                    Runner stdout：content_block_stop    Edge → WS：message.streaming_done
                                                                    UI：光标停止，最终格式化
 17   运行中                    Runner：进程退出 code 0               Edge → WS：run.completed
                                                                  → runStore.completeRun()
 18   空闲                      ─                                    UI：StopButton → SendButton，
                                                                    streamingThreads.delete(id)
                                                                    RunIndicator → 绿色勾，然后消失
```

**乐观 UI 状态机**：

| 转换 | 本地状态 | 服务端确认 | 冲突解决 |
|------------|-------------|---------------------|---------------------|
| 用户发送消息 | `id: "local_<uuid>"`，status: "sending" | `id: "<server-id>"` 通过 WS `message.created` 到达 | 用 server id 替换 `local_*`；更新缓存 key |
| 发送失败 | 显示重试横幅 + 消息上的红色圆点 | 不适用 | 提供 [Retry] [Delete] [Edit & Resend] |
| 发送超时（10s） | 持续显示 "sending..." 旋转图标 | 不适用 | 30s 硬超时后与失败相同 |

### 3.2 Diff Card：显示 → 应用/丢弃交互状态机

```
状态：
  IDLE          DiffCard 未显示
  VIEWING       DiffCard 可见，用户正在阅读 diff
  EXPANDED      用户点击了 "View Full Diff" → RightPanel Diff 标签页已打开
  APPLYING      用户点击了 [Apply]，正在执行
  APPLIED       Apply 成功，有 [Undo] 选项
  APPLY_FAILED  Apply 出错，可重试
  DISCARDED     用户点击了 [Discard]
  COMMENTING    用户在某一行打开了评论表单

  ┌──────────┐
  │  IDLE     │◄──────── (diffCard.dismissed / navigate away)
  └─────┬─────┘
        │ ToolUseCard.expand() → tool_result 包含 diff
        ▼
  ┌──────────┐
  │ VIEWING   │────────────────────────────────────┐
  └─┬───┬────┘                                    │
    │   │                                         │
    │   │ [Expand to RightPanel]                   │ [Discard]
    │   ▼                                         ▼
    │  ┌────────────┐                     ┌────────────┐
    │  │ EXPANDED    │                     │ DISCARDED   │──→ IDLE（通知后）
    │  └──┬──┬───────┘                     └────────────┘
    │     │  │
    │     │  │ [Apply]（来自 RightPanel 或内联）
    │     │  ▼
    │     │ ┌──────────┐
    │     │ │ APPLYING  │
    │     │ └──┬───┬────┘
    │     │    │   │
    │     │  success error
    │     │    │   │
    │     │    ▼   ▼
    │     │ ┌──────────┐   ┌──────────────┐
    │     │ │ APPLIED   │   │ APPLY_FAILED │──[Retry]──→ APPLYING
    │     │ └────┬──────┘   └──────────────┘
    │     │      │
    │     │   [Undo]（5s 窗口）
    │     │      │
    │     │      ▼
    │     │   VIEWING
    │     │
    │  [Comment on line N]
    │     │
    │     ▼
    │  ┌────────────┐
    │  │ COMMENTING  │──[Submit]──→ VIEWING（评论已保存）
    │  └────────────┘
    │
    [Apply from inline]
    │
    └──→ APPLYING
```

**每个 DiffCard 的 Apply/Discard UI 状态**：

| 组件状态 | DiffFooter 按钮 | 颜色标记 |
|-----------------|-------------------|--------------|
| `pending`（默认） | [Apply] [Discard] [View Full] | DiffCard：黄色左边框（未应用的变更） |
| `applying` | 旋转图标 "Applying..." | 动画脉冲 |
| `applied` | 绿色勾 "Applied" + [Undo (5s)] | DiffCard：绿色左边框，随后渐变为灰色 |
| `apply_failed` | 红色 "Failed" + [Retry] [Discard] | DiffCard：红色左边框 |
| `discarded` | "Discarded" 置灰 | DiffCard：灰色左边框，降低不透明度 |
| `commented` | 行上显示评论计数徽章 | 边框不变 |

### 3.3 渐进展开 -- 四层展开（Claude Code Viewer 模式）

```
Layer 0：始终可见
  ├── 用户消息文本（完整，始终展开）
  └── Agent 消息文本（Markdown，始终展开）
        │
        │ [点击 "Thinking (collapsed)" 按钮 ↓]
        ▼
Layer 1：Thinking Block（默认折叠）
  └── ThinkingContent（暗淡文本，max-h-48 可滚动）
        │
        │ 消息中存在 tool_use 时自动展开
        ▼
Layer 2：Tool Use Block（默认折叠）
  ├── ToolHeader：图标 + toolName + 参数摘要（可见）
  │   │
  │   │ [点击展开 ↓]
  │   ▼
  ├── ToolParams：完整 JSON（可展开代码块）
  └── ToolResult：（仅当 L2 展开时渲染）
      │
      │ 如果工具是 "Task"（子 agent）：
      ▼
Layer 3：Subagent Sidechain（默认在 L2 内部折叠）
  ├── SidechainHeader："code-reviewer：3 个工具，2 个发现"
  │   │
  │   │ [点击展开 ↓]
  │   ▼
  └── SidechainMessages：子 agent 的递归 MessageNode
        │
        │ 子 agent 自身的 tool_use 块：
        ▼
Layer 4：嵌套工具详情（在子 agent 内部，L3 必须先展开）
  └── ToolUseCard（递归，与 L1-L2 相同的模式）
```

**渐进展开状态转换表**：

| 当前状态 | 触发条件 | 下一状态 | 动画 |
|--------------|---------|------------|-----------|
| `L0：文本可见` | 消息有 thinking block | `L1：thinking_visible`（折叠） | 即时挂载，切换按钮 `max-h-0` → `max-h-12` |
| `L1：折叠` | 点击切换 | `L1：展开` | `max-h-0` → `max-h-48`，淡入 150ms |
| `L1：展开` | 点击切换 | `L1：折叠` | `max-h-48` → `max-h-0`，淡出 100ms |
| `L1：任意` | 消息有 tool_use | `L2：tool_visible`（折叠） | 即时挂载 |
| `L2：折叠` | 点击工具头部 | `L2：展开` | 下滑 ToolParams，然后渲染 ToolResult |
| `L2：展开` | 点击工具头部 | `L2：折叠` | 上滑，卸载 ToolResult |
| `L2：展开` | 工具为 "Task" 且 agent session 存在 | `L3：sidechain_visible`（折叠） | 显示 "Expand subagent" 按钮 |
| `L3：折叠` | 点击 "Expand subagent" | `L3：展开` | 下滑 SidechainMessages |
| `L3：展开` | 点击折叠 | `L3：折叠` | 上滑 |
| `L3：展开` | 子 agent 有 tool_use 块 | `L4：nested_tool`（折叠） | 与 L1→L2 相同的递归行为 |

**自动展开规则**：
- 用户导航至活跃 thread 时：展开 L0，折叠所有 L1-L4
- 用户从消息点击 "View Diff" 链接时：自动展开该特定 tool_use 的 L2，然后跳转到 RightPanel Diff 标签页
- 通过流式传输到达的新 tool_use：L2 初始折叠，用户点击展开
- 当 run 处于 "awaiting_approval" 时：ApprovalCard 在 L0，始终可见，脉冲动画

### 3.4 Thread Fork —— 交互流程

```
状态：用户正在查看 Thread A，位于消息 M5（有 3 个兄弟节点）

  1. 用户右键点击 M5 → [Fork Here]
  2. ForkDialog 打开
     ├── 模式选择器（radio group）：
     │   [○] DIRECT_PATH（仅从根到 M5 的消息）
     │   [○] INCLUDE_BRANCHES（所有兄弟节点，完整树）
     │   [ ] TARGET_LEVEL（M5 所在深度的所有消息）
     │   [ ] DEFAULT（仅 M5 之后的消息）
     ├── 目标项目（dropdown，默认：同一项目）
     └── [Cancel] [Create Fork]
  3. 用户选择 DIRECT_PATH + 点击 [Create Fork]
  4. threadStore.forkThread(threadA_id, M5_id, 'DIRECT_PATH')
     → POST /api/threads/:id/fork { fromMessageId, mode }
     → Edge：创建新 threadB，复制消息树路径
     → Edge：WS → threadStore：threadB 出现在左侧栏
  5. UI：导航至 threadB，显示 fork 源横幅：
     "Forked from Thread A / Message #5 · DIRECT_PATH 模式"
     横幅带有 [Open Original Thread] 链接
  6. ThreadB 现在活跃，ComposeArea 等待新提示
```

### 3.5 全局搜索（Ctrl+K）流程

```
状态：空闲

  1. 用户按下 Ctrl+K
  2. searchDialogOpen = true，SearchInput 自动聚焦
  3. 用户键入 "auth login"（防抖 200ms）
  4. searchStore.search("auth login")
     → Edge：对活跃项目中所有 thread 执行 FTS5 查询
     → 返回按 BM25 分数排序的 SearchResult[]
  5. UI：SearchResults 渲染，尚未导航
  6. 用户点击结果或按 Enter
  7. 关闭对话框，导航至目标 thread + 滚动到对应消息
  8. 页内搜索高亮（DOM TreeWalker）应用查询文本
```

---

## 4. 移动端适配策略

### 4.1 断点：768px（单一断点，CloudCLI 模式）

```ts
// src/hooks/useIsMobile.ts
const useIsMobile = (breakpoint = 768): boolean => {
  const [isMobile, setIsMobile] = useState(
    typeof window !== 'undefined' ? window.innerWidth < breakpoint : false
  )

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < breakpoint)
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [breakpoint])

  return isMobile
}
```

### 4.2 三栏到单栏转换

```
Desktop (>768px):                         Mobile (<=768px):
┌──────┬──────────────┬──────────┐        ┌─────────────────────┐
│ Side │ Center Chat  │ Right    │        │ ChatHeader（含       │
│ bar  │              │ Panel    │        │  汉堡菜单 + 标签页）  │
│      │              │          │        ├─────────────────────┤
│      │              │          │        │                     │
│      │              │          │        │  Center Chat        │
│      │              │          │        │  （全宽，            │
│      │              │          │        │   MessageTree）      │
│      │              │          │        │                     │
│      │              │          │        ├─────────────────────┤
│      │              │          │        │ ComposeArea         │
│      │              │          │        │ （底部固定，          │
│      │              │          │        │  适配键盘）          │
└──────┴──────────────┴──────────┘        └─────────────────────┘

Sidebar  → Drawer 覆盖层（从左侧滑入，背景模糊）
RightPanel → Bottom Sheet（从底部上滑，拖拽手柄）
```

### 4.3 Sidebar → Drawer 覆盖层（移动端）

```tsx
// src/components/layout/MobileDrawer.tsx
const MobileDrawer: React.FC<{
  open: boolean
  onClose: () => void
  children: React.ReactNode
  side: 'left' | 'right'
}> = ({ open, onClose, children, side }) => {
  return (
    <div className={clsx(
      'fixed inset-0 z-50 flex transition-all duration-150 ease-out',
      open ? 'visible opacity-100' : 'invisible opacity-0'
    )}>
      {/* Backdrop */}
      <button
        className="fixed inset-0 bg-background/60 backdrop-blur-sm"
        onClick={onClose}
        onTouchStart={(e) => { e.preventDefault(); onClose() }}
      />
      {/* Drawer */}
      <div className={clsx(
        'relative h-full w-[85vw] max-w-sm transform border-r border-border/40 bg-card',
        'transition-transform duration-150 ease-out',
        side === 'left' && (open ? 'translate-x-0' : '-translate-x-full'),
        side === 'right' && clsx('ml-auto border-l', open ? 'translate-x-0' : 'translate-x-full')
      )}>
        {children}
      </div>
    </div>
  )
}
```

### 4.4 RightPanel → Bottom Sheet（移动端）

```tsx
// src/components/layout/MobileBottomSheet.tsx
const MobileBottomSheet: React.FC<{
  open: boolean
  onClose: () => void
  activeTab: string
  tabs: { id: string; label: string; icon: LucideIcon }[]
  children: React.ReactNode
}> = ({ open, onClose, activeTab, tabs, children }) => {
  const [sheetHeight, setSheetHeight] = useState(50) // percentage
  const startYRef = useRef(0)

  const onDragStart = (e: React.TouchEvent) => { startYRef.current = e.touches[0].clientY }
  const onDragMove = (e: React.TouchEvent) => {
    const dy = startYRef.current - e.touches[0].clientY
    const vh = window.innerHeight
    setSheetHeight(Math.min(90, Math.max(30, sheetHeight + (dy / vh) * 100)))
  }
  const onDragEnd = () => {
    if (sheetHeight < 35) onClose()
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50">
      <div className="fixed inset-0 bg-background/60 backdrop-blur-sm" onClick={onClose} />
      <div
        className="fixed bottom-0 left-0 right-0 bg-card border-t border-border/40 rounded-t-2xl"
        style={{ height: `${sheetHeight}vh` }}
      >
        {/* Drag handle */}
        <div
          className="flex justify-center pt-2 pb-1"
          onTouchStart={onDragStart}
          onTouchMove={onDragMove}
          onTouchEnd={onDragEnd}
        >
          <div className="w-10 h-1 bg-muted-foreground/30 rounded-full" />
        </div>
        {/* Tab bar (horizontal scrollable) */}
        <div className="flex gap-1 px-3 overflow-x-auto scrollbar-none border-b border-border/40 pb-2">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={clsx(
                'flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap',
                activeTab === tab.id ? 'bg-primary/10 text-primary' : 'text-muted-foreground'
              )}
            >
              <tab.icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          ))}
        </div>
        {/* Content */}
        <div className="overflow-auto" style={{ height: 'calc(100% - 48px)' }}>
          {children}
        </div>
      </div>
    </div>
  )
}
```

### 4.5 iOS 键盘适配（visualViewport 模式，13 行）

```tsx
// src/hooks/useKeyboardHeight.ts
const useKeyboardHeight = () => {
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return

    const update = () => {
      const keyboardHeight = Math.max(0, window.innerHeight - vv.height)
      document.documentElement.style.setProperty('--keyboard-height', `${keyboardHeight}px`)
    }

    vv.addEventListener('resize', update)
    // NOTE: only listen to 'resize', NOT 'scroll' — avoids chat-jitter during content scrolling
    return () => vv.removeEventListener('resize', update)
  }, [])
}
```

应用于 ComposeArea CSS：
```css
.compose-area-container {
  position: sticky;
  bottom: var(--keyboard-height, 0px);
  transition: bottom 0.15s ease-out;
}
```

### 4.6 PWA 离线策略

**manifest.json**（位于 `apps/web/public/`）：
```json
{
  "name": "AgentHub Desktop",
  "short_name": "AgentHub",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#0a0a0a",
  "theme_color": "#0a0a0a",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

**Service Worker**（`apps/web/src/sw.ts`）：
```ts
// Strategy: Network-first with offline fallback (Claude Code Viewer pattern)

// 1. Precache: Vite build manifest (workbox-precaching)
// 2. SPA Navigation: NavigationRoute → /index.html (exclude /api/*)
// 3. API: NetworkFirst, max 100 entries, 1 hour expiration
// 4. SSE: NetworkOnly (never cached)
// 5. Static assets: CacheFirst (CSS/JS/fonts, versioned by hash)
// 6. Push Notifications: push event → showNotification, click → navigate to thread

// PWA detection (useDeviceSettings pattern, CloudCLI):
const isPWA = () => {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(display-mode: standalone)').matches
    || (navigator as any).standalone  // iOS
    || document.referrer.includes('android-app://')
}
```

**离线能力**：
| 功能 | 在线 | 离线（P0 桌面） |
|---------|--------|----------------------|
| 查看 thread 历史 | 来自 Edge 的 REST | 从 SQLite 读取（Edge local-store） |
| 发送消息 | WS 到 Edge → Runner | WS 到本地 Edge（始终可用） |
| Diff 面板 | Git 命令本地 | 相同（本地仓库） |
| 文件树 | Edge 本地文件系统 | 相同 |
| 预览 | Edge localhost | 相同 |
| 搜索（FTS5） | Edge SQLite | 相同（本地数据库） |
| Hub 同步 | 在线时活跃 | 排队，重连时同步 |
| 插件市场 | 需要网络 | 本地插件仍可工作 |

**离线指示器**：ConnectionStore.edgeStatus 横幅：
- 绿色圆点 "Connected to Edge" —— 正常
- 黄色圆点 "Connecting..." —— 瞬时
- 红色横幅 "Edge disconnected — offline mode" —— 重连失败时显示，非侵入式
- 自动重连：指数退避（1s, 2s, 4s, 8s, max 30s）

---

## 5. 数据流汇总（端到端）

```
┌─────────────────────────────────────────────────────────────────────┐
│                          前端（React）                               │
│                                                                      │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐        │
│  │Zustand   │   │Zustand   │   │Zustand   │   │Zustand   │  ...    │
│  │project   │   │thread    │   │run       │   │diff      │         │
│  │Store     │   │Store     │   │Store     │   │Store     │         │
│  └────┬─────┘   └────┬─────┘   └────┬─────┘   └────┬─────┘        │
│       │               │               │               │              │
│       └───────────────┼───────────────┼───────────────┘              │
│                       │               │                              │
│                 ┌─────┴──────┐  ┌─────┴──────┐                       │
│                 │ WS Client  │  │ REST Client│                       │
│                 │ （实时）     │  │ （历史）    │                       │
│                 └─────┬──────┘  └─────┬──────┘                       │
└───────────────────────┼───────────────┼──────────────────────────────┘
                        │               │
                  ws://127.0.0.1    http://127.0.0.1
                        │   :3210        │   :3210
                        │               │
┌───────────────────────┼───────────────┼──────────────────────────────┐
│                    EDGE SERVER（Go）                                  │
│  local-api（REST）   local-ws（WS）   local-store（SQLite）          │
│  hub-client（P1+）   sync-client       runner-manager                 │
└───────────────────────┼──────────────────────────────────────────────┘
                        │
                  POST /runs
                        │
┌───────────────────────┼──────────────────────────────────────────────┐
│                    RUNNER（Go）                                       │
│  executor（child_process） adapters（claude-code/codex/opencode）    │
│  workspace（worktree）     diff       preview      logs               │
└───────────────────────┼──────────────────────────────────────────────┘
                        │
                  child_process.spawn
                        │
┌───────────────────────┼──────────────────────────────────────────────┐
│                 AGENT CLI（claude / codex / opencode）                │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 6. 端口与 URL 约定

| 组件 | 地址 | 协议 |
|-----------|---------|----------|
| Web UI（开发） | `http://127.0.0.1:3000` | HTTP |
| Web UI WS（开发） | `ws://127.0.0.1:3000/ws` | WebSocket（Vite 代理 → Edge） |
| Edge API | `http://127.0.0.1:3210` | REST |
| Edge WS | `ws://127.0.0.1:3210/ws` | WebSocket（主实时通道） |
| Runner | `http://127.0.0.1:39731` | REST（仅 Edge 使用） |
| 预览端口范围 | `http://127.0.0.1:5100-5199` | HTTP（开发服务器） |
| Hub（开发） | `http://127.0.0.1:3211` | REST + WS |

---

## 7. 参考文献

- `cross-analysis-im-ux.md` -- 四核心区域交互设计
- `opcode.md` -- Tauri 桌面架构、checkpoint UI、Zustand store
- `cloudcli.md` -- 移动端 768px 断点、Drawer 覆盖层、PWA、插件系统
- `claude-code-viewer.md` -- 渐进展开、DiffViewer + 评论、FTS5、RightPanel 标签页
- `librechat.md` -- 消息树 buildTree()、SiblingSwitch、Fork 四种模式、Artifacts
- `architecture.md` -- Hub-Edge-Runner 拓扑、P0 桌面优先级
- `product-model.md` -- 产品层级：指挥中心 → IM → Hub
- `data-model.md` -- Project/Conversation/Thread/Turn/Item/Artifact 类型
- `authority.md` -- Conversation/Execution/Artifact/Memory authority 模型
