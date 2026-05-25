# Competitor Analysis: Jean (Tauri Desktop App)

> Researcher 1: Jean is our **closest comparison** -- a Tauri 2 desktop app for AI-assisted development with Claude CLI, Codex CLI, OpenCode CLI, and Cursor CLI.

## 1. Technical Architecture

### Stack
| Layer | Technology |
|-------|-----------|
| Desktop Shell | Tauri 2 (Rust) |
| Frontend | React 19 + TypeScript |
| Styling | Tailwind CSS v4 + shadcn/ui v4 (new-york style, neutral base) |
| State (Client) | Zustand v5 (3 stores: ui-store, chat-store, projects-store) |
| State (Server) | TanStack Query v5 |
| Icons | Lucide React |
| Bundler | Vite 7 |
| Terminal | xterm.js v6 + @xterm/addon-fit, @xterm/addon-web-links |
| Code Editing | CodeMirror 6 (chat input) |
| Syntax Highlight | Shiki v3 |
| Markdown | react-markdown + remark-gfm + rehype-raw |
| Drag & Drop | @dnd-kit (core, sortable, modifiers, utilities) |
| Layout | react-resizable-panels |
| Toasts | sonner |
| Diff Viewer | @pierre/diffs + diff |
| Command Palette | cmdk |

### Rust Backend (`src-tauri/`)
```
src-tauri/src/
├── main.rs                    # Entry point
├── lib.rs                     # Tauri commands (~2000+ lines)
├── chat/                      # Chat execution engine
│   ├── commands.rs            # Session CRUD, message sending
│   ├── claude.rs              # Claude CLI integration
│   ├── codex.rs               # Codex CLI integration
│   ├── opencode.rs            # OpenCode CLI integration
│   ├── cursor.rs              # Cursor CLI integration
│   └── registry.rs            # Process registry (cancellation)
├── claude_cli/                # Claude CLI management
├── codex_cli/                 # Codex CLI management
├── opencode_cli/              # OpenCode CLI management
├── cursor_cli/                # Cursor CLI management
├── gh_cli/                    # GitHub CLI integration
├── projects/                  # Project/worktree management
├── terminal/                  # Terminal processes
├── browser/                   # Browser pane
├── platform/                  # Platform-specific (Windows console flash prevention)
├── http_server/               # Web access mode
│   └── dispatch.rs            # WebSocket command routing
├── jean_mcp_config.rs         # MCP configuration
├── jean_mcp_core.rs           # MCP core types
├── jean_mcp_socket.rs         # MCP socket transport
├── jean_mcp_stdio.rs          # MCP stdio transport
└── background_tasks/          # Background task manager
```

### Key Architecture Decisions
1. **Event-driven bridge**: Rust -> React via `app.emit()`, React -> Rust via `invoke()` with TanStack Query
2. **WebSocket transport**: Every `#[tauri::command]` also registered in `dispatch.rs` for web access
3. **Three-layer state onion**: `useState` -> Zustand -> TanStack Query
4. **`getState()` pattern**: Use `getState()` in callbacks to avoid render cascades (core performance pattern)
5. **silent_command()**: Custom helper for Windows to prevent console window flashes
6. **Image processing**: Resize/compress images before sending to Claude (max 1568px, PNG->JPEG at 85%)

---

## 2. UI Layout & Component Structure

### Layout Architecture
```
┌──────────────────────────────────────────┐
│ Title Bar (Overlay, custom-drawn)        │
├──────┬───────────────────────────────────┤
│      │                                   │
│ Side │    Main Content Area              │
│ bar  │    ┌─────────────────────────┐    │
│      │    │ Chat Toolbar            │    │
│ Proj │    │ (Model, Mode, Backend)  │    │
│ ects │    ├─────────────────────────┤    │
│      │    │ Chat Messages           │    │
│ Work │    │ (Streaming, Tool Calls) │    │
│ tree │    ├─────────────────────────┤    │
│ s    │    │ Chat Input (CodeMirror) │    │
│      │    └─────────────────────────┘    │
│      │                                   │
└──────┴───────────────────────────────────┘
```

