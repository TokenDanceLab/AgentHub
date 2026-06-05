# Researcher 5: Sandbox, Tools, Trust, Cloud -- Advanced Features

> Sources: `codex-rs/protocol/src/config_types.rs`, `codex-rs/utils/cli/src/sandbox_mode_cli_arg.rs`, `codex-rs/app-server-protocol/src/protocol/v2/shared.rs`, `codex-rs/core/src/config/mod.rs` (Config struct), `codex-rs/cli/src/main.rs` (Subcommand enum)

## 5.1. Sandbox Modes

### Mode Enum
```rust
pub enum SandboxMode {
    ReadOnly,          // Can read files, cannot write
    WorkspaceWrite,    // Can write within workspace only (default)
    DangerFullAccess,  // Full filesystem access (--yolo equivalent)
}
```

### Adapter Mapping (codex.go)
```
plan               -> read-only
default            -> default (not a valid Codex sandbox; but passed as-is)
acceptEdits        -> workspace-write
dontAsk            -> workspace-write
bypassPermissions  -> danger-full-access
```

**Issue**: There is no `default` sandbox mode in Codex. The `--sandbox default` flag value is invalid. The adapter should NOT pass a sandbox flag when mode is "default". The correct mapping should leave the --sandbox flag off entirely for "default" mode, letting Codex use its built-in default (varies by trust level).

### Permission Profiles (Profile V2 - Modern Alternative)
Codex has moved beyond simple sandbox modes to **named permission profiles**:
- Configured via `$CODEX_HOME/<name>.config.toml` (ProfileV2Name)
- Selected via `--profile-v2 <name>` or `-c` config
- Profiles define: sandbox permissions, environment policies, MCP servers, collaboration modes, approval rules
- More flexible than legacy sandbox modes

**Adapter Gap**: No support for profile-based permission configuration. Should add `ConfigProfile` field to RunProcessContext.

### Windows-Specific Sandbox
```rust
pub enum WindowsSandboxLevel {
    Disabled,
    RestrictedToken,
    Elevated,
}
```
Only relevant on Windows platforms.

## 5.2. Tool Ecosystem

### Built-in Tools (Always Available)

| Tool | Description | Event Type | Adapter Mapping |
|------|-------------|------------|-----------------|
| Shell Command | Execute shell commands | `command_execution` | toolName="shell_command" |
| File Change | Apply file patches | `file_change` | toolName="apply_patch" |
| MCP Tools | External tool servers | `mcp_tool_call` | toolName="mcp__{server}__{tool}" |
| Web Search | Search the web | `web_search` | toolName="web_search", kind="web_search" |
| Collab Agent | Spawn/send/wait/close agents | `collab_tool_call` | `BusEventTaskStarted`/`BusEventTaskNotification` |
| Todo List | Task tracking | `todo_list` | toolName="plan", kind="plan" |
| Plan | Proposed plan (TUI only) | NOT in exec, only in app-server | N/A |

### App-Server Only Tools
| Tool | Description | Event Type |
|------|-------------|------------|
| DynamicToolCall | Client-implemented tools | `item/tool/dynamic/call` (server request) |
| Image Generation | Generate images | `ImageGeneration` item |
| Image View | Display local images | `ImageView` item |

### Tool Output Control
- `tool_output_token_limit`: Config key to limit tool output stored in context (prevents context overflow)

## 5.3. Approval & Trust System

### AskForApproval (6 levels)
```rust
pub enum AskForApproval {
    UnlessTrusted,   // Prompt unless project is trusted (default)
    OnFailure,       // Prompt only on failure
    OnRequest,       // Prompt when agent explicitly requests
    Granular {       // Fine-grained per-action prompting
        sandbox_approval: bool,
        rules: bool,
        skill_approval: bool,
        request_permissions: bool,
        mcp_elicitations: bool,
    },
    Never,           // Never prompt (implies --yolo behavior)
}
```

### ApprovalsReviewer (2 modes)
```rust
pub enum ApprovalsReviewer {
    User,          // Human user reviews (default)
    AutoReview,    // Guardian subagent auto-reviews (serialized as "guardian_subagent")
}
```

### Trust Level (2 levels)
```rust
pub enum TrustLevel {
    Trusted,    // Project is trusted (looser sandbox)
    Untrusted,  // Project is untrusted (strict sandbox)
}
```

