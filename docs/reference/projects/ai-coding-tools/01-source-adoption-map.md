# AI Coding Tools — Source Adoption Map for AgentHub

> Generated: 2026-05-24 | Sources: aider, cline, continue, Roo-Code (actual source code)

---

## 1. aider — CLI AI Coding Tool

### 1.1 Edit Format Strategy Pattern (Multi-Coder Architecture)

**Finding: Adopt edit-format negotiation for agent response parsing**

**Source**: `aider/aider/coders/base_coder.py:124-200`
**Target**: `edge-server/internal/adapters/adapter.go:23-43` (AgentAdapter interface)
**What**: aider supports 14+ "edit formats" (udiff, editblock, wholefile, search_replace, editor_diff, etc.) via a `Coder.create()` factory that selects the right coder class based on model capabilities. AgentHub's AgentAdapter interface has a single `ParseStream` method with no format negotiation. Adopt a `SupportedFormats() []string` capability on AgentCapabilities so the Edge server can negotiate the best edit format per model.
**Priority**: P1

---

**Finding: ChatChunks prompt caching with ephemeral cache_control**

**Source**: `aider/aider/coders/chat_chunks.py:28-55`
**Target**: `edge-server/internal/adapters/claude_code.go:122-130` (ParseStream)
**What**: aider marks messages for Anthropic prompt caching by adding `cache_control: {type: "ephemeral"}` to content blocks — system prompt, repo map, and chat files. AgentHub has no prompt caching. Add cache-breakpoint hints to NDJSON events so the Edge server can mark cacheable content, reducing input token costs by ~90%.
**Priority**: P1

---

**Finding: Multi-strategy search/replace pipeline**

**Source**: `aider/aider/coders/search_replace.py:434-608`
**Target**: `app/desktop/src/components/DiffViewer.tsx:108-240`
**What**: aider applies edits via 4 strategies in cascade: simple `str.replace()`, `git cherry-pick`, Google diff-match-patch, and line-based DMP — each tried with 4 preprocessors (strip blanks, relative indent, reverse). AgentHub's DiffViewer is a presentation-only component with no edit application logic. Could benefit from a client-side edit application pipeline for `Write`/`Edit` tool results to preview changes in-editor.
**Priority**: P2

---

**Finding: Model alias normalization**

**Source**: `aider/aider/models.py:92-116` (MODEL_ALIASES)
**Target**: `edge-server/internal/adapters/model_config.go:1` (ModelConfig)
**What**: aider maps shorthand aliases (`sonnet`, `opus`, `haiku`, `4o`, `flash`) to canonical model IDs via a MODEL_ALIASES dict and a ModelSettings dataclass with per-model edit_format preferences. AgentHub's ModelConfig lack user-facing aliases. Add alias resolution to `ResolveModel()` so users can type "sonnet" instead of "claude-sonnet-4-6".
**Priority**: P1

---

**Finding: Repo map for workspace awareness**

**Source**: `aider/aider/repo.py:52-100` (GitRepo class), `aider/aider/repomap.py`
**Target**: `edge-server/internal/adapters/claude_code.go:112-117` (--add-dir)
**What**: aider builds a "repo map" — a token-budgeted AST-level summary of the repository structure sent as part of the system prompt. AgentHub passes `--add-dir <workDir>` to Claude Code but has no repo-aware context construction. Add a repo map builder that generates a structured file tree with key symbols, sent before the user prompt.
**Priority**: P2

---

**Finding: Slash command system for agent control**

**Source**: `aider/aider/commands.py:87-150` (cmd_model, cmd_chat_mode, etc.)
**Target**: `edge-server/internal/adapters/adapter.go:72-102` (BusEvent constants)
**What**: aider exposes 30+ slash commands (`/model`, `/chat-mode`, `/editor-model`, `/add`, `/drop`, `/commit`, `/undo`, etc.) for runtime configuration changes. AgentHub's event system has no command layer. Add slash command support via control protocol `set_model`, `set_permission_mode` messages that already exist.
**Priority**: P2

---

## 2. cline — VS Code AI Extension

### 2.1 Task State Machine

**Finding: Comprehensive TaskState tracking**

