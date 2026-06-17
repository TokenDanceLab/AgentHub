# Competitor Analysis: CLI/TUI Agents (Goose + Crush)

> Researcher 4: Terminal-native agents built with Rust/Go using TUI frameworks, offering lessons in agent architecture and UX patterns that inform desktop app design.

## 1. Goose (by Agentic AI Foundation / Linux Foundation)

### Overview
- **Description**: "Your native open source AI agent -- desktop app, CLI, and API -- for code, workflows, and everything in between"
- **Built in**: Rust
- **License**: Apache 2.0
- **Governance**: Part of Linux Foundation's Agentic AI Foundation (AAIF)
- **Interfaces**: Native desktop app (Electron), CLI (Rust), API (HTTP), TUI (ink.rs React-based terminal UI)
- **Providers**: 15+ via ACP (Agent Communication Protocol) -- Anthropic, OpenAI, Google, Ollama, OpenRouter, Azure, Bedrock, etc.

### Architecture
```
crates/
├── goose/              # Core agent logic (largest crate)
├── goose-cli/          # CLI entry point (terminal interaction)
├── goose-server/       # Backend server binary (goosed)
├── goose-mcp/          # MCP extension system (~70 extensions)
├── goose-acp-macros/    # ACP protocol proc macros
├── goose-sdk/          # Rust SDK for embedding Goose
├── goose-test/         # Test utilities
└── goose-test-support/ # Test helpers

ui/
├── desktop/            # Electron desktop app
│   ├── forge.config.ts # Electron Forge build config
│   ├── openapi.json    # Generated OpenAPI spec (239KB!)
│   └── src/            # React frontend
├── goose2/             # Next-gen UI (React + Biome + Vite)
├── text/               # Ink.rs TUI (React-based terminal UI)
├── install-link-generator/
└── sdk/                # TypeScript SDK for Goose API
```

### Multi-Interface Strategy (Unique)
Goose is the only competitor that supports ALL interface types:
1. **Desktop (Electron)** -- Full GUI with file tree, chat, settings
2. **CLI (Rust)** -- Headless automation, CI/CD, scripting
3. **API (REST + WebSocket)** -- Embeddable, programmatic access
4. **TUI (Ink.rs)** -- Terminal-native interactive chat for SSH/remote
5. **SDK (Rust + TypeScript)** -- Build custom integrations

### Key Technologies
- **ACP Protocol**: Agent Communication Protocol -- Goose's standard for provider integration
  - Uses your existing Claude/ChatGPT/Gemini subscriptions
  - `acp-meta.json` (8.7KB) and `acp-schema.json` (94.6KB) define the protocol
- **MCP Support**: 70+ extensions via Model Context Protocol
- **OpenAPI**: Server generates 239KB OpenAPI spec for typed client generation
- **Forge**: Electron Forge for desktop packaging

### Ink.rs TUI Design (Important Lessons)
Goose's terminal UI uses Ink.rs (React for terminal). Key constraints learned:
```
- No overflow:hidden in Ink - content MUST fit container
- Fixed-height Boxes must use wrap="truncate" not wrap="wrap"
- Never use flexGrow on text inside fixed-height cards
- Calculate exact line budget: headers + footers + borders + margins + content
- Don't apply marginBottom to last list item (wastes a line)
- Border = 2 chars. Account for ALL chrome line usage
```

### Recipes/Workflows
- **Recipe system**: YAML-based workflow definitions (`goose-self-test.yaml`)
- **Run command**: `goose run --recipe <file>.yaml`
- Extensible via custom recipes

### Provider Architecture
- **Provider trait**: `providers/base.rs` defines the interface
- **15+ implementations**: Each provider implements the trait
- **ACP integration**: Providers can expose via ACP for subscription-based access

---

## 2. Crush (by Charm)

### Overview
- **Description**: "Your new coding bestie, now available in your favourite terminal"
- **Built with**: Go (Charm ecosystem)
- **License**: MIT
- **Philosophy**: Terminal-first, LSP-enhanced, session-based

### Feature Set
1. **Multi-Model**: Wide range of LLMs, plus custom OpenAI/Anthropic-compatible APIs
2. **Flexible Provider Switching**: Switch LLMs mid-session while preserving context
3. **Session-Based**: Multiple work sessions and contexts per project
4. **LSP-Enhanced**: Uses Language Server Protocol for additional code context
5. **MCP Extensions**: http, stdio, and sse transport
6. **Cross-Platform**: macOS, Linux, Windows (PowerShell + WSL), Android, FreeBSD, OpenBSD, NetBSD
7. **Charm Ecosystem**: Industrial-grade foundation powering 25k+ applications

### Distribution
Crush is distributed through EVERY possible channel:
- Homebrew, npm, Arch (yay), Nix, FreeBSD pkg
- Windows: winget, scoop
- Docker

### Charm Ecosystem Integration
- **Bubble Tea**: Charm's TUI framework (Go)
- **Lip Gloss**: Style definitions for terminal UIs
- **Glamour**: Markdown rendering in terminal
- **Huh**: Form components for terminal
- These libraries power Crush's terminal UI rendering

