---
from: researcher
to: dev-loop
status: final
priority: p0
summary: OpCode (Tauri 2 desktop GUI + Checkpoint system) adoption highlights for AgentHub Desktop -- checkpoint engine, content-addressed storage, Tauri patterns, and native integration.
---

# OpCode Adoption Guide -- What to Take for AgentHub Desktop

> Full report: `docs/reference/05-adopt/08-opcode-adoption.md`
> Source analysis: `docs/reference/01-learn/repos/05-opcode.md`
> Prerequisite: `docs/reference/02-decide/05-undo-rollback.md`

---

## 1. What Is OpCode?

OpCode is a **Tauri 2 + React 18 desktop GUI** for Claude Code CLI, built by mufeedvh and Asterisk (AGPL-3.0). It provides a project-based multi-tab interface, agent runner, MCP server manager, usage analytics dashboard, and a full **timeline/checkpoint engine** with content-addressed file snapshots, diff visualization, and fork-based branching.

The tech stack is **identical** to AgentHub Desktop: Tauri 2, React, TypeScript, Vite, Zustand, Tailwind CSS, shadcn/ui. OpCode ships 60+ frontend components and 60+ Tauri commands across 7 modules. Its checkpoint system is the most mature open-source file-level rollback engine among all surveyed competitors.

---

## 2. Top 6 Highlights for AgentHub Desktop

### Highlight 1 -- Content-Addressed Checkpoint Storage (Adopt Entirely)

OpCode's `CheckpointStorage` uses SHA-256 content hashing + zstd level 3 compression. Identical files are stored once in `content_pool/` and referenced by multiple checkpoints via `refs/`. This is the exact storage pattern needed for AgentHub's Turn-level undo/rollback (see `docs/reference/02-decide/05-undo-rollback.md`).

**Directory layout to adopt:**
```
project/.agenthub/checkpoints/{thread_id}/
  content_pool/      # {sha256_hex} -> zstd compressed bytes
  refs/{ckpt_id}/    # {safe_filename}.json -> {path, hash, is_deleted}
  timeline.json      # checkpoint chain metadata
```

**Key property**: Forking a Thread creates a new checkpoint chain that references the same `content_pool` hashes. Zero-copy branching.

### Highlight 2 -- Turn as Checkpoint Boundary (Simplify)

OpCode has 4 checkpoint strategies (Manual, PerPrompt, PerToolUse, Smart). AgentHub **only needs PerPrompt (default)** because each Turn is a natural save point. OpCode needs Smart because its JSONL streams have no Turn structure -- AgentHub's structured Turn model eliminates this complexity entirely.

The `CheckpointManager.create_checkpoint()` flow (file scan -> content hash -> snapshot -> storage write -> timeline update) maps directly to AgentHub's `turn_completed` event handler.

### Highlight 3 -- Tauri 2 Plugin Configuration (Reference Baseline)

OpCode registers 8 Tauri plugins. AgentHub currently uses 2 (shell, notification). The diff reveals what we are missing:

| Plugin | OpCode | AgentHub | Gap |
|--------|--------|----------|-----|
| `tauri-plugin-dialog` | Yes | No | **P1**: native file/folder picker |
| `tauri-plugin-fs` | Yes | No | **P0**: workspace file tree access |
| `tauri-plugin-process` | Yes | No | **P1**: native subprocess management |
| `tauri-plugin-shell` | Yes | Yes | Already present |
| `tauri-plugin-notification` | Yes | Yes | Already present |
| `tauri-plugin-clipboard-manager` | Yes | No | **P2**: copy-to-clipboard from Tauri |
| `tauri-plugin-global-shortcut` | Yes | No | **P1**: global hotkeys (Ctrl+K etc.) |
| `tauri-plugin-updater` | Yes | No | **P2**: auto-update |

OpCode's `apiAdapter.ts` pattern (detect `window.__TAURI__` -> `invoke()` or WebSocket fallback) is directly reusable for AgentHub's potential web mode.

### Highlight 4 -- Process Registry with Graceful Shutdown (Adopt Pattern)

