# Claude Agent SDK and OpenAI Agents SDK Integration Report

> Date: 2026-06-09
> Worker: Research Worker D
> Base: `origin/codex/p1-remote-control-integration`
> Scope: product and architecture value for AgentHub. No SDK package was installed, no CLI/model/API call was executed, and no API/model budget was consumed.

## Executive Recommendation

AgentHub should adopt Claude Agent SDK and OpenAI Agents SDK as **runtime adapter sources and evidence inputs**, not as AgentHub's product model.

The immediate value is not "replace Edge with SDKs". The value is to use both SDKs to harden AgentHub's own model:

- AgentHub-owned `Agent Profile` remains the user-facing agent identity.
- Edge-owned `Agent Runtime adapter` remains the execution boundary.
- Hub-owned TeamRun, permissions, approvals, routing, audit, and IM transcript remain canonical.
- SDK-native tools, handoffs, permissions, sessions, tracing, and sandbox concepts become provider-specific adapter mappings.

This matches current AgentHub architecture: Claude Code, Codex, and OpenCode are runtimes, while users manage Agent Profiles and Execution Targets. It also extends the existing `docs/reference/sdk-agent-strategy.md` decision that external SDK objects must not leak into Hub/Web/Desktop/Tauri product state.

## Official Sources Researched

Claude official sources:

