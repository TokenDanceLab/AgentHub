# Hub `internal/service` Boundary Map

> last-updated: 2026-07-17
> issue: #505 (refresh after EdgeCallback extract; prior #493 / #478 / #468)
> status: map current — `service/agentevent` (#468) + `RunEventService` (#478) + `EdgeCallbackService` (#505) landed
> companion: `cleanup-strategy.md` Phase 4 Hub · precedent `service/agentteam` (ADR-014)

This document is the authoritative **read-only boundary map** for
`hub-server/internal/service`. It records package shape, coupling risks,
ranked extract candidates, landed extracts, and the next low-risk seam with
an acceptance sketch.

## 0. Snapshot totals

| Surface | Prod LOC | Test LOC | Files | Notes |
|---|---:|---:|---:|---|
| Flat `service` package | ~9,1xx | ~10,8xx | 56 `.go` | 32 prod + 24 test (approx; re-count on extract PRs) |
| Already-extracted `service/agentteam` | ~3,012 | ~3,259 | 13 | Template for later domain extracts |
| Pure extract `service/agentevent` | ~620 | unit tests | pure helpers | no DB/WS/cache/`*AgentService` (#468) |
| Same-package type extract `RunEventService` | ~200 methods + facade | existing `agent_run_event_test.go` | still in flat `service` | injected `runEventControl` (#478) |
| Same-package type extract `EdgeCallbackService` | ~500 methods + facade | existing HandleTask*/outbox auto-ack tests | still in flat `service` | injected bus/seq/outbox (#505) |

**Shape note:** not one god struct — **25+ `*Service` types** already exist
(including `RunEventService`, `EdgeCallbackService`). Concentration remains
**package flatness + `AgentService` method sprawl** (~3.2k LOC across
agent/dispatch/outbox/run-event facade/callback facade).

Precedent: `service/agentteam` uses **local interfaces**
(`agentTeamAgentSvc`, `agentTeamCache`, `agentTeamControlSvc`) + `*service.Bus`.
`RunEventService` follows the same port pattern with `runEventControl`.
`EdgeCallbackService` injects `edgeCallbackBus` / `edgeCallbackSeq` /
`edgeCallbackOutbox`.

## 1. File inventory by domain

| Domain | Prod LOC | Files (prod) | Role |
|--------|---------:|--------------|------|
| **agent_runtime** | ~2,9xx | `agent.go`, `agent_custom.go`, `agent_dispatch.go` (819), `agent_run_event.go` (`RunEventService` + facade), `agent_edge_callback.go` (`EdgeCallbackService` + facade), `delivery_outbox.go` (599), `agent_control.go`, `agent_team_helpers.go` (compat wrappers), `relay.go` | Task dispatch, edge callback, outbox retry, run-event projection |
| **im_messaging** | ~3,111 | `message.go` (860), `session.go` (728), `contact.go`, `attachment.go`, `message_reaction.go`, `workspace.go`, `notification.go`, `image_meta.go`, `s3_client.go` | IM/session/contact/attachments |
| **agent_catalog** | ~1,133 | `agent_profile.go`, `document.go`, `skill.go`, `mcp_server.go`, `provider_binding.go` | Profiles/docs/market installables |
| **identity_auth** | ~829 | `auth.go`, `oidc.go`, `device.go`, `user_settings.go` | Login/OIDC/device/settings |
| **execution_target** | ~516 | `execution_target.go` | Local-edge targets + health |
| **infra_shared** | ~493 | `eventbus.go`, `cache_fallback.go`, `audit.go`, `public_stats.go` | Bus, nil-cache guards, audit, public stats |
| **agentteam/** (subpkg) | ~3,012 | CRUD/member/run/routing/approval/guard/compete | **Already extracted** team domain |
| **agentevent/** (subpkg) | ~620 | pure project/validate/helpers | **Extracted in #468** |

### Named hotspots

| File | LOC | Owns | Couples to |
|------|----:|------|------------|
| `agent_dispatch.go` | 819 | `TriggerAgentTask`, `dispatchTask`, edge HTTP, capability, history/pins | outbox `RecordDelivery`/`MarkDeliverySent`; private `dispatchPayload`; cache/ws/relay |
| `delivery_outbox.go` | 599 | `deliveryOutboxRecord` model + retry loop | **same-package** `dispatchPayload` + `dispatchToEdgeHTTP`; `deliveryOutboxAcker` used by EdgeCallback |
| `message.go` | 860 | send/edit/pin/forward/search | `Bus`, cache seq, attachments |
| `session.go` | 728 | private/group lifecycle | cache, bus, agent cleanup helpers |
| `agent_edge_callback.go` | ~513 | `EdgeCallbackService` + `AgentService` facade | repo; `agentevent` normalize/validate; injected bus/seq/outbox (**#505 done**) |
| `agent_run_event.go` | 237 | `RunEventService` + `AgentService` facade | repo; `agentevent` project; injected `runEventControl` (**#478 done**) |

### Consumers outside package

- **Wiring:** `hub-server/internal/app/{wiring,app,background,events}.go`
- **Handlers:** per-domain interfaces already in `handler/*` (good extract seam)
- **Subpkg:** `agentteam` → `service.Bus` + agent/control interfaces
- **Subpkg:** `agentevent` → pure helpers used by `RunEventService` + `EdgeCallbackService`
- **Composition:** `AgentService` holds `runEvents *RunEventService` and
  `edgeCallbacks *EdgeCallbackService` (set in `NewAgentService`); facade
  methods keep handler signatures stable

## 2. Coupling risks

1. **`*AgentService` is still the real god receiver** — dispatch + outbox + custom agents share one struct (`db`, `bus`, `mgr`, `cacheClient`, `relay`). Run-event and edge-callback orchestration are composed out but facaded.
2. **`dispatchPayload` is package-private glue** between `agent_dispatch.go` and `delivery_outbox.go` (retry re-unmarshals payload and calls `dispatchToEdgeHTTP`). **Cannot extract either alone without exporting a DTO + redispatch port.**
3. **Outbox row type lives in service** (`deliveryOutboxRecord`) by design comment — schema coupled to service package; cleanup-strategy wants model/repository later. `#505` only injects a narrow auto-ack port (`deliveryOutboxAcker`), not a full outbox move.
4. **Run-event pure helpers** — normalize/validate used by edge callback; project/summarize used by list/decide APIs. **Moved to `agentevent` in #468.**
5. **`DecideTaskApproval` control coupling** — **resolved in #478**: `RunEventService` injects `runEventControl` (implemented by `*AgentControlService`). Facade still type-asserts cache for tests that construct `AgentService` without `NewAgentService`.
6. **`agent_team_helpers.go` overlaps agentteam** — approval ID/decision predicates still duplicated in subpkg (drift risk). Flat package wraps `agentevent`; agentteam still has local copies. Edge callback now prefers `agentevent.*` on touched paths.
7. **`service.Bus` is a parent-package dependency** for agentteam — bus cannot move with a domain without an `events` subpackage or interface. **Resolved for edge callback in #505** via `edgeCallbackBus` port (implemented by `*Bus`).
8. **IM vs agent_runtime** — mostly independent at service layer; coupling is app/handler orchestration + session agent cleanup, not deep import cycles.
9. **Trivial “extracts” (image_meta / public_stats / eventbus alone)** shrink LOC almost nothing vs concentration problem.
10. **Handler interfaces already thin the edge** — package extract without service-side ports still leaves fat concrete type for tests/wiring.

Cleanup strategy alignment (`docs/analysis/cleanup-strategy.md` Phase 4 Hub):
`DispatchService` / `RunEventService` / `EdgeCallbackService` → then delivery model to model/repository → then im/catalog agentteam-style subpackages.
**“先接口后搬家；一次一个 seam.”** — `RunEventService` + `EdgeCallbackService` done; **do not big-bang `DispatchService`.**

## 3. Extract candidates ranked (lowest risk first)

| Rank | Candidate | Risk | Value | Status |
|-----:|-----------|------|------:|--------|
| **1** | **Pure run-event projection/validation package** (`service/agentevent`) | **Lowest** | High seam | **DONE in #468** |
| 2 | Same-package **interface boundary only** (export projector/ports; methods stay) | Very low | Medium | Superseded by #478 type extract for run-events |
| 3 | Mechanical move of already-standalone small services (`public_stats`, `user_settings`) | Low | Low | LOC theater — defer |
| 4 | `MessageReactionService` / `WorkspaceService` subpkg | Low–med | Medium | Independent but not concentration core |
| **5** | **`RunEventService` type split (methods + inject control)** | Medium | High | **DONE in #478** |
| **6** | **`EdgeCallbackService` type split (ack/stream/done/fail + ports)** | Medium | High | **DONE in #505** |
| 6b | Pure outbox helpers only (`computeNextRetryAt`, `truncateString`, status/backoff constants) | Low | Low–med | Optional micro-step before full outbox move |
| 7 | `DeliveryOutbox` service + repository model | **High** | High | Tied to `dispatchPayload` + redispatch — with explicit `Redispatcher` port |
| 8 | Full `DispatchService` extract | **Highest** | Highest | **Last among runtime** — no big-bang |

## 4. Landed extracts

### 4a. `hub-server/internal/service/agentevent` (#468)

**Moved (from `agent_run_event.go` + helpers, unexported → exported):**

- Projection: `SummarizeAgentRunEvents`, `ProjectTaskApprovals`, `ProjectTaskArtifacts`, `FindTaskApproval`, `TaskApprovalEdgeControl`, artifact path/capability helpers, token/output parsers
- Ingress validation: `NormalizeRunEventInput`, `ValidateAgentCallbackPayloadSize`, `ValidateAgentCallbackEdgeRunID`, `ValidateRunEventType`, `InferRunEventType`
- Shared pure helpers: approval decision/status, `ApprovalIDFor`, first-non-empty / JSON string helpers

**Kept on orchestration types:**

- List/summary/approvals/artifacts/decide (now on `RunEventService`, facaded by `AgentService`)
- All of `agent_dispatch` / `delivery_outbox` orchestration
- Edge callback orchestration (now on `EdgeCallbackService`, facaded by `AgentService`)

### 4b. `RunEventService` same-package type extract (#478)

**Landed:**

- `type RunEventService struct { db; controlSvc runEventControl }`
- Methods: `ListTaskRunEvents`, `GetTaskRunEventSummary`, `ListTaskApprovals`, `DecideTaskApproval`, `ListTaskArtifacts`, `taskRunEventsForOwner`
- Injected port: `runEventControl` with `DeliverToDesktopDevice` (implemented by `*AgentControlService`)
- `AgentService` composition: `runEvents *RunEventService` via `NewAgentService`; lazy `runEventService()` for test struct literals
- `AgentService` facade methods unchanged for handlers/wiring

**Explicit non-goals (honored in #478)**

- Did not move outbox model
- Did not split `dispatchPayload`
- Did not rewire agentteam
- Did not extract edge callback

### 4c. `EdgeCallbackService` same-package type extract (#505)

**Landed:**

- `type EdgeCallbackService struct { db; bus edgeCallbackBus; seq edgeCallbackSeq; outbox edgeCallbackOutbox }`
- Methods: `HandleTaskAck`, `HandleTaskStream`, `HandleTaskDone`, `HandleTaskFail`
- Private helpers: `authorizeTaskEdgeCallback`, `transitionDispatchedTaskToRunning`, `tryAutoParseRouteDecision`, `autoAck`
- Injected ports:
  - `edgeCallbackBus` — `Publish(ctx, Event)` (implemented by `*Bus`)
  - `edgeCallbackSeq` — `allocateSeq(ctx, sessionID)` (adapted via `seqAllocatorFunc` from `AgentService.allocateSeq`)
  - `edgeCallbackOutbox` — `autoAckDeliveriesForTask` (implemented by `deliveryOutboxAcker` over outbox table)
- `AgentService` composition: `edgeCallbacks *EdgeCallbackService` via `NewAgentService`; lazy `edgeCallbackService()` for test struct literals
- `AgentService` facade methods unchanged for handlers/wiring
- Touched paths prefer `agentevent.*` over compatibility wrappers

**Explicit non-goals (honored in #505)**

- Did not extract `DispatchService`
- Did not move `deliveryOutboxRecord` to model/repository
- Did not export/redesign `dispatchPayload` / redispatch
- Did not change OpenAPI / handler signatures
- No frontend

## 5. Test plan & evidence (landed)

### Pure package

```bash
cd hub-server
go test ./internal/service/agentevent/ -count=1
```

### Run-event orchestration / facade

```bash
go test ./internal/service/ -run 'Test(ListTask|GetTaskRun|DecideTask|HandleTask|ListTaskApprovals|ListTaskArtifacts|ValidateRunEvent|InferRunEvent|FirstNonEmpty|FirstRuntime|ValidateAgentCallback)' -count=1
go test ./internal/service/ -count=1 -timeout 120s
```

### Edge-callback orchestration / facade (#505)

```bash
go test ./internal/service/ -short -count=1
go test ./internal/service/ -short -count=1 -run 'Test(HandleTask|Outbox)'
```

### Acceptance (landed)

- [x] Pure helpers out of orchestration file (`agentevent`, #468)
- [x] `agentevent` has **no** `*gorm.DB` / `*AgentService` / ws / cache imports
- [x] `RunEventService` owns list/summary/approvals/artifacts/decide (#478)
- [x] Control delivery injected; no inline `AgentControlService{...}` in decide path
- [x] `EdgeCallbackService` owns ack/stream/done/fail + private helpers (#505)
- [x] Bus / seq / outbox auto-ack injected; no full outbox or dispatch move
- [x] Handler interfaces / OpenAPI unchanged via `AgentService` facade
- [x] Follow-up extract order refreshed below (#505)

## 6. Suggested follow-up extract order

1. ~~**`RunEventService`**~~ — **DONE #478**
2. ~~**`EdgeCallbackService`**~~ — **DONE #505**
3. **Optional pure outbox helpers** — extract `computeNextRetryAt` + `truncateString` (+ retry constants if needed) into a tiny pure package or `service/deliveryoutbox` helpers file **only if** it unblocks tests without touching `dispatchPayload` / redispatch. Not a full outbox service.
4. **Outbox service + model move** — `deliveryOutboxRecord` → `model`/`repository`; `DeliveryOutbox` with `Redispatcher` interface implemented by dispatch. Reuse `#505` `edgeCallbackOutbox` port shape.
5. **`DispatchService`** — **last** among runtime; owns `dispatchPayload` + capability. **No big-bang.**
6. **IM subpackages** (`service/im` or message/session/contact) — agentteam-style, lower urgency than runtime.
7. **Optional dedupe:** import `agentevent` helpers from `agentteam` to remove duplicated approval predicates; finish remaining call sites to prefer `agentevent.*` over wrappers.

### Follow-up issue acceptance sketch: pure outbox helpers / DeliveryOutbox

**Goal:** next lowest-risk seam after EdgeCallback — either pure helpers micro-step or full `DeliveryOutbox` + `Redispatcher` once dispatch boundary is ready.

**Scope (micro-step)**

- Move pure functions `computeNextRetryAt` + `truncateString` (+ retry constants)
- Keep DB/retry/redispatch methods until `Redispatcher` exists

**Scope (full outbox)**

- `deliveryOutboxRecord` → model/repository
- `DeliveryOutbox` service with `Redispatcher` implemented by dispatch
- Keep EdgeCallback's `edgeCallbackOutbox` port (or rebind to new type)

**Non-goals**

- No `DispatchService` big-bang in the same PR as outbox model move unless ports are already stable
- No frontend / OpenAPI churn

**Tests / acceptance**

- [ ] Existing `TestOutbox_*` green
- [ ] `go test ./internal/service/ -short` green
- [ ] Boundary map status updated; next points at `DispatchService` or IM

## 7. Bottom line

- **Map:** six domains in flat package; **agent_runtime + im_messaging** dominate; **agentteam** is the extract template; **`agentevent`** is the pure seam; **`RunEventService`** and **`EdgeCallbackService`** are the first orchestration type extracts.
- **Highest remaining coupling:** `AgentService` × (`dispatch` ↔ `outbox` via `dispatchPayload`).
- **Landed:** pure **`agentevent`** (#468) + **`RunEventService` + injected control** (#478) + **`EdgeCallbackService` + injected bus/seq/outbox** (#505).
- **Next:** pure outbox helpers micro-step **or** **`DeliveryOutbox` + `Redispatcher`** — not DispatchService big-bang.

## Key paths

- `hub-server/internal/service/`
- `hub-server/internal/service/agentevent/`
- `hub-server/internal/service/agentteam/`
- `hub-server/internal/service/agent_run_event.go` (`RunEventService`)
- `hub-server/internal/service/agent_edge_callback.go` (`EdgeCallbackService`)
- `hub-server/internal/service/delivery_outbox.go` (next)
- `docs/analysis/cleanup-strategy.md`
