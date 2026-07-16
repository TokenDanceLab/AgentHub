# Hub `internal/service` Boundary Map

> last-updated: 2026-07-17
> issue: #468
> status: map + first pure extract landed (`service/agentevent`)
> companion: `cleanup-strategy.md` Phase 4 Hub · precedent `service/agentteam` (ADR-014)

This document is the authoritative **read-only boundary map** for
`hub-server/internal/service`. It records package shape, coupling risks,
ranked extract candidates, and the first low-risk pure extract executed with
this issue.

## 0. Snapshot totals

| Surface | Prod LOC | Test LOC | Files | Notes |
|---|---:|---:|---:|---|
| Flat `service` package | ~9,066 | ~10,816 | 56 `.go` | 32 prod + 24 test |
| Already-extracted `service/agentteam` | ~3,012 | ~3,259 | 13 | Template for later domain extracts |
| **First extract (this PR)** `service/agentevent` | ~560 pure | unit tests | pure helpers | no DB/WS/cache/`*AgentService` |

**Shape note:** not one god struct — **23 `*Service` types** already exist.
Concentration is **package flatness + `AgentService` method sprawl**
(~3.3k LOC across agent/dispatch/outbox/run-event/callback).

Precedent: `service/agentteam` uses **local interfaces**
(`agentTeamAgentSvc`, `agentTeamCache`, `agentTeamControlSvc`) + `*service.Bus`.

## 1. File inventory by domain

