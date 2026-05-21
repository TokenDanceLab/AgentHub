# AgentHub Desktop Command Center -- UI/UX Engineering Specification

> Based on: `cross-analysis-im-ux.md`, `opcode.md`, `cloudcli.md`, `claude-code-viewer.md`, `librechat.md`, `architecture.md`, `product-model.md`, `data-model.md`, `authority.md`, `README.md`
> Date: 2026-05-21
> Status: Draft v1.0

---

## 1. Component Tree (Complete Nested Hierarchy with Props Interfaces)

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

## 2. State Management Design (Zustand Stores)

### 2.1 Store Architecture

Following opcode's Zustand v5 + `subscribeWithSelector` + CloudCLI's dual-cache pattern, with LibreChat's message-tree model:

```
WebSocket Events ──→ EdgeEventBus ──→ Store Actions ──→ React re-render
                                          │
REST API (history) ──→ Store Loaders ──→ merged (deduped)
                                          │
TanStack Query ──→ Server State (cache + invalidation on WS events)
```

### 2.2 Store Definitions

#### 2.2.1 `projectStore` -- Project & Workspace

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

#### 2.2.2 `threadStore` -- Thread Tree & Message Tree

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

#### 2.2.3 `runStore` -- AgentRun Lifecycle

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

#### 2.2.4 `diffStore` -- Diff & Git State

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

#### 2.2.5 `previewStore` -- Artifact & Preview

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

#### 2.2.6 `approvalStore` -- Permission & Approval

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

#### 2.2.7 `uiStore` -- Layout & Panel State

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

#### 2.2.8 `connectionStore` -- Edge/WS Connection

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

#### 2.2.9 `searchStore` -- Global Search (FTS5)

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

#### 2.2.10 `pluginStore` -- Plugin Registry

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

### 2.3 WebSocket Event → Store Data Flow

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

**WebSocket Event Types → Store Mapping**:

| WS Event | Store | Action |
|----------|-------|--------|
| `message.created` | `threadStore` | `appendMessage()` → `buildTree()` |
| `message.streaming` | `threadStore` | `updateStreamingMessage()` |
| `message.streaming_done` | `threadStore` | `updateStreamingMessage(msgId, null, true)` |
| `run.started` | `runStore` | `startRun()` sets status |
| `run.status_changed` | `runStore` | `updateRunStatus()` |
| `run.item` | `runStore` / `threadStore` | `attachRunOutput()` + `appendMessage()` |
| `run.completed` / `run.failed` | `runStore` | `completeRun()` / `failRun()` |
| `permission.requested` | `approvalStore` | `addApprovalRequest()` |
| `permission.resolved` | `approvalStore` | remove from pending, push to history |
| `artifact.created` | `previewStore` | `openArtifact()` or notification |
| `artifact.updated` | `previewStore` | update version list |
| `workspace.changed` | `projectStore` | `refreshWorkspaceStatus()` |
| `session.changed` | `threadStore` | `loadMessages()` if active thread affected |
| `edge.connection_status` | `connectionStore` | `setEdgeStatus()` / `setWsLatency()` |
| `edge.pong` | `connectionStore` | `setWsLatency(Date.now() - sentAt)` |

---

## 3. Key Interaction Flows (with State Transition Tables)

### 3.1 User Sends @mention Message → Agent Reply (Full Frontend Flow)

```
Step  State Before            User/System Action                  State After
────  ──────────────────────  ─────────────────────────────────  ──────────────────────
 1    Thread active, idle     User types "@ClaudeCode write..."    ComposeArea has text
                               in ComposeArea.textarea
 2    Text entered             User presses Enter (or clicks       ─
                               SendButton)
 3    ─                       ComposeArea.onSubmit() called        ─
 4    ─                       Optimistic: append User Message      threadStore.messageCache[id]=msg
                               to messageCache + buildTree()       threadStore.activeThread.now has user msg
 5    ─                       Reset ComposeArea.textarea           ComposeArea empty
 6    ─                       POST /api/threads/:id/messages       ─
                               → Edge Server
 7    ─                       Edge: persist message                ─
 8    ─                       Edge: local-orchestrator dispatch    ─
 9    ─                       Edge → Runner: POST /runs/new        ─
 10   Thread active,          Runner: spawn claude child_process   runStore.startRun() → status="starting"
      running                  Edge → WS: run.started              threadStore.streamingThreads.add(id)
 11   running                 Runner stdout: content_block_start   Edge → WS: run.item(content_block)
                                                                → threadStore.appendMessage(agentMsg)
 12   running                 Runner stdout: content_block_delta   Edge → WS: message.streaming
                                                                → threadStore.updateStreamingMessage()
 13   running                 (streaming continues...)             UI: MessageBubble text grows,
                                                                   cursor blinks at end, auto-scroll
 14   running                 Runner stdout: tool_use (Read)       Edge → WS: run.item(tool_use)
                                                                → threadStore.appendMessage(toolMsg)
                                                                   UI: ToolUseCard appears, collapsed
 15   running                 Runner stdout: tool_result           Edge → WS: run.item(tool_result)
                                                                   UI: ToolResult under ToolUseCard (L2)
 16   running                 Runner stdout: content_block_stop    Edge → WS: message.streaming_done
                                                                   UI: cursor stops, final formatting
 17   running                 Runner: process exits code 0         Edge → WS: run.completed
                                                                → runStore.completeRun()
 18   idle                    ─                                    UI: StopButton → SendButton,
                                                                   streamingThreads.delete(id)
                                                                   RunIndicator → green check then gone
```

