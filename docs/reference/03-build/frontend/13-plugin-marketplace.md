# AgentHub Plugin Marketplace -- Design

> Generated: 2026-05-21
> Sources: cloudcli.md (Plugin manifest + RPC proxy + atomic install),
>   opencode.md (19 Hooks + bidirectional pattern),
>   librechat.md (Agent Marketplace + MCP manager),
>   langflow.md (MCP three-tier upgrade chain + Component registration),
>   design-adapter-sdk.md (3 registration modes + lifecycle)

---

## 1. Design Philosophy

AgentHub's plugin system draws from four reference implementations, each contributing a distinct layer:

| Reference | Contributes | Layer |
|-----------|------------|-------|
| **CloudCLI** | Manifest schema, atomic install, RPC proxy, process manager | Packaging & Distribution |
| **OpenCode** | Bidirectional hook pattern `(input, output) => Promise<void>`, 19 lifecycle hooks, permission merge | Runtime Extension |
| **LibreChat** | Agent Marketplace UI (grid + virtualized + category tabs), MCP manager singleton | Discovery & Discovery UI |
| **Langflow** | `tool_mode=True` → Agent tool → MCP tool upgrade chain, Component registration, per-project MCP | Capability Export |

Core principle: **a plugin starts as local code, graduates to an Agent tool, and optionally surfaces as an MCP tool -- without code changes**. This is the Langflow three-tier chain applied to AgentHub's Runner model.

---

## 2. Plugin Marketplace Lifecycle

### 2.1 Discovery

Plugins are discovered from three sources, mirroring the adapter registration tri-mode from `design-adapter-sdk.md` Section 1.3:

```
Source 1: Built-in Registry
  packages/plugin/registry/ -- Go init() self-registration
  Loaded at runner startup, always available

Source 2: Marketplace Index
  ~/.agenthub/plugins/ -- manifest.yaml scan (CloudCLI pattern)
  discoverPlugins() skips .tmp-* dirs (atomic install guard)

Source 3: Remote Registry
  GET /api/v1/plugins/search?q=&category=&author=&sort=
  Remote plugin index with version metadata
```

**Marketplace UI** (from LibreChat Section 1.6 + Langflow Section 1.5):

- **Grid view** with virtualized cards (`react-virtualized` or `@tanstack/virtual`)
- **Category tabs** filtering (agent, tool, theme, skill, mcp-bridge)
- **Fuse.js fuzzy search** across name, description, author, tags (Langflow sidebar pattern)
- **Plugin detail** page: description, version history, permissions, install count, author info
- **Sharing/Permissions UI**: LibreChat's People Picker + Access Roles pattern

### 2.2 Install Flow (Atomic)

Directly adapts CloudCLI's `installPluginFromGit()` atomic pattern (cloudcli.md Section 2.6):

```
1. Resolve plugin source (git URL, registry ID, or local path)
2. Validate name + version against the existing registry (duplicate check)
3. Clone/Download to .tmp-<name>-<hash>/ (skipped by scanPlugins)
4. Validate manifest.yaml:
   - name: ^[a-zA-Z0-9_-]+$
   - displayName: non-empty
   - entry: no path traversal (.. check), no absolute paths
   - permissions: must be string array
5. Run npm install --ignore-scripts (prevent postinstall attack, CloudCLI L341)
6. Run build script if present (60s timeout, CloudCLI L96-143)
7. fs.renameSync .tmp-* -> <plugin-name>/ (atomic -- scanner never sees half-installed)
8. Register in plugin registry
9. Start server sidecar if manifest has server entry
```

### 2.3 Update Flow

```
1. Check current version from manifest.yaml
2. Compare with target version (registry or git tag)
3. Backup current plugin dir -> .bak-<name>-<version>/
4. Repeat install steps 3-9 into a fresh .tmp-* directory
5. On success: swap .tmp-* -> plugin dir, delete backup
6. On failure: restore from .bak-*/, report error
7. Restart server sidecar (SIGTERM → SIGKILL two-phase, CloudCLI L111-136)
```

### 2.4 Uninstall Flow

```
1. SIGTERM server sidecar (5s grace) → SIGKILL
2. Remove plugin directory
3. Remove from plugin registry
4. Clean up any plugin-scoped data (config, secrets, caches)
```