### Component Tree (key components)
```
App
└── MainWindow
    ├── CommandPalette (cmdk-based)
    ├── Sidebar (resizable panel)
    │   ├── ProjectList
    │   └── WorktreeList
    ├── ChatWindow
    │   ├── ChatToolbar
    │   │   ├── BackendSelector (claude/codex/opencode/cursor)
    │   │   ├── ModelSelector
    │   │   ├── ExecutionModeSelector (plan/build/yolo)
    │   │   ├── ThinkingLevelSelector
    │   │   └── SessionTabs
    │   ├── MessageList
    │   │   ├── UserMessage
    │   │   ├── AssistantMessage
    │   │   │   ├── TextContent (react-markdown)
    │   │   │   ├── ToolCallCard (collapsible)
    │   │   │   ├── ThinkingBubble (expandable)
    │   │   │   └── CodeBlock (Shiki syntax highlight)
    │   │   └── ApprovalCard (plan approval)
    │   ├── ChatInput
    │   │   ├── CodeMirror editor
    │   │   ├── FilePicker button
    │   │   ├── Image attachment area
    │   │   └── Send button
    │   └── TerminalPanel (xterm.js, dockable)
    ├── MagicModal (AI commands)
    ├── CommitModal
    ├── PRModal
    ├── PreferencesModal
    ├── OnboardingModal
    └── FeatureTourModal
```

---

## 3. Chat Interface Deep-Dive

### Chat Input (ChatInput.tsx)
- **Editor**: CodeMirror 6 (not plain textarea)
  - Syntax highlighting in chat input
  - Multi-line editing
  - Language modes: CSS, HTML, JS, JSON, Markdown, Python, Rust, SQL, YAML
- **Attachments**: File picker + image drag/drop + paste
  - Images resized to max 1568px, PNG -> JPEG at 85%
  - Image token cost displayed: `(width * height) / 750`
- **Send behavior**: Enter to send, Shift+Enter for newline
- **Focus shortcut**: `Cmd+L` (configurable)

### Message Display
- **Streaming**: Real-time text streaming with `chat:chunk` events
- **Thinking**: Expandable thinking/reasoning section (streaming or completed)
- **Tool Calls**: Collapsible cards showing:
  - Tool name + icon (Read, Edit, Bash, etc.)
  - Input parameters (truncated, expandable)
  - Output/result (collapsible, with diff view for edits)
  - Live events for long-running tools (Monitor notifications)
  - Status: armed, running, done, timeout, error
  - Parent-child attribution for sub-agent tool calls
- **Code Blocks**: Shiki syntax highlighting with copy button
- **Markdown**: Full GFM support via react-markdown + remark-gfm
- **Plan Approval**: Interactive approval cards when in plan mode
- **Codex-specific**: Command approval requests, dynamic tool calls, MCP elicitation, permissions requests, goal banner

### Session Management
- **Execution Modes**: Plan (read-only) / Build (auto-approve edits) / Yolo (bypass all permissions)
  - Cycled via `Shift+Tab`
  - Per-backend support: Cursor only supports plan/yolo
  - Build/yolo can override model/backend/effort when approving plans
- **Session Tabs**: Tab-style session switching within a worktree
  - `Cmd+Alt+Left/Right` to switch sessions
- **Context**: Saved contexts with AI summarization, file attachments
- **Recovery**: Auto-detect resumable sessions on startup
- **Archiving**: Auto-archive on PR merge, retention settings
- **Naming**: Auto-generated session titles via AI

