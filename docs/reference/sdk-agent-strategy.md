# AgentHub SDK Agent Strategy

> Date: 2026-06-08
> Scope: Product and architecture strategy for using external agent SDKs without replacing AgentHub's own product model.
> Status: docs + contract-schema draft. This slice may define fixture examples and OpenAPI component-only draft schemas, but it does not change endpoint request/response behavior, code, adapters, runtime behavior, SDK installation, or real model execution gates.

## Decision

AgentHub should own a product-level `AgentHubAgentSpec` / DSL. Claude SDK, OpenAI Agents SDK, Codex, OpenCode, and future agent SDKs should be treated as Edge runtime or provider adapter experiments, not as the product model exposed to Hub, Web, Desktop, TeamRun, marketplace, or user settings.

The core boundary is:

```text
AgentHubAgentSpec / Agent Profile / TeamRun
  -> Edge runtime adapter contract
    -> Claude SDK / OpenAI Agents SDK / Codex / OpenCode implementation detail
```

External SDK objects may inspire adapter mappings, event fixtures, and provider-specific capability discovery. They must not leak upward as Hub database rows, Web/Tauri UI state, TeamRun orchestration state, marketplace records, approval policy, memory ownership, or execution target identity.

Ownership boundary:

| Layer | Owns | Must not own |
|---|---|---|
| Hub | AgentHub API, Agent Profile identity, TeamRun orchestration, approvals, audit, marketplace intent, product memory policy | Claude/OpenAI SDK objects, SDK-native handoff state, provider sessions |
| Edge | Runtime adapters, SDK/CLI process integration, event normalization, tool/MCP execution boundary, local evidence collection | Hub orchestration decisions, product Agent Profile identity, TeamRun authority |
| Web/Desktop UI | AgentHub-owned fields from Hub/Edge contracts, approval UX, evidence display, target selection UX | SDK classes, provider credentials, raw SDK session objects |
| Tauri host | Desktop platform bridge and Local Edge lifecycle readiness | SDK object ownership, direct SDK execution bypassing Edge |

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

This is an experimental contract draft. The OpenAPI component may exist as a docs-only schema, but no current endpoint accepts or returns this full shape until a later implementation slice explicitly wires it.

