# P1 Agent SDK Product Integration Report

> Date: 2026-06-09
> Branch: `codex/p1-sdk-integration-product-report`
> Base: `codex/p1-critical-evidence-integration` at `219cadb0d2a0cc5baeab729a5633686c59492d17`
> Scope: concrete product and architecture report only. No SDK install, no real model/API calls, no secret handling, no endpoint changes, no roadmap edits.

## Executive Recommendation

AgentHub should use Claude Agent SDK and OpenAI Agents SDK as optional Edge runtime adapter inputs, not as the AgentHub product model.

Near term, keep CLI adapters as the default execution path. Add an SDK-ready adapter profile and fixture/event mapping path behind the existing Edge adapter boundary. In parallel, define AgentHub-owned custom Agent registration/profile fields that can target CLI or SDK providers without exposing provider SDK objects above Edge.

The reason is concrete in the current architecture:

- `edge-server/internal/lifecycle/process_executor.go` owns run lifecycle, cancellation, process execution, EventBus publication, Hub callbacks, runtime evidence emission, transcript persistence, budget wrapping, decision-loop wrapping, and security-hook wrapping.
- `edge-server/internal/adapters/adapter.go` already defines the runtime seam: `Metadata`, `Capabilities`, `BuildCommand`, `ParseStream`, `NeedsStdin`, and normalized `run.agent.*` event names.
- `edge-server/internal/adapters/registry.go` resolves per-run `agentID` to an adapter and falls back to default runtime selection.
- `edge-server/README.md` explicitly distinguishes Agent Runtime, Agent Profile, Agent Configuration, and Execution Target. Runtime answers "what implementation runs"; Profile answers "who is doing work"; Target answers "where it runs."
- `docs/reference/sdk-agent-strategy.md` already states the durable product decision: AgentHub owns `AgentHubAgentSpec` / Agent Profile / TeamRun, while external SDK objects stay below the Edge adapter boundary.

The valuable 48-hour outcome is therefore not live SDK execution. It is a precise adapter contract, fixture mapper, approval/event envelope, and custom Agent profile shape that lets AgentHub optimize its own custom Agent path while keeping provider SDKs replaceable.

## Official Sources Consulted

OpenAI official sources:

- Agents SDK guide: https://developers.openai.com/api/docs/guides/agents
- Guardrails and human review: https://developers.openai.com/api/docs/guides/agents/guardrails-approvals
- Results and state: https://developers.openai.com/api/docs/guides/agents/results
- Integrations and observability: https://developers.openai.com/api/docs/guides/agents/integrations-observability
- Tools guide: https://developers.openai.com/api/docs/guides/tools
- OpenAI Agents SDK Python agents: https://openai.github.io/openai-agents-python/agents/
- OpenAI Agents SDK TypeScript overview: https://openai.github.io/openai-agents-js/
- OpenAI Agents SDK TypeScript agents: https://openai.github.io/openai-agents-js/guides/agents/

Claude official sources:

- Claude Agent SDK overview: https://code.claude.com/docs/en/agent-sdk/overview
- Claude Agent SDK TypeScript reference: https://code.claude.com/docs/en/agent-sdk/typescript
- Claude Agent SDK permissions: https://code.claude.com/docs/en/agent-sdk/permissions
- Claude Agent SDK hooks: https://code.claude.com/docs/en/agent-sdk/hooks
- Claude Agent SDK agent loop: https://code.claude.com/docs/en/agent-sdk/agent-loop
- Claude Agent SDK MCP: https://code.claude.com/docs/en/agent-sdk/mcp
- Claude Agent SDK cost tracking: https://code.claude.com/docs/en/agent-sdk/cost-tracking

## Current AgentHub Runtime Fit

AgentHub already has the right host shape for SDK integration:

```text
AgentHub Agent Profile / TeamRun / Execution Target
  -> Edge RunProcessContext
  -> Edge AgentAdapter
  -> CLI adapter today, SDK-backed adapter later
  -> normalized Edge events
  -> Hub/Web/Desktop transcript, approvals, evidence, and audit
```

Current adapter signals that should remain product-owned:

