# Hub `internal/service` Boundary Map

> last-updated: 2026-07-17
> issue: #528 (DeliveryOutbox + Redispatcher boundary sketch; prior #514 / #505 / #493 / #478 / #468)
> status: map current — pure helpers closed; **#528 docs-only** DeliveryOutbox/Redispatcher sketch + thin-type feasibility (no code extract this PR)
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
| Same-package type extract `DeliveryOutbox` | **not landed** | existing `TestOutbox_*` | still on `*AgentService` | blocked by `dispatchPayload` redispatch glue; sketch in §6a (#528) |

**Shape note:** not one god struct — **25+ `*Service` types** already exist
(including `RunEventService`, `EdgeCallbackService`). Concentration remains
**package flatness + `AgentService` method sprawl** (~3.2k LOC across
agent/dispatch/outbox/run-event facade/callback facade). Outbox journal +
retry redispatch remain methods on `*AgentService` in `delivery_outbox.go`
(~592 LOC), not a composed type yet.

Precedent: `service/agentteam` uses **local interfaces**
(`agentTeamAgentSvc`, `agentTeamCache`, `agentTeamControlSvc`) + `*service.Bus`.
`RunEventService` follows the same port pattern with `runEventControl`.
`EdgeCallbackService` injects `edgeCallbackBus` / `edgeCallbackSeq` /
`edgeCallbackOutbox`. DeliveryOutbox (when extracted) should inject a
`Redispatcher` port rather than importing dispatch HTTP/WS guts.

## 1. File inventory by domain

| Domain | Prod LOC | Files (prod) | Role |
|--------|---------:|--------------|------|
| **agent_runtime** | ~2,9xx | `agent.go`, `agent_custom.go`, `agent_dispatch.go` (819), `agent_run_event.go` (`RunEventService` + facade), `agent_edge_callback.go` (`EdgeCallbackService` + facade), `delivery_outbox.go` (592), `agent_control.go`, `agent_team_helpers.go` (compat wrappers), `relay.go` | Task dispatch, edge callback, outbox retry, run-event projection |
| **im_messaging** | ~3,111 | `message.go` (860), `session.go` (728), `contact.go`, `attachment.go`, `message_reaction.go`, `workspace.go`, `notification.go`, `image_meta.go`, `s3_client.go` | IM/session/contact/attachments |
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
| `agent_dispatch.go` | 819 | `TriggerAgentTask`, `dispatchTask`, edge HTTP, capability, history/pins | outbox `RecordDelivery`/`MarkDeliverySent`; private `dispatchPayload`; cache/ws/relay |
| `delivery_outbox.go` | ~592 | `deliveryOutboxRecord` model + journal + retry loop | pure helpers → `deliveryoutbox` (#514); still **same-package** `dispatchPayload` + `dispatchToEdgeHTTP` + cache/ws in redispatch; `deliveryOutboxAcker` used by EdgeCallback; app wires `StartDeliveryRetryLoop` |
| `message.go` | 860 | send/edit/pin/forward/search | `Bus`, cache seq, attachments |
| `session.go` | 728 | private/group lifecycle | cache, bus, agent cleanup helpers |
| `agent_edge_callback.go` | ~513 | `EdgeCallbackService` + `AgentService` facade | repo; `agentevent` normalize/validate; injected bus/seq/outbox (**#505 done**) |
| `agent_run_event.go` | 237 | `RunEventService` + `AgentService` facade | repo; `agentevent` project; injected `runEventControl` (**#478 done**) |

### Consumers outside package

- **Wiring:** `hub-server/internal/app/{wiring,app,background,events}.go`
- **Handlers:** per-domain interfaces already in `handler/*` (good extract seam)
- **Subpkg:** `agentteam` → `service.Bus` + agent/control interfaces
- **Subpkg:** `agentevent` → pure helpers used by `RunEventService` + `EdgeCallbackService`
- **Subpkg:** `deliveryoutbox` → pure backoff/truncate helpers used by `delivery_outbox.go`
- **Composition:** `AgentService` holds `runEvents *RunEventService` and
  `edgeCallbacks *EdgeCallbackService` (set in `NewAgentService`); facade
  methods keep handler signatures stable. No `deliveryOutbox` field yet —
  outbox methods still live directly on `*AgentService` (#528 sketch for next)

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
| **6b** | **Pure outbox helpers only** (`NextRetryDelay`/`TruncateString` + retry constants in `service/deliveryoutbox`) | Low | Low–med | **DONE in #514** |
| **6c** | **Same-package `DeliveryOutbox` type + `Redispatcher` port** (no model move) | Med–high | High | **Sketch only #528** — journal half is clean; redispatch half needs port first |
| 7 | Full outbox model/repository move + `DeliveryOutbox` | **High** | High | After 6c ports stabilize; still no DispatchService big-bang |
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

## 6. Suggested follow-up extract order

1. ~~**`RunEventService`**~~ — **DONE #478**
2. ~~**`EdgeCallbackService`**~~ — **DONE #505**
3. ~~**Optional pure outbox helpers**~~ — **DONE #514** (`service/deliveryoutbox`)
4. ~~**Boundary sketch DeliveryOutbox + Redispatcher**~~ — **DONE #528** (docs-only; this section)
5. **Same-package thin type extract `DeliveryOutbox` + `Redispatcher` port** — next code PR (optional if sized small enough; see §6a feasibility)
6. **Outbox model/repository move** — `deliveryOutboxRecord` → `model`/`repository` after ports stabilize
7. **`DispatchService`** — **last** among runtime; owns `dispatchPayload` + capability. **No big-bang.**
8. **IM subpackages** (`service/im` or message/session/contact) — agentteam-style, lower urgency than runtime.
9. **Optional dedupe:** import `agentevent` helpers from `agentteam` to remove duplicated approval predicates; finish remaining call sites to prefer `agentevent.*` over wrappers.

### 6a. #528 feasibility: DeliveryOutbox + Redispatcher (docs sketch vs thin type extract)

#### File ownership (current)

| Path | Owns | Notes |
|------|------|-------|
| `service/delivery_outbox.go` (~592) | status consts, `deliveryOutboxRecord`, journal methods on `*AgentService`, retry loop, redispatch glue | **single ownership file** for outbox orchestration |
| `service/deliveryoutbox/` (~30–40) | pure backoff/TTL/truncate | **DONE #514** — no pure residual left to extract |
| `service/agent_dispatch.go` (~819) | `dispatchPayload`, `dispatchToEdgeHTTP`, `dispatchTask`, `RecordDelivery`/`MarkDeliverySent` call sites | package-private DTO + HTTP path; **not moved** |
| `service/agent_edge_callback.go` | `edgeCallbackOutbox` + `deliveryOutboxAcker` | narrow auto-ack port over same outbox table |
| `service/agent.go` | `AgentService` composition (`runEvents`, `edgeCallbacks`) | no `deliveryOutbox` field yet |
| `app/wiring.go` | `AgentService.StartDeliveryRetryLoop(coreCtx)` | retry loop **is** wired (AH-SR-049) |

#### Coupling map (`dispatchPayload` ↔ outbox)

```
dispatchTask (agent_dispatch.go)
  │  builds dispatchPayload, json.Marshal → payload string
  ├─► RecordDelivery(taskID, payload, edgeDeviceID)   // delivery_outbox.go
  ├─► dispatchToEdgeHTTP / WS / offline queue
  └─► MarkDeliverySent(deliveryID)

StartDeliveryRetryLoop → retryDeliveries (delivery_outbox.go)
  │  ScanRetryableDeliveries / MarkDeliveryRetrying
  └─► redispatchDelivery
        │  json.Unmarshal → dispatchPayload   // PRIVATE type in agent_dispatch.go
        │  getPendingTaskForRedelivery (pending_agent_tasks snapshot)
        └─► retryDispatchToTarget
              ├─► dispatchToEdgeHTTP(ctx, minimalTask, &dp)  // AgentService method
              ├─► cache GetRouteForDevice / PushPendingTask
              └─► ws.Manager PushToConn (TypeAgentDispatch)

EdgeCallbackService.autoAck
  └─► deliveryOutboxAcker.autoAckDeliveriesForTask  // writes delivery_outbox rows
```

**Coupling split (`dispatchPayload` ↔ outbox):**

| Half | LOC (approx) | Deps | Extractable alone? |
|------|-------------:|------|--------------------|
| Journal (Record/Ack/Scan/Retry/Dead/Stats/Cleanup + model) | ~300 | `*gorm.DB` + pure `deliveryoutbox` | **Yes** |
| Redispatch (`redispatchDelivery` + snapshot + `retryDispatchToTarget`) | ~230 | private `dispatchPayload`, `dispatchToEdgeHTTP`, cache, `ws.Manager` | **No** without port |
| Retry loop orchestration (`StartDeliveryRetryLoop` / `retryDeliveries`) | ~40 | journal + redispatch | Yes once `Redispatcher` exists |

**Hard coupling facts:**

1. `dispatchPayload` is **package-private** in `agent_dispatch.go` and is the only schema redispatch unmarshals. Outbox cannot leave the package without either exporting a DTO or injecting a redispatch port that accepts **opaque JSON bytes** (preferred — avoids exporting the full payload shape).
2. `retryDispatchToTarget` is **not pure outbox** — it reimplements route selection (HTTP unbound / device WS / offline queue / inviter fallback) and touches `s.mgr`, `s.cacheClient`, `dispatchToEdgeHTTP`. That is ~half of `delivery_outbox.go` (~230 LOC redispatch path).
3. Journal half is clean DB-only: `RecordDelivery`, `MarkDeliverySent`, `AckDelivery`, `ScanRetryableDeliveries`, `MarkDeliveryRetrying`, `MoveDeliveryToDeadLetter`, `GetDeliveryStatus`, `CleanupOldDeliveries`, `GetDeliveryStats` (~250–260 LOC methods) + model/hooks (~40 LOC) ≈ **~300 LOC** extractable with only `*gorm.DB` + pure `deliveryoutbox` helpers.
4. Pure residual after #514: **none**. Remaining free functions (`computeNextRetryAt`, `truncateString`) are thin aliases for tests. Status strings (`DeliveryStatus*`) stay domain constants on the orchestration side (or move with the type); not a pure-package extract.
5. `StartDeliveryRetryLoop` **is** wired in `app/wiring.go` (AH-SR-049). Any wiki/note that says the retry loop is “never started” is **stale**.
6. Tests: broad `TestOutbox_*` coverage for journal/scan/dead-letter/auto-ack; **no direct unit test of `redispatchDelivery` / `retryDispatchToTarget`** (integration stops at scan + MarkRetrying + Ack). A type extract that only moves journal is safer than one that also relocates redispatch without a port mock.

#### Feasibility decision (this PR / #528)

| Option | Size | Risk | Verdict for #528 |
|--------|-----:|------|------------------|
| **A. Docs-only sketch** (this section) | S | Lowest | **Chosen** — precise acceptance + ownership; no runtime churn |
| **B. Thin same-package type extract** (`DeliveryOutbox` + ports; model stays) | M–L | Medium | **Feasible as follow-up code PR**, not free in one small PR if redispatch stays attached |
| **C. Full model/repository move + type** | L | High | **Defer** until B ports land |
| **D. DispatchService big-bang** | XL | Highest | **Out of scope** |

**Why not B in the same PR as this sketch:**

- Mirror of `#478`/`#505` would be: `type DeliveryOutbox struct { db; redispatcher Redispatcher }` + `AgentService` facade + lazy constructor.
- Journal-only move is mechanical (~260 LOC methods + model stay in same package file or split file). Safe.
- Retry loop **must** either (1) keep redispatch methods on `*AgentService` and call them via a port, or (2) move redispatch into `DeliveryOutbox` with injected deps (`agentCache`, `*ws.Manager`, HTTP dispatcher). Option (2) is a **de facto mini-Dispatch extract** and exceeds “thin type extract only with ports (no model move)” unless the port is deliberately opaque.
- Recommended thin shape for a later PR (still same package, no model move):

```go
// Opaque redispatch: outbox never imports dispatchPayload.
type Redispatcher interface {
    // RedispatchDelivery re-sends a stored outbox payload for taskID/deliveryID.
    // Implementer owns unmarshal + route (HTTP/WS/offline).
    RedispatchDelivery(ctx context.Context, taskID, deliveryID, payloadJSON, edgeDeviceID string) error
}

type DeliveryOutbox struct {
    db           *gorm.DB
    redispatcher Redispatcher // nil → scan/mark only; loop no-ops redispatch
}

// AgentService implements Redispatcher by wrapping redispatchDelivery/retryDispatchToTarget.
// OR a small adapter type holds *AgentService / dispatch deps.
```

- Keep `deliveryOutboxRecord` **unexported in service** until model move (same as today).
- Rebind `edgeCallbackOutbox` implementer: either keep `deliveryOutboxAcker{db}` or add `DeliveryOutbox.autoAckDeliveriesForTask` and inject that.
- `NewAgentService` gains `s.deliveryOutbox = NewDeliveryOutbox(db, agentRedispatcher{s})` (or set redispatcher after construct to avoid init cycles).
- Facade: `RecordDelivery` / `MarkDeliverySent` / `AckDelivery` / `StartDeliveryRetryLoop` / … remain on `*AgentService` for dispatch call sites and `app/wiring.go`.

**Sizing estimate for follow-up code PR (option B):**

| Slice | LOC | Port needed? |
|-------|----:|--------------|
| Model + status consts (stay same package) | ~70 | no |
| Journal methods → `DeliveryOutbox` | ~250–260 | no |
| Retry loop orchestration (`Start`/`retryDeliveries`) | ~40 | calls `Redispatcher` |
| `redispatchDelivery` + task snapshot + `retryDispatchToTarget` | ~230 | **stay on AgentService as Redispatcher impl** (preferred) or inject cache/ws/http |
| Facade + `NewAgentService` wiring | ~40–60 | — |
| Test updates (`*AgentService` → facade still works) | mostly zero if facades kept | add fake `Redispatcher` tests optional |

**Pure residual close:** closed in #514; #528 confirms **no further pure extract** before orchestration type work.

#### Acceptance checklist — docs-only (#528 this PR)

- [x] Boundary map next step precise with acceptance sketch (this §6a)
- [x] File ownership table for DeliveryOutbox / dispatch / edge-callback / wiring
- [x] Coupling map for `dispatchPayload` + redispatch
- [x] Thin type extract feasibility documented; **code extract deferred**
- [x] Pure residual: none remaining after #514
- [x] No DispatchService big-bang; no frontend / OpenAPI

#### Acceptance checklist — follow-up code PR (thin type extract only)

- [ ] `type DeliveryOutbox struct` + `NewDeliveryOutbox` in same package (likely still `delivery_outbox.go` or split file)
- [ ] Injected `Redispatcher` port; redispatch implementation remains on dispatch/`AgentService` side
- [ ] **No** `deliveryOutboxRecord` move to `model`/`repository` in that PR
- [ ] **No** export of `dispatchPayload` required (opaque JSON on port)
- [ ] `AgentService` facades keep `RecordDelivery` / `MarkDeliverySent` / `AckDelivery` / `StartDeliveryRetryLoop` / scan/retry/cleanup/stats signatures
- [ ] `edgeCallbackOutbox` still satisfied (`deliveryOutboxAcker` or `DeliveryOutbox` method)
- [ ] Existing `TestOutbox_*` green; `go test ./internal/service/ -short` green
- [ ] Optional: unit test with fake `Redispatcher` proving retry loop invokes port without HTTP/WS
- [ ] Boundary map status → thin type landed; next = model move **or** DispatchService last

#### Acceptance checklist — later full outbox (model move)

- [ ] `deliveryOutboxRecord` → `model` + repository accessors
- [ ] `DeliveryOutbox` uses repository; pure `deliveryoutbox` helpers unchanged
- [ ] Reuse `#505` outbox auto-ack port shape
- [ ] Existing `TestOutbox_*` green after model move
- [ ] Next extract pointer: **`DispatchService` last** among runtime (or IM)

### Follow-up issue ready

| Field | Value |
|-------|-------|
| Suggested title | `[P14.x] Hub DeliveryOutbox same-package type + Redispatcher port` |
| Depends on | #528 sketch (this), #514 pure helpers |
| Scope | Option B only: type + port + facades; no model move; no DispatchService |
| Non-goals | model/repository move; exporting `dispatchPayload`; OpenAPI/frontend; starting new background semantics beyond existing wiring |
| Primary files | `delivery_outbox.go`, `agent.go`, `agent_edge_callback.go` (rebind only if needed), `delivery_outbox_test.go` |
| Risk note | Keep redispatch implementation on `AgentService` behind `Redispatcher`; do not drag `dispatchToEdgeHTTP` into outbox type |

## 7. Bottom line

- **Map:** six domains in flat package; **agent_runtime + im_messaging** dominate; **agentteam** is the extract template; **`agentevent`** + **`deliveryoutbox`** are pure seams; **`RunEventService`** and **`EdgeCallbackService`** are the first orchestration type extracts.
- **Highest remaining coupling:** `AgentService` × (`dispatch` ↔ `outbox` via `dispatchPayload` + `retryDispatchToTarget`).
- **Landed:** pure **`agentevent`** (#468) + **`RunEventService` + injected control** (#478) + **`EdgeCallbackService` + injected bus/seq/outbox** (#505) + pure **`deliveryoutbox`** (#514) + **#528 docs sketch** (DeliveryOutbox/Redispatcher feasibility).
- **Pure residual:** **closed** — no more pure helpers to lift before orchestration work.
- **#528 decision:** **docs-only deliverable**. Thin same-package `DeliveryOutbox` + opaque `Redispatcher` is **feasible as the next code PR** if redispatch stays on the dispatch/`AgentService` side; full model move and DispatchService remain later. **Not** DispatchService big-bang.
- **Next code step:** thin `DeliveryOutbox` type extract + `Redispatcher` port (follow-up issue table above) — or, if capacity prefers lower risk still, model-move-only after that port exists.

## Key paths

- `hub-server/internal/service/`
- `hub-server/internal/service/agentevent/`
- `hub-server/internal/service/deliveryoutbox/`
- `hub-server/internal/service/agentteam/`
- `hub-server/internal/service/agent_run_event.go` (`RunEventService`)
- `hub-server/internal/service/agent_edge_callback.go` (`EdgeCallbackService`)
- `hub-server/internal/service/delivery_outbox.go` (journal + redispatch remaining; next thin `DeliveryOutbox`/`Redispatcher`)
- `hub-server/internal/service/agent_dispatch.go` (`dispatchPayload`, `dispatchToEdgeHTTP`)
- `hub-server/internal/app/wiring.go` (`StartDeliveryRetryLoop`)
- `docs/analysis/cleanup-strategy.md`
