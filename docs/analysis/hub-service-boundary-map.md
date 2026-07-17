# Hub `internal/service` Boundary Map

> last-updated: 2026-07-17
> issue: #585 (MessageService thin first seam; prior #573 / #563 / #551 / #540 / #528 / #514 / #505 / #493 / #478 / #468)
> status: map current — pure helpers closed; runtime typed services landed; **#585 MessageService thin first seam** (ports on existing typed service) landed same-package; full package moves deferred; next residual = SessionService / ContactService ports or IM subpackages / optional outbox model package move
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
| Pure extract `service/deliveryoutbox` | ~30–40 | unit tests | pure helpers | backoff/truncate + retry constants; no DB/WS/cache/`*AgentService` (#514) |
| Same-package type extract `DeliveryOutbox` | **landed #540 + #551** | existing `TestOutbox_*` + fake Redispatcher tests | still in flat `service` | opaque `Redispatcher`; private `deliveryOutboxRecord` + repo helpers; scan returns `DeliveryOutboxEntry`; redispatch uses `redispatchTarget` |
| Same-package type extract `DispatchService` | **landed #563 thin first seam + #573 redispatch residual** | existing `agent_test` dispatchTask + `TestOutbox_*` | still in flat `service` | injected bus/cache/relay/outbox ports; `dispatchPayload` stays package-private; redispatch owned by `DispatchService` via `dispatchRedispatcher` |
| Same-package type extract `MessageService` | **landed #585 thin first seam** | existing `message_test` / `message_edit_test` + port no-op tests | still in flat `service` | injected `messageBus` / `messageCache`; send/edit/pin/forward/search ownership clarified; no package move |

**Shape note:** not one god struct — **25+ `*Service` types** already exist
(including `RunEventService`, `EdgeCallbackService`, `DeliveryOutbox`,
`DispatchService`, `MessageService`). Concentration remains **package flatness + residual
`AgentService` facade sprawl + remaining IM services still on concrete `*Bus`**. Outbox journal + retry-loop orchestration
are on `DeliveryOutbox`; trigger/dispatch/cancel/regenerate **and redispatch**
are on `DispatchService` behind facades. Redispatch
(`redispatchDelivery` / `retryDispatchToTarget`) lives on `*DispatchService`
behind `Redispatcher` (`dispatchRedispatcher` / lazy adapter) using
`redispatchTarget` (not the GORM row); `dispatchPayload` stays package-private.
**#585:** `MessageService` hardens replaceable `messageBus` / `messageCache` ports
(same-package thin seam; methods already lived on the typed service).

Precedent: `service/agentteam` uses **local interfaces**
(`agentTeamAgentSvc`, `agentTeamCache`, `agentTeamControlSvc`) + `*service.Bus`.
`RunEventService` follows the same port pattern with `runEventControl`.
`EdgeCallbackService` injects `edgeCallbackBus` / `edgeCallbackSeq` /
`edgeCallbackOutbox`. `DeliveryOutbox` injects opaque `Redispatcher`
(no `dispatchPayload` export). `DispatchService` injects `dispatchBus` /
`dispatchOutbox` + shared `agentCache` / `relayDispatcher` / `*ws.Manager`.
`MessageService` injects `messageBus` / `messageCache` (**#585**).

## 1. File inventory by domain

| Domain | Prod LOC | Files (prod) | Role |
|--------|---------:|--------------|------|
| **agent_runtime** | ~2,9xx | `agent.go`, `agent_custom.go`, `agent_dispatch.go` (`DispatchService` + facade, ~930), `agent_run_event.go` (`RunEventService` + facade), `agent_edge_callback.go` (`EdgeCallbackService` + facade), `delivery_outbox.go` (~820), `agent_control.go`, `agent_team_helpers.go` (compat wrappers), `relay.go` | Task dispatch, edge callback, outbox retry, run-event projection |
| **im_messaging** | ~3,1xx | `message.go` (~900; `MessageService` + ports), `session.go` (728), `contact.go`, `attachment.go`, `message_reaction.go`, `workspace.go`, `notification.go`, `image_meta.go`, `s3_client.go` | IM/session/contact/attachments |
| **agent_catalog** | ~1,133 | `agent_profile.go`, `document.go`, `skill.go`, `mcp_server.go`, `provider_binding.go` | Profiles/docs/market installables |
| **identity_auth** | ~829 | `auth.go`, `oidc.go`, `device.go`, `user_settings.go` | Login/OIDC/device/settings |
| **execution_target** | ~516 | `execution_target.go` | Local-edge targets + health |
| **infra_shared** | ~493 | `eventbus.go`, `cache_fallback.go`, `audit.go`, `public_stats.go` | Bus, nil-cache guards, audit, public stats |
| **agentteam/** (subpkg) | ~3,012 | CRUD/member/run/routing/approval/guard/compete | **Already extracted** team domain |
| **agentevent/** (subpkg) | ~620 | pure project/validate/helpers | **Extracted in #468** |
| **deliveryoutbox/** (subpkg) | ~30–40 | pure retry/truncate helpers | **Extracted in #514** |

### Named hotspots

| File | LOC | Owns | Couples to |
|------|----:|------|------------|
| `agent_dispatch.go` | ~1,1xx | `DispatchService` + facades: `TriggerAgentTask`, `dispatchTask`, edge HTTP, capability, history/pins, cancel/regenerate, **redispatch residual** | injected outbox/bus/cache/ws/relay (**#563**); private `dispatchPayload`; redispatch owned by `DispatchService` (**#573**) |
| `delivery_outbox.go` | ~6xx | `DeliveryOutbox` owns private model + repo helpers + journal/retry + `Redispatcher` adapter; facades on `AgentService` | pure helpers → `deliveryoutbox` (#514); thin type + `Redispatcher` (**#540**); model ownership residual (**#551**); redispatch impl moved off this file onto `DispatchService` (**#573**) |
| `message.go` | ~900 | `MessageService` + ports: send/edit/recall/pin/forward/search/read | injected `messageBus` / `messageCache` (**#585**); attachments |
| `session.go` | 728 | private/group lifecycle | cache, bus, agent cleanup helpers |
| `agent_edge_callback.go` | ~520 | `EdgeCallbackService` + `AgentService` facade | repo; `agentevent` normalize/validate; injected bus/seq/outbox (**#505 done**); outbox rebind via `DeliveryOutbox` (**#540**) |
| `agent_run_event.go` | 237 | `RunEventService` + `AgentService` facade | repo; `agentevent` project; injected `runEventControl` (**#478 done**) |

### Consumers outside package

- **Wiring:** `hub-server/internal/app/{wiring,app,background,events}.go`
- **Handlers:** per-domain interfaces already in `handler/*` (good extract seam)
- **Subpkg:** `agentteam` → `service.Bus` + agent/control interfaces
- **Subpkg:** `agentevent` → pure helpers used by `RunEventService` + `EdgeCallbackService`
- **Subpkg:** `deliveryoutbox` → pure backoff/truncate helpers used by `delivery_outbox.go`
- **Composition:** `AgentService` holds `runEvents *RunEventService`,
  `edgeCallbacks *EdgeCallbackService`, `deliveryOutbox *DeliveryOutbox`, and
  `dispatch *DispatchService` (set in `NewAgentService`); facade methods keep
  handler signatures stable. Redispatch lives on `*DispatchService` via
  `dispatchRedispatcher` (**#573**; supersedes `agentRedispatcher` from **#540**).
  `#551`: `deliveryOutboxRecord` private to outbox surface; scan facade returns
  `DeliveryOutboxEntry`; only `DeliveryOutbox` implements `edgeCallbackOutbox`.
  `#563/#573`: `dispatchPayload` remains package-private.
  `#585`: `MessageService` is already a top-level typed service (not under
  `AgentService`); wiring stays `NewMessageService(db, bus, cache)` with bus/cache
  as ports. Handler interface in `handler/message.go` unchanged.

## 2. Coupling risks

1. **`*AgentService` residual god surface** — custom-agent methods still share the struct (`db`, `bus`, `mgr`, `cacheClient`, `relay`). Run-event, edge-callback, outbox journal, **dispatch orchestration**, and **redispatch** are composed out but facaded; primary residual is facade sprawl + custom-agent surface, not redispatch.
2. **`dispatchPayload` remains package-private glue** for redispatch + dispatch — thin extracts (#540/#563/#573) avoided export via opaque `Redispatcher` and same-package `DispatchService`.
3. **Outbox row type still lives in service package** (`deliveryOutboxRecord`) — **#551** seals ownership: private GORM model + `findOutboxByDeliveryID` / `updateOutboxByDeliveryID` / `outboxModel` helpers on `DeliveryOutbox`; public scan view is `DeliveryOutboxEntry` (no GORM tags); redispatch uses `redispatchTarget`; edge-callback `deliveryOutboxAcker` removed. Full move to `model/` + `repository/` packages remains optional/deferred — not required before `DispatchService`.
4. **Run-event pure helpers** — normalize/validate used by edge callback; project/summarize used by list/decide APIs. **Moved to `agentevent` in #468.**
5. **`DecideTaskApproval` control coupling** — **resolved in #478**: `RunEventService` injects `runEventControl` (implemented by `*AgentControlService`). Facade still type-asserts cache for tests that construct `AgentService` without `NewAgentService`.
6. **`agent_team_helpers.go` overlaps agentteam** — approval ID/decision predicates still duplicated in subpkg (drift risk). Flat package wraps `agentevent`; agentteam still has local copies. Edge callback now prefers `agentevent.*` on touched paths.
7. **`service.Bus` is a parent-package dependency** for agentteam — bus cannot move with a domain without an `events` subpackage or interface. **Resolved for edge callback in #505** via `edgeCallbackBus` port (implemented by `*Bus`).
8. **IM vs agent_runtime** — mostly independent at service layer; coupling is app/handler orchestration + session agent cleanup, not deep import cycles.
9. **Trivial “extracts” (image_meta / public_stats / eventbus alone)** shrink LOC almost nothing vs concentration problem.
10. **Handler interfaces already thin the edge** — package extract without service-side ports still leaves fat concrete type for tests/wiring.

Cleanup strategy alignment (`docs/analysis/cleanup-strategy.md` Phase 4 Hub):
`RunEventService` / `EdgeCallbackService` / `DeliveryOutbox` / **`DispatchService` thin first seam + redispatch residual** / **`MessageService` thin first seam (#585)** → Session/Contact port hardening or optional delivery model package move → im/catalog agentteam-style subpackages.
**“先接口后搬家；一次一个 seam.”** — runtime + message typed ports done thin; **do not big-bang package moves.**

## 3. Extract candidates ranked (lowest risk first)

| Rank | Candidate | Risk | Value | Status |
|-----:|-----------|------|------:|--------|
| **1** | **Pure run-event projection/validation package** (`service/agentevent`) | **Lowest** | High seam | **DONE in #468** |
| 2 | Same-package **interface boundary only** (export projector/ports; methods stay) | Very low | Medium | Superseded by #478 type extract for run-events |
| 3 | Mechanical move of already-standalone small services (`public_stats`, `user_settings`) | Low | Low | LOC theater — defer |
| 4 | `MessageReactionService` / `WorkspaceService` subpkg | Low–med | Medium | Independent but not concentration core |
| **5** | **`RunEventService` type split (methods + inject control)** | Medium | High | **DONE in #478** |
| **6** | **`EdgeCallbackService` type split (ack/stream/done/fail + ports)** | Medium | High | **DONE in #505** |
| **6b** | **Pure outbox helpers only** (`NextRetryDelay`/`TruncateString` + retry constants in `service/deliveryoutbox`) | Low | Low–med | **DONE in #514** |
| **6c** | **Same-package `DeliveryOutbox` type + `Redispatcher` port** (no model move) | Med–high | High | **Sketch only #528** — journal half is clean; redispatch half needs port first |
| 7 | Outbox model ownership residual / optional package move | Med → High | High | **#551 residual landed** (private model + repo helpers + DTO view); full `model/`/`repository/` package move optional/deferred |
| 8 | Full `DispatchService` extract | **Highest** | Highest | **#563 thin first seam + #573 redispatch residual landed** — optional deeper ports / package move still deferred |
| **8b** | **`MessageService` thin first seam** (ports on existing typed service) | Low–med | High (IM concentration) | **DONE #585** — `messageBus` / `messageCache` + ownership docs; no package move |
| 9 | `SessionService` / `ContactService` ports (mirror #585) | Low–med | Med | Next IM residual before subpackage move |
| 10 | IM subpackages (`service/im` or message/session/contact) | Med | High | After port hardening; agentteam-style |

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

### 4d. `hub-server/internal/service/deliveryoutbox` (#514)

**Moved (from `delivery_outbox.go`, pure only):**

- Retry/TTL constants: `DefaultMaxAttempts`, `RetryBaseInterval`, `RetryMaxInterval`,
  `RetryScanInterval`, `PendingTimeout`, `SentTimeout`, `MaxBatch`
- Backoff helpers: `NextRetryDelay(attempt)`, `NextRetryAt(attempt, now)` (clock-injectable)
- String helper: `TruncateString(s, maxLen)` (guards `maxLen < 3`)

**Kept in flat `service` package:**

- Status strings (`DeliveryStatus*`)
- `deliveryOutboxRecord` + GORM hooks / `TableName`
- All `*AgentService` outbox orchestration methods and redispatch glue
- Thin aliases for constants / `computeNextRetryAt` / `truncateString` so existing
  `TestOutbox_*` names stay stable

**Explicit non-goals (honored in #514)**

- Did not extract `DispatchService`
- Did not move `deliveryOutboxRecord` to model/repository
- Did not introduce `Redispatcher` / redesign redispatch
- Did not change OpenAPI / handler / frontend surfaces

## 5. Test plan & evidence (landed)

### Pure package

```bash
cd hub-server
go test ./internal/service/agentevent/ -count=1
go test ./internal/service/deliveryoutbox/ -count=1
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
- [x] Pure outbox helpers package (`deliveryoutbox`, #514)
- [x] `deliveryoutbox` has **no** `*gorm.DB` / `*AgentService` / ws / cache imports
- [x] Existing `TestOutbox_*` + `go test ./internal/service/ -short` green after pure extract
- [x] DeliveryOutbox + Redispatcher boundary sketch + thin-type feasibility (#528 docs-only)
- [x] Pure residual closed — no further pure helpers before orchestration type work
- [x] Same-package thin type extract `DeliveryOutbox` + opaque `Redispatcher` (#540)
- [x] Redispatch stays on `*AgentService` via `agentRedispatcher`; no `dispatchPayload` export
- [x] Facades preserve call sites; `edgeCallbackOutbox` rebound to `DeliveryOutbox`
- [x] Fake-`Redispatcher` unit test for retry loop; `TestOutbox_*` + short suite green
- [x] DeliveryOutbox model ownership residual (#551): private record + repo helpers + `DeliveryOutboxEntry`
- [x] Redispatch uses `redispatchTarget`; edge-callback no longer mutates outbox model
- [x] Next seam pointer was **DispatchService last** → **#563 thin first seam landed**
- [x] `DispatchService` owns trigger/dispatch/cancel/regenerate + edge HTTP/capability/history (#563)
- [x] Injected `dispatchBus` / `dispatchOutbox` (+ cache/relay/mgr); no `dispatchPayload` export
- [x] Redispatch remains on `AgentService`; HTTP redispatch reuses `DispatchService.dispatchToEdgeHTTP`
- [x] `AgentService` facades keep handler signatures; `go test ./internal/service/ -short` green
- [x] Redispatch residual moved onto `DispatchService` (`redispatchDelivery` / `retryDispatchToTarget` / task snapshot) (#573)
- [x] `dispatchRedispatcher` (+ lazy adapter for test literals) injects DispatchService into `DeliveryOutbox`; no `dispatchPayload` export
- [x] `dispatchOutbox` port gains `MoveDeliveryToDeadLetter` for redispatch dead-letter path
- [x] Boundary map residual next = IM subpackages / optional model package move; no package move
- [x] `MessageService` thin first seam: `messageBus` / `messageCache` ports + nil-safe publish (#585)
- [x] Message ownership clarified (send/edit/recall/pin/forward/search/read); no OpenAPI/handler/frontend
- [x] Existing `message_*` tests + short suite green; port no-op unit tests
- [x] Boundary map residual next = Session/Contact ports or IM subpackages / optional model package move

## 6. Suggested follow-up extract order

1. ~~**`RunEventService`**~~ — **DONE #478**
2. ~~**`EdgeCallbackService`**~~ — **DONE #505**
3. ~~**Optional pure outbox helpers**~~ — **DONE #514** (`service/deliveryoutbox`)
4. ~~**Boundary sketch DeliveryOutbox + Redispatcher**~~ — **DONE #528** (docs-only)
5. ~~**Same-package thin type extract `DeliveryOutbox` + `Redispatcher` port**~~ — **DONE #540**
6. ~~**Outbox model ownership residual**~~ — **DONE #551** (private record + repo helpers + `DeliveryOutboxEntry`; full package move deferred)
7. ~~**`DispatchService` thin first seam**~~ — **DONE #563** (typed service + ports + facades; payload private)
8. ~~**Redispatch residual**~~ — **DONE #573** (`redispatchDelivery` / `retryDispatchToTarget` on `DispatchService`; `dispatchPayload` private)
9. ~~**`MessageService` thin first seam**~~ — **DONE #585** (`messageBus` / `messageCache` ports; ownership on existing typed service)
10. **`SessionService` / `ContactService` ports** (mirror #585) — still use concrete `*Bus` / cache types.
11. **IM subpackages** (`service/im` or message/session/contact) — agentteam-style after port hardening.
12. **Optional dedupe:** import `agentevent` helpers from `agentteam` to remove duplicated approval predicates; finish remaining call sites to prefer `agentevent.*` over wrappers.
13. **Optional outbox model package move** — deferred; not required before IM ports.

### 6a. DeliveryOutbox + Redispatcher (#528 sketch → #540 thin type landed)

#### File ownership (current, post-#540)

| Path | Owns | Notes |
|------|------|-------|
| `service/delivery_outbox.go` | status consts, private `deliveryOutboxRecord` + repo helpers, `DeliveryOutboxEntry` view, `redispatchTarget`, `DeliveryOutbox` journal + retry loop, `Redispatcher`, `dispatchRedispatcher` adapter, facades | **#540 thin type + #551 model residual + #573 adapter only** |
| `service/deliveryoutbox/` (~30–40) | pure backoff/TTL/truncate | **DONE #514** — no pure residual left to extract |
| `service/agent_dispatch.go` (~1,1xx) | `DispatchService` + ports, `dispatchPayload`, edge HTTP, trigger/dispatch/cancel/regenerate, **redispatch residual**, facades | **#563 thin first seam + #573 redispatch residual**; package-private DTO retained |
| `service/agent_edge_callback.go` | `edgeCallbackOutbox` port only | auto-ack **only** via `DeliveryOutbox` (**#551** removed `deliveryOutboxAcker`) |
| `service/agent.go` | `AgentService` composition (`runEvents`, `edgeCallbacks`, `deliveryOutbox`, `dispatch`) | `NewDispatchService(..., deliveryOutbox)` then `SetRedispatcher(dispatchRedispatcher{dispatch})` |
| `app/wiring.go` | `AgentService.StartDeliveryRetryLoop(coreCtx)` | retry loop **is** wired (AH-SR-049); facade unchanged |

#### Coupling map (`dispatchPayload` ↔ outbox)

```
DispatchService.dispatchTask (agent_dispatch.go)
  │  builds dispatchPayload, json.Marshal → payload string
  ├─► dispatchOutbox.RecordDelivery(...)   // DeliveryOutbox via port
  ├─► dispatchToEdgeHTTP / WS / offline queue
  └─► dispatchOutbox.MarkDeliverySent(deliveryID)

StartDeliveryRetryLoop → DeliveryOutbox.retryDeliveries
  │  ScanRetryableDeliveries / MarkDeliveryRetrying
  └─► Redispatcher.RedispatchDelivery(opaque payload JSON)  // port
        └─► dispatchRedispatcher → DispatchService.redispatchDelivery
              │  json.Unmarshal → dispatchPayload   // stays PRIVATE
              │  getPendingTaskForRedelivery
              └─► retryDispatchToTarget
                    ├─► dispatchToEdgeHTTP / cache / ws.Manager
                    └─► dispatchOutbox.MoveDeliveryToDeadLetter (on hard failures)

EdgeCallbackService.autoAck
  └─► DeliveryOutbox.autoAckDeliveriesForTask
```

**Coupling split (`dispatchPayload` ↔ outbox):**

| Half | LOC (approx) | Deps | Extractable alone? |
|------|-------------:|------|--------------------|
| Journal (Record/Ack/Scan/Retry/Dead/Stats/Cleanup + model) | ~300 | `*gorm.DB` + pure `deliveryoutbox` | **Yes** |
| Redispatch (`redispatchDelivery` + snapshot + `retryDispatchToTarget`) | ~230 | private `dispatchPayload`, `dispatchToEdgeHTTP`, cache, `ws.Manager` | **Moved to DispatchService in #573** |
| Retry loop orchestration (`StartDeliveryRetryLoop` / `retryDeliveries`) | ~40 | journal + redispatch | Yes once `Redispatcher` exists |

**Hard coupling facts:**

1. `dispatchPayload` is **package-private** in `agent_dispatch.go` and is the only schema redispatch unmarshals. Outbox cannot leave the package without either exporting a DTO or injecting a redispatch port that accepts **opaque JSON bytes** (preferred — avoids exporting the full payload shape).
2. `retryDispatchToTarget` is **not pure outbox** — it reimplements route selection (HTTP unbound / device WS / offline queue / inviter fallback) and touches `mgr`, `cacheClient`, `dispatchToEdgeHTTP`. **#573 moved this half onto `DispatchService`.**
3. Journal half is clean DB-only: `RecordDelivery`, `MarkDeliverySent`, `AckDelivery`, `ScanRetryableDeliveries`, `MarkDeliveryRetrying`, `MoveDeliveryToDeadLetter`, `GetDeliveryStatus`, `CleanupOldDeliveries`, `GetDeliveryStats` (~250–260 LOC methods) + model/hooks (~40 LOC) ≈ **~300 LOC** extractable with only `*gorm.DB` + pure `deliveryoutbox` helpers.
4. Pure residual after #514: **none**. Remaining free functions (`computeNextRetryAt`, `truncateString`) are thin aliases for tests. Status strings (`DeliveryStatus*`) stay domain constants on the orchestration side (or move with the type); not a pure-package extract.
5. `StartDeliveryRetryLoop` **is** wired in `app/wiring.go` (AH-SR-049). Any wiki/note that says the retry loop is “never started” is **stale**.
6. Tests: broad `TestOutbox_*` coverage for journal/scan/dead-letter/auto-ack; **no direct unit test of `redispatchDelivery` / `retryDispatchToTarget`** (integration stops at scan + MarkRetrying + Ack). A type extract that only moves journal is safer than one that also relocates redispatch without a port mock.

#### Decision trail

| Option | Size | Risk | Verdict |
|--------|-----:|------|---------|
| **A. Docs-only sketch** (#528) | S | Lowest | **Landed #528** |
| **B. Thin same-package type extract** (`DeliveryOutbox` + ports; model stays) | M–L | Medium | **Landed #540** |
| **C. Model ownership residual (same-package)** | M | Med | **Landed #551** — private model + DTO/repo helpers; package move deferred |
| **D. DispatchService big-bang package move** | XL | Highest | **Out of scope** |
| **E. DispatchService thin first seam** | M–L | Medium | **Landed #563** — same-package type + ports + facades |

**Landed thin shape (#540):**

```go
type Redispatcher interface {
    RedispatchDelivery(ctx context.Context, taskID, deliveryID, payloadJSON, edgeDeviceID string) error
}

type DeliveryOutbox struct {
    db           *gorm.DB
    redispatcher Redispatcher // nil → scan/mark only; loop no-ops redispatch
}

// dispatchRedispatcher adapts *DispatchService; owns dispatchPayload unmarshal + route.
// NewAgentService: NewDeliveryOutbox(db, nil) → NewDispatchService(..., outbox)
// then SetRedispatcher(dispatchRedispatcher{dispatch})
// Lazy test path uses lazyDispatchRedispatcher{s} to avoid construction recursion.
```

- `deliveryOutboxRecord` remains **unexported** and is only touched by `DeliveryOutbox` journal/repo helpers (**#551**).
- Scan/facade returns `DeliveryOutboxEntry` (no GORM tags); redispatch uses `redispatchTarget`.
- `edgeCallbackOutbox` satisfied only by `DeliveryOutbox.autoAckDeliveriesForTask`; **`deliveryOutboxAcker` removed** (**#551**).
- Facades: `RecordDelivery` / `MarkDeliverySent` / `AckDelivery` / `StartDeliveryRetryLoop` / scan/retry/cleanup/stats remain on `*AgentService`.
- Fake-`Redispatcher` unit tests prove retry loop invokes port without HTTP/WS.

#### Acceptance checklist — docs-only (#528)

- [x] Boundary map next step precise with acceptance sketch (this §6a)
- [x] File ownership table for DeliveryOutbox / dispatch / edge-callback / wiring
- [x] Coupling map for `dispatchPayload` + redispatch
- [x] Thin type extract feasibility documented
- [x] Pure residual: none remaining after #514
- [x] No DispatchService big-bang; no frontend / OpenAPI

#### Acceptance checklist — thin type extract (#540 this PR)

- [x] `type DeliveryOutbox struct` + `NewDeliveryOutbox` in same package (`delivery_outbox.go`)
- [x] Injected `Redispatcher` port; redispatch implementation remains on `AgentService` side
- [x] **No** `deliveryOutboxRecord` move to `model`/`repository`
- [x] **No** export of `dispatchPayload` (opaque JSON on port)
- [x] `AgentService` facades keep `RecordDelivery` / `MarkDeliverySent` / `AckDelivery` / `StartDeliveryRetryLoop` / scan/retry/cleanup/stats signatures
- [x] `edgeCallbackOutbox` still satisfied (`DeliveryOutbox` method; acker retained)
- [x] Existing `TestOutbox_*` green; `go test ./internal/service/ -short` green
- [x] Fake-`Redispatcher` unit test for retry loop
- [x] Boundary map status → thin type landed; next residual was model ownership (**#551**) then **DispatchService** (**#563** landed)

#### Acceptance checklist — model ownership residual (#551 this PR)

- [x] `deliveryOutboxRecord` fully owned by `DeliveryOutbox` (private GORM model + hooks)
- [x] Private repository helpers: `outboxModel` / `findOutboxByDeliveryID` / `updateOutboxByDeliveryID`
- [x] Scan/facade returns `DeliveryOutboxEntry` (no GORM tags) — AgentService does not leak record type
- [x] Redispatch path uses `redispatchTarget` (not GORM row)
- [x] `deliveryOutboxAcker` removed; edge callback only uses `DeliveryOutbox` for auto-ack
- [x] Existing `TestOutbox_*` + `go test ./internal/service/ -short` green
- [x] **No** full `model/`/`repository/` package move; **no** OpenAPI/handler/frontend
- [x] Boundary map next seam after #551 was **`DispatchService`** → **#563 thin first seam landed**

#### Acceptance checklist — DispatchService thin first seam (#563 this PR)

- [x] `type DispatchService struct` + `NewDispatchService` in same package (`agent_dispatch.go`)
- [x] Injected ports: `dispatchBus`, `dispatchOutbox`, plus cache/relay/`*ws.Manager`
- [x] Methods moved: `TriggerAgentTask`, `dispatchTask`, `dispatchToEdgeHTTP`, history/pins, capability, cancel/regenerate
- [x] **No** export of `dispatchPayload`; redispatch remains on `AgentService`
- [x] Redispatch HTTP path reuses `s.dispatchService().dispatchToEdgeHTTP`
- [x] `AgentService` facades keep `TriggerAgentTask` / `CancelTask` / `RegenerateAgentTask` signatures
- [x] Existing dispatch + outbox tests green; `go test ./internal/service/ -short` green
- [x] Boundary map residual next = redispatch ownership / deeper ports; no package move

#### Acceptance checklist — redispatch residual (#573 this PR)

- [x] `redispatchDelivery` / `getPendingTaskForRedelivery` / `retryDispatchToTarget` / `pendingTaskSnapshot` on `DispatchService`
- [x] `dispatchRedispatcher` (+ `lazyDispatchRedispatcher` for test literals) implements `Redispatcher`
- [x] `dispatchOutbox` includes `MoveDeliveryToDeadLetter` for redispatch hard failures
- [x] **No** export of `dispatchPayload`; **no** OpenAPI/handler/frontend; **no** package move
- [x] Existing `TestOutbox_*` + `go test ./internal/service/ -short` green
- [x] Boundary map residual next = IM subpackages / optional model package move

#### Optional later — full package move (not blocking redispatch residual)

- [ ] `deliveryOutboxRecord` → `model` + repository accessors (if package boundaries demand it)
- [ ] Pure `deliveryoutbox` helpers unchanged
- [ ] Existing `TestOutbox_*` green after package move

### 6b. MessageService thin first seam (#585)

#### File ownership (current, post-#585)

| Path | Owns | Notes |
|------|------|-------|
| `service/message.go` (~900) | `MessageService` + `messageBus` / `messageCache` ports; send/edit/recall/pin/forward/search/read; content normalize helpers | **#585 thin first seam** — methods already on typed service; ports hardened |
| `service/message_test.go` / `message_edit_test.go` | send/edit/pin/forward/search coverage + port no-op tests | Handler interface tests remain in `handler/` |
| `handler/message.go` | thin handler interface over `MessageService` methods | **Unchanged** |
| `app/wiring.go` | `NewMessageService(db, bus, cache)` | Signature still accepts `*Bus` / `*cache.Client` via ports |

#### Landed thin shape (#585)

```go
type messageBus interface {
    Publish(ctx context.Context, event Event)
}

type messageCache interface {
    AllocateSeq(ctx context.Context, sessionID string) (int64, error)
}

type MessageService struct {
    db          *gorm.DB
    bus         messageBus
    cacheClient messageCache
}

// NewMessageService(db, bus, cacheClient)
// SetBus / SetCache for tests; publish() nil-safe
```

- Methods stay on `*MessageService` (already extracted historically; #585 is port ownership, not method relocation from `AgentService`).
- No package move; no OpenAPI / handler / frontend changes.
- Content normalize helpers remain package-private pure functions in `message.go`.

#### Acceptance checklist — MessageService thin first seam (#585 this PR)

- [x] `messageBus` / `messageCache` ports on `MessageService` (same package)
- [x] Nil-safe `publish`; `SetBus` / `SetCache` injectors
- [x] Ownership docs: send/edit/recall/pin/forward/search/read
- [x] **No** package move; **no** OpenAPI/handler/frontend
- [x] Existing message tests green; port unit tests added
- [x] Boundary map residual next = Session/Contact ports or IM subpackages

### Follow-up issue ready

| Field | Value |
|-------|-------|
| Suggested title | `[P19.x] Hub Session/Contact ports (mirror MessageService) then IM subpackages` |
| Depends on | #585 MessageService thin first seam |
| Scope | Port-harden `SessionService` / `ContactService` (bus/cache interfaces), then optional agentteam-style `service/im` subpackages and/or optional `deliveryOutboxRecord` model/repository move |
| Non-goals | Big-bang package move of all IM; OpenAPI/frontend redesign |
| Primary files | `session.go` / `contact.go` / `message_reaction.go` or outbox model helpers |
| Risk note | Message ports closed; session/contact still concrete `*Bus`; IM independent of runtime |

## 7. Bottom line

- **Map:** six domains in flat package; **agent_runtime + im_messaging** dominate; **agentteam** is the extract template; **`agentevent`** + **`deliveryoutbox`** are pure seams; **`RunEventService`**, **`EdgeCallbackService`**, **`DeliveryOutbox`**, **`DispatchService`**, and **`MessageService`** are orchestration type extracts (message was pre-typed; #585 ports).
- **Highest remaining coupling:** package flatness + `AgentService` facade/custom-agent surface; Session/Contact still concrete bus; runtime redispatch residual **closed** on `DispatchService`.
- **Landed:** pure **`agentevent`** (#468) + **`RunEventService`** (#478) + **`EdgeCallbackService`** (#505) + pure **`deliveryoutbox`** (#514) + **#528 docs sketch** + **#540 thin `DeliveryOutbox` + opaque `Redispatcher`** + **#551 model residual** + **#563 thin `DispatchService` first seam** + **#573 redispatch residual** + **#585 MessageService thin first seam**.
- **Pure residual:** **closed**.
- **#540 decision:** thin same-package extract **landed**. Redispatch initially stayed on `AgentService` behind port; no DispatchService big-bang.
- **#551 decision:** model ownership residual **landed** (option A). Private GORM record + repo helpers on `DeliveryOutbox`; `DeliveryOutboxEntry` scan view; redispatch `redispatchTarget`; edge-callback acker removed. Full package move deferred.
- **#563 decision:** thin same-package `DispatchService` **landed**. Trigger/dispatch/cancel/regenerate + edge HTTP/capability/history moved; facades preserve handlers; `dispatchPayload` stays private.
- **#573 decision:** redispatch residual **landed** on `DispatchService`. `dispatchRedispatcher` injects DispatchService into `DeliveryOutbox`; lazy adapter avoids test-literal construction recursion; payload remains private.
- **#585 decision:** MessageService thin first seam **landed**. Ports `messageBus` / `messageCache` + nil-safe publish; methods already on typed service; no package move.
- **Next code step:** **Session/Contact ports** (mirror #585), then **IM subpackages** and/or **optional outbox model package move**.

## Key paths

- `hub-server/internal/service/`
- `hub-server/internal/service/agentevent/`
- `hub-server/internal/service/deliveryoutbox/`
- `hub-server/internal/service/agentteam/`
- `hub-server/internal/service/agent_run_event.go` (`RunEventService`)
- `hub-server/internal/service/agent_edge_callback.go` (`EdgeCallbackService`)
- `hub-server/internal/service/delivery_outbox.go` (`DeliveryOutbox` + private model ownership + Redispatcher adapter)
- `hub-server/internal/service/agent_dispatch.go` (`DispatchService` + redispatch residual + facades; private `dispatchPayload`)
- `hub-server/internal/service/message.go` (`MessageService` + `messageBus` / `messageCache` ports)
- `hub-server/internal/app/wiring.go` (`StartDeliveryRetryLoop`, `NewMessageService`)
- `docs/analysis/cleanup-strategy.md`
