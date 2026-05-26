# Researcher 3: codex app-server -- Full JSON-RPC Protocol

> Sources: `codex-rs/app-server/src/main.rs`, `codex-rs/app-server-protocol/src/protocol/common.rs`, `codex-rs/app-server-protocol/src/protocol/v2/*.rs`, `codex-rs/app-server-protocol/src/jsonrpc_lite.rs`

## 3.1. Transport & Connection

The app-server listens on a transport URL:

| Transport | URL | Description |
|-----------|-----|-------------|
| stdio | `stdio://` | Default; stdin/stdout JSON-RPC |
| Unix socket | `unix://` or `unix://PATH` | Local IPC |
| WebSocket | `ws://IP:PORT` | Network-accessible |

CLI flags:
- `--listen URL` (default: `stdio://`)
- `--session-source SOURCE` (default: `vscode`)
- `--strict-config`
- `--remote-control` (enable remote control, hidden flag)
- `--disable-plugin-startup-tasks-for-tests` (debug only)

## 3.2. JSON-RPC Primitives

The app-server uses a "lite" JSON-RPC variant (no `"jsonrpc"` field):

```json
// Request (client -> server)
{ "id": "1", "method": "thread/start", "params": { ... } }

// Response (server -> client)
{ "id": "1", "result": { ... } }

// Error (server -> client)
{ "error": { "code": -32000, "message": "...", "data": { ... } } }

// Notification (no id, one direction)
{ "method": "item/started", "params": { ... } }
```

## 3.3. Client -> Server Methods (Requests)

Full registry from `client_request_definitions!` macro in common.rs. Organized by category:

### Thread Lifecycle (8 methods)
| Method | Description |
|--------|-------------|
| `thread/start` | Create a new thread with model, permissions, sandbox, etc. |
| `thread/resume` | Resume an existing thread by id or path |
| `thread/fork` | Fork a thread with optional overrides |
| `thread/archive` | Archive a thread |
| `thread/unarchive` | Unarchive a thread |
| `thread/unsubscribe` | Unsubscribe from thread updates |
| `thread/rollback` | Rollback thread to previous state |
| `thread/shellCommand` | Run a shell command in a thread context |

### Thread Metadata (4 methods)
| Method | Description |
|--------|-------------|
| `thread/name/set` | Set thread display name |
| `thread/metadata/update` | Update thread metadata |
| `thread/goal/set` | EXPERIMENTAL: Set thread goal (objective, status, token_budget) |
| `thread/goal/get` | EXPERIMENTAL: Get thread goal |
| `thread/goal/clear` | EXPERIMENTAL: Clear thread goal |

### Turn Management (3 methods)
| Method | Description |
|--------|-------------|
| `turn/start` | Start a new turn (send user input to agent) |
| `turn/steer` | Steer an existing turn (inject additional user input) |
| `turn/interrupt` | Interrupt a running turn |

### Thread Browsing (5 methods)
| Method | Description |
|--------|-------------|
| `thread/list` | List all threads |
| `thread/loaded/list` | List currently loaded threads |
| `thread/read` | Read a thread's full history |
| `thread/turns/list` | EXPERIMENTAL: List turns in a thread |
| `thread/turns/items/list` | EXPERIMENTAL: List items in thread turns |
| `thread/inject_items` | Append raw Response API items to thread history |

### Turn Context (3 experimental)
| Method | Description |
|--------|-------------|
| `thread/compact/start` | Start context compaction |
| `thread/increment_elicitation` | EXPERIMENTAL: Increment elicitation counter |
| `thread/decrement_elicitation` | EXPERIMENTAL: Decrement elicitation counter |

### Memory (2 experimental)
| Method | Description |
|--------|-------------|
| `thread/memoryMode/set` | EXPERIMENTAL: Set memory mode for thread |
| `memory/reset` | EXPERIMENTAL: Reset memory state |

### Approval (1 method)
| Method | Description |
|--------|-------------|
| `thread/approveGuardianDeniedAction` | Override a guardian denied action |

### File System (9 methods)
| Method | Description |
|--------|-------------|
| `fs/read` | Read file at path |
| `fs/write` | Write file |
| `fs/create` | Create file/directory |
| `fs/metadata` | Get file metadata |
| `fs/readdir` | List directory contents |
| `fs/remove` | Remove file/directory |
| `fs/copy` | Copy file/directory |
| `fs/watch` | Watch file/directory for changes |
| `fs/unwatch` | Stop watching file/directory |

