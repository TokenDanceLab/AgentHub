# 02: Codex CLI -> AgentHub Source Adoption Map

## Scope

This document maps Codex CLI source code structures to AgentHub's M3b Orchestrator design,
identifying concrete adoption priorities (P0/P1/P2) for each mapped feature.

Every finding includes: Codex file:line -> AgentHub file:line -> choice -> priority.

---

## 1. Agent Tree & Dispatch (Subagent A)

### 1.1 Tree-Based Agent Addressing

| Codex | AgentHub | Decision | Priority |
|---|---|---|---|
| `protocol/src/agent_path.rs:15-72` — `AgentPath` with `/root/child/grandchild` hierarchy, validation, `join()`, `resolve()` | `orchestrator.go:25-31` — flat `[]string` subAgent list passed to prompt; no structural addressing | **Adopt**: Add `AgentPath` to AgentHub's store model to represent sub-agent hierarchy. The Capabilities.SubAgentSpawn flag is already set (`orchestrator.go:43`) but the tree is not modeled. | **P1** |
| `protocol/src/agent_path.rs:18-19` — `ROOT = "/root"`, `MORPHEUS = "/morpheus"` special paths | (no equivalent) | **Adapt**: Use `/root` for the orchestrator; skip `/morpheus` (Codex-internal convention). | P2 |
| `protocol/src/agent_path.rs:54-57` — `join()` builds child path, `resolve()` handles relative/absolute | (no equivalent) | **Adopt**: Implement path composition in `store.go` for parent-child thread relationships. | P1 |
| `protocol/src/agent_path.rs:15` — `#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]` — rich Rust derive | (no equivalent) | **Adapt**: Model as a simple Go string with validation helpers; AgentHub's `store.Run` already has `ThreadID` as a flat string. | P2 |

### 1.2 AgentControl — Spawn & Lifecycle

| Codex | AgentHub | Decision | Priority |
|---|---|---|---|
| `core/src/agent/control.rs:153-163` — `AgentControl` struct holds `session_id`, `Weak<ThreadManagerState>`, `Arc<AgentRegistry>` | `orchestrator.go:17-20` — `OrchestratorAdapter` wraps a `ClaudeCodeAdapter` with a system prompt | **Adopt**: Extend `OrchestratorAdapter` with an agent registry and spawn slots, not just prompt injection. | **P0** |
| `core/src/agent/control.rs:213-358` — `spawn_agent_internal()` with slot reservation, shell snapshot inheritance, exec policy inheritance, fork support, analytics | (none) | **Adopt**: NodeJS spawn callbacks in `Edge Server` must implement slot reservation (max threads), inherited env, and analytics hooks. The `RunProcessContext` (`adapter.go:15`) already carries WorkDir and PermissionMode but not agent tree metadata. | **P0** |
| `core/src/agent/control.rs:798-809` — `shutdown_agent_tree()` — recursive termination of descendant agents | (none) | **Adopt**: When orchestrator shuts down, cascade-kill all spawned sub-agent processes. | P1 |
| `core/src/agent/control.rs:719-740` — `send_inter_agent_communication()` with `InterAgentCommunication { author, recipient, content, trigger_turn }` | (none) | **Adopt**: The `BusEventTaskNotificaton` and `BusEventTaskDispatched` events in `adapter.go:86-87` exist but are never wired to an actual inter-agent message system. | **P0** |
| `core/src/agent/control.rs:130-131` — `is_multi_agent_v2_usage_hint_message()` — detection of usage hint texts for filtering | (none) | **Skip** for now: AgentHub uses prompt-based orchestration, not injected developer messages with usage hints. | P2 |

### 1.3 AgentRegistry — Concurrency & Limits

