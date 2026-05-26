# Competitor Analysis: Web Agent UIs (ClaudeCodeUI + Kanna)

> Researcher 3: Web UIs purpose-built for CLI agent interaction, operating as a visual layer on top of headless agent CLIs.

## 1. ClaudeCodeUI (CloudCLI)

### Overview
- **Purpose**: Desktop and mobile web UI for Claude Code, Cursor CLI, Codex, and Gemini CLI
- **Architecture**: Node.js server + React frontend (Vite) + WebSocket
- **Deployment**: Self-hosted (npm) or managed cloud (cloudcli.ai)
- **Platforms**: Web (desktop + mobile responsive), Electron desktop app
- **License**: Apache 2.0

### Tech Stack
| Layer | Technology |
|-------|-----------|
| Frontend | React + TypeScript + Vite |
| Backend | Node.js + Express + WebSocket |
| Syntax Highlight | react-syntax-highlighter |
| State | Zustand (useSessionStore) |
| Real-time | WebSocket (useWebSocketContext) |

### Feature Set
1. **Responsive Design** -- Desktop, tablet, and mobile from single codebase
2. **Interactive Chat Interface** -- Built-in chat for direct agent communication
3. **Integrated Shell Terminal** -- Direct CLI access through built-in shell (xterm.js)
4. **File Explorer** -- Interactive file tree with syntax highlighting and live editing
5. **Git Explorer** -- Stage, commit, branch switching from UI
6. **Session Management** -- Resume conversations, multiple sessions, history tracking
7. **Plugin System** -- Extend with custom plugins (tabs, backend services, integrations)
   - Plugin starter kit: `cloudcli-plugin-starter`
8. **TaskMaster AI Integration** -- AI-powered task planning, PRD parsing, workflow automation
9. **Multi-Model** -- Claude, GPT, Gemini model families (via `shared/modelConstants.js`)
10. **Web Push Notifications** -- Browser push notifications for long-running tasks
11. **Session Protection** -- Prevent accidental session loss
12. **Device Settings** -- Per-device configuration
13. **GitHub Stars** -- Social proof integration

### Architecture Notes
```
React Frontend (Vite)
    ↕ WebSocket
Node.js Server (Express + WS)
    ├── CLI Process Management
    ├── Session Store
    ├── Plugin Loader
    ├── File System Access
    └── Git Operations
    ↕ stdio
Claude Code / Cursor CLI / Codex / Gemini CLI
```

### Key UI Patterns
- **File Explorer**: Interactive file tree in sidebar for project context
- **Git Integration**: Visual diff/stage/commit from within chat context
- **Shell Terminal**: Terminal panel docked alongside chat for direct CLI access
- **Mobile Responsive**: Full mobile support with touch navigation
- **Plugin Tabs**: Extensible tab system for custom integrations

---

## 2. Kanna

### Overview
- **Purpose**: Beautiful web UI for Claude Code and Codex CLIs
- **Architecture**: Bun server + React frontend + WebSocket + Event Sourcing
- **Install**: `bun install -g kanna-code`, run `kanna` from any project
- **Design Philosophy**: "Event sourcing for all state mutations, CQRS with separate write and read paths"

### Technical Architecture (Key Innovation)
```
Browser (React + Zustand)
    ↕ WebSocket (reactive subscriptions)
Bun Server (HTTP + WS)
    ├── WSRouter ─── subscription & command routing
    ├── AgentCoordinator ─── multi-provider turn management
    ├── ProviderCatalog ─── provider/model/effort normalization
    ├── QuickResponseAdapter ─── structured queries with provider fallback
    ├── EventStore ─── JSONL persistence + snapshot compaction
    └── ReadModels ─── derived views (sidebar, chat, projects)
    ↕ stdio
Claude Agent SDK / Codex App Server (local processes)
    ↕
Local File System (~/.kanna/data/, project dirs)
```

### Event Sourcing Pattern (Unique)
Kanna uses **event sourcing** (CQRS) which is unique among competitor UIs:
- **Write path**: All mutations appended as events to JSONL event log
- **Read path**: ReadModels derive snapshot views from events
- **Compaction**: Periodic snapshot creation for performance
- **Replay**: Event store can replay to rebuild state
- **Reactive broadcasting**: Subscribers get pushed fresh snapshots on every state change

### Feature Set
1. **Multi-provider support** -- Claude and Codex from the same chat input
   - Per-provider model selection
   - Reasoning effort controls
   - Codex fast mode toggle
2. **Project-first sidebar** -- Chats grouped under projects
   - Live status indicators: idle, running, waiting, failed
   - Color-coded status dots
3. **Drag-and-drop project ordering** -- Reorder project groups with persistence
4. **Local project discovery** -- Auto-discovers projects from Claude and Codex local history
5. **Rich transcript rendering**:
   - Hydrated tool calls (expanded inline)
   - Collapsible tool groups with summary headers
   - Plan mode dialogs with approve/reject
   - Interactive prompts with full result display
6. **Quick responses** -- Lightweight structured queries via Haiku
   - Auto Codex fallback if Haiku unavailable
   - Used for title generation, summarization