| Current surface | Product meaning | SDK implication |
|---|---|---|
| `AgentCapabilities` | Provider-neutral runtime capability summary | Extend with SDK-specific flags; do not expose provider classes. |
| `BuildCommand` | Current subprocess launcher contract | Keep for CLI adapters; add an adjacent SDK runner contract only when live SDK work starts. |
| `ParseStream` | Runtime-native event normalization | SDK mappers should emit the same `run.agent.*` events. |
| `NeedsStdin` | Runtime control channel requirement | SDK approvals may not use stdin, so approval transport must be provider-neutral. |
| `PermissionHooks` | Runtime can ask before risky tools | Expand from binary approval toward allow, deny, modified input, defer, and question-answer. |
| `MCPIntegration` | Runtime can expose MCP-backed tools | Normalize local MCP, hosted MCP, remote MCP, and provider-hosted tool boundaries. |
| `SubAgentSpawn` | Runtime can spawn/delegate | Treat SDK handoffs/subagents as route evidence or suggestions; Hub TeamRun remains canonical. |

## Integration Options

### Option A: Use SDKs only inside Edge adapters as event/stream/action sources

This is the best near-term path.

How it works:

- Add SDK adapter IDs such as `claude-agent-sdk` and `openai-agents-sdk` later, but keep CLI adapters as default.
- Translate SDK tool calls, approvals, handoffs, trace refs, usage, file changes, and final results into existing or minimally extended `run.agent.*` events.
- Keep SDK package imports and provider runtime objects below `edge-server/internal/adapters/` or a sibling `internal/sdkadapters/` package.
- Keep Hub, Web, Desktop, and Tauri consuming only AgentHub contracts.

Why it fits:

- Claude Agent SDK is a library that runs the agent loop in the caller's process/infrastructure and exposes built-in tools, hooks, permissions, MCP, subagents, sessions, and cost/usage data.
- OpenAI Agents SDK is an orchestration layer where `Agent` plus runner manages tools, guardrails, handoffs, sessions, human review, and tracing. Official OpenAI guidance says if the application wants to own the loop itself, use the Responses API directly instead.
- AgentHub already owns loop-adjacent product surfaces: TeamRun, target routing, approval UX, transcript, evidence, and Hub audit. SDKs should feed those surfaces, not replace them.

Risks:

- Live SDK libraries may want long-lived process state while the current executor is subprocess-centered.
- Provider traces and tool inputs may include sensitive local paths or prompts.

Mitigation:

- Start with fixture mappers, then introduce a `RuntimeDriver` abstraction only for live SDK execution.
- Store metadata-only `trace_ref` evidence first.

### Option B: Build our own Agent runtime abstraction over SDKs

This is the correct medium-term direction, but not the first 48-hour slice.

What "own runtime abstraction" should mean:

- `AgentHubAgentSpec` remains the durable product object.
- A runtime driver interface can support subprocess CLI, in-process SDK, remote SDK service, and fixture modes.
- Driver output is normalized into the same Edge event stream.

What it must not mean:

- A giant cross-provider framework that reimplements every SDK.
- Making OpenAI `Agent`, Claude `AgentDefinition`, or SDK sessions Hub database records.
- Making SDK handoffs the authoritative TeamRun routing state.

Concrete shape:

```text
AgentHubAgentSpec
  -> RunProcessContext
  -> RuntimeDriver
      - CLIProcessDriver
      - ClaudeAgentSDKDriver
      - OpenAIAgentsSDKDriver
      - FixtureDriver
  -> EventNormalizer
  -> Edge EventBus / evidence
```

This can be introduced after fixture mapping proves the event envelope.

### Option C: Keep CLI adapters as default and use SDK as optional provider

This should be the product default for P1.

CLI adapters already cover the currently supported real execution modes: `claude-code`, `codex`, `opencode`, and `orchestrator`. They preserve existing smoke paths, operator habits, and local security posture. SDK-backed adapters should be opt-in profile/provider choices with capability labels:

- `runtimeMode: cli | sdk | fixture`
- `provider: claude | openai | opencode | codex | agenthub`
- `executionLocality: edge-process | edge-subprocess | provider-hosted | sandbox`
- `liveExecution: disabled | approval-required | enabled-for-target`
- `defaultForNewProfiles: false` until real smoke evidence exists

This protects the product from a provider-specific migration before AgentHub has target-bound approvals, SDK credential storage rules, and trace redaction.

### Option D: Custom Agent registration/profile implications

Custom Agent registration is where SDK research becomes product value.

AgentHub should define and validate a provider-neutral profile shape:

| Profile field | Why it matters for our custom Agent path |
|---|---|
| `agentId`, `displayName`, `ownerScope`, `visibility` | User/team-manageable identity, not SDK identity. |
| `role`, `instructions`, `responsibility` | Stable role prompt and TeamRun routing intent. |
| `runtimeMode`, `runtimeId`, `provider`, `modelPolicy` | Decouple product profile from runtime provider. |
| `targetPolicy` | Which Edge targets, workspaces, and remote approval gates can run this profile. |
| `toolPolicy` | AgentHub-owned allowlist/risk rules across built-ins, CLI tools, MCP, hosted tools, and provider tools. |
| `mcpPolicy` | Server IDs, owner scope, transport class, secret scope, and approval policy. |
| `approvalPolicy` | Product-local approval semantics independent of provider callbacks. |
| `memoryPolicy` | AGENTS.md, project memory, thread context, provider session usage, retention, and redaction. |
| `evidencePolicy` | Required event, file, artifact, approval, trace, usage, and result evidence. |
| `sdkOptions` | Optional provider-specific tuning kept below Edge and marked experimental. |

Registration should accept "SDK-capable" as capability metadata, not as proof of live support. Public UI should show "fixture-mapped" or "adapter-ready" until a real SDK smoke gate lands.

## Recommended Near-Term Path

1. Keep CLI adapters as the default runtime path.
2. Add SDK concepts as provider-neutral adapter capability metadata and fixture-mapped event inputs.
3. Define custom Agent profile registration fields that target existing CLI adapters first and reserve SDK-specific fields for optional providers.
4. Extend approval/event envelopes before live SDK work, because both SDK families support richer control than a simple yes/no decision.
5. Add metadata-only trace and usage evidence refs, not full provider trace ingestion.

This is the smallest path that directly improves our own custom Agent product:

- AgentHub gets a cleaner custom Agent spec.
- Edge gets a future-proof runtime abstraction path.
- Hub/Web/Desktop get stable approval and evidence contracts.
- SDK provider choice stays an implementation detail until it is proven.

## What Not To Do In 48 Hours

- Do not install Claude Agent SDK or OpenAI Agents SDK packages.
- Do not run real SDK, CLI, model, hosted MCP, shell, browser, or computer-use calls.
- Do not introduce provider API keys, OAuth tokens, MCP credentials, or secret paths.
- Do not replace `ProcessExecutor` or the current CLI adapters.
- Do not make SDK sessions, OpenAI `Agent`, Claude `AgentDefinition`, handoff state, or provider trace payloads Hub/Web/Desktop product state.
- Do not change `docs/roadmap.md`.
- Do not claim live production support for Claude Agent SDK or OpenAI Agents SDK.
- Do not store raw provider traces, raw tool inputs, full prompts, or local absolute paths in public docs.
- Do not make SDK adapters the default runtime for existing profiles.

## API And Event Implications

### Events to keep

Most SDK signals can map to existing events:

| SDK signal | Existing AgentHub event |
|---|---|
| Text delta or message block | `run.agent.text_delta`, `run.agent.text_block` |
| Tool call | `run.agent.tool_call` |
| Tool result | `run.agent.tool_result` |
| File write/edit/delete evidence | `run.agent.file_change` |
| Handoff or subagent routing suggestion | `run.agent.route_decision`, `run.agent.task_started`, `run.agent.task_dispatched` |
| Final result | `run.agent.result` |
| Usage/cost/context | `run.agent.session_metrics`, `run.agent.context_usage`, `run.agent.context_warning` |
| Runtime state | `run.agent.session_state_changed`, `run.agent.status_change` |
| Permission pause | `run.agent.permission_requested`, `run.agent.permission_decided` |

### Events to add or formalize

Add these only as contract/schema work first:

| Proposed event | Purpose |
|---|---|
| `run.agent.trace_ref` | Metadata-only pointer to provider trace/span/run diagnostics. |
| `run.agent.eval_ref` | Metadata-only pointer to eval result or replay dataset. |
| `run.agent.tool_registry_snapshot` | Runtime-adapter view of enabled tools, MCP servers, hosted tools, and approval policies. |
| `run.agent.approval_deferred` | Provider or AgentHub pause that can be resumed later. |
| `run.agent.user_question` | Runtime asks the operator a structured question rather than requesting a tool approval. |

### Permission envelope

Current permission events should grow toward:

```yaml
requestId: string
runId: string
threadId: string
projectId: string
agentId: string
runtimeId: string
provider: claude-agent-sdk|openai-agents-sdk|claude-code|codex|opencode|agenthub
executionTargetId: string
workspaceRef: string
tool:
  toolId: string
  providerToolName: string
  kind: builtin|function|mcp|hosted_mcp|shell|file|browser|computer|subagent
  risk: read|write|execute|network|secret|admin
inputPreview: redacted object
supports:
  allow: true
  deny: true
  modifiedInput: true|false
  remember: true|false
  defer: true|false
  answerQuestion: true|false
decision:
  type: allow|deny|allow_with_input|allow_and_remember|defer|answer_question|cancel
  decidedBy: user|policy|hook|hub-admin|edge-policy
  decidedAt: timestamp
```

Why this matters:

- Claude hooks can allow, deny, ask, defer, and update tool input.
- OpenAI human review can pause tool execution and resume from state after approval.
- Remote Edge approval must be bound to the exact target, workspace, run, tool, and redacted input preview.

### Tool registry

Do not persist raw provider tool objects. Persist normalized descriptors:

```yaml
toolId: string
displayName: string
provider: agenthub|claude-agent-sdk|openai-agents-sdk|mcp|cli
runtimeId: string
providerToolName: string
mcpServerId: string
transport: local-stdio|local-http|remote-http|remote-sse|provider-hosted
inputSchemaRef: string
riskLevel: read|write|execute|network|secret|admin
executionLocality: edge-local|edge-remote|provider-hosted|sandbox
secretScope: none|edge|hub|provider-connector
approvalPolicy: never|on-risk|always|blocked
enabledForProfile: boolean
```

## Security And Credential Boundaries

Security rule: SDK credentials and provider tool secrets must live at the execution authority, not in Web UI, public docs, Feishu cards, Hub IM payloads, or raw trace artifacts.

Concrete boundaries:

| Surface | Allowed | Forbidden |
|---|---|---|
| Web/Desktop UI | AgentHub-owned profile fields, redacted approval previews, trace refs | Provider API keys, raw SDK sessions, raw MCP auth headers |
| Hub Server | Profile catalog, TeamRun state, audit, target authorization, approval records | Local filesystem access, provider SDK process state, raw provider traces by default |
| Local/Remote Edge | Runtime adapter execution, local workspace access, MCP client execution, SDK credentials when explicitly configured | Leaking credentials to event payloads or public evidence |
| Provider-hosted tools | Only when target policy and secret scope explicitly allow it | Implicit use from a generic custom Agent profile |
| Public docs/audit | URLs, no-secret schemas, fake fixture IDs | Real prompts containing secrets, absolute private paths, API tokens |

Credential implications:

- Claude SDK MCP examples pass remote API tokens through environment/header config. AgentHub must model these as `secretScope=edge` or `provider-connector`, never as profile JSON visible to Web.
- OpenAI hosted MCP and tools can run outside the Edge process. AgentHub must distinguish `edge-local` execution from `provider-hosted` execution before approvals are meaningful.
- Claude SDK cost fields are useful for insight but official docs describe them as client-side estimates, not authoritative billing. AgentHub should store them as `usage_estimate`, not billing truth.
- Provider trace data can include prompts, tool inputs, file paths, outputs, and identifiers. Store `trace_ref` first; ingest full trace only under private evidence policy.
- The existing executor-level rejection of `bypassPermissions` should remain a hard guard. SDK permission modes must not bypass AgentHub target policy.

## Test Strategy

No live SDK calls are needed for P1.

1. Fixture mapper tests
   - Add Claude Agent SDK-like and OpenAI Agents SDK-like fixture events.
   - Map them into existing `run.agent.*` events.
   - Cover tool call/result, MCP tool, file change, handoff/subagent suggestion, permission request, deferred approval, user question, trace ref, usage, and final result.

2. Redaction tests
   - Token-like values become `<redacted>`.
   - Absolute local paths become workspace-relative or basename-only.
   - Remote MCP headers and OAuth tokens never enter emitted payloads.
   - Provider IDs are retained only when useful for correlation and safe to expose.

3. Approval contract tests
   - Allow, deny, allow-with-modified-input, defer/resume, and answer-question decisions round trip through a provider-neutral envelope.
   - Decisions are target-bound and cannot be replayed to a different run, workspace, or tool call.

4. Custom Agent profile validation tests
   - A profile can register with CLI runtime only.
   - A profile can declare SDK capability without live execution.
   - A profile cannot enable provider-hosted tools unless target policy and secret scope allow it.
   - SDK-specific options do not appear in public profile lists unless redacted.