### Fuzzy File Search (2 experimental)
| Method | Description |
|--------|-------------|
| `fuzzyFileSearch/start` | EXPERIMENTAL: Start fuzzy file search session |
| `fuzzyFileSearch/step` | EXPERIMENTAL: Step fuzzy file search session |

### Terminal / Command Execution (5 methods)
| Method | Description |
|--------|-------------|
| `commandExec/write` | Write stdin to a running command |
| `commandExec/terminate` | Terminate a running command |
| `commandExec/resize` | Resize a command's PTY |

### Process Management (3 methods)
| Method | Description |
|--------|-------------|
| `process/spawn` | Spawn a process |
| `process/writeStdin` | Write to process stdin |
| `process/kill` | Kill a process |
| `process/resizePty` | Resize process PTY |

### Skills & Hooks (2 methods)
| Method | Description |
|--------|-------------|
| `skills/list` | List available skills |
| `hooks/list` | List available hooks |

### Marketplace (3 methods)
| Method | Description |
|--------|-------------|
| `marketplace/add` | Install from marketplace |
| `marketplace/remove` | Remove marketplace item |
| `marketplace/upgrade` | Upgrade marketplace item |

### Plugin Lifecycle (3 methods)
| Method | Description |
|--------|-------------|
| `plugin/list` | List plugins |
| `plugin/installed` | Check if plugin installed |
| `plugin/read` | Read plugin content |

### Code Review (1 method)
| Method | Description |
|--------|-------------|
| `review/start` | Start a code review |

### Cloud Tasks (3 methods)
| Method | Description |
|--------|-------------|
| `cloudTasks/list` | List cloud tasks |
| `cloudTasks/checkout` | Checkout a cloud task |

### Model & Config (8 methods)
| Method | Description |
|--------|-------------|
| `initialize` | Initialize the app-server session |
| `config/read` | Read config values |
| `config/value/write` | Write a config value |
| `config/batch/write` | Write multiple config values |
| `config/requirements/read` | Read requirements.toml config |
| `model/list` | List available models |
| `modelProvider/capabilities/read` | Read model provider capabilities |
| `experimentalFeatures/list` | List experimental features |
| `experimentalFeatures/enablement/set` | Enable/disable experimental features |

### Auth (8 methods)
| Method | Description |
|--------|-------------|
| `auth/status` | Get auth status |
| `auth/login` | Login |
| `auth/login/cancel` | Cancel login |
| `auth/logout` | Logout |
| `account/get` | Get account info |
| `account/getRateLimits` | Get account rate limits |
| `sendAddCreditsNudgeEmail` | Send add credits nudge email |
| `feedback/upload` | Upload feedback |

### Remote Control (2 experimental)
| Method | Description |
|--------|-------------|
| `remoteControl/start` | EXPERIMENTAL: Start remote control proxy |
| `remoteControl/stop` | EXPERIMENTAL: Stop remote control proxy |

### Collaboration Mode (1 method)
| Method | Description |
|--------|-------------|
| `collaborationMode/list` | List collaboration modes |

### Environment (1 method)
| Method | Description |
|--------|-------------|
| `environment/add` | Add an environment resource |

### MCP Server Management (6+ methods)
| Method | Description |
|--------|-------------|
| `mcpServer/list` | List MCP servers |
| `mcpServer/get` | Get MCP server details |
| `mcpServer/delete` | Delete MCP server |
| `mcpServer/approval/enable` | Enable MCP server approval |
| `mcpServer/approval/disable` | Disable MCP server approval |
| `mcpServer/oauth/start` | Start MCP OAuth flow |
| `mcpServer/oauth/exchange` | Exchange MCP OAuth code |

### External Agent (2 experimental)
| Method | Description |
|--------|-------------|
| `externalAgent/config/get` | EXPERIMENTAL: Get external agent config |
| `externalAgent/config/set` | EXPERIMENTAL: Set external agent config |

### Permission Profiles (1 method)
| Method | Description |
|--------|-------------|
| `permissionProfile/list` | List permission profiles |

### One-off Execution (1 legacy)
| Method | Description |
|--------|-------------|
| `command/exec` (oneOffCommandExec) | Legacy: Execute a one-off command |

### Background Terminals (1 experimental)
| Method | Description |
|--------|-------------|
| `thread/backgroundTerminals/clean` | EXPERIMENTAL: Clean background terminals |

## 3.4. Server -> Client Notifications (Push Events)

Major notification categories (60+ in total):

### Thread
- `thread/started`, `thread/statusChanged`, `thread/archived`, `thread/unarchived`, `thread/closed`, `thread/nameUpdated`
- `thread/goalUpdated`, `thread/goalCleared` (experimental)
- `thread/tokenUsageUpdated`