- [Claude Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview)
- [Claude Agent SDK Python reference](https://code.claude.com/docs/en/agent-sdk/python)
- [Claude Agent SDK permissions](https://code.claude.com/docs/en/agent-sdk/permissions)
- [Claude Agent SDK approvals and user input](https://code.claude.com/docs/en/agent-sdk/user-input)
- [Claude Agent SDK hooks](https://code.claude.com/docs/en/agent-sdk/hooks)
- [Claude Agent SDK MCP](https://code.claude.com/docs/en/agent-sdk/mcp)
- [Claude Agent SDK tool search](https://code.claude.com/docs/en/agent-sdk/tool-search)
- [Claude Agent SDK subagents](https://code.claude.com/docs/en/agent-sdk/subagents)
- [Claude Agent SDK OpenTelemetry observability](https://code.claude.com/docs/en/agent-sdk/observability)
- [Claude Agent SDK cost tracking](https://code.claude.com/docs/en/agent-sdk/cost-tracking)

OpenAI official sources:

- [OpenAI Agents SDK Python overview](https://openai.github.io/openai-agents-python/)
- [OpenAI Agents SDK Python agents](https://openai.github.io/openai-agents-python/agents/)
- [OpenAI Agents SDK Python tools](https://openai.github.io/openai-agents-python/tools/)
- [OpenAI Agents SDK Python handoffs](https://openai.github.io/openai-agents-python/handoffs/)
- [OpenAI Agents SDK Python guardrails](https://openai.github.io/openai-agents-python/guardrails/)
- [OpenAI Agents SDK Python MCP](https://openai.github.io/openai-agents-python/mcp/)
- [OpenAI Agents SDK Python tracing](https://openai.github.io/openai-agents-python/tracing/)
- [OpenAI Agents SDK TypeScript overview](https://openai.github.io/openai-agents-js/)
- [OpenAI Agents SDK TypeScript agents](https://openai.github.io/openai-agents-js/guides/agents/)
- [OpenAI Agents SDK TypeScript tools](https://openai.github.io/openai-agents-js/guides/tools/)
- [OpenAI Agents SDK TypeScript orchestration](https://openai.github.io/openai-agents-js/guides/multi-agent/)
- [OpenAI Agents SDK TypeScript MCP](https://openai.github.io/openai-agents-js/guides/mcp/)
- [OpenAI Agents SDK TypeScript tracing](https://openai.github.io/openai-agents-js/guides/tracing/)
- [OpenAI Responses API reference](https://developers.openai.com/api/docs/api-reference/responses/create)
- [OpenAI tools guide](https://platform.openai.com/docs/guides/tools?api-mode=responses)
- [OpenAI remote MCP/connectors guide](https://platform.openai.com/docs/guides/tools-remote-mcp)
- [OpenAI migrate to Responses guide](https://platform.openai.com/docs/guides/migrate-to-responses)
- [OpenAI API computer use guide](https://developers.openai.com/api/docs/guides/tools-computer-use)

## Current AgentHub Fit

AgentHub already has the right host architecture for SDK integration:

| AgentHub layer | Current role | SDK fit |
|---|---|---|
| Shared Workbench | IM transcript, composer, inspector, evidence UI | Consume normalized events only; never import SDK classes. |
| Desktop platform adapter | Local Edge, Tauri host, workspace allowlist | Surface SDK approval requests and trace/evidence from Edge. |
| Web platform adapter | Hub session, remote viewing/approval, target routing | Show remote approvals and evidence through Hub; no direct SDK/Local Edge access. |
| Hub Server | identity, IM, TeamRun, target routing, audit | Own orchestration state; SDK handoffs are inputs, not authority. |
| Edge Server | project/workspace, lifecycle, adapters, artifacts | Natural place for Claude/OpenAI SDK adapters or fixture mappers. |
| API/events | REST + WebSocket contracts | Needs small provider-neutral extensions for SDK permissions, tool registry, trace refs, and resumable approvals. |

The important boundary is:

```text
AgentHub Agent Profile / TeamRun / Execution Target
  -> Edge Runtime Adapter contract
    -> Claude Agent SDK / OpenAI Agents SDK / CLI runtime
```

## Integration Value Map

| Product area | Claude Agent SDK value | OpenAI Agents SDK/API value | AgentHub adoption value |
|---|---|---|---|
| Custom agents | Supports agent prompts, skills, plugins, subagents, built-in tools, and filesystem-based Claude Code settings. | `Agent` has instructions, tools, handoffs, guardrails, structured outputs, context, hooks, and sessions. | Use both to validate `AgentHubAgentSpec` fields: role prompt, tools, MCP servers, approval mode, memory sources, evidence requirements, and runtime preferences. |
| Runtime adapters | Runs Claude Code as a library with built-in tools and session handling. | Provides Python/TypeScript runners, Responses-backed models, streaming, sessions, sandbox agents, and tool execution. | Add SDK adapter capability flags below Edge: `sdk_runtime`, `library_loop`, `sdk_session`, `sandbox_workspace`, `tool_search`, `trace_export`. |
| Tool registry | Claude exposes built-in tools, custom tools, MCP, tool search, and allowed tool policies. | OpenAI exposes function tools, hosted tools, built-in Responses API tools, remote MCP tools, connectors, tool filtering, and tool approval request patterns. | Turn AgentHub's Skill/MCP/runtime tool inventory into a provider-neutral `ToolDescriptor` registry with owner, risk, input schema, execution locality, secret scope, and approval policy. |
| Permission and control flow | `canUseTool` can pause for tool approvals or `AskUserQuestion`; hooks can allow/deny/modify requests; deferral supports resume later. | Guardrails, MCP approval callbacks, human-in-the-loop, tool approval items, and tool guardrails can pause or block runs. | Normalize all provider approval waits into `run.agent.permission_requested` + Hub/Edge `permission.decide`, including allow, deny, modified input, remember policy, defer/resume, and user-question answers. |
| Multi-agent orchestration | Subagents can be invoked through the `Agent` tool and include parent tool-use linkage. | Handoffs and agents-as-tools are first-class orchestration primitives. | Treat SDK handoffs/subagents as adapter evidence and route suggestions; Hub TeamRun remains the authoritative assignment, approval, replay, and audit state. |
| Tracing and evaluation | OpenTelemetry observability and cost/usage tracking expose run-level diagnostics. | Built-in tracing supports visual debugging, monitoring, evaluation, fine-tuning, and distillation workflows. | Add `TraceRef` / `EvalRef` evidence records that can point to provider traces, but keep AgentHub transcript/evidence refs canonical and redacted. |
| Remote Desktop Edge execution | Claude SDK runs in the process/infrastructure that has workspace access; approvals can pause indefinitely or defer. | Responses API tool loops, sandbox agents, remote MCP transports, and computer-use APIs are useful patterns for isolated workspace, hosted-tool, and UI-control paths. | Use remote Desktop Edge as the execution authority. SDKs run only inside approved Edge targets, with Hub relay carrying approvals, not provider credentials or local filesystem access. |
| Product differentiation | Claude gives a strong coding-agent library surface with built-in editing, Bash, MCP, subagents, hooks, and permissions. | OpenAI gives a broader app-agent runtime with handoffs, guardrails, tracing, sandbox, hosted MCP, and computer-use APIs. | AgentHub can position itself as the cross-runtime collaboration layer: same IM, TeamRun, approval, target routing, and evidence UI across Claude, OpenAI, Codex, and OpenCode. |

## Adopt Now

These actions are compatible with a 48-hour docs/contract/fixture slice and do not require real SDK calls.

1. **Adopt SDK capability vocabulary into Edge adapter metadata.**
   Add a design note or future schema proposal for capability flags such as `libraryLoop`, `builtInTools`, `customTools`, `mcpClient`, `hostedMcp`, `toolSearch`, `permissionCallback`, `approvalDefer`, `subagents`, `handoffs`, `guardrails`, `traceExport`, `usageExport`, `sandboxWorkspace`, and `computerUse`.

2. **Define provider-neutral SDK event mapping.**
   Map Claude/OpenAI SDK concepts into existing AgentHub events: `run.agent.tool_call`, `run.agent.tool_result`, `run.agent.permission_requested`, `run.agent.route_decision`, `run.agent.file_change`, `artifact.created`, `run.agent.result`, and future `run.agent.trace_ref`.

3. **Extend approval semantics in the interface plan.**
   AgentHub should support allow, deny, allow-with-modified-input, remember policy, user-question answers, and deferred approval resume. Claude's `canUseTool` and OpenAI MCP/tool approval patterns both need more than a binary approve/deny.

4. **Make the tool registry provider-neutral.**
   Tool inventory should store `toolId`, `providerToolName`, `runtimeId`, `mcpServerId`, `inputSchema`, `riskLevel`, `ownerScope`, `secretScope`, `executionLocality`, `approvalPolicy`, and `enabledForProfile`. OpenAI Responses API `mcp_list_tools` and `mcp_call` items should be normalized into this registry/evidence model rather than stored as raw API output. Do not store raw provider SDK tool objects.

5. **Add trace/evaluation evidence refs, not trace ownership.**
   Create an evidence concept that can point to Claude OpenTelemetry spans or OpenAI trace IDs after redaction. AgentHub should keep its own event log and transcript as the source of truth.

6. **Use official SDK terms in product strategy, but preserve AgentHub terms.**
   Public/product copy can say "supports Claude Agent SDK and OpenAI Agents SDK adapters" only when a real adapter exists. Until then, use "adapter-ready" or "fixture-mapped" wording.

## Defer

Defer these until a separate approved implementation slice provides credentials, budget, redaction, runtime paths, and evidence handling.

- Live Claude Agent SDK or OpenAI Agents SDK execution.
- Installing SDK packages into the repo.
- Real API/model calls, tracing export, hosted MCP connector calls, or computer-use sessions.
- Replacing Hub TeamRun with SDK-native handoffs.
- Replacing AgentHub memory/session state with SDK sessions.
- Exposing provider SDK classes or raw provider sessions to Web/Desktop/Tauri.
- Hosted MCP connectors that require third-party OAuth/access tokens.
- Any public claim that AgentHub production supports live Claude/OpenAI SDK execution before a real-run gate exists.

## Required Interface Changes

These are interface recommendations only; no implementation is included in this report.

### 1. Adapter capability metadata

Extend `AgentCapabilities` or adjacent adapter metadata with SDK-specific feature flags:

```ts
type RuntimeCapability =
  | "built_in_tools"
  | "custom_tools"
  | "mcp_client"
  | "hosted_mcp"
  | "tool_search"
  | "permission_callback"
  | "approval_defer"
  | "subagents"
  | "handoffs"
  | "guardrails"
  | "trace_export"
  | "usage_export"
  | "sandbox_workspace"
  | "computer_use";
```

### 2. Tool registry contract

Add a provider-neutral tool record that can describe Claude built-ins, Claude custom tools, OpenAI function tools, OpenAI hosted tools, MCP tools, shell tools, and AgentHub-local tools:

```ts
interface ToolDescriptor {
  toolId: string;
  displayName: string;
  provider: "agenthub" | "claude-agent-sdk" | "openai-agents-sdk" | "mcp" | "cli";
  runtimeId?: string;
  providerToolName?: string;
  mcpServerId?: string;
  inputSchema?: unknown;
  riskLevel: "read" | "write" | "execute" | "network" | "secret" | "admin";
  executionLocality: "edge-local" | "edge-remote" | "openai-hosted" | "provider-hosted";
  approvalPolicy: "never" | "on-risk" | "always" | "blocked";
  secretScope: "none" | "edge" | "hub" | "provider-connector";
}
```

### 3. Permission request envelope

Current approval flows should be extended to preserve provider IDs and richer decisions:

```ts
interface RuntimePermissionRequest {
  requestId: string;
  runId: string;
  runtimeId: string;
  toolId: string;
  providerToolCallId?: string;
  providerToolName?: string;
  input: unknown;
  riskLevel: string;
  suggestedPolicyUpdates?: unknown[];
  supportsUpdatedInput: boolean;
  supportsDefer: boolean;
  question?: {
    header?: string;
    text: string;
    options?: Array<{ label: string; description?: string }>;
    multiSelect?: boolean;
  };
}
```

Decision values should support:

- `allow`
- `deny`
- `allow_with_input`
- `allow_and_remember`
- `answer_question`
- `defer`
- `cancel`

### 4. Trace and evaluation refs

Add evidence refs that link SDK traces without making provider trace storage canonical:

```ts
interface RuntimeTraceRef {
  provider: "claude-agent-sdk" | "openai-agents-sdk" | "agenthub";
  traceId: string;
  spanId?: string;
  runId: string;
  redaction: "metadata-only" | "operator-reviewed" | "private";
  exportedAt?: string;
}
```

Evaluation refs should be metadata-only until explicit approval exists:

```ts
interface RuntimeEvalRef {
  provider: "openai" | "agenthub" | "external";
  evalId: string;
  datasetRef?: string;
  scoreSummary?: string;
  redaction: "metadata-only" | "private";
}
```

### 5. Execution Target policy

Execution Targets need explicit SDK/runtime policy fields:

```ts
interface ExecutionTargetPolicy {
  allowedRuntimeIds: string[];
  allowedSdkProviders: Array<"claude-agent-sdk" | "openai-agents-sdk">;
  workspaceAllowlistRequired: boolean;
  remoteApprovalRequired: boolean;
  hostedToolCallsAllowed: boolean;
  providerSecretsAllowedAt: "none" | "edge" | "hub";
}
```

This prevents Web or Hub relay from accidentally dispatching a provider-hosted or filesystem-capable SDK run to a target that has no workspace, approval, or secret boundary.

## Risks

| Risk | Why it matters | Mitigation |
|---|---|---|
| Product model leakage | SDK `Agent`, handoff, session, or tool objects could become Hub/UI state. | Keep SDK classes below Edge adapter; expose only AgentHub contracts. |
| Permission mismatch | Claude and OpenAI can pause, modify inputs, remember rules, or defer; binary approval is insufficient. | Extend AgentHub permission envelope before live SDK work. |
| Remote execution ambiguity | A Web user approving a remote Desktop Edge action must know exact target, workspace, tool, and risk. | Require target-bound approvals and replay only to the same device/target. |
| Secret exposure | Hosted MCP, connectors, SDK API keys, traces, and tool inputs can carry sensitive data. | Secret scopes, no public evidence dumps, redacted trace refs, and explicit live-run approval gate. |
| Provider lock-in | SDK-native orchestration could replace AgentHub TeamRun by accident. | Treat SDK handoffs/subagents as suggestions/evidence; Hub TeamRun remains canonical. |
| Cost drift | SDKs make real tool loops easy to run and can spend budget quickly. | Keep proposal/fixture mode default; separate real-run gate with budget and redaction. |
| Terms and branding | Claude docs restrict claude.ai login/rate-limit resale and warn against appearing as Claude Code. | Use API-key/provider auth boundaries and AgentHub-first branding. |
| Trace privacy | Provider traces are useful but may contain prompts, file paths, tool inputs, and outputs. | Store trace refs first; ingest full trace only under private evidence rules. |

## 48-Hour-Compatible Plan

### 0-6 hours: contract alignment

- Add an SDK integration appendix to the existing `docs/reference/sdk-agent-strategy.md` or keep this audit as the owning report.
- Freeze non-goals: no SDK install, no live SDK/model/API calls, no endpoint behavior changes.
- Draft adapter capability flags and permission decision semantics.

### 6-18 hours: fixture mapping

- Create no-secret Claude Agent SDK-like and OpenAI Agents SDK-like fixture events.
- Map fixtures to existing AgentHub events:
  - tool call/result
  - permission requested/decided
  - route suggestion
  - file/artifact evidence
  - trace ref metadata
- Include redaction cases for path, token-like values, and provider IDs.

### 18-30 hours: interface review

- Review whether `api/events.md`, shared transcript types, and Edge `AgentCapabilities` can represent the fixture output without leaking provider objects.
- If schema changes are needed, keep them component-only or docs-only unless a separate implementation card is approved.
- Check remote target implications: exact device replay, workspace allowlist, and Hub permission ownership.

### 30-42 hours: product and UX mapping

- Define the product copy:
  - "SDK adapter-ready"
  - "fixture-mapped SDK evidence"
  - no "live SDK execution" claim.
- Draft approval UI requirements for modified input, defer/resume, questions, and target-bound decisions.
- Draft inspector requirements for provider trace refs and usage/cost metadata.

### 42-48 hours: verification and handoff

- Run markdown whitespace checks and repo governance checks that are safe for a docs-only branch.
- Produce a handoff with:
  - source links
  - recommended next implementation card
  - explicit blockers for real SDK execution
  - no-spend/no-secret evidence statement.

## Recommended Next Card

Create a follow-up card:

```text
codex/p1-sdk-fixture-event-mapper

Goal:
  Add fixture-only Claude Agent SDK and OpenAI Agents SDK event mappers under Edge adapter tests.

Allowed:
  docs/reference fixtures, Edge adapter testdata, mapper tests, docs-only event mapping.

Forbidden:
  SDK package install, real CLI/model/API calls, provider credentials, endpoint behavior changes,
  Web/Desktop SDK imports, docs/roadmap.md edits.

Acceptance:
  Fixture mapper tests pass.
  Mapped events feed existing AgentHub runtime event names.
  Permission requests cover allow, deny, modified input, question answer, and defer.
  Trace refs are metadata-only and redacted.
```

## Bottom Line

Adopt SDK concepts now as adapter metadata, fixture mappings, approval semantics, tool registry fields, and trace/evidence refs. Defer live SDK execution until AgentHub can prove exact target routing, workspace allowlists, redacted evidence, budget caps, and richer approval decisions.

The product differentiation is clear: AgentHub is not a Claude-only or OpenAI-only SDK wrapper. It is the collaboration, permission, routing, and evidence layer that lets multiple agent runtimes work inside the same IM-shaped team workspace.