| Codex | AgentHub | Decision | Priority |
|---|---|---|---|
| `core/src/agent/registry.rs:22-26` — `AgentRegistry` with `Mutex<HashMap<String, AgentMetadata>>` tree + `AtomicUsize` total count | `registry.go:8-13` — Adapter registry with `map[string]AgentAdapter` + `map[string]string` defaults | **Adapt**: AgentHub's adapter `Registry` is about adapter types; need a separate run-time agent instance registry. For Phase 1, a simple in-memory `map[string]*AgentInstance` guarded by `sync.RWMutex` suffices. | **P0** |
| `core/src/agent/registry.rs:80-97` — `reserve_spawn_slot()` with `agent_max_threads` limit via atomic CAS | (none) | **Adopt**: The orchestrator must enforce `agent_max_threads` before spawning. The Codex atomic CAS pattern maps cleanly to Go `atomic.Int32`. | P1 |
| `core/src/agent/registry.rs:202-240` — nickname pool with resets and ordinal suffixes ("the 2nd", "the 3rd") | (none) | **Adapt**: Use human-readable task names from the orchestration prompt instead of auto-generated nicknames. | P2 |
| `core/src/agent/registry.rs:301-329` — `SpawnReservation` RAII pattern — commit or rollback on Drop | (none) | **Adopt**: Go `defer` pattern: allocate slot, defer release on error, commit on success. | P1 |

### 1.4 Spawn Agent Tool Handler

| Codex | AgentHub | Decision | Priority |
|---|---|---|---|
| `core/src/tools/handlers/multi_agents_v2/spawn.rs:45-234` — `handle_spawn_agent()` with `SpawnAgentArgs { message, task_name, agent_type, model, reasoning_effort, fork_turns }` | (none — OrchestratorAdapter is prompt-only; no tool handler for sub-agent spawning) | **Adopt**: Create a `spawn_agent` tool handler in the `adapters` package that the orchestrator can invoke. | **P0** |
| `core/src/tools/handlers/multi_agents_v2/spawn.rs:88-98` — `fork_mode()` parsing: `"none"`, `"all"`, `N` (last N turns) | (none) | **Adopt**: Implement fork modes for context inheritance. `FullHistory` = share entire parent context. `LastNTurns(N)` = share only recent context. | P1 |
| `core/src/tools/handlers/multi_agents_v2/spawn.rs:67-81` — `CollabAgentSpawnBeginEvent` / `CollabAgentSpawnEndEvent` for lifecycle tracking | `adapter.go:85-86` — `BusEventTaskStarted`, `BusEventTaskDispatched` exist but not wired | **Adopt**: Wire `BusEventTaskStarted` at spawn begin and `BusEventTaskNotification` at spawn end. | P1 |
| `core/src/tools/handlers/multi_agents_v2/spawn.rs:292-321` — `SpawnAgentResult` with `WithNickname` / `HiddenMetadata` variants | (none) | **Adapt**: Return task name + thread ID as the spawn result; nicknames are P2. | P1 |

---

## 2. Context Budget & Compaction (Subagent B)

### 2.1 ContextManager — History & Token Tracking

| Codex | AgentHub | Decision | Priority |
|---|---|---|---|
| `core/src/context_manager/history.rs:34-51` — `ContextManager` struct with `items: Vec<ResponseItem>`, `token_info: Option<TokenUsageInfo>`, `reference_context_item: Option<TurnContextItem>`, `history_version: u64` | `context_budget.go:1-6` — single constant `CtxBudgetKey ctxKey = "agenthub-budget"` | **Adopt**: Build a real `ContextManager` in Go that tracks item history, token estimates, and reference context. The stub in `context_budget.go` is a placeholder. | **P0** |
| `core/src/context_manager/history.rs:99-113` — `record_items()` with truncation policy, item processing | (none) | **Adopt**: Record items from NDJSON stream parser (`parser_ndjson.go`) into the context manager. The parser already knows about individual events but doesn't maintain a total budget. | **P0** |
| `core/src/context_manager/history.rs:119-122` — `for_prompt()` — normalized history for model consumption | (none) | **Adopt**: Before sending the next turn, query the context manager for a normalized, token-budget-aware history. | P1 |
| `core/src/context_manager/history.rs:183-184` — `replace()` — atomic history swap with version bump | (none) | **Adopt**: Used in compaction; the orchestrator replaces history after summarization. | P1 |