### 2.5 Version Pinning & Dependency Resolution

- **Semver range** in manifest: `"dependencies": { "agenthub": "^1.2.0" }`
- **Plugin-to-plugin dependency**: `"requires": { "mcp-bridge": ">=0.3.0" }`
- **Conflict detection**: two plugins requesting the same slot with same priority → user resolves
- **Rollback**: keep last N versions in `.bak-*` for quick revert

---

## 3. Plugin Slot Types

CloudCLI currently has only `"tab"` (cloudcli.md L140). AgentHub extends to **five slot types**:

| Slot | Display Location | What Plugin Gets | Example Use Case |
|------|-----------------|-----------------|-----------------|
| **`tab`** | Main content area as a new tab (CloudCLI pattern) | Full React component, `mount(container, api)` / `unmount(container)` | Kanban board, diagram editor, workflow designer |
| **`panel`** | Sidebar bottom section, collapsible panel | React component, limited height (max 400px) | Mini file browser, quick actions, status monitor |
| **`toolbar`** | Top toolbar icon + dropdown/popover | React component in popover container | Quick prompt templates, clipboard manager |
| **`tool`** | Registered as an Agent tool (no UI, pure function) | Tool definition: `{ name, description, parameters, execute }` | API call, database query, file transformation |
| **`skill`** | Registered as an Agent skill (injected into system prompt) | Skill definition: `{ name, description, instructions }` | Code style guide, domain knowledge, workflow template |
| **`theme`** | Global theme override | CSS variables map + optional dark/light variants | Custom color scheme, font set |

**Slot priority & conflict resolution**:
- Multiple plugins can register for the same slot
- `tab` / `panel` / `toolbar`: sorted by `manifest.priority` (default 0), user can reorder
- `tool` / `skill`: name-unique; collision = last-installed wins with warning
- `theme`: only one active theme at a time; user selects in settings

### 3.1 UI Slot API (tab / panel / toolbar)

Each UI plugin receives a standard `PluginAPI` object (from CloudCLI L95-115):

```typescript
interface PluginAPI {
  // Environment context
  context: {
    theme: "dark" | "light"
    project: { name: string; path: string }
    session: { id: string; title: string }
  }
  onContextChange(cb: (ctx: PluginContext) => void): () => void  // unsubscribe

  // RPC to plugin server sidecar
  rpc(method: string, path: string, body?: unknown): Promise<unknown>

  // Agent interaction (tool/skill slots only)
  agent: {
    sendPrompt(text: string): Promise<void>
    getMessages(): Message[]
    onToolCall(cb: (call: ToolCall) => ToolResult): () => void
  }

  // UI utilities
  ui: {
    showNotification(opts: NotificationOpts): void
    openFile(path: string): void
  }
}
```

### 3.2 Non-UI Slot Types (tool / skill)

**Tool slot** -- registered as a callable Agent tool:

```yaml
# manifest.yaml (tool slot)
slot: tool
tool:
  name: "git_commit_summary"
  description: "Generate a summary of recent git commits"
  parameters:
    type: object
    properties:
      since:
        type: string
        description: "Git rev range, e.g. HEAD~5..HEAD"
    required: ["since"]
  execute: "tool-handler.js"  # exports async execute(params, context)
```

**Skill slot** -- injected into Agent system prompt:

```yaml
# manifest.yaml (skill slot)
slot: skill
skill:
  name: "python_style_guide"
  description: "Enforce project Python style conventions"
  instructions: |
    When writing Python code:
    - Use type hints on all function signatures
    - Prefer dataclasses over plain dicts
    - Max line length: 100 characters
  always_apply: false   # true = always in prompt, false = on-demand
```

### 3.3 Slot Loading Strategy

| Slot | Load Timing | Failure Behavior |
|------|------------|-----------------|
| `tab` | Manual activation (user clicks) | Error boundary in tab container |
| `panel` | On sidebar render | Collapsed with error indicator |
| `toolbar` | On toolbar render | Hidden, logged |
| `tool` | On agent startup | Skipped, warning in agent init |
| `skill` | On agent startup | Skipped, warning in system prompt build |
| `theme` | On app load | Fallback to default theme |