7. **Plan mode** -- Review and approve agent plans before execution
8. **Persistent local history** -- Refresh-safe routes by design
9. **Auto-generated titles** -- Background title generation via Haiku
10. **Session resumption** -- Resume with full context preservation
11. **WebSocket-driven** -- Real-time subscription model

### Key Design Decisions
- **Event sourcing over CRUD**: Complete audit trail, time-travel debugging potential
- **Provider-agnostic transcript hydration**: Unified rendering regardless of which CLI generated the content
- **Tool gating**: User-approval flow gates tool execution behind user consent
- **Snapshot compaction**: Prevents event log from growing unbounded

---

## 3. Comparison: Web UIs vs Desktop Apps

### Strengths of Web UIs
| Aspect | Advantage |
|--------|----------|
| Cross-device access | Access from phone, tablet, any browser |
| No installation | Run `npx` or `bun install -g` |
| Remote operation | Can run on a server, access from anywhere |
| Responsive design | One codebase for all screen sizes |
| URL-based sharing | Deep-link to specific sessions |
| Quick deployment | Push updates without user action |

### Weaknesses of Web UIs
| Aspect | Disadvantage |
|--------|------------|
| System integration | Limited file system, process, notification access |
| Offline capability | Requires server running |
| Performance | Network latency for real-time streaming |
| Native feel | Browser chrome, no OS-native interactions |
| Security | Exposed HTTP endpoints need auth |

---

## 4. Cross-Cutting Questions

### How do they handle the chat input area?
- **ClaudeCodeUI**: Textarea with send button, supports multi-line
- **Kanna**: Provider switcher in input area, per-provider model/effort controls, plan mode toggle
- Neither supports @mentions or file drag-drop natively (both delegate to CLI)

### How do they display agent thinking/reasoning?
- **ClaudeCodeUI**: Thinking blocks rendered as separate collapsible sections in chat stream
- **Kanna**: Thinking sections rendered as collapsible blocks within the transcript. Since Kanna uses event sourcing, thinking content is stored as typed events and hydrated during rendering.

### How do they handle tool calls?
- **ClaudeCodeUI**: Tool calls rendered with:
  - Tool name badge
  - Input parameters (collapsed by default)
  - Output/result with syntax highlighting
  - Status: pending, running, done, error
- **Kanna**: Rich transcript rendering:
  - Hydrated tool calls with expandable input/output
  - Collapsible tool groups (multiple related tools bundled)
  - Plan mode dialogs for tool approval
  - Interactive prompts with user input fields
  - Provider-agnostic rendering (unified format regardless of Claude/Codex origin)

### What design tokens are used?
- **ClaudeCodeUI**: Material-UI influenced, dark theme primary, blue accent (#0066FF brand)
- **Kanna**: Pink accent (#f472b6), dark-first design, clean modern aesthetic

### ONE thing each does better than anyone else?
- **ClaudeCodeUI**: **Mobile + Desktop + Plugin System** -- It's the only competitor that simultaneously delivers a great mobile experience AND a plugin architecture AND desktop web access. The plugin system in particular could be very valuable for AgentHub to emulate.
- **Kanna**: **Event Sourcing Architecture** -- No other agent UI uses proper event sourcing. This gives Kanna unprecedented data integrity, the ability to replay and reconstruct state, and a clean audit trail of every agent interaction. It's architecturally the most sophisticated agent UI.

---

## 5. Borrow/Adapt/Ignore for AgentHub

### BORROW
| Feature | Source | Why |
|---------|--------|-----|
| File explorer in sidebar | ClaudeCodeUI | Direct file access context for agents |
| Git explorer panel | ClaudeCodeUI | Version control visibility in chat |
| Plugin/tab extension system | ClaudeCodeUI | Extensibility for AgentHub's multi-agent |
| Provider switcher in chat input | Kanna | AgentHub needs per-message agent selection |
| Rich tool call rendering | Kanna | Collapsible, status-aware tool cards |
| Event sourcing for conversation history | Kanna | Guarantees data integrity, enables replay |
| Auto-generated chat titles | Kanna | Essential UX for conversation management |
| Project-first sidebar organization | Kanna | AgentHub's project-centric view |
| Live status indicators (idle/running/waiting) | Kanna | Agent state visibility |
| Quick responses with fallback | Kanna | Lightweight operations (title gen, summarization) |

### ADAPT
| Feature | Source | How to Adapt |
|---------|--------|-------------|
| Web access mode | ClaudeCodeUI | AgentHub Desktop can add web access later via Tauri HTTP server |
| Plugin system | ClaudeCodeUI | Adapt to AgentHub's agent plugin model |
| Event sourcing | Kanna | Full event sourcing may be overkill, but append-only JSONL logs are practical |
| CQRS read models | Kanna | Derived views for sidebar, chat list, agent status |
| Provider-agnostic rendering | Kanna | Unified UI regardless of Claude Code, Codex, or OpenCode backend |

### IGNORE
| Feature | Source | Reason |
|---------|--------|--------|
| Mobile-first design | ClaudeCodeUI | Desktop-first for AgentHub |
| Cloud-hosted deployment | ClaudeCodeUI | Local-first desktop app |
| Bun runtime dependency | Kanna | We use Tauri/Rust + Node ecosystem |
| Web push notifications | ClaudeCodeUI | Desktop has native notifications |