### 2.2 Token Estimation & Budget Enforcement

| Codex | AgentHub | Decision | Priority |
|---|---|---|---|
| `core/src/context_manager/history.rs:135-158` — `estimate_token_count()` and `estimate_token_count_with_base_instructions()` | (none) | **Adopt**: Implement byte-based token estimation using the `approx_token_count` heuristic (4 bytes ~ 1 token). The `BusEventContextUsage` event (`adapter.go:101`) exists but never fires. | **P0** |
| `core/src/context_manager/history.rs:511-568` — `estimate_item_token_count()` and `estimate_response_item_model_visible_bytes()` with image, reasoning, encrypted output estimation | (none) | **Adapt**: Implement simplified version: serialize item to JSON, count bytes, divide by 4. Image/encrypted estimation is P2. | P1 |
| `core/src/context_manager/history.rs:309-327` — `get_total_token_usage()` with server reasoning included/excluded tracking | (none) | **Adopt**: Track total token usage across turns, emitting `BusEventContextUsage` at turn boundaries. | P1 |
| `core/src/context_manager/history.rs:160-170` — `remove_first_item()` — oldest-first eviction with paired call/output cleanup | (none) | **Adopt**: Used when context window exceeded during compaction retry. | P1 |

### 2.3 Compaction Engine

| Codex | AgentHub | Decision | Priority |
|---|---|---|---|
| `core/src/compact.rs:69-93` — `run_inline_auto_compact_task()` — auto-triggered compaction with summarization prompt | (none; `BusEventCompactBoundary` exists at `adapter.go:82` but never emitted) | **Adopt**: Implement a compaction task that: (1) triggers when token budget exceeds threshold, (2) summarizes conversation history, (3) replaces history with summary + recent context. | **P0** |
| `core/src/compact.rs:46-47` — `SUMMARIZATION_PROMPT` and `SUMMARY_PREFIX` templates | (none) | **Adopt**: Embed summarization prompt templates. Codex uses `compact/prompt.md` and `compact/summary_prefix.md`; AgentHub should define its own that respects the orchestrator's role. | P1 |
| `core/src/compact.rs:60-63` — `InitialContextInjection` enum — `BeforeLastUserMessage` vs `DoNotInject` | (none) | **Adopt**: Mid-turn compaction must reinject initial context before the last user message; standalone compaction clears it. | P1 |
| `core/src/compact.rs:296-359` — `CompactionAnalyticsAttempt` — tracks before/after token counts, duration, trigger, status | (none; `BusEventContextUsage` exists at `adapter.go:101`) | **Adopt**: Fire `BusEventContextUsage` with before/after token counts at compaction boundaries. | P1 |
| `core/src/compact.rs:131-168` — `run_compact_task_inner()` with pre/post-compaction hooks, retry loop on `ContextWindowExceeded` | (none) | **Adopt**: Integration with AgentHub's existing hook system (`hooks.go`). The retry loop with oldest-item eviction is critical for robustness. | P1 |
| `core/src/compact.rs:388-402` — `collect_user_messages()` — extracts non-summary user messages for the compacted history | (none) | **Adopt**: Used to preserve user intent in compacted history. | P2 |
| `core/src/compact.rs:465-530` — `build_compacted_history()` and `build_compacted_history_with_limit()` — constructs replacement history with token budget for retained messages | (none) | **Adopt**: Core algorithm: select recent user messages within token budget, append summary, return replacement history. | P1 |

### 2.4 ContextCompactionItem — TurnItem Protocol