---

## 4. Plugin Permission Model

### 4.1 Permission Categories

Inspired by CloudCLI's permission array (cloudcli.md L131) and OpenCode's hierarchical permission merge (opencode.md Section 2.1 L152-158):

| Category | Permission | What It Grants |
|----------|-----------|---------------|
| **`fs`** | `fs.read` | Read files in project scope |
| | `fs.write` | Write files in project scope |
| | `fs.delete` | Delete files in project scope |
| | `fs.exec` | Execute files / run scripts |
| **`network`** | `network.http` | Outbound HTTP requests |
| | `network.websocket` | WebSocket connections |
| | `network.listen` | Open a local server port |
| **`agent`** | `agent.prompt` | Send prompts to the active agent |
| | `agent.messages.read` | Read agent conversation history |
| | `agent.tool.intercept` | Intercept/hook into tool calls |
| | `agent.tool.define` | Register new tools at runtime |
| | `agent.subagent.spawn` | Spawn sub-agents |
| **`system`** | `system.env.read` | Read environment variables |
| | `system.process.spawn` | Spawn child processes (sidecar) |
| | `system.clipboard` | Read/write system clipboard |
| | `system.notification` | Show OS notifications |
| **`ui`** | `ui.inject` | Inject UI components |
| | `ui.theme` | Override theme |
| | `ui.shortcut` | Register keyboard shortcuts |
| **`user`** | `user.identity` | Access user ID/email |
| | `user.secrets` | Access per-plugin secrets |

### 4.2 Permission Declaration

```yaml
# manifest.yaml
permissions:
  - fs.read
  - fs.write
  - network.http
  - agent.prompt
  - ui.inject
```

### 4.3 Permission Gates

Three-tier permission gating, adapted from OpenCode's merge model:

```
Layer 1: Plugin manifest  →  declared permissions (what the plugin asks for)
Layer 2: User config      →  user-approved permissions (what the user allows)
Layer 3: Agent policy     →  organization policy (admin-enforced allow/deny lists)

Effective permissions = Layer1 ∩ Layer2 ∩ Layer3  (intersection, not union)
```

**Runtime enforcement**:
- `fs.*`: validate path is within project scope (`path.resolve + startsWith` check, CloudCLI L271-273)
- `network.*`: SSRF-safe proxy for outbound requests (LibreChat `createSSRFSafeUndiciConnect`, librechat.md Section 3.5)
- `agent.*`: check at each tool call / prompt injection point
- `user.secrets`: secrets injected as `X-Plugin-Secret-*` headers, never exposed in API response (CloudCLI L244-246)

### 4.4 Install-Time Permission Prompt

When a user installs a plugin, they see:

```
Plugin: "Database Explorer" v1.2.0 by @author
Required permissions:
  [x] fs.read       -- Read project files
  [x] network.http  -- Connect to database server
  [ ] fs.write      -- (not requested)
  [ ] agent.prompt  -- (not requested)
  [!] system.process -- SPAWN CHILD PROCESSES -- requires extra approval

[Allow] [Allow with restrictions...] [Deny]
```

**Dangerous permission categories** (`system.process.spawn`, `fs.exec`, `network.listen`) require explicit user confirmation -- they cannot be granted via `--yes` or config defaults.

### 4.5 Runtime Permission Audit

- All permission-sensitive operations are logged with `[plugin:<name>]` prefix
- User can view permission usage: Settings > Plugins > <name> > Permissions Audit
- Excessive denial events trigger a warning: "Plugin X tried to access fs.write 47 times and was denied"

---

## 5. AgentHub Plugin System Architecture

### 5.1 Overall Architecture