**Source**: `cline/src/core/task/TaskState.ts:6-83`
**Target**: `app/desktop/src/stores/runStore.ts:6-26` (RunState interface)
**What**: cline's TaskState tracks 20+ dimensions: streaming flags, content processing state, ask/response handling, file read dedup cache, error tracking, loop detection counters, auto-retry state, focus chain / todo management, abort/cancellation, and auto-context summarization. AgentHub's RunState tracks only `runId, status, outputText, toolCalls, changedFiles`. Add streaming state, error counters, and abort tracking to RunState.
**Priority**: P0

---

**Finding: File read deduplication cache**

**Source**: `cline/src/core/task/TaskState.ts:50-52` (fileReadCache)
**Target**: `edge-server/internal/adapters/security_hooks.go:36-40` (PreToolUse)
**What**: cline maintains a `Map<string, {readCount, mtime, imageBlock}>` per task to deduplicate repeated file reads — prevents the LLM from reading the same file 100+ times in a loop. AgentHub has no dedup. Add a file-read cache in the NDJSON parser or SecurityHook that short-circuits Read tool calls for already-read files with unchanged mtime.
**Priority**: P0

---

**Finding: Tool execution loop detection**

**Source**: `cline/src/core/task/loop-detection.ts:21-68`
**Target**: `edge-server/internal/adapters/parser_ndjson.go` (no existing loop detection)
**What**: cline detects repeated tool calls (same name + same params) with soft (3) and hard (5) thresholds. When soft threshold is hit, it injects a warning; hard threshold escalates to the user. AgentHub has no loop detection — an agent stuck calling `Read` on the same file endlessly will consume the entire token budget. Add `checkRepeatedToolCall` to the NDJSON parser with tool call signature tracking.
**Priority**: P0

---

**Finding: gRPC-like proto-based WebView communication**

**Source**: `cline/proto/cline/task.proto`, `cline/src/core/webview/WebviewProvider.ts:11-100`
**Target**: `app/desktop/src/api/eventClient.ts:19-112` (WebSocket client)
**What**: cline uses protobuf-based typed messages between extension and webview with code-generated clients and handlers. AgentHub uses plain JSON over WebSocket with manual type definitions. While protobuf is heavyweight for AgentHub's current scale, cline's pattern of generated type-safe message contracts is worth adopting via a shared JSON schema.
**Priority**: P2

---

**Finding: Dedicated CommandPermissionController**

**Source**: `cline/src/core/permissions/CommandPermissionController.ts`
**Target**: `edge-server/internal/adapters/control_protocol.go:74-144` (DefaultPermissionHandler)
**What**: cline has a configurable `CommandPermissionController` that supports per-command permissions, auto-approval by path, and integration with the config system. AgentHub's `DefaultPermissionHandler` auto-approves everything. A proper permission controller with configurable rules (e.g., auto-approve Read on certain paths, always ask for Bash) would improve security posture.
**Priority**: P1

---

**Finding: Auto-context compact / summarization**

**Source**: `cline/src/core/task/index.ts:1-40` (imports include ContextManager, executePreCompactHook)
**Target**: `edge-server/internal/adapters/context_budget.go:1-5` (stub)
**What**: cline has a full `ContextManager` system that tracks token usage, triggers auto-compact when approaching context limits, and uses a `summarizeTask` prompt to compress history. AgentHub's `context_budget.go` is a 5-line stub with no implementation. Implement context budget tracking and auto-compaction in the Edge server.
**Priority**: P1

---

**Finding: Streaming partial messages UI pattern**

**Source**: `cline/src/core/controller/ui/subscribeToPartialMessage.ts`, `cline/webview-ui/src/App.tsx:82` (ChatView never unmounts)
**Target**: `app/desktop/src/components/ChatView.tsx:336-378` (message map), `app/desktop/src/hooks/useStreamingText.ts`
**What**: cline keeps `ChatView` always mounted (never conditionally rendered) to preserve streaming state across view transitions. AgentHub conditionally renders ChatView based on message count. Additionally, cline's partial message system sends incremental stream chunks with a `partial: true` flag. AgentHub's `useStreamingText` hook provides char-by-char animation but lacks the partial-message protocol.
**Priority**: P1

---

## 3. continue — Open-Source AI Code Assistant

### 3.1 Streaming Diff Application

**Finding: Real-time myers-diff streaming**

