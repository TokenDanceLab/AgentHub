# AgentHub SDK Agent Strategy

> Date: 2026-06-08
> Scope: Product and architecture strategy for using external agent SDKs without replacing AgentHub's own product model.
> Status: docs-only strategy. This document does not change OpenAPI, schemas, code, adapters, runtime behavior, or real model execution gates.

## Decision

AgentHub should own a product-level `AgentHubAgentSpec` / DSL. Claude SDK, OpenAI Agents SDK, Codex, OpenCode, and future agent SDKs should be treated as Edge runtime or provider adapter experiments, not as the product model exposed to Hub, Web, Desktop, TeamRun, marketplace, or user settings.

The core boundary is:

```text
AgentHubAgentSpec / Agent Profile / TeamRun
  -> Edge runtime adapter contract
    -> Claude SDK / OpenAI Agents SDK / Codex / OpenCode implementation detail
```

External SDK objects may inspire adapter mappings, event fixtures, and provider-specific capability discovery. They must not leak upward as Hub database rows, Web/Tauri UI state, TeamRun orchestration state, marketplace records, approval policy, memory ownership, or execution target identity.

## Official Source Anchors

OpenAI official sources:

- [OpenAI Agents SDK for Python](https://openai.github.io/openai-agents-python/)
- [Agents](https://openai.github.io/openai-agents-python/agents/)
- [Tools](https://openai.github.io/openai-agents-python/tools/)
- [MCP](https://openai.github.io/openai-agents-python/mcp/)
- [Handoffs](https://openai.github.io/openai-agents-python/handoffs/)
- [Guardrails](https://openai.github.io/openai-agents-python/guardrails/)
- [Tracing](https://openai.github.io/openai-agents-python/tracing/)

Anthropic / Claude official sources:

- [Claude Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview)
- [Claude Agent SDK TypeScript](https://code.claude.com/docs/en/agent-sdk/typescript)
- [Claude Agent SDK Python](https://code.claude.com/docs/en/agent-sdk/python)
- [Claude Agent SDK MCP](https://code.claude.com/docs/en/agent-sdk/mcp)
- [Claude Agent SDK permissions](https://code.claude.com/docs/en/agent-sdk/permissions)
- [Claude Agent SDK hooks](https://code.claude.com/docs/en/agent-sdk/hooks)

These sources are useful because they expose real concepts AgentHub must map: agents, tools, MCP servers, handoffs, guardrails, traces, SDK sessions, permission modes, hooks, and settings. They do not override AgentHub's existing Agent Runtime / Agent Profile / Agent Configuration / Execution Target terminology.

## Why AgentHub Needs Its Own Agent Layer

AgentHub is not only a wrapper around one agent SDK. It is an IM-shaped collaboration product with Hub-owned users, sessions, Agent Profiles, TeamRun state, approvals, evidence, runtime routing, local/remote Execution Targets, marketplace intent, and cross-product TokenDance identity boundaries.

An SDK-native product model would create the wrong coupling:

| Product need | Why an external SDK object is insufficient |
|---|---|
| Agent Profile identity | Users manage Builder, Reviewer, Researcher, Deployer, and Supervisor identities. Runtime SDK `Agent` objects are provider-specific execution constructs. |
| TeamRun orchestration | TeamRun needs Hub-owned assignment, route decision, approval, replay, and audit records. SDK handoffs can be an adapter input, not the authoritative TeamRun state. |
| Tools and MCP governance | Tool allowlists, MCP server ownership, marketplace install state, and secret boundaries belong to Hub/Edge policy. SDK tool objects are runtime bindings. |
| Approval policy | AgentHub approval must connect Desktop/Web UI decision, Edge permission request, Hub audit, TeamRun event, and exact Execution Target. Provider permission hooks are only one runtime surface. |
| Runtime portability | AgentHub supports Codex, Claude Code, OpenCode, OpenAI Agents SDK experiments, and future runtimes. The product model must survive provider changes. |
| Memory ownership | Project memory, thread context, user preferences, and runtime session files have different retention and privacy boundaries. SDK memory/session state cannot become the only source. |
| Evidence policy | Competition/demo and production review require normalized run, tool, diff, artifact, preview, route, and approval evidence. Provider traces are useful inputs but not sufficient product evidence. |
| Execution Target routing | Local Edge, remote Edge, Cloud Edge, and Hub relay target selection are AgentHub routing decisions, not SDK runtime identity. |

The strategic direction is therefore to define a durable AgentHub layer first, then build SDK adapters underneath it.

## `AgentHubAgentSpec` v1 Shape

This is a docs-only sketch, not a schema change. A later slice can turn it into shared types after review.

```yaml
id: profile_builder
kind: agent_profile
display:
  name: Builder
  description: Implements scoped code changes with evidence.
identity:
  owner: hub_user_or_org
  visibility: private|team|marketplace
role:
  teamRole: supervisor|worker|reviewer|observer
  instructions: product-level durable role prompt
runtime:
  preferredRuntime: codex|claude-code|opencode|openai-agents-sdk|claude-sdk
  model: provider/model hint
  reasoning: effort or budget hint
  adapterMode: cli|sdk|daemon|fixture
target:
  preferences:
    - local-edge
    - remote-edge
  workspacePolicy: explicit project/workspace allowlist
tools:
  allowlist:
    - file.read
    - file.patch
    - shell.test
  mcpServers:
    - owned server ids, not raw secret config
approval:
  mode: read-only|workspace-write|approval-required|blocked
  riskRules:
    - command/category/path rules
memory:
  sources:
    - AGENTS.md
    - project memory
    - thread context
    - selected artifact summaries
  retention: product policy, not SDK session default
evidence:
  required:
    - run events
    - tool calls
    - file changes
    - artifacts
    - approvals
    - route decisions
  redaction: no secrets, no raw private model output in public docs
handoff:
  accepts:
    - TeamRun assignment
  emits:
    - route decision
    - result summary
    - evidence refs
```

This shape keeps product concepts first:

- `AgentProfile` answers who is doing the work.
- `runtime` answers what implementation runs the work.
- `target` answers where it runs.
- `tools`, `mcpServers`, `approval`, `memory`, and `evidence` answer what the agent is allowed to access and what proof it must produce.

## Adapter Mapping Strategy

SDK adapters should be evaluated as translation layers.

| AgentHub concept | Claude SDK experiment | OpenAI Agents SDK experiment | Product rule |
|---|---|---|---|
| Agent role/instructions | Map to SDK prompt/options or session setup | Map to SDK Agent instructions | Keep durable role prompt in AgentHubAgentSpec. |
| Tools | Map selected tools and MCP servers to SDK runtime | Map functions/hosted tools/MCP bridge where supported | AgentHub owns allowlist and secret boundary. |
| MCP | Use SDK-supported MCP wiring for runtime process | Use OpenAI SDK MCP support | Hub/Edge own MCP server registry and policy. |
| Approval | Map provider permission hooks/modes into Edge permission events | Map guardrails/tool decisions into Edge permission events where possible | Edge/Hub approval events remain canonical. |
| Handoff | Treat SDK handoff as possible route-decision input | Treat SDK handoff as possible route-decision input | TeamRun route state remains Hub-owned. |
| Tracing | Ingest trace spans as optional evidence refs | Ingest trace spans as optional evidence refs | AgentHub evidence model remains canonical. |
| Memory/session | Use runtime session only as adapter-local context | Use SDK session only as adapter-local context | Product memory stays AgentHub-owned. |

The first adapter experiments should use fixture event streams, not live model calls. The purpose is to validate event shape, approval mapping, and evidence projection before any provider-specific runtime becomes a real execution path.

## PoC Backlog

### 1. `AgentHubAgentSpec` v1 docs-only

Owner scope: `docs/reference/sdk-agent-strategy.md`.

Deliverables:

- Freeze the product decision that AgentHub owns `AgentHubAgentSpec` / DSL.
- Define draft fields for AgentProfile identity, tools, MCP, approval, runtime, target, memory, and evidence policy.
- Record Avoid/Defer boundaries.

Validation:

- `git diff --check`
- markdown/link basic check

Non-goals:

- No OpenAPI/schema/code changes.
- No SDK installation.
- No real CLI/model execution.

### 2. Shared schema proposal

Owner scope: future proposal only.

Deliverables:

- Propose shared TypeScript/Go schema names and field ownership.
- Map current Hub AgentProfile fields to the draft spec.
- Identify migration-free adapter-only fields versus persistent Hub-owned fields.

Acceptance:

- Review confirms no external SDK class or JSON shape becomes a public AgentHub product contract.
- Review confirms Web/Tauri UI only consumes AgentHub-owned fields.

Non-goals:

- No database migration until field ownership is approved.
- No TeamRun or ExecutionTarget replacement.

### 3. Edge SDK event fixture mapper

Owner scope: future Edge adapter test slice.

Deliverables:

- Add fixture events that simulate Claude SDK and OpenAI Agents SDK tool, handoff, permission, result, and trace outputs.
- Map fixtures into existing AgentHub runtime event types such as `run.agent.file_change`, `approval.requested`, `run.agent.route_decision`, `artifact.created`, and result events.
- Verify redaction and workspace-relative path policy.

Acceptance:

- Fixture-only tests prove mapper behavior without SDK packages, CLI processes, model calls, secrets, or external services.
- Mapped output can feed existing transcript/evidence surfaces.

Non-goals:

- No live SDK runtime.
- No real MCP server.
- No model/provider credentials.

### 4. Claude SDK adapter experiment

Owner scope: future Edge runtime/provider adapter worktree.

Deliverables:

- Build an experimental adapter behind an explicit runtime id, for example `claude-sdk-experimental`.
- Map Claude SDK session/tool/permission/MCP surfaces into the existing Edge runtime adapter contract.
- Keep permission decisions routed through AgentHub Edge/Hub approval events.
- Keep output normalization compatible with TeamRun route decision fixtures.

Acceptance:

- Starts with fake/static or dry adapter tests.
- Any live Claude SDK execution requires a separate approval gate, no-secret evidence policy, and explicit model budget.

Non-goals:

- Do not replace `claude-code` CLI adapter.
- Do not replace Hub TeamRun, Hub AgentProfile, memory, or ExecutionTarget.
- Do not expose Claude SDK objects in Web/Desktop UI.

### 5. OpenAI Agents SDK experiment

Owner scope: future Edge runtime/provider adapter worktree.

Deliverables:

- Build an experimental adapter behind an explicit runtime id, for example `openai-agents-sdk-experimental`.
- Map OpenAI Agents SDK agent/tool/MCP/handoff/guardrail/trace concepts into Edge runtime events and evidence refs.
- Evaluate whether SDK handoffs can become a provider-side signal for AgentHub TeamRun route decisions.

Acceptance:

- Starts with fixture mapper tests.
- Live OpenAI Agents SDK execution requires a separate approval gate, no-secret evidence policy, and explicit model budget.

Non-goals:

- Do not replace Codex adapter work.
- Do not replace Hub orchestrator, TeamRun, memory, approval, or ExecutionTarget.
- Do not put OpenAI SDK agent objects in Hub/Web/Desktop product models.

## Avoid / Defer

Avoid:

- Do not replace Hub orchestrator, TeamRun, AgentProfile, memory, approval, evidence, or ExecutionTarget with SDK-native abstractions.
- Do not call Claude/OpenAI SDKs directly from Web or Tauri UI.
- Do not let Web import Local Edge, Tauri, filesystem, SDK credentials, or runtime provider objects.
- Do not let Desktop bypass Edge to run SDK code.
- Do not store SDK provider secrets in AgentHub public docs, Web local state, Feishu cards, or public logs.
- Do not run real CLI/model calls in this strategy slice.
- Do not create OpenAPI/schema/code changes in this strategy slice.

Defer:

- Real SDK installation and runtime smoke.
- Real MCP bridge with provider credentials.
- Persistent schema additions.
- Marketplace packaging for SDK-backed profiles.
- Production remote/cloud Execution Target routing for SDK adapters.
- Provider trace ingestion beyond fixture evidence.

## ByteDance Demo Value

The ByteDance demo needs to show AgentHub as a collaboration product, not as a thin SDK launcher. A custom AgentHub agent layer strengthens the demo in four concrete ways:

1. Reviewer-visible product identity: Builder, Reviewer, Supervisor, and Worker appear as durable Agent Profiles, while Codex/Claude/OpenAI/OpenCode remain runtime mechanisms.
2. Credible TeamRun story: route decisions, assignments, approvals, and replayable events are Hub-owned, so the demo can show multi-agent coordination instead of provider-specific handoff screenshots.
3. Evidence-first proof: transcript, right inspector, route/task/event lists, file changes, artifacts, previews, and approvals all use AgentHub evidence refs, even when the underlying runtime changes.
4. Safer offline progression: fixture mappers can validate the event/evidence contract before spending model budget or exposing secrets.

The demo narrative should be:

```text
AgentHub defines the collaboration model.
Edge adapters translate provider SDKs into AgentHub events.
TeamRun and evidence prove the collaboration loop.
```

This keeps SDK experiments valuable without making any vendor SDK the architecture center.

## Review Checklist For Future SDK Work

- Does the change preserve Agent Runtime / Agent Profile / Agent Configuration / Execution Target terminology?
- Are SDK objects kept below the Edge runtime adapter boundary?
- Are tools and MCP servers resolved through AgentHub-owned policy, not raw SDK config?
- Are approvals emitted through AgentHub Edge/Hub approval events?
- Are route decisions projected into TeamRun state rather than SDK-native handoff state?
- Is memory retention controlled by AgentHub policy?
- Is evidence normalized into AgentHub transcript/evidence refs?
- Does the test use fixtures unless live SDK/model approval is explicit?
- Does the UI avoid direct SDK imports and provider credentials?
- Are no secrets, raw production logs, or private model outputs committed?