### Turn
- `turn/started`, `turn/completed`, `turn/diffUpdated`, `turn/planUpdated`

### Items (streaming deltas)
- `item/started` (ItemStartedNotification: item, threadId, turnId, startedAtMs)
- `item/completed` (ItemCompletedNotification: item, threadId, turnId, completedAtMs)
- `item/agentMessage/delta` (AgentMessageDeltaNotification)
- `item/plan/delta` (PlanDeltaNotification) -- EXPERIMENTAL
- `item/reasoning/summaryText/delta` (ReasoningSummaryTextDeltaNotification)
- `item/reasoning/summaryText/partAdded` (ReasoningSummaryPartAddedNotification)
- `item/reasoning/text/delta` (ReasoningTextDeltaNotification)
- `item/commandExecution/output/delta` (CommandExecutionOutputDeltaNotification)
- `item/fileChange/patchUpdated` (FileChangePatchUpdatedNotification)
- `item/rawResponseItem/completed` (RawResponseItemCompletedNotification)

### Approval
- `item/commandExecution/requestApproval` (CommandExecutionRequestApprovalParams) -- SERVER REQUEST (expects response)
- `item/fileChange/requestApproval` (FileChangeRequestApprovalParams) -- SERVER REQUEST
- `item/tool/requestUserInput` (ToolRequestUserInputParams) -- SERVER REQUEST (experimental)
- `item/autoApprovalReview/started` (ItemGuardianApprovalReviewStartedNotification) -- UNSTABLE
- `item/autoApprovalReview/completed` (ItemGuardianApprovalReviewCompletedNotification) -- UNSTABLE

### Dynamic Tools
- `item/tool/dynamic/call` (DynamicToolCallParams) -- SERVER REQUEST (expects response)

### MCP
- `item/tool/mcp/elicitationRequest` (McpServerElicitationRequest) -- SERVER REQUEST

### Permissions
- `item/permissions/requestApproval` (PermissionsRequestApprovalParams) -- SERVER REQUEST

### Auth
- `chatgptAuthTokens/refresh` -- SERVER REQUEST
- `attestation/generate` -- SERVER REQUEST

### Legacy
- `item/applyPatch/approval` (deprecated)
- `item/commandExecution/approval` (deprecated, v1)

## 3.5. app-server vs exec Comparison

| Dimension | exec (Phase 1) | app-server (Phase 2) |
|-----------|---------------|---------------------|
| Protocol | JSONL stdout | JSON-RPC (bidirectional) |
| Streaming | Batch only (text at completion) | Real-time text/tool/reasoning deltas |
| Multi-turn | One exec = one turn | Persistent thread; multi-turn |
| Thread continuity | Manual resume via subcommand | First-class thread lifecycle |
| Tool interaction | Read-only event stream | Bidirectional (approve, steer, interrupt) |
| File system | Via shell commands only | Full fs/ read/write/watch API |
| MCP management | config.toml only | Dynamic MCP server add/remove |
| Cloud tasks | Not available | Full cloud task browsing |
| Auth | static config | Full OAuth/keyring/AgentIdentity |
| Config management | -c flags at startup | Dynamic config read/write at runtime |
| Process/terminal | Via shell tool only | Dedicated process/terminal APIs |
| Transport | Local only (process spawn) | stdio://, unix://, ws:// (remote capable) |

## 3.6. Phase 2 Integration Feasibility

### High Value for AgentHub
1. **Streaming deltas**: Real-time AgentMessage, Reasoning, CommandOutput streaming = better UX
2. **Persistent threads**: Thread lifecycle matches AgentHub's thread model
3. **Turn steering**: Can inject additional user input mid-turn (IM-style collaboration!)
4. **Approval callbacks**: Can handle sandbox escapes, file change approvals programmatically
5. **Thread forking**: Multiple AgentHub participants can fork from the same base

### Complexity Worth Noting
1. **Bidirectional protocol**: Requires persistent connection management (WebSocket or Unix socket)
2. **60+ notification types**: Must handle subset; graceful ignore of unknown types
3. **Experimental API surface**: Many methods gated behind experimental features
4. **Auth complexity**: Multiple auth modes (API key, ChatGPT OAuth, AgentIdentity)
5. **No "jsonrpc" field**: Not quite JSON-RPC spec-compliant; need custom codec

### Recommended Transport: WebSocket (`ws://`)
- Allows remote app-server deployment
- WS is well-supported on both sides
- Enables connection pooling for multiple threads