**Optimistic UI State Machine**:

| Transition | Local State | Server Confirmation | Conflict Resolution |
|------------|-------------|---------------------|---------------------|
| User sends message | `id: "local_<uuid>"`, status: "sending" | `id: "<server-id>"` arrives via WS `message.created` | Replace `local_*` with server id; update cache key |
| Send fails | Show retry banner + red dot on message | N/A | Offer [Retry] [Delete] [Edit & Resend] |
| Send timeout (10s) | Show "sending..." spinner persistent | N/A | Same as fail after 30s hard timeout |

### 3.2 Diff Card: Display → Apply/Discard Interaction State Machine

```
States:
  IDLE          DiffCard not shown
  VIEWING       DiffCard visible, user reading diff
  EXPANDED      User clicked "View Full Diff" → RightPanel Diff tab opened
  APPLYING      User clicked [Apply], executing
  APPLIED       Apply successful, with [Undo] option
  APPLY_FAILED  Apply error, with retry
  DISCARDED     User clicked [Discard]
  COMMENTING    User has comment form open on a specific line

  ┌──────────┐
  │  IDLE     │◄──────── (diffCard.dismissed / navigate away)
  └─────┬─────┘
        │ ToolUseCard.expand() → tool_result contains diff
        ▼
  ┌──────────┐
  │ VIEWING   │────────────────────────────────────┐
  └─┬───┬────┘                                    │
    │   │                                         │
    │   │ [Expand to RightPanel]                   │ [Discard]
    │   ▼                                         ▼
    │  ┌────────────┐                     ┌────────────┐
    │  │ EXPANDED    │                     │ DISCARDED   │──→ IDLE (after notification)
    │  └──┬──┬───────┘                     └────────────┘
    │     │  │
    │     │  │ [Apply] (from RightPanel or inline)
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
    │     │   [Undo] (5s window)
    │     │      │
    │     │      ▼
    │     │   VIEWING
    │     │
    │  [Comment on line N]
    │     │
    │     ▼
    │  ┌────────────┐
    │  │ COMMENTING  │──[Submit]──→ VIEWING (comment saved)
    │  └────────────┘
    │
    [Apply from inline]
    │
    └──→ APPLYING
```

**Apply/Discard UI States per DiffCard**:

| Component State | DiffFooter buttons | Color accent |
|-----------------|-------------------|--------------|
| `pending` (default) | [Apply] [Discard] [View Full] | DiffCard: yellow left border (unapplied change) |
| `applying` | spinner "Applying..." | Animating pulse |
| `applied` | green check "Applied" + [Undo (5s)] | DiffCard: green left border, then fade to gray |
| `apply_failed` | red "Failed" + [Retry] [Discard] | DiffCard: red left border |
| `discarded` | "Discarded" grayed out | DiffCard: gray left border, opacity reduced |
| `commented` | comment count badge on line | No border change |

### 3.3 Progressive Disclosure -- Four-Layer Expansion (Claude Code Viewer Pattern)

```
Layer 0: Always Visible
  ├── User Message text (full, always expanded)
  └── Agent Message text (Markdown, always expanded)
        │
        │ [Click "Thinking (collapsed)" button ↓]
        ▼
Layer 1: Thinking Block (default collapsed)
  └── ThinkingContent (dimmed text, max-h-48 scrollable)
        │
        │ Auto-expands when tool_use is present in message
        ▼
Layer 2: Tool Use Block (default collapsed)
  ├── ToolHeader: icon + toolName + param summary (visible)
  │   │
  │   │ [Click to expand ↓]
  │   ▼
  ├── ToolParams: full JSON (expandable code block)
  └── ToolResult: (only rendered when L2 expanded)
      │
      │ If tool is "Task" (subagent):
      ▼
Layer 3: Subagent Sidechain (default collapsed inside L2)
  ├── SidechainHeader: "code-reviewer: 3 tools, 2 findings"
  │   │
  │   │ [Click to expand ↓]
  │   ▼
  └── SidechainMessages: recursive MessageNode for subagent
        │
        │ Subagent's own tool_use blocks:
        ▼
Layer 4: Nested Tool Details (inside subagent, L3 must be expanded)
  └── ToolUseCard (recursive, same L1-L2 pattern)
```