**Source**: `continue/core/diff/streamDiff.ts:14-81`, `continue/core/diff/myers.ts`
**Target**: `app/desktop/src/components/DiffViewer.tsx:108-240` (FileDiffSection, HunkRenderer)
**What**: continue uses a myers-diff-based streaming diff engine that can compute and emit diff lines in real-time as new file content streams in, supporting "old/new/same" line types with indentation-aware matching. AgentHub's DiffViewer renders pre-computed diffs from `FileDiff` objects. Adopt incremental diff computation in the UI so tool results can show diffs as they stream rather than waiting for the complete output.
**Priority**: P2

---

**Finding: CodeRenderer with Shiki for syntax highlighting**

**Source**: `continue/core/codeRenderer/CodeRenderer.ts:54-80`
**Target**: `app/desktop/src/components/MarkdownRenderer.tsx:1`
**What**: continue uses Shiki (server-side syntax highlighter) to generate SVG images of syntax-highlighted code blocks, with support for diff notation, highlight notation, and multiple theme engines. AgentHub's MarkdownRenderer uses a client-side renderer (likely marked/highlight.js). For the Tauri desktop app, Shiki integration via the Rust side could provide higher-quality code rendering with theme support.
**Priority**: P2

---

**Finding: Recursive streaming for token limit handling**

**Source**: `continue/core/edit/recursiveStream.ts:24-80`
**Target**: `edge-server/internal/adapters/parser_ndjson.go` (no continuation logic)
**What**: continue's `recursiveStream()` handles the case where generated content reaches the token limit mid-stream — it captures the buffer, sends a "continue exactly where you left" prompt, and recursively merges the continuation. AgentHub has no mechanism for continuing a truncated stream. Add stream continuation logic to the NDJSON parser for long code generation.
**Priority**: P2

---

**Finding: Autocomplete pipeline architecture**

**Source**: `continue/core/autocomplete/CompletionProvider.ts:33-80`
**Target**: No equivalent in AgentHub
**What**: continue has a full autocomplete subsystem with debouncing, bracket matching, LSP-aware context retrieval, classification (single/multiline), caching (LRU), and streaming generation. While AgentHub is not an autocomplete tool, the debounce + cache pipeline pattern is applicable for the prompt input / agent response streaming in the Desktop UI.
**Priority**: P2

---

**Finding: Composable slash command system**

**Source**: `continue/core/commands/slash/built-in-legacy/index.ts:14-37`
**Target**: No equivalent in AgentHub
**What**: continue supports pluggable slash commands (cmd, commit, http, review, share, onboard, draftIssue) that are registered in a single array and resolved by name. Each command implements a `SlashCommand` interface. AgentHub has no slash command system. Adopting this pattern would allow plugins/extensions to register custom commands for the Desktop prompt input.
**Priority**: P2

---

## 4. Roo-Code — VS Code Multi-Agent Extension

### 4.1 Agent State Machine

**Finding: Formal AgentLoopState state machine**

**Source**: `apps/cli/src/agent/agent-state.ts:48-108` (AgentLoopState enum), `agent-state.ts:305-463` (detectAgentState)
**Target**: `edge-server/internal/adapters/adapter.go:72-102` (BusEvent constants — no state machine)
**What**: Roo-Code defines a formal state machine: NO_TASK → RUNNING ↔ STREAMING → WAITING_FOR_INPUT / IDLE / RESUMABLE. The `detectAgentState()` function analyzes the message array to determine the current state and required user action. AgentHub's run status is a free-form string. Implement a proper run state machine in the Edge server with well-defined transitions and UI-visible states.
**Priority**: P0

---

**Finding: Layered MessageProcessor → StateStore → EventEmitter architecture**

**Source**: `apps/cli/src/agent/message-processor.ts:75-120`, `apps/cli/src/agent/state-store.ts:106-384`, `apps/cli/src/agent/extension-client.ts:17-80`
**Target**: `app/desktop/src/hooks/useChatMessages.ts`, `app/desktop/src/stores/runStore.ts:27-69`
**What**: Roo-Code separates concerns cleanly: `MessageProcessor` routes messages by type, `StateStore` manages immutable state with observable subscriptions, `EventEmitter` fires typed events. AgentHub's architecture couples message processing and state management in the `useChatMessages` hook. Adopt a similar separation: message handler → store adapter → event bus.
**Priority**: P0

---

**Finding: Transport-agnostic ExtensionClient with sendMessage abstraction**

