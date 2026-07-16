# Hub `internal/service` Boundary Map

> last-updated: 2026-07-17
> issue: #493 (refresh after #478; prior map #468)
> status: map current — `service/agentevent` pure package (#468) + `RunEventService` type extract (#478) landed
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

**Shape note:** not one god struct — **24+ `*Service` types** already exist
(including `RunEventService`). Concentration remains **package flatness +
`AgentService` method sprawl** (~3.2k LOC across agent/dispatch/outbox/
run-event facade/callback).

Precedent: `service/agentteam` uses **local interfaces**
(`agentTeamAgentSvc`, `agentTeamCache`, `agentTeamControlSvc`) + `*service.Bus`.
`RunEventService` follows the same port pattern with `runEventControl`.

## 1. File inventory by domain

| Domain | Prod LOC | Files (prod) | Role |
|--------|---------:|--------------|------|
| **agent_runtime** | ~2,9xx | `agent.go`, `agent_custom.go`, `agent_dispatch.go` (819), `agent_run_event.go` (`RunEventService` + `AgentService` facade), `agent_edge_callback.go` (392), `delivery_outbox.go` (599), `agent_control.go`, `agent_team_helpers.go` (compat wrappers), `relay.go` | Task dispatch, edge callback, outbox retry, run-event projection |
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
| `delivery_outbox.go` | 599 | `deliveryOutboxRecord` model + retry loop | **same-package** `dispatchPayload` + `dispatchToEdgeHTTP`; `agent_edge_callback` auto-ack |
| `message.go` | 860 | send/edit/pin/forward/search | `Bus`, cache seq, attachments |
| `session.go` | 728 | private/group lifecycle | cache, bus, agent cleanup helpers |
| `agent_edge_callback.go` | 392 | ack/stream/done/fail + authorize | repo; `agentevent` normalize/validate; outbox auto-ack; bus/ws; **next type extract** |
| `agent_run_event.go` | 237 | `RunEventService` + `AgentService` facade | repo; `agentevent` project; injected `runEventControl` (**#478 done**) |

### Consumers outside package

- **Wiring:** `hub-server/internal/app/{wiring,app,background,events}.go`
- **Handlers:** per-domain interfaces already in `handler/*` (good extract seam)
- **Subpkg:** `agentteam` → `service.Bus` + agent/control interfaces
- **Subpkg:** `agentevent` → pure helpers used by `RunEventService` + edge callback
- **Composition:** `AgentService` holds `runEvents *RunEventService` (set in `NewAgentService`); facade methods keep handler signatures stable

## 2. Coupling risks

1. **`*AgentService` is still the real god receiver** — dispatch + outbox + edge callback + custom agents share one struct (`db`, `bus`, `mgr`, `cacheClient`, `relay`). Run-event orchestration is composed out but facaded.
2. **`dispatchPayload` is package-private glue** between `agent_dispatch.go` and `delivery_outbox.go` (retry re-unmarshals payload and calls `dispatchToEdgeHTTP`). **Cannot extract either alone without exporting a DTO + redispatch port.**
3. **Outbox row type lives in service** (`deliveryOutboxRecord`) by design comment — schema coupled to service package; cleanup-strategy wants model/repository later.
4. **Run-event pure helpers** — normalize/validate used by `agent_edge_callback.go`; project/summarize used by list/decide APIs. **Moved to `agentevent` in #468.**
5. **`DecideTaskApproval` control coupling** — **resolved in #478**: `RunEventService` injects `runEventControl` (implemented by `*AgentControlService`). Facade still type-asserts cache for tests that construct `AgentService` without `NewAgentService`.
6. **`agent_team_helpers.go` overlaps agentteam** — approval ID/decision predicates still duplicated in subpkg (drift risk). Flat package wraps `agentevent`; agentteam still has local copies. Edge callback still mixes `agentevent.*` and thin wrappers (`validateAgentCallback*`).
7. **`service.Bus` is a parent-package dependency** for agentteam — bus cannot move with a domain without an `events` subpackage or interface. **EdgeCallbackService** will need a bus/publish port for the same reason.
8. **IM vs agent_runtime** — mostly independent at service layer; coupling is app/handler orchestration + session agent cleanup, not deep import cycles.
9. **Trivial “extracts” (image_meta / public_stats / eventbus alone)** shrink LOC almost nothing vs concentration problem.
10. **Handler interfaces already thin the edge** — package extract without service-side ports still leaves fat concrete type for tests/wiring.

Cleanup strategy alignment (`docs/analysis/cleanup-strategy.md` Phase 4 Hub):
`DispatchService` / `RunEventService` / `EdgeCallbackService` → then delivery model to model/repository → then im/catalog agentteam-style subpackages.
**“先接口后搬家；一次一个 seam.”** — `RunEventService` done; **do not big-bang `DispatchService`.**

## 3. Extract candidates ranked (lowest risk first)

| Rank | Candidate | Risk | Value | Status |
|-----:|-----------|------|------:|--------|
| **1** | **Pure run-event projection/validation package** (`service/agentevent`) | **Lowest** | High seam | **DONE in #468** |
| 2 | Same-package **interface boundary only** (export projector/ports; methods stay) | Very low | Medium | Superseded by #478 type extract for run-events |
| 3 | Mechanical move of already-standalone small services (`public_stats`, `user_settings`) | Low | Low | LOC theater — defer |
| 4 | `MessageReactionService` / `WorkspaceService` subpkg | Low–med | Medium | Independent but not concentration core |
| **5** | **`RunEventService` type split (methods + inject control)** | Medium | High | **DONE in #478** |
| **6** | **`EdgeCallbackService` type split (ack/stream/done/fail + ports)** | Medium | High | **Next recommended** after #478 |
| 6b | Pure outbox helpers only (`computeNextRetryAt`, `truncateString`, status/backoff constants) | Low | Low–med | Optional micro-step before full outbox move; not a substitute for EdgeCallback |
| 7 | `DeliveryOutbox` service + repository model | **High** | High | Tied to `dispatchPayload` + redispatch — after callback or with explicit `Redispatcher` port |
| 8 | Full `DispatchService` extract | **Highest** | Highest | **Last among runtime** — no big-bang |

## 4. Landed extracts

### 4a. `hub-server/internal/service/agentevent` (#468)

**Moved (from `agent_run_event.go` + helpers, unexported → exported):**

- Projection: `SummarizeAgentRunEvents`, `ProjectTaskApprovals`, `ProjectTaskArtifacts`, `FindTaskApproval`, `TaskApprovalEdgeControl`, artifact path/capability helpers, token/output parsers
- Ingress validation: `NormalizeRunEventInput`, `ValidateAgentCallbackPayloadSize`, `ValidateAgentCallbackEdgeRunID`, `ValidateRunEventType`, `InferRunEventType`
- Shared pure helpers: approval decision/status, `ApprovalIDFor`, first-non-empty / JSON string helpers

**Kept on orchestration types:**

- List/summary/approvals/artifacts/decide (now on `RunEventService`, facaded by `AgentService`)
- All of `agent_dispatch` / `delivery_outbox` / `agent_edge_callback` orchestration

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

### Acceptance (landed)

- [x] Pure helpers out of orchestration file (`agentevent`, #468)
- [x] `agentevent` has **no** `*gorm.DB` / `*AgentService` / ws / cache imports
- [x] `RunEventService` owns list/summary/approvals/artifacts/decide (#478)
- [x] Control delivery injected; no inline `AgentControlService{...}` in decide path
- [x] Handler interfaces / OpenAPI unchanged via `AgentService` facade
- [x] Follow-up extract order refreshed below (#493)

## 6. Suggested follow-up extract order

1. ~~**`RunEventService`**~~ — **DONE #478**
2. **`EdgeCallbackService` (recommended next)** — move `HandleTaskAck` / `HandleTaskStream` / `HandleTaskDone` / `HandleTaskFail` (+ private `authorizeTaskEdgeCallback`, `transitionDispatchedTaskToRunning`, stream projection helpers). Inject ports for: DB/repo access (or keep `*gorm.DB` like `RunEventService`), bus publish, seq allocation, outbox auto-ack, optional team route-decision hook. Keep `AgentService` facade for `handler/agent.go`.
3. **Optional pure outbox helpers** — extract `computeNextRetryAt` + `truncateString` (+ retry constants if needed) into a tiny pure package or `service/deliveryoutbox` helpers file **only if** it unblocks tests without touching `dispatchPayload` / redispatch. Not a full outbox service.
4. **Outbox service + model move** — `deliveryOutboxRecord` → `model`/`repository`; `DeliveryOutbox` with `Redispatcher` interface implemented by dispatch.
5. **`DispatchService`** — **last** among runtime; owns `dispatchPayload` + capability. **No big-bang.**
6. **IM subpackages** (`service/im` or message/session/contact) — agentteam-style, lower urgency than runtime.
7. **Optional dedupe:** import `agentevent` helpers from `agentteam` to remove duplicated approval predicates; finish edge-callback call sites to prefer `agentevent.*` over wrappers.

### Follow-up issue acceptance sketch: `EdgeCallbackService`

**Goal:** same-package type extract mirroring #478 — shrink `AgentService` method surface without moving dispatch/outbox models.

**Scope**

- New `EdgeCallbackService` (or `AgentEdgeCallbackService`) owns:
  - `HandleTaskAck`
  - `HandleTaskStream`
  - `HandleTaskDone`
  - `HandleTaskFail`
  - private helpers currently only used by those paths (`authorizeTaskEdgeCallback`, `transitionDispatchedTaskToRunning`, stream-side auto-route parse if tightly coupled)
- Inject narrow ports instead of reaching through full `AgentService` where practical:
  - `edgeCallbackBus` — `Publish(ctx, Event)`
  - `edgeCallbackSeq` — `allocateSeq(ctx, sessionID)` (or pass seq allocator interface)
  - `edgeCallbackOutbox` — `autoAckDeliveriesForTask` / ack-by-task (avoid pulling full outbox retry loop)
  - optional `edgeCallbackTeamRoute` for auto-parse route decision
- Reuse `agentevent` normalize/validate; no reimplementation
- `AgentService` composes the type + thin facade methods so `handler/agent.go` interfaces stay stable
- Prefer direct `agentevent.*` calls over `agent_team_helpers` wrappers on touched lines

**Non-goals**

- No `DispatchService` extract
- No `deliveryOutboxRecord` model/repository move
- No `dispatchPayload` export / redispatch redesign
- No OpenAPI / handler signature change
- No frontend

**Tests / acceptance**

- [ ] `EdgeCallbackService` exists; methods no longer primarily live as fat logic on `AgentService` (facade OK)
- [ ] Existing callback/stream tests green: `HandleTask*` cases in `agent_run_event_test.go` + outbox auto-ack-on-task-ack cases
- [ ] `go test ./internal/service/ -short` (or full package with timeout) green
- [ ] No new import cycles; no handler/OpenAPI churn
- [ ] Boundary map status line updated to mark EdgeCallback done and point next (outbox helpers or `DeliveryOutbox`+`Redispatcher`)

### Alternate / parallel micro-sketch: pure outbox helpers

Only if `EdgeCallbackService` is deferred and a PR needs a sub-day seam:

- Move pure functions `computeNextRetryAt(attempt int) time.Time` and `truncateString(s string, maxLen int) string` (optionally constants `DeliveryRetry*`) to a pure file/package
- Keep all DB/retry/redispatch methods on `AgentService` until `Redispatcher` port exists
- Tests: existing `TestOutbox_ComputeBackoff` + `TestOutbox_TruncateString` move or re-export
- **Do not** pretend this completes DeliveryOutbox extract

## 7. Bottom line

- **Map:** six domains in flat package; **agent_runtime + im_messaging** dominate; **agentteam** is the extract template; **`agentevent`** is the pure seam; **`RunEventService`** is the first orchestration type extract.
- **Highest remaining coupling:** `AgentService` × (`dispatch` ↔ `outbox` via `dispatchPayload`) × (edge callback ↔ bus/seq/outbox auto-ack).
- **Landed:** pure **`agentevent`** (#468) + **`RunEventService` + injected control** (#478).
- **Next:** **`EdgeCallbackService` type extract with injected bus/seq/outbox ports** — not DispatchService, not outbox model big-bang. Optional pure outbox helpers only as a micro-step.

## Key paths

- `hub-server/internal/service/`
- `hub-server/internal/service/agentevent/`
- `hub-server/internal/service/agentteam/`
- `hub-server/internal/service/agent_run_event.go` (`RunEventService`)
- `hub-server/internal/service/agent_edge_callback.go` (next)
- `hub-server/internal/service/delivery_outbox.go`
- `docs/analysis/cleanup-strategy.md`