| Domain | Prod LOC | Files (prod) | Role |
|--------|---------:|--------------|------|
| **agent_runtime** | ~2,984 | `agent.go`, `agent_custom.go`, `agent_dispatch.go` (819), `agent_run_event.go` (orchestration only after extract), `agent_edge_callback.go` (391), `delivery_outbox.go` (599), `agent_control.go`, `agent_team_helpers.go` (compat wrappers), `relay.go` | Task dispatch, edge callback, outbox retry, run-event projection |
| **im_messaging** | ~3,111 | `message.go` (860), `session.go` (728), `contact.go`, `attachment.go`, `message_reaction.go`, `workspace.go`, `notification.go`, `image_meta.go`, `s3_client.go` | IM/session/contact/attachments |
| **agent_catalog** | ~1,133 | `agent_profile.go`, `document.go`, `skill.go`, `mcp_server.go`, `provider_binding.go` | Profiles/docs/market installables |
| **identity_auth** | ~829 | `auth.go`, `oidc.go`, `device.go`, `user_settings.go` | Login/OIDC/device/settings |
| **execution_target** | ~516 | `execution_target.go` | Local-edge targets + health |
| **infra_shared** | ~493 | `eventbus.go`, `cache_fallback.go`, `audit.go`, `public_stats.go` | Bus, nil-cache guards, audit, public stats |
| **agentteam/** (subpkg) | ~3,012 | CRUD/member/run/routing/approval/guard/compete | **Already extracted** team domain |
| **agentevent/** (subpkg) | ~560 | pure project/validate/helpers | **Extracted in #468** |

### Named hotspots

| File | LOC | Owns | Couples to |
|------|----:|------|------------|
| `agent_dispatch.go` | 819 | `TriggerAgentTask`, `dispatchTask`, edge HTTP, capability, history/pins | outbox `RecordDelivery`/`MarkDeliverySent`; private `dispatchPayload`; cache/ws/relay |
| `delivery_outbox.go` | 599 | `deliveryOutboxRecord` model + retry loop | **same-package** `dispatchPayload` + `dispatchToEdgeHTTP`; `agent_edge_callback` auto-ack |
| `message.go` | 860 | send/edit/pin/forward/search | `Bus`, cache seq, attachments |
| `session.go` | 728 | private/group lifecycle | cache, bus, agent cleanup helpers |
| `agent_run_event.go` | ~177 (was 694) | list/summary/approvals/artifacts orchestration | repo; **pure projection moved to `agentevent`**; inline `AgentControlService` on decide |

### Consumers outside package

- **Wiring:** `hub-server/internal/app/{wiring,app,background,events}.go`
- **Handlers:** per-domain interfaces already in `handler/*` (good extract seam)
- **Subpkg:** `agentteam` → `service.Bus` + agent/control interfaces
- **Subpkg:** `agentevent` → pure helpers used by `AgentService` methods

## 2. Coupling risks

1. **`*AgentService` is the real god receiver** — dispatch + outbox + edge callback + run events + custom agents share one struct (`db`, `bus`, `mgr`, `cacheClient`, `relay`).
2. **`dispatchPayload` is package-private glue** between `agent_dispatch.go` and `delivery_outbox.go` (retry re-unmarshals payload and calls `dispatchToEdgeHTTP`). **Cannot extract either alone without exporting a DTO + redispatch port.**
3. **Outbox row type lives in service** (`deliveryOutboxRecord`) by design comment — schema coupled to service package; cleanup-strategy wants model/repository later.
4. **Run-event pure helpers were shared** — normalize/validate used by `agent_edge_callback.go`; project/summarize used by list/decide APIs. **Moved to `agentevent` in #468.**
5. **`DecideTaskApproval` hidden control coupling** — type-asserts `cacheClient` to `agentControlCache` and constructs `AgentControlService` inline (not injected).
6. **`agent_team_helpers.go` overlaps agentteam** — approval ID/decision predicates still duplicated in subpkg (drift risk). Flat package now wraps `agentevent`; agentteam still has local copies.
7. **`service.Bus` is a parent-package dependency** for agentteam — bus cannot move with a domain without an `events` subpackage or interface.
8. **IM vs agent_runtime** — mostly independent at service layer; coupling is app/handler orchestration + session agent cleanup, not deep import cycles.
9. **Trivial “extracts” (image_meta / public_stats / eventbus alone)** shrink LOC almost nothing vs concentration problem.
10. **Handler interfaces already thin the edge** — package extract without service-side ports still leaves fat concrete type for tests/wiring.

Cleanup strategy alignment (`docs/analysis/cleanup-strategy.md` Phase 4 Hub):
`DispatchService` / `RunEventService` / `EdgeCallbackService` → then delivery model to model/repository → then im/catalog agentteam-style subpackages.
**“先接口后搬家；一次一个 seam.”**

## 3. Extract candidates ranked (lowest risk first)

| Rank | Candidate | Risk | Value | Status |
|-----:|-----------|------|------:|--------|
| **1** | **Pure run-event projection/validation package** (`service/agentevent`) | **Lowest** | High seam | **DONE in #468** |
| 2 | Same-package **interface boundary only** (export `RunEventProjector` / ports; methods stay) | Very low | Medium | Optional doc-only next |
| 3 | Mechanical move of already-standalone small services (`public_stats`, `user_settings`) | Low | Low | LOC theater — defer |
| 4 | `MessageReactionService` / `WorkspaceService` subpkg | Low–med | Medium | Independent but not concentration core |
| 5 | `RunEventService` type split (methods + inject control) | Medium | High | Landed in #478 (type extract + injected control) |
| 6 | `DeliveryOutbox` service + repository model | **High** | High | Tied to `dispatchPayload` + redispatch |
| 7 | Full `DispatchService` extract | **Highest** | Highest | Last among runtime |

## 4. Recommended one extract (executed)

### Choice: `hub-server/internal/service/agentevent`

**Moved (from `agent_run_event.go` + helpers, unexported → exported):**

- Projection: `SummarizeAgentRunEvents`, `ProjectTaskApprovals`, `ProjectTaskArtifacts`, `FindTaskApproval`, `TaskApprovalEdgeControl`, artifact path/capability helpers, token/output parsers
- Ingress validation: `NormalizeRunEventInput`, `ValidateAgentCallbackPayloadSize`, `ValidateAgentCallbackEdgeRunID`, `ValidateRunEventType`, `InferRunEventType`
- Shared pure helpers: approval decision/status, `ApprovalIDFor`, first-non-empty / JSON string helpers

**Kept on `*AgentService`:**

- `ListTaskRunEvents`, `GetTaskRunEventSummary`, `ListTaskApprovals`, `DecideTaskApproval`, `ListTaskArtifacts`, `taskRunEventsForOwner`
- All of `agent_dispatch` / `delivery_outbox` / `agent_edge_callback` orchestration

**Call-site updates:**

- `agent_run_event.go` → `agentevent.Project…` / `Summarize…` / `Valid…`
- `agent_edge_callback.go` → `agentevent.Normalize…` / `Validate…` / `FirstNonEmpty`
- `agent_team_helpers.go` → thin compatibility wrappers for remaining same-package tests/call sites
- **No** `app/wiring.go` change; handler interfaces unchanged

**Explicit non-goals (honored)**

- Did not move outbox model
- Did not split `dispatchPayload`
- Did not rewire agentteam

## 5. Test plan & evidence

### Pure package

```bash
cd hub-server
go test ./internal/service/agentevent/ -count=1
```

Covers: validate/infer/normalize, summary aggregation, approval pending vs decided, artifact projection, capability fail-closed.

### Regression

```bash
go test ./internal/service/ -run 'Test(ListTask|GetTaskRun|DecideTask|HandleTask|ListTaskApprovals|ListTaskArtifacts|ValidateRunEvent|InferRunEvent|FirstNonEmpty|FirstRuntime|ValidateAgentCallback)' -count=1
go test ./internal/service/agentteam/ -count=1 -short
go test ./internal/service/ -count=1 -timeout 120s
```

### Acceptance

- [x] Flat `service` prod concentration reduced by moving pure helpers out of `agent_run_event.go` (~694 → ~177 orchestration lines)
- [x] `agentevent` has **no** `*gorm.DB` / `*AgentService` / ws / cache imports
- [x] Prior run-event / callback tests remain package-compatible via wrappers
- [x] Pure package has direct unit tests for normalize + project paths
- [x] Follow-up extract order documented below

## 6. Suggested follow-up extract order

1. **`RunEventService`** — move list/summary/approvals/artifacts methods; inject control delivery interface (fix inline construct in `DecideTaskApproval`).
2. **`EdgeCallbackService`** — ack/stream/done/fail; depends on `agentevent` normalize + task transitions.
3. **Outbox:** `deliveryOutboxRecord` → `model`/`repository`; `DeliveryOutbox` with `Redispatcher` interface implemented by dispatch.
4. **`DispatchService`** — last among runtime; owns `dispatchPayload` + capability.
5. **IM subpackages** (`service/im` or message/session/contact) — agentteam-style, lower urgency than runtime.
6. **Optional dedupe:** import `agentevent` helpers from `agentteam` to remove duplicated approval predicates.

### Follow-up issue acceptance sketch: `RunEventService`

- New type owns `ListTaskRunEvents` / summary / approvals / artifacts / decide
- Inject `agentControl` port; no inline `AgentControlService{...}` construct
- `AgentService` either embeds/composes or becomes a facade for wiring stability
- Tests: existing `agent_run_event_test.go` green; no OpenAPI/handler change required if facade kept

## 7. Bottom line

- **Map:** six domains in flat package; **agent_runtime + im_messaging** dominate; **agentteam is the extract template**; **`agentevent` is the first pure seam**.
- **Highest remaining coupling:** `AgentService` × (`dispatch` ↔ `outbox` via `dispatchPayload`) × (run-event orchestration ↔ edge callback ↔ inline control).
- **Lowest-risk first extract (done):** pure **`agentevent`** projection/validation package.
- **Next:** `RunEventService` type extract with injected control port — not dispatch/outbox.

## Key paths

- `hub-server/internal/service/`
- `hub-server/internal/service/agentevent/`
- `hub-server/internal/service/agentteam/`
- `docs/analysis/cleanup-strategy.md`