**State Transition Table for Progressive Disclosure**:

| Current State | Trigger | Next State | Animation |
|--------------|---------|------------|-----------|
| `L0: text visible` | Message has thinking block | `L1: thinking_visible` (collapsed) | Instant mount, `max-h-0` → `max-h-12` for toggle button |
| `L1: collapsed` | Click toggle | `L1: expanded` | `max-h-0` → `max-h-48`, fade-in 150ms |
| `L1: expanded` | Click toggle | `L1: collapsed` | `max-h-48` → `max-h-0`, fade-out 100ms |
| `L1: any` | Message has tool_use | `L2: tool_visible` (collapsed) | Instant mount |
| `L2: collapsed` | Click tool header | `L2: expanded` | Slide-down ToolParams, then ToolResult renders |
| `L2: expanded` | Click tool header | `L2: collapsed` | Slide-up, unmount ToolResult |
| `L2: expanded` | Tool is "Task" + agent session exists | `L3: sidechain_visible` (collapsed) | Show "Expand subagent" button |
| `L3: collapsed` | Click "Expand subagent" | `L3: expanded` | Slide-down SidechainMessages |
| `L3: expanded` | Click collapse | `L3: collapsed` | Slide-up |
| `L3: expanded` | Subagent has tool_use blocks | `L4: nested_tool` (collapsed) | Same as L1→L2 recursively |

**Auto-Expand Rules**:
- When user navigates to an active thread: expand L0, collapse all L1-L4
- When user clicks "View Diff" link from message: auto-expand L2 for that specific tool_use, then jump to RightPanel Diff tab
- When a new tool_use arrives via streaming: L2 starts collapsed, user clicks to expand
- When a run is "awaiting_approval": ApprovalCard at L0, always visible, pulse animation

### 3.4 Thread Fork — Interaction Flow

```
State: User is viewing Thread A, at message M5 (which has 3 siblings)

  1. User right-clicks M5 → [Fork Here]
  2. ForkDialog opens
     ├── Mode selector (radio group):
     │   [○] DIRECT_PATH (only messages from root to M5)
     │   [○] INCLUDE_BRANCHES (all siblings, full tree)
     │   [ ] TARGET_LEVEL (all messages at M5's depth)
     │   [ ] DEFAULT (from M5 onward only)
     ├── Target project (dropdown, default: same project)
     └── [Cancel] [Create Fork]
  3. User selects DIRECT_PATH + clicks [Create Fork]
  4. threadStore.forkThread(threadA_id, M5_id, 'DIRECT_PATH')
     → POST /api/threads/:id/fork { fromMessageId, mode }
     → Edge: creates new threadB, copies message tree path
     → Edge: WS → threadStore: threadB appears in sidebar
  5. UI: navigate to threadB, show fork source banner:
     "Forked from Thread A / Message #5 · DIRECT_PATH mode"
     Banner has [Open Original Thread] link
  6. ThreadB now active, ComposeArea ready for new prompt
```

### 3.5 Global Search (Ctrl+K) Flow

```
State: idle

  1. User presses Ctrl+K
  2. searchDialogOpen = true, SearchInput auto-focused
  3. User types "auth login" (debounced 200ms)
  4. searchStore.search("auth login")
     → Edge: FTS5 query across all threads in active project
     → Returns SearchResult[] sorted by BM25 score
  5. UI: SearchResults render, no navigation yet
  6. User clicks result or presses Enter
  7. Close dialog, navigate to target thread + scroll to message
  8. In-page search highlight applied (DOM TreeWalker) for the query text
```

---

## 4. Mobile Adaptation Strategy

### 4.1 Breakpoint: 768px (Single Breakpoint, CloudCLI Pattern)

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

### 4.2 Three-Column → Single-Column Transformation

```
Desktop (>768px):                         Mobile (<=768px):
┌──────┬──────────────┬──────────┐        ┌─────────────────────┐
│ Side │ Center Chat  │ Right    │        │ ChatHeader (w/      │
│ bar  │              │ Panel    │        │  hamburger + tabs)  │
│      │              │          │        ├─────────────────────┤
│      │              │          │        │                     │
│      │              │          │        │  Center Chat        │
│      │              │          │        │  (full width,       │
│      │              │          │        │   MessageTree)      │
│      │              │          │        │                     │
│      │              │          │        ├─────────────────────┤
│      │              │          │        │ ComposeArea         │
│      │              │          │        │ (sticky bottom,     │
│      │              │          │        │  keyboard-adapted)  │
└──────┴──────────────┴──────────┘        └─────────────────────┘

Sidebar  → Drawer overlay (swipe from left, backdrop blur)
RightPanel → Bottom Sheet (swipe up from bottom, drag handle)
```