```
┌──────────────────────────────────────────────────┐
│                   AgentHub Hub                     │
│                                                    │
│  ┌──────────────────┐   ┌──────────────────────┐  │
│  │ Plugin Registry  │   │ Plugin Manager        │  │
│  │ (init() +        │   │ (lifecycle: install,  │  │
│  │  manifest scan)  │   │  start, stop, update) │  │
│  └──────┬───────────┘   └──────────┬───────────┘  │
│         │                          │               │
│         ▼                          ▼               │
│  ┌──────────────────────────────────────────────┐  │
│  │              Plugin Runtime                    │  │
│  │                                                │  │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────────────┐  │
│  │  │ UI Slot │ │Tool Slot│ │ Skill Slot       │  │
│  │  │ Runtime │ │ Runtime │ │ Runtime           │  │
│  │  │(React   │ │(Tool    │ │(Prompt injection) │  │
│  │  │ mount)  │ │Registry)│ │                   │  │
│  │  └────┬────┘ └────┬────┘ └────────┬────────┘  │
│  │       │           │               │            │
│  │       ▼           ▼               ▼            │
│  │  ┌──────────────────────────────────────────┐  │
│  │  │          Permission Gate                   │  │
│  │  │  (manifest ∩ user ∩ policy enforcement)   │  │
│  │  └────────────────────┬─────────────────────┘  │
│  │                       │                        │
│  └───────────────────────┼────────────────────────┘
│                          │
│                          ▼
│  ┌──────────────────────────────────────────────┐
│  │          Plugin Server Sidecar                 │
│  │  (Node.js/Python/Rust -- ready protocol)       │
│  │  RPC: POST /rpc/<path>                         │
│  │  Secrets: X-Plugin-Secret-* headers            │
│  └──────────────────────────────────────────────┘
│                                                    │
│                          │
│                          ▼  (optional MCP export)
│  ┌──────────────────────────────────────────────┐
│  │       MCP Endpoint (tool_mode=true)            │
│  │  tools/list → plugin tools                     │
│  │  tools/call → plugin tool invocation           │
│  └──────────────────────────────────────────────┘
└──────────────────────────────────────────────────┘
```

### 5.2 Plugin Manifest Schema (Final)

Synthesized from CloudCLI's manifest (cloudcli.md L116-131) + design-adapter-sdk.md L337-361 + slot extensions:

```yaml
# manifest.yaml -- AgentHub Plugin Manifest
name: my-plugin                   # Required: ^[a-zA-Z0-9_-]+$
displayName: My Plugin            # Required: UI label
version: 1.2.0                    # Required: semver
description: "Does something useful"
author: "developer-name"
icon: Database                    # Lucide icon name
type: plugin                      # "plugin" (for marketplace) | "adapter" (for agent adapter)
slot: tab                         # tab | panel | toolbar | tool | skill | theme

# UI slot entry (required for tab/panel/toolbar slots)
entry: dist/plugin.js             # Relative path, no .. allowed

# Server sidecar (optional)
server: server.js                 # Relative path, spawns as child process

# Tool/Skill slot fields (required for tool/skill slots)
tool:                             # Only if slot: tool
  name: my_tool
  description: "Tool description"
  parameters: {...}               # JSON Schema
  execute: handler.js

skill:                            # Only if slot: skill
  name: my_skill
  description: "Skill description"
  instructions: "Instructions injected into system prompt"
  always_apply: false

# Theme slot fields (required for slot: theme)
theme:                            # Only if slot: theme
  variables:
    --primary: "#3B82F6"
    --background: "#0F172A"

# Permissions (required)
permissions:
  - fs.read
  - network.http

# Dependencies (optional)
dependencies:
  agenthub: "^1.0.0"
requires:                         # Plugin dependencies
  mcp-bridge: ">=0.3.0"

# Metadata (optional)
tags: [database, productivity]
homepage: https://github.com/author/my-plugin
priority: 0                       # Slot ordering, higher = first
```

### 5.3 Plugin SDK

Each plugin type gets a focused SDK:

**UI plugins** (`@agenthub/plugin-sdk/ui`):

```typescript
import { createPlugin, PluginAPI } from "@agenthub/plugin-sdk/ui"

export default createPlugin({
  mount(container: HTMLElement, api: PluginAPI) {
    // Render React/Preact/Svelte/Vanilla into container
    // api.rpc(), api.context, api.onContextChange() available
  },
  unmount(container: HTMLElement) {
    // Cleanup
  }
})
```

**Tool plugins** (`@agenthub/plugin-sdk/tool`):