```yaml
identity:
  specId: profile_builder
  ownerScope: hub_user_or_org
  visibility: private|team|marketplace
  source: hub-agent-profile|marketplace-draft|fixture
display:
  name: Builder
  description: Implements scoped code changes with evidence.
  avatarRef: optional AgentHub asset ref
role:
  teamRole: supervisor|worker|reviewer|observer
  instructions: product-level durable role prompt
  responsibility: short role contract for TeamRun assignment
runtime:
  preferredRuntime: codex|claude-code|opencode|openai-agents-sdk|claude-sdk
  modelHint: provider/model policy hint, not a public model claim
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
  - serverId: owned server id, not raw secret config
    ownerScope: hub|edge
    exposure: tool-provider|context-provider|blocked-in-fixture
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
sdkOptions:
  provider: none|claude-sdk|openai-agents-sdk
  adapterExperiment: read-only-fixture|sandbox-fixture|event-mapper|live-approved
  liveModelExecution: blocked|approval-required
  rawSdkObjectPolicy: never exposed above Edge adapter
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

### 1. `AgentHubAgentSpec` v1 contract draft

Owner scope: `docs/reference/sdk-agent-strategy.md`, optional `api/openapi.yaml` component-only schema, and fixture JSON under `docs/reference/` or `docs/competition/`.

Deliverables:

- Freeze the product decision that AgentHub owns `AgentHubAgentSpec` / DSL.
- Define draft fields for `identity`, `display`, `role`, `runtime`, `target`, `tools`, `mcpServers`, `approval`, `memory`, `evidence`, `handoff`, and `sdkOptions`.
- Mark any OpenAPI schema as `experimental` / `contract draft`; do not describe it as an implemented request or response.
- Add only no-secret fixture examples with fake ids, no local paths, and no real model claims.
- Record Avoid/Defer boundaries.

Validation:

- `git diff --check`
- OpenAPI YAML parse if `api/openapi.yaml` changes
- JSON parse for fixture examples
- markdown/link basic check

Non-goals:

- No endpoint behavior changes.
- No shared generated types or DB migration.
- No SDK installation.
- No real CLI/model execution.

### 2. Claude SDK read-only adapter fixture

Owner scope: future Edge adapter fixture slice.

Deliverables:

- Project a read-only Claude SDK-like fixture stream into AgentHub runtime events.
- Cover tool listing, permission request, MCP metadata, result summary, and trace/evidence refs without importing SDK packages.
- Use `AgentHubAgentSpec.sdkOptions.adapterExperiment: read-only-fixture`.

Acceptance:

- Fixture-only tests pass without SDK packages, CLI processes, model calls, secrets, or external services.
- Web/Desktop remain consumers of AgentHub-owned fields only.

Non-goals:

- No live Claude SDK execution.
- No provider credentials.
- No TeamRun or ExecutionTarget replacement.

### 3. OpenAI Agents SDK sandbox fixture

Owner scope: future Edge adapter fixture slice.

Deliverables:

- Project a sandboxed OpenAI Agents SDK-like fixture stream into AgentHub runtime events.
- Cover tool call, guardrail/approval signal, handoff suggestion, result summary, and trace/evidence refs without importing SDK packages.
- Use `AgentHubAgentSpec.sdkOptions.adapterExperiment: sandbox-fixture`.

Acceptance:

- Fixture-only tests prove mapper behavior without SDK packages, CLI processes, model calls, secrets, or external services.
- Mapped output can feed existing transcript/evidence surfaces.

Non-goals:

- No live OpenAI Agents SDK execution.
- No real MCP server.
- No model/provider credentials.

### 4. SDK event mapper golden tests

Owner scope: future Edge adapter test slice.

Deliverables:

- Add golden fixture events that simulate Claude SDK and OpenAI Agents SDK tool, handoff, permission, result, and trace outputs.
- Map fixtures into existing AgentHub runtime event types such as `run.agent.file_change`, `approval.requested`, `run.agent.route_decision`, `artifact.created`, and result events.
- Verify redaction and workspace-relative path policy.

Acceptance:

- Golden tests prove stable mapper behavior before any live SDK/model path is approved.
- Mapped output can feed existing transcript/evidence surfaces.

Non-goals:

- No live SDK runtime.
- No real MCP server.
- No model/provider credentials.

### 5. TeamRun fixture E2E

Owner scope: future TeamRun fixture slice.

Deliverables:

- Feed mapped SDK fixture events into TeamRun route, approval, evidence, and handoff state.
- Prove Hub owns TeamRun state while Edge owns adapter translation.
- Keep Web/Desktop/Tauri display and actions limited to AgentHub-owned fields.

Acceptance:

- Fixture E2E completes without real CLI/model calls.
- Route decisions, approvals, evidence refs, and handoff summaries are replayable from AgentHub state.

Non-goals:

- Do not replace Hub orchestrator, TeamRun, memory, approval, or ExecutionTarget.
- Do not expose Claude/OpenAI SDK objects in Hub/Web/Desktop/Tauri product models.

## Avoid / Defer

Avoid:

- Do not replace Hub orchestrator, TeamRun, AgentProfile, memory, approval, evidence, or ExecutionTarget with SDK-native abstractions.
- Do not call Claude/OpenAI SDKs directly from Web or Tauri UI.
- Do not let Web import Local Edge, Tauri, filesystem, SDK credentials, or runtime provider objects.
- Do not let Desktop bypass Edge to run SDK code.
- Do not store SDK provider secrets in AgentHub public docs, Web local state, Feishu cards, or public logs.
- Do not run real CLI/model calls in this strategy slice.
- Do not describe an OpenAPI component-only draft as an implemented endpoint request or response.

Defer:

- Real SDK installation and runtime smoke.
- Real MCP bridge with provider credentials.
- Persistent schema additions, generated shared types, and DB migration.
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