5. Edge integration tests
   - Use mock/fixture drivers only.
   - Verify EventBus output, evidence records, transcript persistence, Hub callback compatibility, and no SDK package import requirement.

6. Docs verification
   - `git diff --check`
   - Markdown link review for official URLs when editing source lists.
   - No generated artifacts, SDK lockfile churn, local DBs, logs, or traces.

## Implementation Slices

### Slice 1: SDK capability and custom Agent profile contract

Estimate: 0.5-1 day.

Dependencies:

- Existing `AgentCapabilities` and `docs/reference/sdk-agent-strategy.md`.
- No SDK package install.

Deliverables:

- Docs-only profile contract for custom Agent registration.
- SDK capability vocabulary: `sdkRuntime`, `libraryLoop`, `builtInTools`, `customTools`, `mcpClient`, `hostedMcp`, `permissionCallback`, `approvalDefer`, `userQuestion`, `subagents`, `handoffs`, `guardrails`, `traceExport`, `usageEstimate`, `sandboxWorkspace`, `providerHostedTools`.

Acceptance:

- Product can explain how a custom Agent targets CLI now and SDK later.
- No runtime behavior change.

### Slice 2: Fixture-only SDK event mapper

Estimate: 1-1.5 days.

Dependencies:

- Slice 1 vocabulary.
- Existing adapter event constants and fixture mapper patterns.

Deliverables:

- Claude-like and OpenAI-like no-secret fixtures.
- Mapper tests from provider-shaped events to `run.agent.*`.
- Redaction and path normalization tests.

Acceptance:

- Tests pass without SDK packages, credentials, model calls, or CLI calls.
- Mapped events feed existing transcript/evidence surfaces.

### Slice 3: Provider-neutral approval envelope

Estimate: 1-2 days.

Dependencies:

- Slice 2 event mapping.
- Current permission broker/control protocol behavior.

Deliverables:

- Contract for approval request and decision payload.
- Fixture tests for allow, deny, modified input, defer/resume, question answer, and cancel.
- Target-bound replay constraints documented.

Acceptance:

- Claude-style hook decisions and OpenAI-style human review interruptions can both map into AgentHub approvals.
- Existing binary approval behavior remains compatible.

### Slice 4: Runtime driver design for optional SDK providers

Estimate: 1-2 days.

Dependencies:

- Slices 1-3.
- Agreement that CLI remains default.

Deliverables:

- Design note for `RuntimeDriver` or equivalent interface supporting `cli`, `sdk`, and `fixture` modes.
- Explicit decision on whether SDK live execution runs in-process, sidecar process, or subprocess wrapper.
- Cancellation, timeout, event emission, trace ref, and credential injection rules.

Acceptance:

- No code path starts a live SDK.
- The team can estimate the live adapter implementation without rewriting `ProcessExecutor`.

### Slice 5: First live SDK smoke gate

Estimate: 2-4 days after explicit approval, credentials, and budget.

Dependencies:

- Slices 1-4.
- Secret owner and local operator environment.
- Target policy for one isolated workspace.

Deliverables:

- One live provider behind opt-in profile only.
- Budget cap, redaction, local-only target, and no provider-hosted tools unless separately approved.
- Smoke evidence captured as AgentHub events and metadata-only trace refs.

Acceptance:

- One SDK run can start, pause for approval, emit normalized events, finish, and leave no raw secret in logs/events.
- CLI adapters remain default and unaffected.

## Product Bottom Line

The SDKs are strategically useful because they pressure-test AgentHub's own custom Agent path:

- Claude validates coding-agent needs: filesystem tools, Bash/Edit/Read/Grep, hooks, permissions, subagents, MCP, sessions, and usage.
- OpenAI validates application-agent needs: typed tools, guardrails, human review, handoffs, sessions, sandbox agents, hosted tools/MCP, tracing, and eval loops.
- AgentHub's product value is the layer above them: custom Agent identity, TeamRun, target routing, local/remote approval, transcript, evidence, and multi-runtime collaboration.

Therefore, the practical P1 recommendation is: keep CLI adapters as the real default, make SDKs optional Edge adapter providers, build a provider-neutral custom Agent profile contract, and prove the event/approval/evidence model with fixtures before any live SDK execution.

## Non-Goals Confirmed

- No code implementation in this report.
- No SDK package installation.
- No real API/model calls.
- No provider secrets or secret paths.
- No roadmap edits.
- No push, merge, or tag.
- No changes outside `docs/audit/`.