OpCode's `ProcessRegistry` manages running subprocesses with `register_process()`, `kill_process()` (SIGTERM -> 5s timeout -> SIGKILL + taskkill fallback), and live output streaming via `append_live_output() / get_live_output()`. AgentHub's `EdgeManager` currently wraps a single Edge process; this pattern scales to multiple Runner processes and agent subprocesses.

### Highlight 5 -- Zustand Store Architecture (Validated Match)

OpCode uses Zustand v5 + `subscribeWithSelector` middleware with two stores (`sessionStore`, `agentStore`). AgentHub already follows the exact same pattern with `threadStore`, `runStore`, `uiStore`, `connectionStore`, and `searchStore`. The `apiAdapter -> invoke/WS -> store action -> React re-render` data flow is validated by a production application.

### Highlight 6 -- System Tray with Edge Lifecycle Control (Already Implemented)

OpCode's tray has Show/Hide/Quit. AgentHub's tray (`src-tauri/src/tray.rs`) goes further with Start Edge/Stop Edge controls integrated with the `EdgeManager` managed state. We are ahead here -- OpCode has no edge server concept.

---

## 3. Priority Table

| Priority | Feature | Source Module | AgentHub Destination | Effort |
|----------|---------|---------------|---------------------|--------|
| **P0** | Content-addressed checkpoint storage | `checkpoint/storage.rs` | `src-tauri/src/checkpoint/storage.rs` | Medium -- ~400 lines ported |
| **P0** | `CheckpointManager` with create/restore | `checkpoint/manager.rs` | `src-tauri/src/checkpoint/manager.rs` | High -- ~750 lines, adapt to Turn model |
| **P0** | Turn-level auto-checkpoint on `turn_completed` | `checkpoint/manager.rs:683-746` | `commands/turn.rs` event handler | Low -- simplifies Smart logic |
| **P0** | File snapshot with SHA-256 + zstd | `checkpoint/mod.rs` + `storage.rs` | `src-tauri/src/checkpoint/` | Medium |
| **P1** | `tauri-plugin-dialog` for native file picker | `main.rs:58` | `src-tauri/Cargo.toml` + `main.rs` | Low -- one plugin, one config |
| **P1** | `tauri-plugin-fs` for workspace file tree | `main.rs` | `src-tauri/Cargo.toml` + `main.rs` | Low |
| **P1** | `tauri-plugin-global-shortcut` | `main.rs` | `src-tauri/Cargo.toml` + `main.rs` | Low |
| **P1** | ProcessRegistry for multi-process management | `process/registry.rs` | `src-tauri/src/process/` | Medium |
| **P1** | TimelineNavigator UI (checkpoint tree) | `TimelineNavigator.tsx` | `components/CheckpointTimeline.tsx` | Medium -- ~420 lines React component |
| **P1** | CheckpointSettings UI (strategy + storage) | `CheckpointSettings.tsx` | `components/CheckpointSettings.tsx` | Medium |
| **P2** | Garbage collection for orphaned content | `storage.rs:409-459` | `src-tauri/src/checkpoint/storage.rs` | Low |
| **P2** | Checkpoint cleanup (keep last N) | `storage.rs:337-377` | `src-tauri/src/checkpoint/storage.rs` | Low |
| **P2** | CheckpointDiff (file-level diff display) | `mod.rs:144-171` | `src-tauri/src/checkpoint/diff.rs` | Medium |
| **P2** | `tauri-plugin-clipboard-manager` | `main.rs` | `src-tauri/Cargo.toml` | Low |
| **P2** | `tauri-plugin-updater` | `main.rs` | `src-tauri/Cargo.toml` | Low |

---

## 4. Reference

- **OpCode source**: `D:\Code\AgentHub\reference\opcode` (v0.2.1, AGPL-3.0)
- **OpCode analysis**: `docs/reference/01-learn/repos/05-opcode.md`
- **AgentHub Desktop spec**: `docs/reference/03-build/frontend/01-desktop-ux.md`
- **Undo/Rollback design**: `docs/reference/02-decide/05-undo-rollback.md`
- **Full adoption report**: `docs/reference/05-adopt/08-opcode-adoption.md`