```typescript
import { defineTool } from "@agenthub/plugin-sdk/tool"

export default defineTool({
  name: "git_commit_summary",
  description: "Summarize recent git commits",
  parameters: { ... },
  async execute(params, context) {
    // context.project, context.session, context.secrets
    return { summary: "..." }
  }
})
```

**Skill plugins** (`@agenthub/plugin-sdk/skill`):

```typescript
import { defineSkill } from "@agenthub/plugin-sdk/skill"

export default defineSkill({
  name: "python_style_guide",
  instructions: "When writing Python: use type hints...",
  // Optional: dynamic instructions based on context
  async getInstructions(context) {
    if (context.project.language === "python") {
      return "Full Python style guide ..."
    }
    return null  // skill not applicable
  }
})
```

### 5.4 Plugin Hook System

Adapted from OpenCode's 19-hook bidirectional model (opencode.md Section 1.2):

Hooks use the `(input, output) => void` bidirectional pattern. All hooks are optional.

| Hook | When | Input | Output (mutable) |
|------|------|-------|-----------------|
| `agent.before_start` | Before agent turn begins | session, prompt | prompt (modified), system_prompt (appended) |
| `agent.after_turn` | After agent turn completes | session, messages, result | summary |
| `tool.before_execute` | Before any tool executes | tool_name, args, session | args (modified), block (set true to deny) |
| `tool.after_execute` | After tool completes | tool_name, args, result, session | result (modified), metadata |
| `message.received` | New user message received | session, message | message (modified) |
| `message.before_send` | Before message sent to LLM | session, messages | messages (transformed) |
| `permission.ask` | Agent requests permission | tool_name, details | decision: "allow" / "deny" / "ask_user" |
| `session.compacting` | Before context compaction | session, context | instructions (appended to compaction prompt) |
| `theme.change` | Theme changed | theme (dark/light) | N/A (notify only) |

Hooks are registered in the plugin's `mount()` or module export:

```typescript
export default createPlugin({
  mount(container, api) {
    api.hooks.on("tool.before_execute", ({ args }, output) => {
      if (args.file_path && !args.file_path.startsWith("/safe/")) {
        output.block = true  // block unsafe file access
      }
    })
  }
})
```

---

## 6. Security Review Pipeline

### 6.1 Automated Checks (Install Time)

| Check | Description | Reference |
|-------|-------------|-----------|
| **Manifest validation** | Required fields, regex, path traversal check | CloudCLI L52-94 |
| **Permission audit** | Verify declared permissions match actual API usage (best-effort static analysis) | -- |
| **npm audit** | Run `npm audit` on plugin dependencies | CloudCLI L341 `--ignore-scripts` |
| **Known vulnerability scan** | Check plugin version against CVE database | -- |
| **Malicious pattern detection** | Scan for `eval()`, `child_process.exec()`, `fetch()` to unknown domains | -- |
| **Code signing** (future) | Verify plugin publisher signature | -- |

### 6.2 Runtime Sandboxing

| Slot Type | Sandbox Level | Mechanism |
|-----------|-------------|-----------|
| `tab` / `panel` / `toolbar` | **iframe isolation** | Plugin UI runs in sandboxed iframe with `sandbox="allow-scripts"`, communication via `postMessage` bridge |
| `tool` | **Worker thread** (Node.js) or **WASM** (browser) | Isolated execution context, no fs/network by default |
| `skill` | **Prompt-only** | No code execution; instructions injected as text |
| `theme` | **CSS-only** | Parsed & sanitized CSS, no `url()` to external resources |

### 6.3 Plugin Server Sidecar Isolation

For plugins with a `server` entry (CloudCLI pattern):

- **Environment**: only `PATH`, `HOME`, `NODE_ENV`, `PLUGIN_NAME` injected (CloudCLI L32-37)
- **Network**: localhost-only (`127.0.0.1`), OS-assigned port
- **Secrets**: per-plugin secrets injected as `X-Plugin-Secret-*` request headers (CloudCLI L244-246)
- **Process lifecycle**: SIGTERM (5s) → SIGKILL two-phase shutdown (CloudCLI L111-136)
- **Startup timeout**: 10s ready signal (CloudCLI L44-50)
- **Concurrency guard**: Map<name, Promise> prevents duplicate starts (CloudCLI L21-23)