**Source**: `apps/cli/src/agent/extension-client.ts:48-80` (ExtensionClientConfig)
**Target**: `app/desktop/src/api/eventClient.ts:19-112` (createEventStream)
**What**: Roo-Code's `ExtensionClient` accepts a `sendMessage` function, making it transport-agnostic — the same client works over VSCode postMessage, WebSocket, or IPC. AgentHub's `createEventStream` is hardcoded to WebSocket. Abstract the transport layer to support mock/testing transports and potential Native Messaging for the Tauri app.
**Priority**: P1

---

**Finding: JSON event emitter with schema versioning**

**Source**: `apps/cli/src/agent/json-event-emitter.ts:28-100`
**Target**: `edge-server/internal/adapters/parser_ndjson.go` (NDJSON parser, no versioning)
**What**: Roo-Code's `JsonEventEmitter` supports two output modes ("stream-json", "json"), includes `schemaVersion` and `protocol` identifiers in the `system:init` event, and filters internal events via a SKIP_SAY_TYPES set. AgentHub's NDJSON parser has no version negotiation. Add `schemaVersion` to the `session_init` event so clients can detect protocol mismatches.
**Priority**: P1

---

**Finding: Ask type classification (9 ask types)**

**Source**: `apps/cli/src/agent/agent-state.ts:219-242` (getRequiredAction)
**Target**: `edge-server/internal/adapters/control_protocol.go:29-41` (ControlRequestInner — only 2 subtypes)
**What**: Roo-Code classifies user interaction points into 9 ask types: `followup`, `command`, `tool`, `use_mcp_server`, `command_output`, `api_req_failed`, `mistake_limit_reached`, `completion_result`, `resume_task`. Each maps to a specific required action. AgentHub's control protocol only handles `can_use_tool` and `initialize`. Add support for `followup`, `completion_result`, and `api_req_failed` ask types.
**Priority**: P1

---

**Finding: Observable state pattern with granular subscriptions**

**Source**: `apps/cli/src/agent/state-store.ts:330-342` (subscribe, subscribeToAgentState)
**Target**: `app/desktop/src/stores/runStore.ts:27-69` (Zustand store)
**What**: Roo-Code's `StateStore` provides both `subscribe()` (full state) and `subscribeToAgentState()` (agent state only) for performance. Zustand's `subscribeWithSelector` provides similar capability but AgentHub doesn't use selectors. Add granular selectors to the runStore and connectionStore for efficient re-renders.
**Priority**: P2

---

## Priority Summary

### P0 — Adopt Immediately (5 items)
| # | Project | Finding | Gap |
|---|---------|---------|-----|
| 1 | cline | TaskState — streaming, errors, abort, dedup tracking | RunState only has 5 fields |
| 2 | cline | File read deduplication cache | No dedup, agents loop reading same file |
| 3 | cline | Tool execution loop detection (soft/hard thresholds) | No loop detection |
| 4 | Roo-Code | Formal AgentLoopState state machine | Run status is a free-string |
| 5 | Roo-Code | MessageProcessor → StateStore → EventEmitter separation | Coupled in useChatMessages hook |

### P1 — Adopt Soon (8 items)
| # | Project | Finding | Gap |
|---|---------|---------|-----|
| 6 | aider | Edit format negotiation | Single ParseStream, no format choice |
| 7 | aider | Prompt caching with ephemeral cache_control | No caching |
| 8 | aider | Model alias normalization | No user-friendly aliases |
| 9 | cline | Configurable CommandPermissionController | Hardcoded auto-approve |
| 10 | cline | Auto-context compact / summarization | context_budget.go is a stub |
| 11 | cline | Streaming partial messages + persistent ChatView | Conditional ChatView rendering |
| 12 | Roo-Code | Transport-agnostic sendMessage abstraction | Hardcoded WebSocket |
| 13 | Roo-Code | Schema versioning in system:init events | No protocol versioning |

### P2 — Nice to Have (8 items)
| # | Project | Finding | Gap |
|---|---------|---------|-----|
| 14 | aider | Multi-strategy search/replace pipeline | Presentation-only DiffViewer |
| 15 | aider | Repo map workspace awareness | Simple --add-dir |
| 16 | aider | Slash command system | No command layer |
| 17 | cline | Protobuf typed message contracts | Manual JSON types |
| 18 | continue | Streaming myers-diff application | Pre-computed diffs only |
| 19 | continue | Shiki server-side code rendering | Client-side only |
| 20 | continue | Recursive streaming for token limits | No continuation |
| 21 | Roo-Code | Granular state subscriptions | No Zustand selectors |