### 4.3 Sidebar → Drawer Overlay (Mobile)

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

### 4.4 RightPanel → Bottom Sheet (Mobile)

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

### 4.5 iOS Keyboard Adaptation (visualViewport Pattern, 13 lines)

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

Applied in ComposeArea CSS:
```css
.compose-area-container {
  position: sticky;
  bottom: var(--keyboard-height, 0px);
  transition: bottom 0.15s ease-out;
}
```

### 4.6 PWA Offline Strategy

**manifest.json** (in `apps/web/public/`):
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

**Service Worker** (`apps/web/src/sw.ts`):
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

**Offline Capabilities**:
| Feature | Online | Offline (P0 Desktop) |
|---------|--------|----------------------|
| View thread history | REST from Edge | Read from SQLite (Edge local-store) |
| Send message | WS to Edge → Runner | WS to localhost Edge (always available) |
| Diff panel | Git commands local | Same (local repo) |
| File tree | Edge local filesystem | Same |
| Preview | Edge localhost | Same |
| Search (FTS5) | Edge SQLite | Same (local DB) |
| Hub sync | Active when online | Queued, syncs on reconnect |
| Plugin marketplace | Network required | Local plugins still work |

**Offline indicator**: ConnectionStore.edgeStatus banner:
- Green dot "Connected to Edge" — normal
- Yellow dot "Connecting..." — momentary
- Red banner "Edge disconnected — offline mode" — show when reconnection fails, non-intrusive
- Auto-reconnect: exponential backoff (1s, 2s, 4s, 8s, max 30s)

---

## 5. Data Flow Summary (End-to-End)

```
┌─────────────────────────────────────────────────────────────────────┐
│                          FRONTEND (React)                            │
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
│                 │ (real-time)│  │ (history)  │                       │
│                 └─────┬──────┘  └─────┬──────┘                       │
└───────────────────────┼───────────────┼──────────────────────────────┘
                        │               │
                  ws://127.0.0.1    http://127.0.0.1
                        │   :3210        │   :3210
                        │               │
┌───────────────────────┼───────────────┼──────────────────────────────┐
│                    EDGE SERVER (Go)                                  │
│  local-api (REST)    local-ws (WS)    local-store (SQLite)           │
│  hub-client (P1+)    sync-client      runner-manager                 │
└───────────────────────┼──────────────────────────────────────────────┘
                        │
                  POST /runs
                        │
┌───────────────────────┼──────────────────────────────────────────────┐
│                    RUNNER (Go)                                       │
│  executor (child_process)  adapters (claude-code/codex/opencode)     │
│  workspace (worktree)      diff       preview      logs              │
└───────────────────────┼──────────────────────────────────────────────┘
                        │
                  child_process.spawn
                        │
┌───────────────────────┼──────────────────────────────────────────────┐
│                 AGENT CLI (claude / codex / opencode)                │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 6. Port & URL Conventions

| Component | Address | Protocol |
|-----------|---------|----------|
| Web UI (dev) | `http://127.0.0.1:3000` | HTTP |
| Web UI WS (dev) | `ws://127.0.0.1:3000/ws` | WebSocket (Vite proxy → Edge) |
| Edge API | `http://127.0.0.1:3210` | REST |
| Edge WS | `ws://127.0.0.1:3210/ws` | WebSocket (primary real-time) |
| Runner | `http://127.0.0.1:39731` | REST (Edge only) |
| Preview Range | `http://127.0.0.1:5100-5199` | HTTP (dev servers) |
| Hub (dev) | `http://127.0.0.1:3211` | REST + WS |

---

## 7. References

- `cross-analysis-im-ux.md` -- 4-core-area interaction design
- `opcode.md` -- Tauri desktop architecture, checkpoint UI, Zustand stores
- `cloudcli.md` -- Mobile 768px breakpoint, Drawer overlay, PWA, plugin system
- `claude-code-viewer.md` -- Progressive Disclosure, DiffViewer + comments, FTS5, RightPanel tabs
- `librechat.md` -- Message tree buildTree(), SiblingSwitch, Fork 4 modes, Artifacts
- `architecture.md` -- Hub-Edge-Runner topology, P0 Desktop priority
- `product-model.md` -- Product layers: Command Center → IM → Hub
- `data-model.md` -- Project/Conversation/Thread/Turn/Item/Artifact types
- `authority.md` -- Conversation/Execution/Artifact/Memory authority model
