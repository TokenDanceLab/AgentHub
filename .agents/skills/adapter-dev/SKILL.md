---
name: adapter-dev
description: SOP for developing new Agent CLI adapters in AgentHub. Agent should use when adding a new agent integration (e.g. Copilot, Gemini CLI, Qwen CLI) or debugging adapter issues around model resolution, environment, or stream parsing.
---

# Adapter Dev -- AgentHub Adapter Development SOP

## When to Use

- Adding a new AI agent CLI integration to AgentHub
- Debugging adapter issues (model resolution, env propagation, event parsing)

## Adapter Interface Checklist

Every adapter must implement `AgentAdapter` (see `edge-server/internal/adapters/adapter.go`):

1. **`Metadata()`** -- return `AdapterMetadata{ID, Name, Version, Description}`
2. **`Capabilities()`** -- return `AgentCapabilities` struct declaring feature support
3. **`BuildCommand(ctx)`** -- return binary path, args, env, workdir
4. **`ParseStream(ctx, stdout, stdin, emitter, run)`** -- read CLI stdout, emit typed events
5. **`NeedsStdin()`** -- whether CLI requires bidirectional stdin pipe

## Critical Patterns (Learned from Claude Code, OpenCode, Codex)

### 1. Model Alias Resolution

Always call `ResolveModel(agentID, model)` in `BuildCommand`. Never pass raw alias strings to the CLI. After resolving, add the alias to `ModelAliases` in `model_config.go`.

### 2. Reasoning Effort Resolution

Always call `ResolveReasoningEffort(agentID, effort)` in `BuildCommand`. Each CLI has different effort strings (Codex: `minimal`/`low`/`high`/`xhigh`; OpenCode: `--variant` flag). After resolving, add to `ReasoningEfforts` in `model_config.go`.

### 3. Environment Variables

Return **nil or empty env** from `BuildCommand`. The process executor's `envForRun` is the single source of truth for `AGENTHUB_*` vars.

### 4. Stdin Protocol

Only return `NeedsStdin() == true` if the CLI has a stdin control protocol (like Claude Code). Returning `true` for a CLI that doesn't read stdin will deadlock -- the attached pipe causes the CLI to block.

### 5. Event Constants

Always use `BusEvent*` constants from `adapter.go`. Never emit raw strings.

### 6. Error Handling in ParseStream

Log and skip unparseable lines, don't fail. Only hard-fail on ctx cancellation or fatal stream errors.

### 7. CLI Parsing Notes

| CLI | Flag | Protocol |
|-----|------|----------|
| Claude Code | `--output-format stream-json` | NDJSON + stdin control |
| OpenCode | `--format json` | NDJSON, no stdin |
| Codex | `exec --json` | NDJSON, type-based schema dispatch |

## Testing Checklist

1. **Unit test `Metadata()` and `Capabilities()`** -- verify ID, Name, Description, and capability flags
2. **Unit test `BuildCommand()`** -- verify arg construction with different model/effort combos
3. **Unit test `ParseStream()`** -- feed fixture JSON lines and assert correct event types/payloads emitted
4. **Integration test with real CLI** -- skip if `testing.Short()`, use a simple prompt (e.g. "say hello")
5. **Add model aliases to `model_config.go`** -- `ModelAliases`, `ReasoningEfforts`, `DefaultModels`

## Registration

In `cmd/agenthub-edge/main.go`:
1. Add a CLI flag for binary path (e.g. `--myagent-path`)
2. In `buildAdapterRegistry()`: construct adapter with `adapters.NewXxxAdapter(cfg.XxxPath)`, call `reg.Register(a)`, log warn on error / info on success
3. Add model aliases to `model_config.go` (`ModelAliases`, `ReasoningEfforts`, `DefaultModels`)

## Common Pitfalls

- Don't set `AGENTHUB_*` env vars in adapter `BuildCommand` -- `envForRun` handles it
- Don't forget to add the adapter to `buildAdapterRegistry()` in `main.go`
- OpenCode uses `--format json` (writes to stdout), not `--print` or `--output`
- Claude Code requires `--output-format stream-json` AND `--verbose` for tool event visibility
- Codex `exec --json` emits different event shapes -- check `type` field before unmarshaling
- If `NeedsStdin()` returns true, the process executor opens a stdin pipe; if the CLI doesn't read from it, it may deadlock

## Reference Files

- `edge-server/internal/adapters/adapter.go` -- interface + event constants
- `edge-server/internal/adapters/model_config.go` -- ModelAliases, ReasoningEfforts, DefaultModels
- `edge-server/internal/adapters/registry.go` -- Registry (Register, Get, List, SetDefault)
- `edge-server/cmd/agenthub-edge/main.go` -- buildAdapterRegistry + CLI flags
- `edge-server/internal/adapters/claude_code.go` -- reference: stdin protocol adapter
- `edge-server/internal/adapters/opencode.go` -- reference: simple NDJSON adapter
- `edge-server/internal/adapters/codex.go` -- reference: multi-schema NDJSON adapter