| Codex | AgentHub | Decision | Priority |
|---|---|---|---|
| `protocol/src/items.rs:41-54` — `TurnItem` enum with 11 variants including `ContextCompaction(ContextCompactionItem)` | `store.go:40-51` — flat `Item` struct with `Type string`, `Role string`, `Content string` | **Adapt**: Add `"context_compaction"` as a recognized Item.Type in the store. The Codex typed-enum model maps to AgentHub's string-typed Item model. | P1 |
| `protocol/src/items.rs:210-231` — `ContextCompactionItem { id }` with UUID generation and `as_legacy_event()` | (none) | **Adopt**: Generate compaction items with UUIDs. The `Item` struct already has `ID`, `Type`, `Content` fields — compaction fits. | P1 |
| `protocol/src/protocol.rs:2689-2706` — `CompactedItem { message, replacement_history }` | (none) | **Adopt**: Model `CompactedItem` content as JSON in `Item.Content`. Store the replacement history for resume/fork replay. | P1 |
| `protocol/src/protocol.rs:2719-2733` — `TurnContextItem` with `turn_id`, `cwd`, `current_date`, `timezone`, `approval_policy`, `sandbox_policy`, `network` | (none) | **Adapt**: `RunProcessContext` already carries `WorkDir` and `PermissionMode`. Extend with `CurrentDate` and `Timezone` for compacted context preservation. | P2 |

---

## 3. Input Queue & Inter-Agent Messaging

### 3.1 Mailbox — InterAgentCommunication Queue

| Codex | AgentHub | Decision | Priority |
|---|---|---|---|
| `core/src/session/input_queue.rs:25-39` — `InputQueue` with `mailbox_tx: watch::Sender`, `mailbox_pending_mails: Mutex<VecDeque<InterAgentCommunication>>`, `idle_pending_input` | (none) | **Adopt**: Create an inter-agent message queue. The `BusEventTaskNotification` event (`adapter.go:88`) carries `senderThreadId` and `receiverThreadIds` but no actual message queue delivers them. | **P0** |
| `core/src/session/input_queue.rs:50-58` — `enqueue_mailbox_communication()` with `watch::Sender` notification | (none) | **Adopt**: Go channels are a natural fit: `chan InterAgentMessage` with a select-based multiplexer per agent. | **P0** |
| `core/src/session/input_queue.rs:65-72` — `has_trigger_turn_mailbox_items()` — some messages auto-trigger a new turn | (none) | **Adopt**: Support `trigger_turn: true` flag. When a sub-agent completes and sends its result, auto-trigger the parent orchestrator's next turn. | P1 |
| `core/src/session/input_queue.rs:73-80` — `drain_mailbox_input_items()` — batch-drain all pending inter-agent messages | (none) | **Adopt**: Drain messages before each turn, inject as context into the agent's prompt. | P1 |
| `core/src/session/input_queue.rs:82-88` — `queue_response_items_for_next_turn()` — buffered items for idle periods | (none) | **Adopt**: When orchestrator is idle and sub-agent results arrive, queue them for the next turn. | P2 |

### 3.2 InterAgentCommunication Protocol

| Codex | AgentHub | Decision | Priority |
|---|---|---|---|
| `protocol/src/protocol.rs:663-711` — `InterAgentCommunication { author, recipient, other_recipients, content, trigger_turn }` with `to_response_input_item()` serialization | (none) | **Adopt**: Define a Go struct mirroring this protocol. Messages are serialized as assistant commentary JSON, injected into agent history. | **P0** |
| `protocol/src/protocol.rs:714-730` — `Op` enum with `InterAgentCommunication { communication }` variant | `adapter.go:86-88` — `BusEventTaskDispatched`, `BusEventTaskNotification` | **Adapt**: Map `Op::InterAgentCommunication` to `BusEventTaskNotification` events. | P1 |

---

## 4. Session Source & Agent Identity

| Codex | AgentHub | Decision | Priority |
|---|---|---|---|
| `protocol/src/protocol.rs:2415-2426` — `SessionSource` enum with `Cli`, `VSCode`, `Exec`, `Mcp`, `Custom`, `Internal`, `SubAgent`, `Unknown` | (none) | **Adopt**: Add `sessionSource` to `RunProcessContext` to distinguish orchestrator turns from sub-agent turns. | P2 |
| `protocol/src/protocol.rs:2476-2489` — `SubAgentSource` enum with `Review`, `Compact`, `ThreadSpawn { parent_thread_id, depth, agent_path, agent_nickname, agent_role }`, `MemoryConsolidation` | (none) | **Adopt**: Model `ThreadSpawn` in AgentHub's run creation to track parent-child relationships. | P1 |
| `protocol/src/protocol.rs:2431-2435` — `ThreadSource` enum with `User`, `Subagent`, `MemoryConsolidation` | (none) | **Adapt**: `store.Thread` already has no source field; add `source` for analytics. | P2 |