Trust level determines:
- Default sandbox mode (Trusted -> WorkspaceWrite, Untrusted -> ReadOnly)
- Whether hooks require trust
- Default AskForApproval behavior

### Approval Review Actions
The guardian/auto-review system evaluates:
- `Command` - Shell command execution (with parsed command_actions)
- `Execve` - Individual program execution (zsh-exec-bridge mode)
- `ApplyPatch` - File changes (which files are being modified)
- `NetworkAccess` - Outbound network connections (host, port, protocol)
- `McpToolCall` - MCP tool invocations (server, tool_name)
- `RequestPermissions` - Permission escalation requests

### Guardian Risk Levels
```rust
pub enum GuardianRiskLevel { Low, Medium, High, Critical }
```

### Guardian User Authorization
```rust
pub enum GuardianUserAuthorization { Unknown, Low, Medium, High }
```

## 5.4. Cloud Tasks

### CLI Subcommand: `cloud` / `cloud-tasks`
```
codex cloud [OPTIONS]
```
- Browse tasks from Codex Cloud
- Apply changes locally
- EXPERIMENTAL feature

### App-Server Methods
- `cloudTasks/list`: List cloud tasks
- `cloudTasks/checkout`: Checkout a cloud task to local workspace

**Adapter Relevance**: LOW for Phase 1-2. Codex Cloud is OpenAI-specific infrastructure.

## 5.5. Web Search Configuration

### Web Search Modes
```rust
pub enum WebSearchMode {
    Disabled,   // No web search
    Cached,     // Use cached results (default)
    Live,       // Perform live web searches
}
```

### Web Search Context Size
```rust
pub enum WebSearchContextSize { Low, Medium, High }
```

### Config Structure
```toml
[web_search_tool_config]
context_size = "high"
allowed_domains = ["github.com", "docs.rs"]

[web_search_tool_config.location]
country = "US"
region = "CA"
city = "San Francisco"
timezone = "America/Los_Angeles"
```

Config key path: `web_search_mode`, `web_search_tool_config.*`

### Adapter Gap
The adapter does not configure web search at all. The `web_search` item type is handled for event parsing only. We should:
1. Add `WebSearchMode` to RunProcessContext
2. Pass `-c web_search_mode=<mode>` in BuildCommand
3. Optionally pass domain allowlists and location config

## 5.6. Other Advanced Features

### Structured Output (output-schema)
- `--output-schema FILE`: JSON Schema file for structured model output
- AgentMessage text becomes a JSON string matching the schema
- Useful for programmatic consumption

### External Notifier (notify command)
- Config: `notify = ["notify-send", "Codex"]`
- Spawns external process after each completed turn
- Receives JSON payload with event details

### Skills System
- `skills/list` app-server method
- `<skills_instructions>` injected into agent prompt
- Managed via marketplace (add/remove/upgrade)

### Hooks System
- `hooks/list` app-server method
- `--dangerously-bypass-hook-trust` flag
- HookPrompt fragments in thread items

### Experimental Features
- `experimentalFeatures/list`: List available experimental features
- `experimentalFeatures/enablement/set`: Enable/disable features
- Many app-server methods gated behind experimental feature flags
- Feature toggles: `--enable FEATURE`, `--disable FEATURE` on CLI

### ExecPolicy System
- `.rules` files for project-specific execution policies
- `--ignore-rules` flag to skip
- `execpolicy` CLI subcommand for management
- Proposed amendments can be part of approval decisions

### Memory System
- `memory/reset` app-server method
- `thread/memoryMode/set` for per-thread memory config
- Memory citations on AgentMessage items

## 5.7. Integration Priority for AgentHub

### P0 (Phase 1 - Now)
1. **Fix sandbox mode "default"**: Don't pass `--sandbox default` (invalid)
2. **Add web_search_mode config**: Allow disabling/enabling web search

### P1 (Phase 2)
3. **Approval handling**: Design workflow for approval callbacks in AgentHub
4. **Permission profiles**: Support `--profile-v2` for advanced sandbox config
5. **Structured output**: Support `--output-schema` for programmatic tasks

### P2 (Phase 3+)
6. **Guardian auto-review**: Could use AgentHub as the approval reviewer
7. **Cloud tasks**: If AgentHub has cloud task tracking
8. **Dynamic tools**: Allow AgentHub plugins to register as Codex dynamic tools
