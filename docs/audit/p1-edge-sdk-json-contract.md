# P1 Edge SDK/CLI JSON Contract

> Date: 2026-06-09
> Branch: `codex/p1-edge-sdk-json-contract`
> Base: `origin/codex/p1-critical-evidence-integration` at `020d6876d5b8401873ff05a0c251b983463fa146`
> Scope: Edge adapter JSON contract, fixture mapper tests, and provider-neutral replay notes only.

## Contract

Edge adapters normalize CLI, SDK, OpenCode sidecar, and custom Agent signals
into AgentHub-owned `run.agent.*` events before Hub/Web replay. Provider SDK
objects, raw traces, raw prompts, API keys, authorization headers, local secret
paths, and native provider event bodies stay below `edge-server/internal/adapters`.

The replay shape remains compatible with the current Hub runtime event contract:

```json
{
  "type": "agent.stream",
  "payload": {
    "edge_run_id": "run_fixture",
    "event_seq": 1,
    "event_type": "run.agent.tool_call",
    "payload": {
      "callId": "call_1",
      "toolName": "read_file"
    }
  }
}
```

## Fixture Signals

| Signal | AgentHub event | Notes |
|---|---|---|
| `invocation_plan` | `run.agent.cli_invocation_plan` | Redacted command shape only: command basename, arg flags, config keys, env names, workspace basename, `promptRedacted`, fixture/no-spend/approval flags. |
| `status` / `session.updated` | `run.agent.status_change` | Runtime session state and short status summaries. |
| `progress` / `task_progress` | `run.agent.task_progress` | Provider-neutral progress for sidecar or SDK task phases. |
| `tool_call` / `tool_state` | `run.agent.tool_call` | Tool name, call ID, status, redacted input, provider/session/trace refs. |
| `tool_result` / completed `tool_state` | `run.agent.tool_result` | Result content, `isError`, redacted attachments and metadata. |
| `usage` / `context_usage` | `run.agent.context_usage` | Token totals, optional model and cost. |
| `terminal_result` / `run_result` | `run.agent.result` | Adapter-level terminal summary with `terminalReason`. |
| `error` | `run.agent.result` | `success: false`, `terminalReason: error`, redacted error text. |
| `cancelled` / `cancellation` | `run.agent.result` | Adapter-level cancellation signal only. Lifecycle-owned `run.cancelled` remains `ProcessExecutor` responsibility. |

## Provider Mapping

OpenAI Agents SDK:

- Agent/run start or runner options map to `invocation_plan` fixture evidence.
- Function calls map to `run.agent.tool_call`; function outputs map to `run.agent.tool_result`.
- Guardrails or human review requests map to `run.agent.permission_requested`.
- Handoffs map to `run.agent.route_decision`; Hub TeamRun remains canonical.
- Usage and final result map to `run.agent.context_usage` and `run.agent.result`.
- Traces stay as metadata refs only; raw trace payloads are not replayed.

Claude Agent SDK:

- Session init/update maps to `run.agent.session_init` and `run.agent.status_change`.
- Tool use and permission hooks map to `run.agent.tool_call`, `run.agent.tool_result`, and `run.agent.permission_requested`.
- Subagent/handoff suggestions map to route or task events as evidence, not authoritative TeamRun state.
- Cost/usage maps to `run.agent.context_usage` or result usage.

OpenCode:

- Sidecar/session readiness maps to `run.agent.session_init`.
- Tool state transitions map to tool call/result events.
- Permission prompts map to `run.agent.permission_requested`.
- Sidecar progress maps to `run.agent.task_progress`.
- Terminal status maps to adapter-level `run.agent.result`.

Custom Agent:

- Custom Agent profiles should emit the same provider-neutral fixture signals.
- `runtimeMode`, provider, and SDK-specific options are profile/runtime metadata,
  not Hub/Web product state until a real approved execution slice lands.
- Invocation plans are safe to show as evidence because they do not include raw
  prompts, env values, model calls, or executable approval claims.

## Verification Added

- `TestSDKFixtureMapperProviderNeutralReplayContract` covers invocation plan,
  status, progress, tool call/result, usage, terminal result, error, and
  cancellation signals.
- The same test wraps mapped events into the Hub `agent.stream` replay shape and
  asserts secrets and absolute local paths are not present.
- Existing Claude/OpenAI/OpenCode fixture golden tests now include
  `terminalReason: completed` on `run.agent.result`.

## Non-Goals

- No real CLI, SDK, model, hosted MCP, browser, shell, or provider API calls.
- No provider SDK package installation.
- No Hub/Web/Desktop changes.
- No store or SQLite migration.
- No `docs/roadmap.md` changes.

## Next Slice

Add a no-spend executable fixture runner for one adapter ID, preferably
`custom-agent-fixture`, that reads fixture JSON from disk, maps it through
`MapSDKFixtureStream`, publishes through the existing Edge event bus, and then
verifies replay through `/v1/events` without launching any real provider CLI or
SDK.