---

## 5. Stream Event Mapping

### 5.1 Codex Item Stream -> AgentHub Bus Events

| Codex event (codex.go:198-245) | AgentHub bus event | Status |
|---|---|---|
| `thread.started` | `BusEventSessionInit` | Mapped |
| `turn.started` | `BusEventSessionStateChanged` | Mapped |
| `turn.completed` | `BusEventResult` (with usage) | Mapped |
| `turn.failed` | `BusEventResult` (success=false) | Mapped |
| `item.started → command_execution` | `BusEventToolCall` (status=started) | Mapped |
| `item.completed → agent_message` | `BusEventTextBlock` | Mapped |
| `item.completed → reasoning` | `BusEventThinking` | Mapped |
| `item.completed → command_execution` | `BusEventToolResult` | Mapped |
| `item.completed → mcp_tool_call` | `BusEventToolResult` | Mapped |
| `item.completed → file_change` | `BusEventFileChange` | Mapped |
| `item.completed → collab_tool_call` | `BusEventTaskNotification` | Mapped |
| `item.started → collab_tool_call` | `BusEventTaskStarted` | Mapped |
| `item.updated → command_execution` | `BusEventToolCall` (status=in_progress) | Mapped |
| `context_compaction` (TurnItem) | `BusEventCompactBoundary` | **NOT YET MAPPED** — add at `codex.go` dispatch |

### 5.2 Missing Codex Event Mappings

| Codex item type | Should emit | Priority |
|---|---|---|
| `context_compaction` (items.rs:210-231) | `BusEventCompactBoundary` | **P0** — compaction events are critical for the client to know context has been replaced |
| `context_compaction` completion | `BusEventContextUsage` with before/after token counts | **P0** — clients need to track token budget |

---

## 6. Priority Summary

### P0 (Critical — orchestrator cannot function without these)

| # | Feature | Codex Source | AgentHub Target |
|---|---|---|---|
| 1 | Agent instance registry with spawn slots | `registry.rs:80-97` | New file: `internal/adapters/agent_registry.go` |
| 2 | `spawn_agent` tool handler | `spawn.rs:45-234` | New handler in `orchestrator.go` or new file |
| 3 | Inter-agent message queue (mailbox) | `input_queue.rs:25-80` | New file: `internal/adapters/mailbox.go` |
| 4 | `InterAgentCommunication` protocol struct | `protocol.rs:663-711` | New Go struct in `adapters` package |
| 5 | ContextManager with token tracking | `history.rs:34-158` | Replace `context_budget.go` stub |
| 6 | Auto-compaction trigger + engine | `compact.rs:69-93` | New file: `internal/adapters/compaction.go` |
| 7 | Emit `BusEventCompactBoundary` on context_compaction items | `items.rs:210-231` | In `codex.go` dispatchItemCompleted |
| 8 | Emit `BusEventContextUsage` on compaction boundaries | `compact.rs:296-359` | In new compaction engine |

### P1 (Important — needed for robust multi-agent operation)