### 6.4 Review Process for Published Plugins

```
1. Automated checks pass
2. Manual review required if:
   - plugin requests system.process.spawn or fs.exec
   - plugin has native (binary) dependencies
   - plugin's npm dependencies include packages with known vulnerabilities
3. Reviewed plugins marked as "verified" in marketplace
4. Unreviewed plugins shown with "community" badge + clear warning
```

---

## 7. MCP Export (The Three-Tier Upgrade Chain)

From Langflow's three-tier model (langflow.md Section 4):

```
Tier 1: Plugin tool (internal to AgentHub)
  slot: tool  →  registered in Agent tool registry

Tier 2: Agent tool (exposed to AgentHub agents)
  tool_mode: true  →  agent can call this tool in turns
  (automatic: any slot=tool plugin is agent-visible)

Tier 3: MCP tool (exposed to external MCP clients)
  export_mcp: true  →  tool appears in MCP tools/list
  (AgentHub MCP server exposes plugin tools to Claude Code, Codex, etc.)
```

A plugin developer writes a tool once. The same tool definition serves as:
1. An internal AgentHub tool (for Hub-level automation)
2. An Agent-callable tool (for user-facing agents)
3. An MCP tool (for external AI tools connecting via MCP)

No code changes required. This is the key insight from Langflow's `tool_mode=True` pattern adapted to AgentHub's Runner model.

---

## 8. Comparison: AgentHub Plugin vs Reference Implementations

| Dimension | CloudCLI | OpenCode | LibreChat | Langflow | **AgentHub (synthesized)** |
|-----------|----------|----------|-----------|----------|---------------------------|
| **Slots** | 1 (tab) | N/A (hooks only) | N/A | Sidebar + Canvas | 6 (tab, panel, toolbar, tool, skill, theme) |
| **Registration** | manifest.json + git clone | init() + dynamic import | N/A | dynamic import + component_index | init() + manifest.yaml + remote registry |
| **Permissions** | String array | Hierarchical merge (agent/user config) | Role-based sharing | N/A (same process) | Three-tier intersection (manifest/user/policy) |
| **Install** | Atomic (tmp + rename) | Bun dynamic import + retry | N/A | N/A (monorepo) | Atomic + backup + rollback |
| **Hook system** | None (RPC only) | 19 bidirectional hooks | N/A | Graph lifecycle events | 9 essential bidirectional hooks |
| **Sandboxing** | Process isolation | TUI/server separation | N/A | Same process | Iframe (UI) + Worker (tool) + Process (sidecar) |
| **MCP export** | None | MCP as first-class citizen | MCP manager singleton | Three-tier (Agentic/Project/External) | Three-tier upgrade chain |
| **Marketplace** | None | None | Agent grid + virtualized + sharing | Sidebar + Fuse.js search | Grid + virtualized + category + Fuse.js + sharing |

---

## 9. Implementation Priority

| Phase | Task | Source Pattern |
|-------|------|---------------|
| **P0** | Manifest schema + validation | CloudCLI L52-94 |
| **P0** | Plugin registry (init + manifest scan) | design-adapter-sdk.md Section 3 |
| **P0** | Atomic install + uninstall | CloudCLI L250-368 |
| **P0** | Permission model (declaration + gate) | OpenCode L152-158 + CloudCLI L131 |
| **P1** | UI slot runtime (tab/panel/toolbar) | CloudCLI PluginTabContent |
| **P1** | Tool/Skill slot runtime | OpenCode tool hook + librechat skill injection |
| **P1** | Server sidecar + ready protocol + RPC proxy | CloudCLI Section 2.5 + 2.7 |
| **P1** | Plugin SDK (npm packages) | design-adapter-sdk.md App A |
| **P2** | Marketplace UI (grid + search + detail) | LibreChat Section 1.6 |
| **P2** | Hook system (9 hooks) | OpenCode Section 1.2 |
| **P2** | MCP export tier | Langflow Section 4 |
| **P2** | Security review pipeline | Section 6 above |
| **P3** | Plugin-to-plugin dependencies | -- |
| **P3** | Code signing + verification | -- |
| **P3** | Remote plugin registry service | -- |

---

*Design complete. 2026-05-21.*
