# Multica Product And UI Deep Dive

Date: 2026-05-21

Purpose: define exactly what AgentHub should learn from `reference/multica/` and what must stay different.

## 1. Why Multica Is Tier-0

Multica is one of the closest references for AgentHub's long-term shape because it treats coding agents as real product actors, not as hidden CLI calls.

Evidence:

- `reference/multica/README.md:31-35` says agents can be assigned work like colleagues and larger teams can route work to squads.
- `reference/multica/README.md:55-62` lists the full lifecycle: agent teammates, squads, autonomous execution, reusable skills, unified runtimes and multi-workspace isolation.
- `reference/multica/docs/product-overview.md:95-121` gives a concept dictionary where Agent, Runtime, Daemon, Task, Skill, Chat and polymorphic actor map directly to database concepts.

AgentHub should therefore treat Multica as a primary reference for:

- agent identity and status
- runtime / daemon registration
- task queue lifecycle
- progress and blocker reporting
- skill attachment
- polished, dense, restrained frontend product design

## 2. Product Mapping

| Multica | AgentHub |
|---|---|
| Agent is a first-class teammate | Agent appears as a first-class actor in conversation, approvals, artifacts and run history |
| Issue is the core work object | Conversation / Thread / Artifact are the core objects |
| Task is one agent execution | AgentRun is one agent execution |
| Runtime is where an agent can execute | RunnerEndpoint / AgentCapability describes where and how a CLI agent can run |
| Daemon polls server and runs CLI agents | Edge manages local/remote Runner availability and dispatches RunnerCommand |
| Squad routes work to a group | Group chat + Orchestrator / Coordinator routes work to agents |
| Chat is a 1:1 sidecar | Chat is the main product surface, including group chat and `@Agent` |
| Progress streams over WebSocket | EdgeEvent / RunnerEvent stream to UI and persist into EventStore |

Boundary:

```text
Learn Multica's agent lifecycle.
Do not copy Multica's Issue/Board-first entry point.
```

## 3. Frontend Structure To Learn

Multica's frontend organization is especially relevant because it separates platform glue from reusable product views.

Evidence:

- `reference/multica/AGENTS.md:15-20` splits `server/`, `apps/web/`, `apps/desktop/`, `packages/core/`, `packages/ui/` and `packages/views/`.
- `reference/multica/AGENTS.md:23-35` says React Query owns server state, Zustand owns client state, WebSocket events invalidate queries, and shared views cannot import Next.js or router APIs directly.
- `reference/multica/apps/web/platform/navigation.tsx:19-35` uses a `NavigationAdapter` so shared views do not depend on Next.js.
- `reference/multica/packages/views/` contains reusable business surfaces such as agents, chat, issues, runtimes, skills, squads, editor, dashboard, search and onboarding.

AgentHub frontend should mirror the boundary, adapted to our names:

| Layer | AgentHub Rule |
|---|---|
| `apps/web` | platform routing, app providers, web-only wiring |
| `apps/desktop` | Tauri shell, native bridge, tray/window behavior |
| `packages/ui-kit` | atomic UI components, no business logic |
| `packages/agent-core` / `packages/im-core` | typed client models and business hooks |
| `packages/views` or equivalent | reusable business views: conversation, artifact panel, runner status, approvals, settings |

## 4. Realtime State Flow

Multica has a useful rule: WebSocket should not become a second database in the frontend.

AgentHub should write this as a frontend contract:

```text
Edge / Hub EventStore is the durable source.
Generated TypeScript event types are the frontend contract.
WebSocket delivers notifications and streamed items.
Each persisted object has one owner store/query.
Derived panels read from that owner, not from duplicated local copies.
```

Practical mapping:

| Object | Frontend owner |
|---|---|
| Project / Conversation / Thread | query cache or conversation store |
| Turn / AgentRun status | run store or query cache, fed by typed events |
| Item stream | append-only thread item stream with event id dedupe |
| Approval request | approval store keyed by approval id |
| Artifact metadata | artifact store keyed by artifact id |
| Preview URL | preview route state derived from artifact/run metadata |

## 5. Visual System To Learn

Multica's UI feels strong because it is restrained and dense, not because it is decorative.

Evidence:

- `reference/multica/docs/design.md:7-13` defines restrained UI, neutral hierarchy and token-based consistency.
- `reference/multica/docs/design.md:78-103` limits typography to a small scale and avoids heavy font weights.
- `reference/multica/docs/design.md:107-133` uses a 4px spacing grid and treats cards as the heaviest separation tool.
- `reference/multica/apps/web/app/globals.css:1-6` composes Tailwind, shadcn, tokens, base and custom CSS layers.

AgentHub should adopt these UI rules:

- use a dense three-pane workbench, not a marketing landing page
- use neutral surfaces for most UI area
- reserve color for status, risk, agent identity and selected state
- keep typography small and consistent
- keep cards for actual repeated objects, approvals and modals
- make agent status, runtime status and run progress visible without loud decoration

## 6. Backend / Runtime Mapping

Multica is also useful because its backend is Go and its execution model is close to Hub-Edge-Runner.

Evidence:

- `reference/multica/README.md:116-126` says the daemon auto-detects CLI agents and registers a runtime used to create agents.
- `reference/multica/README.md:170-175` lists Go backend, PostgreSQL, WebSocket and local daemon runtime.
- `reference/multica/server/internal/` contains runtime, daemon, handler, realtime, service and metrics packages.
- `reference/multica/server/pkg/protocol/events.go` defines task and daemon WebSocket events.

AgentHub mapping:

| Multica Backend | AgentHub Go Service |
|---|---|
| Server metadata | Hub Server for account/sync/relay, Edge Server for local project/run authority |
| Daemon | Edge-managed Runner availability |
| Runtime | RunnerEndpoint / AgentCapability |
| Task queue | AgentRun queue |
| Task progress events | RunnerEvent -> EdgeEvent -> UI |
| Agent provider files | Runner adapter packages for Claude Code / Codex / OpenCode |

## 7. What Not To Copy

Do not copy these parts directly:

- Issue and Board as the first screen.
- Chat as only a private 1:1 sidecar.
- Server owning all execution authority.
- Product language that hides IM/group collaboration.

AgentHub's product sentence should remain:

```text
Like Feishu/WeChat for multi-agent coding: pull Claude Code, Codex and OpenCode into a group chat, let them work on files, review diffs, ask for approvals and ship artifacts.
```

## 8. Concrete AgentHub Changes

Architecture docs should reflect these additions:

- Product model includes `Multica-style managed agent lifecycle`.
- `AgentProfile` is mandatory in the model, not optional decoration.
- `AgentRun` state machine includes queued, running, awaiting approval, done, failed and cancelled.
- Runtime/Runner status is visible in the top bar or right panel.
- Progress, blocker and error become first-class Thread Items.
- UI data flow states that WebSocket events do not mutate random stores directly.
- The design system should favor dense, neutral, status-driven UI.