| # | Feature | Codex Source | AgentHub Target |
|---|---|---|---|
| 1 | `AgentPath` tree addressing in store | `agent_path.rs:15-72` | Extend `store.Thread` with `parentThreadID`, `agentPath` |
| 2 | Fork modes for context inheritance | `spawn.rs:88-98` | In spawn_agent handler |
| 3 | `SubAgentSource::ThreadSpawn` protocol | `protocol.rs:2476-2489` | In `RunProcessContext` |
| 4 | Lifecycle events (CollabAgentSpawnBegin/End) | `spawn.rs:67-81` | Wire `BusEventTaskStarted` / `BusEventTaskNotification` |
| 5 | `CompactedItem` with replacement_history storage | `protocol.rs:2689-2706` | In `store.Item` content |
| 6 | `InitialContextInjection` for mid-turn compaction | `compact.rs:60-63` | In compaction engine |
| 7 | Token estimation (bytes/4 heuristic) | `history.rs:135-158` | In ContextManager |
| 8 | Oldest-item eviction on context overflow | `history.rs:160-170` | In ContextManager |
| 9 | Summarization prompt templates | `compact.rs:46-47` | Embedded Go constants |
| 10 | `trigger_turn` auto-resume for sub-agent completion | `input_queue.rs:65-72` | In mailbox |
| 11 | ContextCompaction as Item.Type in store | `items.rs:210-231` | In `store.go` item type constants |
| 12 | Slot reservation with RAII/defer pattern | `registry.rs:301-329` | In agent registry |
| 13 | `agent_max_threads` enforcement | `registry.rs:80-97` | In agent registry |
| 14 | `shutdown_agent_tree()` cascade | `control.rs:798-809` | In orchestrator cleanup |

### P2 (Nice-to-have — improves UX and debugging)

| # | Feature | Codex Source | AgentHub Target |
|---|---|---|---|
| 1 | Nickname pool with ordinal resets | `registry.rs:202-240` | Task names from orchestration prompt |
| 2 | AgentPath validation helpers | `agent_path.rs:125-181` | Go string validation |
| 3 | Multi-agent usage hint filtering in forks | `control.rs:130-145` | Skip — AgentHub uses prompt-based orchestration |
| 4 | SessionSource mapping | `protocol.rs:2415-2426` | In RunProcessContext |
| 5 | ThreadSource for analytics | `protocol.rs:2431-2435` | In store.Thread |
| 6 | TurnContextItem for compaction preservation | `protocol.rs:2719-2733` | In RunProcessContext |
| 7 | Image/encrypted output token estimation | `history.rs:511-568` | In ContextManager (complex, low ROI) |

---

## 7. Architecture Diff Summary

### What AgentHub Already Has

- `OrchestratorAdapter` wrapping Claude Code with a system prompt that tells it to decompose tasks
- `AgentCapabilities.SubAgentSpawn = true` declared but unimplemented
- Bus event types for task lifecycle (`TaskStarted`, `TaskDispatched`, `TaskNotification`, `CompactBoundary`, `ContextUsage`) — all declared, none wired
- `Registry` for adapter types (Claude Code, Codex, OpenCode) with role-based defaults
- `NDJSONStreamParser` for Claude Code streaming events
- `CodexAdapter` with batch mode `codex exec` support and item type dispatch
- Stub `context_budget.go` with just a context key constant

### What AgentHub Is Missing (Codex already has)

- **Agent tree model**: Codex has `AgentPath` with full hierarchy; AgentHub has flat agent IDs
- **Sub-agent spawning**: Codex has `spawn_agent` tool handler with fork modes, env inheritance, role config; AgentHub has none
- **Inter-agent messaging**: Codex has `InputQueue` with mailbox, watch channels, trigger_turn; AgentHub has none
- **Context management**: Codex has `ContextManager` with token estimation, history tracking, compaction, rollback; AgentHub has a stub
- **Compaction engine**: Codex has full summarization-based compaction with hooks, retry, analytics; AgentHub has none
- **Agent lifecycle events**: Codex has CollabAgentSpawnBegin/End, status subscription; AgentHub has bus events declared but not emitted

### Recommended Build Order

1. **Phase A (P0, ~estimated 3-5 days)**: Agent registry + spawn handler + mailbox + ContextManager
2. **Phase B (P0, ~estimated 2-3 days)**: Compaction engine + bus event wiring
3. **Phase C (P1, ~estimated 3-4 days)**: AgentPath tree model + fork modes + lifecycle events + token estimation
4. **Phase D (P2, ~estimated 2-3 days)**: Nicknames, validation, analytics tags
