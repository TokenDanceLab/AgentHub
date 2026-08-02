# ACP Spike — Phase 1: Architecture & Skeleton

- Issue: #1404
- Started: 2026-07-30
- Status: Phase 1 (skeleton + contract mapping)

## 1. Background

codeg has validated ACP (Agent Client Protocol) as a production-grade agent interoperability layer. v0.22.1 ships claude-agent-acp 0.63.0 with live subagent transcripts, custom agent ecosystem, and full delegation platform — all built on ACP.

AgentHub's edge currently has 5 adapters: 3 CLI (claude-code, codex, opencode) + 2 SDK (anthropic-sdk, openai-sdk). Each CLI adapter has custom stdout parsing. Adding a 4th CLI (Gemini, Grok) would require another custom adapter — exactly the scaling problem ACP solves.

## 2. ACP Protocol Summary

- **Transport**: JSON-RPC 2.0 over stdio, line-delimited
- **Official schema**: `agent-client-protocol-schema` (Zed Industries)
- **Key flow**:
  1. `initialize` → agent capabilities
  2. `session/new|load|resume` → session handle
  3. `session/prompt` → start a turn
  4. `session/update` (notification) ← streaming content
  5. `session/request_permission` (request) ← blocking permission
  6. Respond to permission → agent continues
  7. `session/prompt` response → turn complete

- **Events (agent→client notifications)**:
  - `AgentMessageChunk` — text delta
  - `AgentThoughtChunk` — thinking delta
  - `ToolCall` — tool invocation
  - `ToolCallUpdate` — tool progress
  - `Plan` — proposed plan
  - `UsageUpdate` — token usage
  - `SessionInfoUpdate` — session metadata change

- **Requests (agent→client, blocking)**:
  - `session/request_permission` — permission gate
  - `fs/read`, `fs/write_text_file` — filesystem access
  - `terminal/*` — terminal commands
  - `elicitation/create` — Codex-style elicitation
  - `_x.ai/ask_user_question` — Grok-style question

## 3. Translation Mapping

ACP events → Edge `run.agent.*` events:

| ACP Event | Edge Event | Notes |
|---|---|---|
| `AgentMessageChunk` | `run.agent.text_delta` | text delta → text_delta |
| `AgentThoughtChunk` | `run.agent.thinking` | thinking → thinking |
| `ToolCall` | `run.agent.tool_call` | tool invocation |
| `ToolCallUpdate` | `run.agent.tool_progress` | tool progress update |
| `ToolResult` (in session/update) | `run.agent.tool_result` | tool completion |
| `Plan` | `run.agent.plan_proposed` | plan approval gate |
| `UsageUpdate` | `run.agent.context_usage` | token usage |
| `StopReason` (prompt response) | `run.agent.result` | turn completion |
| `session/request_permission` | `run.agent.permission_requested` | permission gate |

Key challenge: ACP permissions are **blocking requests** (agent pauses until response). Edge's current adapters handle permissions via custom control protocols. The ACP adapter must bridge this: pause stream parsing, emit permission event upstream, wait for response, write response to stdin.

## 4. Skeleton Adapter

File: `edge-server/internal/adapters/acp.go`

```go
type AcpAdapter struct {
    agentBinary string // path to ACP agent binary
    agentArgs   []string
    metadata    AdapterMetadata
}

func (a *AcpAdapter) BuildCommand(...) { /* spawn agent binary */ }
func (a *AcpAdapter) ParseStream(...) { /* JSON-RPC loop: read stdout, handle requests/notifications */ }
func (a *AcpAdapter) NeedsStdin() bool { return true } // required for permission responses
```

## 5. Phase 1 Deliverables

- [ ] Skeleton `acp.go` with stub AgentAdapter implementation
- [ ] Unit test showing JSON-RPC parse loop structure
- [ ] Register `"acp"` in `registry.go` cliAdapterIDs
- [ ] Document the permission round-trip contract

## 6. Phase 2 (next)

- Test with real ACP binary (Gemini CLI `--experimental-acp` or Grok)
- Validate streaming → edge event mapping
- Validate permission round-trip
- Validate session recovery semantics
- Produce go/no-go report

## References

- `D:\Code\Temp\codeg-research\protocol.md` — full ACP protocol analysis
- `D:\Code\Temp\codeg-research\v0.22.1-DELTA.md` — competitive urgency
- `edge-server/internal/adapters/adapter.go` — AgentAdapter interface
- `edge-server/internal/adapters/registry.go` — adapter registration