### Model/Backend Configuration
- **Backends**: Claude CLI, Codex CLI, OpenCode CLI, Cursor CLI
- **Claude Models**: Opus 4.5, Opus 4.6, Opus 4.6 1M, Sonnet 4.6, Haiku
- **Thinking Levels** (Claude): off, think (4K), megathink (10K), ultrathink (32K)
- **Effort Levels** (Opus adaptive): low, medium, high, xhigh, max
- **Per-mode overrides**: Different model/effort for plan vs build vs yolo
- **Per-prompt overrides**: Magic prompts can specify custom model/backend/effort
- **Favorite models**: Pin preferred models

---

## 4. Design System

### Colors & Theming
- **Base**: neutral (shadcn/ui new-york)
- **CSS Variables**: Full cssVariables system via Tailwind
- **Themes**: Light, Dark, System
- **Transparency**: Window-level transparent background with sidebar effects
- **Window Effects**: `sidebar` effect with 12px radius (macOS vibrancy)

### Typography
- **Font System**: Customizable fonts loaded from `src/fonts/`
  - Fira Code, Geist, Inter, JetBrains Mono, Lato, Roboto, Source Code Pro
- **Font Settings**: User-configurable via preferences
  - `use-font-settings.ts` hook applies preferences
- **UI Font**: Inter (default)
- **Code Font**: JetBrains Mono (default)
- **Variable Fonts**: Geist loaded as variable font

### Icons
- **Library**: Lucide React v0.552.0
- **Custom Icons**: Located in `src/components/icons/`

### Spacing & Layout
- **Resizable Panels**: react-resizable-panels for sidebar/chat split
- **Sidebar**: Collapsible left sidebar (Cmd+B)
- **Min Window**: 1000x700 (from tauri.conf.json)
- **Default Window**: 800x600

### Radius & Shape
- **Window**: 12px border radius (from windowEffects config)
- **UI Components**: shadcn/ui default rounding (new-york style)

---

## 5. Keyboard Shortcuts (19 total, user-configurable)

| Action | Default | Description |
|--------|---------|-------------|
| `focus_chat_input` | Cmd+L | Focus chat input |
| `toggle_left_sidebar` | Cmd+B | Toggle sidebar |
| `open_preferences` | Cmd+, | Settings |
| `open_commit_modal` | Cmd+Shift+C | Git commit |
| `open_pull_request` | Cmd+Shift+P | Create PR |
| `open_git_diff` | Cmd+G | Git diff view |
| `execute_run` | Cmd+R | Run workspace script |
| `open_in_modal` | Cmd+O | Open in editor |
| `open_magic_modal` | Cmd+M | Magic commands |
| `new_session` | Cmd+T | New session |
| `next_session` | Cmd+Alt+Right | Next session tab |
| `previous_session` | Cmd+Alt+Left | Prev session tab |
| `close_session_or_worktree` | Cmd+W | Close/remove |
| `new_worktree` | Cmd+N | New worktree |
| `next_worktree` | Cmd+Alt+Down | Next worktree |
| `previous_worktree` | Cmd+Alt+Up | Prev worktree |
| `cycle_execution_mode` | Shift+Tab | Plan/Build/Yolo |
| `approve_plan` | Cmd+Enter | Approve/answer |
| `restore_last_archived` | Cmd+Shift+T | Restore archived |

### Implementation
- **Native DOM events** (not react-hotkeys-hook -- Tauri compatibility)
- All shortcuts stored in preferences.json
- Migration system for changing defaults
- Visual display with platform-specific symbols (Mac: Cmd symbols, Win: Ctrl)

---

## 6. Polish & Interaction Details