### Unique Value Propositions
1. **LSP Integration**: Crush connects to your project's LSP servers for real-time code intelligence context
2. **Session Context Preservation**: Switch models mid-conversation without losing context
3. **Charm Quality**: Benefits from the mature, well-tested Charm ecosystem
4. **Terminal Everywhere**: Works on platforms where GUI apps can't (SSH, WSL, Android, BSD)

---

## 3. CLI/TUI Patterns for Desktop Apps

### What Terminal UIs Teach Us About Agent UX

#### 1. Content Budget Management
Terminal UIs have FIXED character grids. This forces discipline:
- **Lesson**: Desktop apps should also respect viewport constraints
- **Apply to AgentHub**: Message bubbles should have max-width, truncate long tool outputs, show "View more" for large content

#### 2. Information Density
TUI can pack more info per "pixel" than GUI:
- **Lesson**: Don't waste space with excessive padding in chat
- **Apply to AgentHub**: Consider "compact mode" toggle for power users

#### 3. Keyboard-First Navigation
TUIs are inherently keyboard-driven:
- **Lesson**: Every action should have a keyboard shortcut
- **Apply to AgentHub**: Jean's 19 shortcuts show this well -- aim for similar coverage

#### 4. State Visibility
TUI agents show state through simple indicators (spinners, dots, colors):
- **Lesson**: Clear, minimal state indicators work better than verbose text
- **Apply to AgentHub**: Live status dots (like Kanna's idle/running/waiting/failed)

#### 5. Progressive Disclosure
TUIs show summary first, details on demand:
- **Lesson**: Don't dump everything on screen at once
- **Apply to AgentHub**: Tool call results should be collapsed by default, expandable

---

## 4. Cross-Cutting Questions

### How do they handle the chat input area?
- **Goose CLI**: Standard terminal line input with readline-style editing
- **Goose TUI**: Ink.rs text input component with all terminal constraints
- **Crush**: Bubble Tea text input with command history
- **Pattern**: Terminal inputs are inherently simpler but more keyboard-optimized

### How do they display agent thinking/reasoning?
- **Goose TUI**: Color-coded blocks for different content types within terminal constraints
- **Crush**: Glamour-rendered markdown with thinking in grey/dimmed text
- **Pattern**: Use visual distinction (color, dimming, indentation) rather than collapsible panels

### How do they handle tool calls?
- **Goose**: Tool calls are streamed events, rendered with:
  - Tool name in bold/colored
  - Input parameters in code font
  - Output with syntax-aware formatting
  - Status indicators
- **Crush**: Tool execution shown inline with LSP-enhanced context
- **Pattern**: Minimal but informative -- name + status is sufficient in stream

### What design tokens are used?
- **Goose**: Terminal color palette (ANSI colors), no CSS-level design tokens
- **Crush**: Charm Lip Gloss styles, adapts to terminal theme

### ONE thing each does better than anyone else?
- **Goose**: **Multi-interface coverage** -- Being the ONLY agent with CLI, Desktop, API, TUI, and SDK interfaces is a massive strategic advantage. The same agent engine works everywhere, and the ACP protocol makes provider integration standardized.
- **Crush**: **LSP integration for agent context** -- No other agent uses LSP to understand the codebase. This gives Crush real-time code intelligence (go-to-def, references, diagnostics) that no file-reading agent can match.

---

## 5. Borrow/Adapt/Ignore for AgentHub

### BORROW
| Feature | Source | Why |
|---------|--------|-----|
| Recipe/workflow YAML format | Goose | AgentHub could use for multi-agent workflow definitions |
| Provider trait pattern | Goose | Standardized agent provider interface |
| OpenAPI spec generation | Goose | Auto-generate typed API clients |
| SDK alongside desktop app | Goose | Embeddable AgentHub agent API |
| MCP extension ecosystem | Goose | 70+ extensions we can leverage |
| Content budget discipline | TUI patterns | Use max-width, truncation, expandable sections |
| Keyboard-first design philosophy | TUI patterns | Every action shortcut-able |
| Progressive disclosure | TUI patterns | Summary-first, details-on-demand |

### ADAPT
| Feature | Source | How to Adapt |
|---------|--------|-------------|
| Multi-interface strategy | Goose | AgentHub Desktop first, then CLI, API |
| ACP protocol | Goose | Standardized agent communication for our multi-agent system |
| LSP integration | Crush | Could enhance agent context with code intelligence |
| Mid-session model switching | Crush | AgentHub: per-message agent selection |
| Color-coded content types | Goose TUI | Message type badges in chat |

### IGNORE
| Feature | Source | Reason |
|---------|--------|--------|
| Electron desktop | Goose | We use Tauri for better performance |
| Terminal-only interface | Crush | Desktop is our primary target |
| Ink.rs TUI rendering details | Goose | Not applicable to web-based UI |
| Charm ecosystem dependency | Crush | Go library, not applicable to Tauri/Rust |