### Things That Feel Polished
1. **Auto-update flow**: Toast notification with progress %, install, restart button
2. **Onboarding wizard**: Detects CLI installation/auth status, only shows when needed
3. **Feature tour**: Shown after onboarding, one-time
4. **Session recovery**: Resumable sessions detected on startup, snapshots restored
5. **Sound notifications**: Preloaded sounds, configurable
6. **Web access mode**: Headless mode with HTTP server + WebSocket, token auth, reconnection overlay
7. **Toast feedback**: All background operations use toast notifications with action buttons
8. **Loading states**: Reconnect overlay, preloading screen for web mode
9. **Magic prompt defaults**: Auto-detects installed backends, sets appropriate defaults
10. **CLI version check**: Startup check for updates, toast notification
11. **Swipe gestures**: Mobile swipe back/down support
12. **Diff viewer**: Both unified and side-by-side modes
13. **File colors**: Color-coded file type badges

### Error Handling
- **ErrorBoundary**: Component-level error boundary
- **Global rejection handler**: Catches unhandled promise rejections
- **Auth error overlay**: Full-screen auth error for web access mode
- **Reconnect overlay**: Semi-transparent with backdrop blur during WebSocket reconnect

---

## 7. Cross-Cutting Questions

### How does the chat input area work?
- CodeMirror 6 editor (not plain textarea)
- Multi-language syntax highlighting
- File picker button for attachments
- Image paste/drop with auto-resize/compress
- Enter to send, Shift+Enter for newline
- Focus via Cmd+L

### How does it display agent thinking/reasoning?
- Expandable "thinking" sections in message bubbles
- Streaming thinking content (appears as it streams)
- Collapsed by default, click to expand

### How does it handle tool calls?
- Collapsible cards for each tool call
- Shows: tool name + icon, input (truncated), output (with syntax highlighting)
- Streaming tool calls with live events
- Status indicators (armed, running, done, timeout, error)
- Parent-child attribution for sub-agent calls
- Codex-specific approval requests

### What design tokens are used?
- shadcn/ui new-york, neutral base, CSS variables
- Tailwind CSS v4 with tailwind-merge + cva
- Lucide React icons
- Custom fonts: Inter (UI), JetBrains Mono (code)
- 12px window radius, macOS vibrancy effects

### ONE thing Jean does better than anyone else?
**Worktree-centric AI development workflow** -- Jean's git worktree management integrated with AI sessions is unique and powerful. Each worktree gets its own chat sessions, terminals, and state. Combined with auto-archive on PR merge, background investigation, and the worktree lifecycle (create, archive, restore, delete), it creates a workflow where AI-assisted development feels like a natural extension of git branching.

---

## 8. Borrow/Adapt/Ignore for AgentHub

### BORROW (directly applicable)
| Feature | Why |
|---------|-----|
| Tauri 2 window config (transparent, overlay titlebar, vibrancy) | Same tech stack, proven config |
| Three-layer state management (useState -> Zustand -> TanStack Query) | Proven pattern, reduces complexity |
| CodeMirror 6 chat input with syntax highlighting | Much better UX than plain textarea |
| Toast-based feedback for background operations | Clean pattern, non-intrusive |
| Resumable session recovery on startup | Essential for desktop app reliability |
| Silent process spawning (Windows console flash prevention) | Directly applicable to our Rust backend |
| WebSocket transport for multi-client support | Future-proofs for web access |
| Keyboard shortcut system with migration support | Complete, proven implementation |
| Event-driven Rust<->React bridge pattern | Same Tauri architecture |

### ADAPT (applicable with modifications)
| Feature | How to Adapt |
|---------|-------------|
| Worktree management | AgentHub might use "channels" instead of worktrees |
| Execution modes (plan/build/yolo) | Adapt to our agent permission model |
| Magic commands system | We can build similar "quick actions" for agents |
| Session archiving/recovery | Adapt to our conversation history model |
| Image processing pipeline | Same approach for file attachments |
| Per-backend configuration | We have multiple agent providers too |

### IGNORE (not applicable)
| Feature | Reason |
|---------|--------|
| GitHub Issues/PRs integration | Not our core focus |
| Linear integration | External service, not relevant |
| Dependabot investigation | Niche feature |
| macOS-specific signing/notarization config | Platform-specific |
