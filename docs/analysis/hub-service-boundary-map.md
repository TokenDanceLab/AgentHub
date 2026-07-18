# Hub `internal/service` Boundary Map

> last-updated: 2026-07-18
> tip: origin/master `a26a2828` (Phase 61 progress baseline clean; open peels #1067–#1069)
> issue: #823 (Dispatch pure residual closed / boundary-map refresh; prior #811 / #800 / #789 / #779 / #768 / #756 / #744 / #732 / #720 / #708 / #697 / #685 / #673 / #662 / #651 / #639 / #628 / #617 / #606 / #594 / #593 / #585 / #573 / #563 / #551 / #540 / #528 / #514 / #505 / #493 / #478 / #468) · later residual peels closed through Phase 60 (#1033→#1056 chains) + Phase 61 design-token #1070; **live open peels: Phase 61 #1067–#1069** — see `docs/progress/MASTER.md`
> status: header thin-refresh only — `agent_dispatch.go` **786** · `delivery_outbox.go` **469** (+ companions); pure `service/dispatch` ~1963; next residual peels align MASTER Phase 61 open peels only (#1067–#1069)
> companion: `cleanup-strategy.md` (archived program pointer) · live progress `docs/progress/MASTER.md` · precedent `service/agentteam` (ADR-014) / `service/agentevent` / `service/deliveryoutbox` / `service/dispatch` / `service/messagereaction` / `service/workspace` / `service/contact` / `service/attachment` / `service/session` / `service/message`

This document is the authoritative **read-only boundary map** for
`hub-server/internal/service`. It records package shape, coupling risks,
ranked extract candidates, landed extracts, and the next low-risk seam with
an acceptance sketch.

## 0. Snapshot totals

| Surface | Prod LOC | Test LOC | Files | Notes |
|---|---:|---:|---:|---|
| Flat `service` package | ~5892 | ~6910 | 44 `.go` | 28 prod + 16 test (historical recount tip `8f4a846c`; live residual LOC → MASTER) |
| Already-extracted `service/agentteam` | ~3,012 | ~3,259 | 13 | Template for later domain extracts |
| Pure extract `service/agentevent` | ~620 | unit tests | pure helpers | no DB/WS/cache/`*AgentService` (#468) |
| Same-package type extract `RunEventService` | ~200 methods + facade | existing `agent_run_event_test.go` | still in flat `service` | injected `runEventControl` (#478) |
| Same-package type extract `EdgeCallbackService` | ~500 methods + facade | existing HandleTask*/outbox auto-ack tests | still in flat `service` | injected bus/seq/outbox (#505) |
| Pure extract `service/deliveryoutbox` | ~80–100 | unit tests | pure helpers | backoff/truncate + retry constants (#514) + status/eligibility/last-error residual (#744); no DB/WS/cache/`*AgentService` |
| Pure extract `service/dispatch` | ~1963 | ~1248 unit tests | 31 prod + 6 test | pure helpers (#732→#811; **closed #823**; later peels grew package): loopback / runtime type / select / merge / prompt+history / task-status / edge constants / Message+Payload DTOs / Edge request / team+target+capability+redelivery / routing / task-access / events / mint resolve / trigger mapping / model→DTO mappers / route classify; no DB/WS/cache/`*Service` |
| Pure extract `service/im` | ~280 | unit tests | pure helpers | content/attachment + reaction normalize/summary + workspace thread content + workspace name/description fields; no DB/WS/cache/`*Service` (#628/#639/#651) |
| Typed extract `service/messagereaction` | ~217 | ~278 | 2 | **DONE #662** first IM typed-service package; Bus port + DTOs + add/remove/list; pure helpers stay in `im` |
| Typed extract `service/workspace` | ~370 | ~273 | 2 | **DONE #673** second IM typed-service package; DB-only Service + DTOs + project/thread CRUD; pure helpers stay in `im`; no bus/cache ports invented |
| Typed extract `service/contact` | ~400 | ~900 | 2 | **DONE #685** third IM typed-service package; Bus + Cache ports + DTOs + search/request/list/block; ports from #594 kept interface-shaped |
| Typed extract `service/attachment` | ~420 | ~450 | 3 | **DONE #697** fourth IM typed-service package; ObjectStorage port + LocalStorage/S3Storage + DTOs; pure helpers stay in `im` |
| Typed extract `service/session` | ~790 | ~1,5xx | 3 | **DONE #708** fifth IM typed-service package; Bus + Cache ports + DTOs + private/group lifecycle; ports from #593 kept interface-shaped |
| Typed extract `service/message` | ~800 | ~1,3xx | 3 | **DONE #720** sixth IM typed-service package; Bus + Cache ports + DTOs + send/edit/pin/forward/search/read; ports from #585 kept interface-shaped; pure helpers stay in `im` |
| Same-package type extract `DeliveryOutbox` | **landed #540 + #551 + #744 pure residual** | existing `TestOutbox_*` + fake Redispatcher tests + `service/deliveryoutbox` unit tests | still in flat `service` | opaque `Redispatcher`; private `deliveryOutboxRecord` + repo helpers; scan returns `DeliveryOutboxEntry`; redispatch uses `redispatchTarget`; pure status/eligibility → `service/deliveryoutbox` |
| Same-package type extract `DispatchService` | **landed #563 thin first seam + #573 redispatch residual + #617 ports residual + #732→#811 pure helpers + #823 pure residual closed** | existing `agent_test` / `agent_logic_test` + `TestOutbox_*` + `service/dispatch` unit tests | still in flat `service` (**786** LOC orchestration at tip `7ef83beb`) | injected `dispatchBus` / `dispatchOutbox` / narrow `dispatchCache` / `dispatchWS` / relay; `dispatchPayload` private; redispatch via `dispatchRedispatcher`; pure helpers → `service/dispatch` (~1963); live further peel **Phase 61 #1068** |
| Same-package type extract `MessageService` | **superseded by #720 package move** (prior #585 bus+cache ports) | moved tests in `service/message` | **extracted** | was flat; now `service/message` |
| Same-package type extract `SessionService` | **superseded by #708 package move** (prior #593 bus+cache ports) | moved tests in `service/session` | **extracted** | was flat; now `service/session` |
| Same-package type extract `ContactService` | **superseded by #685 package move** (prior #594 bus+cache ports) | moved tests in `service/contact` | **extracted** | was flat; now `service/contact` |
| Same-package type extract `AttachmentService` | **superseded by #697 package move** (prior #606 ObjectStorage port) | moved tests in `service/attachment` | **extracted** | was flat; now `service/attachment` |
| Same-package type extract `MessageReactionService` | **superseded by #662 package move** (prior #639 bus port + #651 pure summary helpers) | moved tests in `service/messagereaction` | **extracted** | was flat; now `service/messagereaction` |

**Shape note:** not one god struct — **25+ `*Service` types** already exist
(including `RunEventService`, `EdgeCallbackService`, `DeliveryOutbox`,
`DispatchService`, `MessageService`, `SessionService`, `ContactService`,
`AttachmentService`). **`messagereaction.Service`** is extracted (#662). **`workspace.Service`** is extracted (#673, DB-only). **`contact.Service`** is extracted (#685, bus+cache ports). **`attachment.Service`** is extracted (#697). **`session.Service`** is extracted (#708, bus+cache ports). **`message.Service`** is extracted (#720, bus+cache ports). Concentration remains **package flatness + residual
`AgentService` facade sprawl + optional outbox model / typed DispatchService package-move residual**. Outbox journal + retry-loop orchestration
are on `DeliveryOutbox`; trigger/dispatch/cancel/regenerate **and redispatch**
are on `DispatchService` behind facades. Redispatch
(`redispatchDelivery` / `retryDispatchToTarget`) lives on `*DispatchService`
behind `Redispatcher` (`dispatchRedispatcher` / lazy adapter) using
`redispatchTarget` (not the GORM row); `dispatchPayload` stays package-private.
**#585:** `MessageService` hardens replaceable `messageBus` / `messageCache` ports
(same-package thin seam; methods already lived on the typed service).
**#593:** `SessionService` hardens replaceable `sessionBus` / `sessionCache` ports
**#594:** `ContactService` hardens replaceable `contactBus` / `contactCache` ports
**#606:** `AttachmentService` hardens replaceable `ObjectStorage` port ownership
(same-package thin seam; methods already lived on the typed service).
**#628:** first IM subpackage seam is **pure helpers only** in `service/im`
(content normalize / attachment hash+path+metadata); typed Message/Session/Contact/Attachment
services stay flat with thin aliases — no big-bang IM service move.
**#639:** deeper IM pure helpers (reaction normalize + workspace thread content) +
`MessageReactionService` `messageReactionBus` thin port; workspace stays DB-only (no bus/cache).
**#651:** workspace still has **no** bus/cache deps — ports residual skipped; pure workspace
name/description helpers + reaction summary projection helpers landed in `service/im`;
typed IM package move sketched in §6g.
**#662:** first IM typed-service package move **landed** as `service/messagereaction` (agentteam-style);
flat `message_reaction.go` removed; pure helpers stay in `service/im`; JSON/OpenAPI names preserved.
**#673:** second IM typed-service package move **landed** as `service/workspace` (agentteam-style);
flat `workspace.go` removed; pure helpers stay in `service/im`; DB-only (no invented bus/cache ports); JSON/OpenAPI names preserved.
**#685:** third IM typed-service package move **landed** as `service/contact` (agentteam-style);
flat `contact.go` removed; bus+cache ports stay interface-shaped; JSON/OpenAPI names preserved.

**#697:** fourth IM typed-service package move **landed** as `service/attachment` (agentteam-style);
ObjectStorage port + LocalStorage/S3Storage implementers moved with the typed Service; pure helpers
remain in `service/im`; thin aliases (`IsValidAttachmentHash`/`PathFromHash`/`NormalizeAttachmentMetadataJSON`)
preserved in flat `service` for handler/test call sites; JSON/OpenAPI names preserved.

**#708:** fifth IM typed-service package move **landed** as `service/session` (agentteam-style);
Bus+Cache ports stay interface-shaped (from #593); flat `session.go` removed; behavior suite moved with
package; JSON/OpenAPI names preserved; one service only.

**#720:** sixth IM typed-service package move **landed** as `service/message` (agentteam-style);
Bus+Cache ports stay interface-shaped (from #585); flat `message.go` removed; pure helpers remain in
`service/im` (not re-embedded); JSON/OpenAPI names preserved; one service only.

**#732:** Dispatch residual pure-helper package **landed** as `service/dispatch` (deliveryoutbox/im-style);
`IsLoopback` / `NormalizeRuntimeAgentType` / `SelectAgentInstance` / `MergeModelParams` /
`PromptFromMessage` / `ExtractMessageText` / `MapSenderType` extracted; thin aliases remain in flat
`agent_dispatch.go`; typed `DispatchService` package move still deferred; `dispatchPayload` private.

**#756/#768/#779/#789/#800/#811:** Dispatch pure residual **continued** — Message/Payload DTOs, Edge
request builders, team/target/capability/redelivery, routing classifiers, task-access/events, mint
resolve, model→DTO mappers, redispatch prep, Edge HTTP headers, redelivery route classify, finalize
delivery payload. Pure package grew further via residual peels; historical tip recount at that chain was `agent_dispatch.go` **800** / pure `service/dispatch` **~1963**; **live tip `7ef83beb` = 786** (MASTER residual band).
Thin same-package aliases retained for test/call stability.

**#823:** Dispatch pure residual **closed** (docs + ownership comments). No further pure-only extract
pays for itself (remaining free funcs are thin aliases; redispatch L~800+ is WS/cache/DB
orchestration). Next real seam = optional typed `DispatchService` package move (high risk) or leave
flat. No OpenAPI/handler/frontend; no payload JSON redesign.

**#744:** DeliveryOutbox residual pure-helper package **extended** as `service/deliveryoutbox`
(status / active+cleanup status sets / eligibility cutoffs / dead-letter predicate / last-error truncate);
thin aliases remain in flat `delivery_outbox.go`; full model package move still deferred; one seam only.

Precedent: `service/agentteam` uses **local interfaces**
(`agentTeamAgentSvc`, `agentTeamCache`, `agentTeamControlSvc`) + `*service.Bus`.
`RunEventService` follows the same port pattern with `runEventControl`.
`EdgeCallbackService` injects `edgeCallbackBus` / `edgeCallbackSeq` /
`edgeCallbackOutbox`. `DeliveryOutbox` injects opaque `Redispatcher`
(no `dispatchPayload` export). `DispatchService` injects `dispatchBus` /
`dispatchOutbox` + narrow `dispatchCache` / `dispatchWS` / `relayDispatcher`
(**#617** residual ports; no longer depends on full `agentCache` / concrete `*ws.Manager`).
`MessageService` injects `messageBus` / `messageCache` (**#585**; package-moved **#720**).
`SessionService` injects `sessionBus` / `sessionCache` (**#593**; package-moved **#708**).
`ContactService` injects `contactBus` / `contactCache` (**#594**; package-moved **#685**).
`AttachmentService` injects `ObjectStorage` (**#606**; package-moved **#697**).

## 1. File inventory by domain

| Domain | Prod LOC | Files (prod) | Role |
|--------|---------:|--------------|------|
| **agent_runtime** | residual flat | `agent.go`, `agent_custom.go`, `agent_dispatch.go` (`DispatchService` + residual ports + facade + thin pure aliases, **800**), `agent_run_event.go` (`RunEventService` + facade), `agent_edge_callback.go` (`EdgeCallbackService` + facade), `delivery_outbox.go` (**469** + `delivery_outbox_facade.go` 133 + `delivery_outbox_model.go` 142), `agent_control.go`, `agent_team_helpers.go` (compat wrappers), `relay.go` | Task dispatch, edge callback, outbox retry, run-event projection |
| **im_messaging** | ~4xx | `attachment.go` (~20; thin im aliases after #697), `notification.go`, `image_meta.go` | IM messaging residual pure/notification only (reaction + workspace + contact + attachment + session + message extracted) |
| **agent_catalog** | ~1,133 | `agent_profile.go`, `document.go`, `skill.go`, `mcp_server.go`, `provider_binding.go` | Profiles/docs/market installables |
| **identity_auth** | ~829 | `auth.go`, `oidc.go`, `device.go`, `user_settings.go` | Login/OIDC/device/settings |
| **execution_target** | ~516 | `execution_target.go` | Local-edge targets + health |
| **infra_shared** | ~493 | `eventbus.go`, `cache_fallback.go`, `audit.go`, `public_stats.go` | Bus, nil-cache guards, audit, public stats |
| **agentteam/** (subpkg) | ~3,012 | CRUD/member/run/routing/approval/guard/compete | **Already extracted** team domain |
| **agentevent/** (subpkg) | ~620 | pure project/validate/helpers | **Extracted in #468** |
| **deliveryoutbox/** (subpkg) | ~80–100 | pure retry/truncate + status/eligibility helpers | **Extracted in #514; residual #744** |
| **dispatch/** (subpkg) | ~1963 | pure loopback/runtime-type/select/merge/prompt/history-text + Message/Payload DTO + Edge request + team/target/capability/redelivery + routing + task-access/events + mint + mappers (#732→#811 + later peels) | **Extracted #732; continued #756–#811; pure residual closed #823; tip recount 2026-07-18** |
| **im/** (subpkg) | ~280 | pure content/attachment/reaction/workspace-content/workspace-fields helpers | **Extracted in #628/#639/#651** |
| **messagereaction/** (subpkg) | ~217 | typed reaction orchestration + Bus port + DTOs | **Extracted in #662** |
| **workspace/** (subpkg) | ~370 | typed workspace project/thread CRUD + DTOs (DB-only) | **Extracted in #673** |
| **contact/** (subpkg) | ~400 | typed contact/friendship orchestration + Bus/Cache ports + DTOs | **Extracted in #685** |
| **attachment/** (subpkg) | ~420 | typed attachment orchestration + ObjectStorage port + LocalStorage/S3Storage implementers | **Extracted in #697** |
| **session/** (subpkg) | ~790 | typed session lifecycle orchestration + Bus/Cache ports + DTOs | **Extracted in #708** |
| **message/** (subpkg) | ~800 | typed message orchestration + Bus/Cache ports + DTOs | **Extracted in #720** |

### Named hotspots

| File | LOC | Owns | Couples to |
|------|----:|------|------------|
| `agent_dispatch.go` | **800** | `DispatchService` + facades: `TriggerAgentTask`, `dispatchTask`, edge HTTP, capability, history/pins, cancel/regenerate, **redispatch residual**, residual ports + thin pure aliases | injected `dispatchOutbox` / `dispatchBus` / `dispatchCache` / `dispatchWS` / relay (**#563/#617**); private `dispatchPayload`; redispatch owned by `DispatchService` (**#573**); pure helpers → `service/dispatch` (**#732→#811**; pure residual **closed #823**); further peel **#1033** |
| `dispatch/` | **~1963** | pure helpers: loopback, runtime agent type, select instance, merge model params, prompt/history text, Message/Payload DTOs, Edge request, team/target/capability/redelivery, routing, task-access/events, mint resolve, model→DTO mappers, route classify | **#732→#811 pure residual; closed #823**; tip recount 2026-07-18; no DB/WS/cache/`*Service` |
| `delivery_outbox.go` | **469** | `DeliveryOutbox` owns private model + repo helpers + journal/retry + `Redispatcher` adapter; facades on `AgentService` | companions `delivery_outbox_facade.go` (133) + `delivery_outbox_model.go` (142); pure helpers → `deliveryoutbox` (#514/#744); thin type + `Redispatcher` (**#540**); model ownership residual (**#551**); redispatch impl moved off this file onto `DispatchService` (**#573**); pure residual status/eligibility (**#744**) |
| `message/` | ~915 | typed `Service` + Bus/Cache ports: send/edit/recall/pin/forward/search/read + DTOs; thin aliases to `im` pure helpers | **#720 package move** (flat `message.go` **removed**); ports from **#585**; pure content helpers remain in `im` |
| `session/` | ~936 | typed `Service` + Bus/Cache ports: private/group lifecycle, members, dissolve, settings + DTOs | **#708 package move** (flat `session.go` **removed**); ports from **#593** |
| `contact/` | ~400 | typed `Service` + Bus/Cache ports: search/request/accept/reject/list/remove/block/unblock/remark + DTOs | **#685 package move** from flat `contact.go`; ports from **#594** |
| `attachment.go` | ~20 | thin aliases for `im.IsValidAttachmentHash` / `im.PathFromHash` / `im.NormalizeAttachmentMetadataJSON` | pure-only after #697 package move |
| `attachment/` | ~420 | typed `Service` + `ObjectStorage` port + LocalStorage/S3Storage: probe/save/store/get/delete/presign/access + mime policy | **#697 package move** from flat `attachment.go`; pure helpers remain in `im`; thin aliases preserved |
| `messagereaction/` | ~217 | typed `Service` + `Bus` port: add/remove/list reactions + access checks; DTOs; uses pure `im` normalize/summary | **#662 package move** from flat `message_reaction.go`; pure helpers remain in `im` |
| `workspace/` | ~370 | typed `Service` (DB-only): project/thread CRUD + DTOs; thin aliases to `im` workspace thread content + name/description normalize | **#673 package move** from flat `workspace.go`; pure helpers remain in `im`; no bus/cache ports invented |
| `agent_edge_callback.go` | ~520 | `EdgeCallbackService` + `AgentService` facade | repo; `agentevent` normalize/validate; injected bus/seq/outbox (**#505 done**); outbox rebind via `DeliveryOutbox` (**#540**) |
| `agent_run_event.go` | 237 | `RunEventService` + `AgentService` facade | repo; `agentevent` project; injected `runEventControl` (**#478 done**) |

### Consumers outside package

- **Wiring:** `hub-server/internal/app/{wiring,app,background,events}.go`
- **Handlers:** per-domain interfaces already in `handler/*` (good extract seam)
- **Subpkg:** `agentteam` → `service.Bus` + agent/control interfaces
- **Subpkg:** `agentevent` → pure helpers used by `RunEventService` + `EdgeCallbackService`
- **Subpkg:** `deliveryoutbox` → pure backoff/truncate + status/eligibility helpers used by `delivery_outbox.go` (**#514/#744**)
- **Subpkg:** `dispatch` → pure dispatch helpers used by `agent_dispatch.go` (thin aliases keep call sites stable) (**#732→#811**; pure residual **closed #823**)
- **Subpkg:** `im` → pure message-content + attachment hash/path/metadata + reaction
  normalize/summary + workspace thread content + workspace name/description helpers used by
  `message.go` / `attachment.go` / `message_reaction.go` / `workspace.go` (thin aliases keep
  handler/export surface stable) (**#628/#639/#651**)
- **Subpkg:** `attachment` → typed `Service` + `ObjectStorage` port + LocalStorage/S3Storage
  used by wiring/app/handler/tests; thin aliases for pure helpers preserved in flat `service`
  (**#606** port; **#697** package move)
- **Composition:** `AgentService` holds `runEvents *RunEventService`,
  `edgeCallbacks *EdgeCallbackService`, `deliveryOutbox *DeliveryOutbox`, and
  `dispatch *DispatchService` (set in `NewAgentService`); facade methods keep
  handler signatures stable. Redispatch lives on `*DispatchService` via
  `dispatchRedispatcher` (**#573**; supersedes `agentRedispatcher` from **#540**).
  `#551`: `deliveryOutboxRecord` private to outbox surface; scan facade returns
  `DeliveryOutboxEntry`; only `DeliveryOutbox` implements `edgeCallbackOutbox`.
  `#563/#573/#617`: `dispatchPayload` remains package-private; #617 narrows
  dispatch ports (`dispatchCache` / `dispatchWS`) + SetCache/SetManager/SetRelay +
  nil-safe `publish` / outbox wrappers.
  `#585`: `MessageService` is already a top-level typed service (not under
  `AgentService`); wiring stays `NewMessageService(db, bus, cache)` with bus/cache
  as ports. Handler interface in `handler/message.go` unchanged.
  `#593`: `SessionService` is already a top-level typed service; wiring stays
  `NewSessionService(db, cache, bus)` with bus/cache as ports (variadic bus
  preserved). Handler interface in `handler/session.go` unchanged.
  `#708`: fifth IM typed-service package move **landed** (`service/session`);
  wiring/app/handler/tests import new package; Bus+Cache ports interface-shaped;
  one service only; JSON/OpenAPI names unchanged.
  `#720`: sixth IM typed-service package move **landed** (`service/message`);
  wiring/app/handler/tests import new package; Bus+Cache ports interface-shaped;
  pure helpers remain in `service/im`; one service only; JSON/OpenAPI names unchanged.
  `#594`: `ContactService` is already a top-level typed service; wiring stays
  `NewContactService(db, bus, cache)` with bus/cache as ports. Handler interface
  in `handler/contact.go` unchanged.
  `#606`: `AttachmentService` is already a top-level typed service; wiring stays
  `NewAttachmentService(db, uploadCfg, storage)` with `ObjectStorage` as the
  blob port (+ `SetStorage` for tests). Handler interface in `handler/attachment.go`
  unchanged.
  `#628`: pure IM helpers extracted to `service/im`; `MessageService` /
  `AttachmentService` retain thin aliases (`normalizeMessageContent`,
  `IsValidAttachmentHash`, `PathFromHash`, …). No OpenAPI/handler/frontend.
  `#639`: deeper pure helpers (reaction + workspace thread content) +
  `MessageReactionService` `messageReactionBus` port + `SetBus`/nil-safe publish;
  workspace content aliases; still no OpenAPI/handler/frontend.
  `#651`: workspace ports residual **skipped** (no bus/cache deps); pure workspace
  name/description + reaction summary projection helpers; IM typed-service first-move
  sketch in §6g; still no OpenAPI/handler/frontend.
  `#662`: first IM typed-service package move **landed** (`service/messagereaction`);
  wiring/app/handler/tests import new package; JSON field names + OpenAPI schema names
  unchanged; pure helpers remain in `service/im`; one service only.
  `#673`: second IM typed-service package move **landed** (`service/workspace`);
  wiring/handler/tests import new package; DB-only (no bus/cache); pure helpers remain
  in `service/im`; one service only; JSON/OpenAPI names unchanged.
  `#685`: third IM typed-service package move **landed** (`service/contact`);
  wiring/app/handler/tests import new package; Bus+Cache ports interface-shaped;
  one service only; JSON/OpenAPI names unchanged.

## 2. Coupling risks

1. **`*AgentService` residual god surface** — custom-agent methods still share the struct (`db`, `bus`, `mgr`, `cacheClient`, `relay`). Run-event, edge-callback, outbox journal, **dispatch orchestration**, and **redispatch** are composed out but facaded; primary residual is facade sprawl + custom-agent surface, not redispatch.
2. **`dispatchPayload` remains package-private glue** for redispatch + dispatch — thin extracts (#540/#563/#573) avoided export via opaque `Redispatcher` and same-package `DispatchService`.
3. **Outbox row type still lives in service package** (`deliveryOutboxRecord`) — **#551** seals ownership: private GORM model + `findOutboxByDeliveryID` / `updateOutboxByDeliveryID` / `outboxModel` helpers on `DeliveryOutbox`; public scan view is `DeliveryOutboxEntry` (no GORM tags); redispatch uses `redispatchTarget`; edge-callback `deliveryOutboxAcker` removed. **#744** extracts remaining pure status/eligibility helpers into `service/deliveryoutbox`; full move to `model/` + `repository/` packages remains optional/deferred.
4. **Run-event pure helpers** — normalize/validate used by edge callback; project/summarize used by list/decide APIs. **Moved to `agentevent` in #468.**
5. **`DecideTaskApproval` control coupling** — **resolved in #478**: `RunEventService` injects `runEventControl` (implemented by `*AgentControlService`). Facade still type-asserts cache for tests that construct `AgentService` without `NewAgentService`.
6. **`agent_team_helpers.go` overlaps agentteam** — approval ID/decision predicates still duplicated in subpkg (drift risk). Flat package wraps `agentevent`; agentteam still has local copies. Edge callback now prefers `agentevent.*` on touched paths.
7. **`service.Bus` is a parent-package dependency** for agentteam — bus cannot move with a domain without an `events` subpackage or interface. **Resolved for edge callback in #505** via `edgeCallbackBus` port (implemented by `*Bus`).
8. **IM vs agent_runtime** — mostly independent at service layer; coupling is app/handler orchestration + session agent cleanup, not deep import cycles.
9. **Trivial “extracts” (image_meta / public_stats / eventbus alone)** shrink LOC almost nothing vs concentration problem.
10. **Handler interfaces already thin the edge** — package extract without service-side ports still leaves fat concrete type for tests/wiring.

Cleanup strategy alignment (`docs/analysis/cleanup-strategy.md` Phase 4 Hub):
`RunEventService` / `EdgeCallbackService` / `DeliveryOutbox` / **`DispatchService` thin first seam + redispatch residual + residual ports (#617) + pure helpers (#732→#811) + pure residual closed (#823)** / **`MessageService` thin first seam (#585)** / **`SessionService` thin first seam (#593)** / **`ContactService` thin first seam (#594)** / **`AttachmentService` thin first seam (#606)** / **`service/im` pure helpers first seam (#628)** / **deeper IM pure helpers + MessageReactionService bus port (#639)** / **workspace field pure helpers + reaction summary pure helpers + typed-move sketch (#651)** / **first IM typed-service package move `service/messagereaction` (#662)** / **second IM typed-service package move `service/workspace` (#673)** / **third IM typed-service package move `service/contact` (#685)** / **fourth IM typed-service package move `service/attachment` (#697)** / **fifth IM typed-service package move `service/session` (#708)** / **sixth IM typed-service package move `service/message` (#720)** / **Dispatch pure residual `service/dispatch` (#732→#811; closed #823)** / **DeliveryOutbox pure residual `service/deliveryoutbox` (#744)** → next residual = optional outbox model package move / optional typed DispatchService package move.
**“先接口后搬家；一次一个 seam.”** — runtime + message + session + contact + attachment ports done thin; reaction **package-moved** (#662); workspace **package-moved** (#673, DB-only); contact **package-moved** (#685, bus+cache); attachment **package-moved** (#697); session **package-moved** (#708, bus+cache); message **package-moved** (#720, bus+cache); IM pure package closed (**#628/#639/#651**); Dispatch pure residual closed (**#732→#811; #823**); **do not big-bang package moves.**

## 3. Extract candidates ranked (lowest risk first)

| Rank | Candidate | Risk | Value | Status |
|-----:|-----------|------|------:|--------|
| **1** | **Pure run-event projection/validation package** (`service/agentevent`) | **Lowest** | High seam | **DONE in #468** |
| 2 | Same-package **interface boundary only** (export projector/ports; methods stay) | Very low | Medium | Superseded by #478 type extract for run-events |
| 3 | Mechanical move of already-standalone small services (`public_stats`, `user_settings`) | Low | Low | LOC theater — defer |
| 4 | `MessageReactionService` / `WorkspaceService` / `ContactService` subpkg | Low–med | Medium | **MessageReaction DONE #662**; **Workspace DONE #673**; **Contact DONE #685** |
| **5** | **`RunEventService` type split (methods + inject control)** | Medium | High | **DONE in #478** |
| **6** | **`EdgeCallbackService` type split (ack/stream/done/fail + ports)** | Medium | High | **DONE in #505** |
| **6b** | **Pure outbox helpers only** (`NextRetryDelay`/`TruncateString` + retry constants in `service/deliveryoutbox`) | Low | Low–med | **DONE in #514** |
| **6c** | **Same-package `DeliveryOutbox` type + `Redispatcher` port** (no model move) | Med–high | High | **Sketch only #528** — journal half is clean; redispatch half needs port first |
| 7 | Outbox model ownership residual / optional package move | Med → High | High | **#551 residual landed** (private model + repo helpers + DTO view); full `model/`/`repository/` package move optional/deferred |
| 8 | Full `DispatchService` extract | **Highest** | Highest | **#563 thin first seam + #573 redispatch residual + #617 residual ports + #732→#811 pure helpers + #823 pure residual closed** — typed package move still deferred |
| **8b** | **`MessageService` thin first seam** (ports on existing typed service) | Low–med | High (IM concentration) | **DONE #585** — `messageBus` / `messageCache` + ownership docs; no package move |
| **8c** | **`SessionService` thin first seam** (ports on existing typed service) | Low–med | Med | **DONE #593** — `sessionBus` / `sessionCache` + ownership docs; no package move |
| **8d** | **`ContactService` thin first seam** (ports on existing typed service) | Low–med | Med | **DONE #594** — `contactBus` / `contactCache` + ownership docs; no package move |
| **8e** | **`AttachmentService` thin first seam** (`ObjectStorage` port ownership) | Low | Med | **DONE #606** — `ObjectStorage` + `SetStorage` + ownership docs; no package move |
| **8f** | **IM pure helpers package** (`service/im` content + attachment hash/path/metadata) | **Lowest (IM)** | Med–high seam | **DONE #628** — pure only; thin aliases on message/attachment; no typed-service move |
| **8g** | **Deeper IM pure helpers + MessageReaction bus port** (reaction/workspace content + `messageReactionBus`) | **Lowest residual (IM)** | Med seam | **DONE #639** — pure reaction/workspace helpers + reaction bus port; workspace stays DB-only |
| **8h** | **Workspace pure field helpers + reaction summary pure helpers + typed-move sketch** | **Lowest residual (IM)** | Med seam | **DONE #651** — no invented workspace ports; pure name/description + summary projection; §6g first-move sketch |
| **8i** | **First IM typed-service package move (`service/messagereaction`)** | **Lowest typed move** | High seam | **DONE #662** — agentteam-style package; Bus port; pure helpers stay in `im`; one service only |
| **8j** | **Second IM typed-service package move (`service/workspace`)** | **Lowest remaining typed move** | High seam | **DONE #673** — agentteam-style package; DB-only; pure helpers stay in `im`; no invented bus/cache ports; one service only |
| **8k** | **Third IM typed-service package move (`service/contact`)** | **Lowest remaining typed move** | High seam | **DONE #685** — agentteam-style package; Bus+Cache ports from #594; one service only |
| **8l** | **Fourth IM typed-service package move (`service/attachment`)** | **Lowest remaining typed move** | High seam | **DONE #697** — agentteam-style package; ObjectStorage port from #606; pure helpers stay in `im`; one service only |
| **8m** | **Fifth IM typed-service package move (`service/session`)** | **Lowest remaining typed move** | High seam | **DONE #708** — agentteam-style package; Bus+Cache ports from #593; one service only |
| **8n** | **Sixth IM typed-service package move (`service/message`)** | **Lowest remaining typed move** | High seam | **DONE #720** — agentteam-style package; Bus+Cache ports from #585; pure helpers stay in `im`; one service only |
| **8o** | **Dispatch residual pure helpers (`service/dispatch`)** | **Lowest remaining dispatch residual** | Med seam | **DONE #732→#811; pure residual closed #823** — pure only (~1963); thin aliases on `agent_dispatch.go` (**786** live / was 800 mid-chain); further residual peel **#1068** (Phase 61); typed DispatchService package move deferred |
| 9 | Optional outbox model package move (`deliveryOutboxRecord` → model/repo) | High | Med | Deferred after #551 private ownership; higher risk than IM pure/port seams |
| 10 | IM typed-service subpackages | Med | High | **reaction DONE #662**; **workspace DONE #673**; **contact DONE #685**; **attachment DONE #697**; **session DONE #708**; **message DONE #720** — primary IM typed packages closed |
| 10b | Optional workspace ports residual (if bus/cache appears) | Low | Low | **Closed as N/A in #651/#673** — `workspace.Service` remains DB-only |
| 10c | Optional typed `DispatchService` package move | High | High | Deferred after pure residual closed (#732→#823); ports hardened (#563/#573/#617); still couples `redispatchTarget` / `relayDispatcher` / private payload |

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

### 4e. `hub-server/internal/service/im` (#628)

**Moved (from `message.go` + `attachment.go`, pure only):**

- Content helpers: `IsValidContentType`, `NormalizeMessageContent`,
  `AttachmentIDsFromContent` (+ private payload field validators)
- Attachment helpers: `NormalizeAttachmentMetadataJSON`, `IsValidAttachmentHash`,
  `PathFromHash`

**Kept in flat `service` package:**

- Typed orchestration: `MessageService`, `SessionService`, `ContactService`,
  `AttachmentService` (+ ports from #585/#593/#594/#606)
- Thin aliases for same-package / exported call sites:
  `normalizeMessageContent`, `attachmentIDsFromContent`,
  `NormalizeAttachmentMetadataJSON`, `IsValidAttachmentHash`, `PathFromHash`
- Workspace continues to use package aliases for content normalize

**Explicit non-goals (honored in #628)**

- Did **not** move typed IM services into `service/im`
- Did **not** touch OpenAPI / handler / frontend surfaces
- Did **not** extract reaction/workspace orchestration
- Did **not** continue agent_dispatch residual pure helpers (higher coupling to
  model/runtime types than IM pure content/hash helpers)

### 4f. Deeper IM pure helpers + MessageReaction bus port (#639)

**Moved into `service/im` (pure only):**

- Reaction helper: `NormalizeMessageReaction` (+ `MaxMessageReactionLength`)
- Workspace content helpers: `NormalizeWorkspaceThreadMessageContent`,
  `NormalizeStructuredTextContent`

**Same-package thin port residual:**

- `MessageReactionService` injects `messageReactionBus` (+ `SetBus` / nil-safe
  `publish`); methods already lived on the typed service
- Thin aliases: `normalizeMessageReaction`, `normalizeWorkspaceThreadMessageContent`
- Workspace remains DB-only (no bus/cache ports introduced)

**Explicit non-goals (honored in #639)**

- Did **not** move typed IM services into `service/im`
- Did **not** invent workspace bus/cache ports (service has no such deps)
- Did **not** touch OpenAPI / handler / frontend surfaces
- Did **not** perform outbox model package move

### 4g. Workspace pure field helpers + reaction summary pure helpers (#651)

**Decision:** workspace ports residual **skipped** — `WorkspaceService` still has only
`db *gorm.DB` (no bus/cache/ws deps to harden). Instead, land remaining lowest-risk pure
helpers + document the next typed IM package-move seam without a big-bang move.

**Moved into `service/im` (pure only):**

- Workspace field helpers: `NormalizeRequiredName`, `NormalizeOptionalText`
- Reaction summary helpers: `UserReacted`, `ReactionCountFor`

**Same-package thin aliases / ownership residual:**

- `WorkspaceService` aliases: `normalizeWorkspaceName`, `normalizeWorkspaceDescription`,
  existing `normalizeWorkspaceThreadMessageContent`
- `MessageReactionService` list/snapshot projection uses `im.UserReacted` /
  `im.ReactionCountFor`
- Workspace remains DB-only (no invented bus/cache ports)

**Explicit non-goals (honored in #651)**

- Did **not** invent workspace bus/cache ports
- Did **not** move typed IM services into `service/im` (sketch only — §6g)
- Did **not** touch OpenAPI / handler / frontend surfaces
- Did **not** perform outbox model package move

## 5. Test plan & evidence (landed)

### Pure package

```bash
cd hub-server
go test ./internal/service/agentevent/ -count=1
go test ./internal/service/deliveryoutbox/ -count=1
go test ./internal/service/im/ -count=1
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
- [x] Boundary map residual next = optional outbox model package move / dispatch residual package move
- [x] Second IM typed-service package move: `service/workspace` owns Service + DTOs + project/thread methods (#673)
- [x] No invented workspace bus/cache ports; pure helpers remain in `service/im`
- [x] Flat `workspace.go` removed; wiring/handler/tests import `service/workspace`
- [x] One service only; no OpenAPI/handler/frontend redesign
- [x] Third IM typed-service package move: `service/contact` owns Service + Bus/Cache + DTOs + methods (#685)
- [x] Ports stay interface-shaped; pure helpers (if any) remain outside typed package
- [x] Flat `contact.go` removed; wiring/app/handler/tests import `service/contact`
- [x] One service only; no OpenAPI/handler/frontend redesign
- [x] `go test ./internal/service/contact/ ./internal/service/ ./internal/app/ ./internal/handler/` green
- [x] Boundary map residual next = optional outbox model package move / dispatch residual package move
- [x] `MessageService` thin first seam: `messageBus` / `messageCache` ports + nil-safe publish (#585)
- [x] Message ownership clarified (send/edit/recall/pin/forward/search/read); no OpenAPI/handler/frontend
- [x] Existing `message_*` tests + short suite green; port no-op unit tests
- [x] Boundary map residual next = Session/Contact ports or IM subpackages / optional model package move
- [x] `SessionService` thin first seam: `sessionBus` / `sessionCache` ports + nil-safe publish (#593)
- [x] `ContactService` thin first seam: `contactBus` / `contactCache` ports + nil-safe publish (#594)
- [x] Session ownership clarified (private/group lifecycle, members, dissolve, settings); no OpenAPI/handler/frontend
- [x] Existing `session_*` tests + short suite green; port no-op unit tests
- [x] Boundary map residual next = AttachmentService ports or IM subpackages / optional model package move
- [x] `AttachmentService` thin first seam: `ObjectStorage` ownership + `SetStorage` + nil-safe blob paths (#606)
- [x] Attachment ownership clarified (probe/save/store/get/delete/presign/access + mime policy); no OpenAPI/handler/frontend
- [x] Existing `attachment_*` tests + short suite green; storage port unit tests
- [x] Boundary map residual next = Dispatch residual ports / IM subpackages / optional outbox model package move
- [x] `DispatchService` residual ports cleanup: narrow `dispatchCache` / `dispatchWS` + SetCache/SetManager/SetRelay + nil-safe publish/outbox (#617)
- [x] Dispatch ownership clarified (trigger/dispatch/cancel/regenerate/redispatch + pure helpers); no OpenAPI/handler/frontend
- [x] Existing dispatch + outbox tests + short suite green; residual port unit tests
- [x] Boundary map residual next = IM subpackages / optional outbox model package move
- [x] First IM pure helpers package (`service/im`) for message content + attachment hash/path/metadata (#628)
- [x] Thin aliases keep same-package + handler export surface stable; no typed-service package move
- [x] `service/im` has **no** `*gorm.DB` / `*Service` / ws / cache imports
- [x] Existing message/attachment tests + `go test ./internal/service/ -short` + `./internal/service/im` green
- [x] Boundary map residual next = deeper IM pure helpers / reaction-workspace ports / optional outbox model package move
- [x] Deeper IM pure helpers: reaction normalize + workspace thread content into `service/im` (#639)
- [x] `MessageReactionService` thin residual seam: `messageReactionBus` + SetBus + nil-safe publish (#639)
- [x] Workspace content aliases to `im`; no invented workspace bus/cache ports
- [x] Existing reaction/workspace tests + short suite + `./internal/service/im` green
- [x] Boundary map residual next = optional workspace ports residual / IM typed-service package moves / optional outbox model package move
- [x] Workspace ports residual closed as N/A (DB-only; no bus/cache deps to inject) (#651)
- [x] Pure workspace name/description helpers + reaction summary projection into `service/im` (#651)
- [x] Thin workspace aliases + MessageReactionService list/snapshot use pure summary helpers (#651)
- [x] IM typed-service first-move sketch landed in §6g (MessageReaction recommended); no package move
- [x] Existing reaction/workspace tests + short suite + `./internal/service/im` green
- [x] Boundary map residual next = first IM typed-service package move / optional outbox model package move
- [x] First IM typed-service package move: `service/messagereaction` owns Service + Bus + DTOs + methods (#662)
- [x] Pure helpers remain in `service/im` (no re-embed); flat `message_reaction.go` removed
- [x] Wiring/app/handler/tests point at new package; JSON/OpenAPI field names preserved
- [x] One service only; no multi-service move; no OpenAPI/handler/frontend redesign
- [x] `go test ./internal/service/messagereaction/ ./internal/service/ ./internal/app/ ./internal/handler/ ./internal/router/` green
- [x] Boundary map residual next = next IM typed package (Workspace recommended) / remaining IM packages one-at-a-time / optional outbox model package move

- [x] Fifth IM typed-service package move: `service/session` owns Service + Bus/Cache + DTOs + methods (#708)
- [x] Ports stay interface-shaped; flat `session.go` removed; behavior suite moved with package
- [x] Wiring/app/handler/tests point at new package; JSON/OpenAPI field names preserved
- [x] One service only; no multi-service move; no OpenAPI/handler/frontend redesign
- [x] `go test ./internal/service/session/ ./internal/service/ ./internal/app/ ./internal/handler/` green
- [x] Boundary map residual next = optional outbox model package move / dispatch residual package move

- [x] Sixth IM typed-service package move: `service/message` owns Service + Bus/Cache + DTOs + methods (#720)
- [x] Ports stay interface-shaped; pure helpers remain in `service/im` (no re-embed); flat `message.go` removed
- [x] Wiring/app/handler/tests point at new package; JSON/OpenAPI field names preserved
- [x] One service only; no multi-service move; no OpenAPI/handler/frontend redesign
- [x] `go test ./internal/service/message/ ./internal/service/ ./internal/app/ ./internal/handler/` green
- [x] Boundary map residual next = optional outbox model package move / dispatch residual package move
- [x] Dispatch residual pure helpers package (`service/dispatch`) for loopback/runtime-type/select/merge/prompt/history-text (#732)
- [x] Thin aliases keep same-package + existing agent_logic/agent tests stable; no typed DispatchService package move
- [x] `service/dispatch` has **no** `*gorm.DB` / `*Service` / ws / cache imports
- [x] Existing dispatch + outbox tests + short suite + `./internal/service/dispatch` green
- [x] Boundary map residual next = optional outbox model package move / optional typed DispatchService package move
- [x] DeliveryOutbox residual pure helpers package extension (`service/deliveryoutbox`) for status/eligibility/last-error (#744)
- [x] Thin aliases keep same-package + existing TestOutbox_* stable; no model package move
- [x] `service/deliveryoutbox` has **no** `*gorm.DB` / `*Service` / ws / cache imports
- [x] Existing outbox tests + short suite + `./internal/service/deliveryoutbox` green
- [x] Boundary map residual next = optional outbox model package move / optional typed DispatchService package move
- [x] Dispatch pure residual continue chain (#756/#768/#779/#789/#800/#811) grew `service/dispatch`; historical recount pure ~1963 / orchestration 800 → **live 786**
- [x] Dispatch pure residual **closed** (#823): docs/map/comments only; no theater pure extract; no typed package move; go test green

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
10. ~~**`SessionService` thin first seam**~~ — **DONE #593** (`sessionBus` / `sessionCache` ports; ownership on existing typed service)
11. ~~**`ContactService` thin first seam**~~ — **DONE #594** (`contactBus` / `contactCache` ports; ownership on existing typed service)
12. ~~**`AttachmentService` thin first seam**~~ — **DONE #606** (`ObjectStorage` port ownership + `SetStorage`; no package move)
13. ~~**`DispatchService` residual ports cleanup**~~ — **DONE #617** (narrow `dispatchCache` / `dispatchWS` + Set* injectors + nil-safe publish/outbox; pure helpers stay package-private)
14. ~~**IM pure helpers first seam**~~ — **DONE #628** (`service/im` content normalize + attachment hash/path/metadata; thin aliases)
15. ~~**Deeper IM pure helpers / MessageReaction bus port**~~ — **DONE #639** (reaction/workspace content pure helpers + `messageReactionBus`)
16. ~~**Optional workspace ports residual / pure residual + typed-move sketch**~~ — **DONE #651** (ports residual N/A; pure field/summary helpers; §6g sketch)
17. ~~**First IM typed-service package move**~~ — **DONE #662** (`service/messagereaction`; agentteam-style; pure helpers stay in `im`)
18. ~~**Second IM typed-service package move**~~ — **DONE #673** (`service/workspace`; DB-only; pure helpers stay in `im`; no invented bus/cache ports)
19. ~~**Third IM typed-service package move**~~ — **DONE #685** (`service/contact`; Bus+Cache ports from #594; one service only)
20. ~~**Fourth IM typed-service package move**~~ — **DONE #697** (`service/attachment`; ObjectStorage port from #606; pure helpers stay in `im`)
21. ~~**Fifth IM typed-service package move**~~ — **DONE #708** (`service/session`; Bus+Cache ports from #593; one service only)
22. ~~**Sixth IM typed-service package move**~~ — **DONE #720** (`service/message`; Bus+Cache ports from #585; pure helpers stay in `im`; one service only)
23. ~~**Dispatch residual pure helpers**~~ — **DONE #732** (`service/dispatch`; thin aliases; typed package move deferred)
24. ~~**DeliveryOutbox residual pure helpers**~~ — **DONE #744** (`service/deliveryoutbox` status/eligibility/last-error; thin aliases; model package move deferred)
25. ~~**Dispatch pure residual continue**~~ — **DONE #756/#768/#779/#789/#800/#811** (DTO/builders/routing/mint/mappers; ~1.2k pure prod LOC)
26. ~~**Dispatch pure residual closed**~~ — **DONE #823** (docs/map/ownership comments; no further pure-only extract; typed package move still deferred)
27. **Optional dedupe:** import `agentevent` helpers from `agentteam` to remove duplicated approval predicates; finish remaining call sites to prefer `agentevent.*` over wrappers.
28. **Optional outbox model package move** — deferred/high-risk residual after pure residual closed (#744).
29. **Optional typed `DispatchService` package move** — still deferred; thin seams + residual ports + pure helpers already landed (#563/#573/#617/#732→#823).

### 6a. DeliveryOutbox + Redispatcher (#528 sketch → #540 thin type landed)

#### File ownership (current, post-#540)

| Path | Owns | Notes |
|------|------|-------|
| `service/delivery_outbox.go` | status const aliases, private `deliveryOutboxRecord` + repo helpers, `DeliveryOutboxEntry` view, `redispatchTarget`, `DeliveryOutbox` journal + retry loop, `Redispatcher`, `dispatchRedispatcher` adapter, facades | **#540 thin type + #551 model residual + #573 adapter + #744 pure residual aliases** |
| `service/deliveryoutbox/` (~80–100) | pure backoff/TTL/truncate + status/eligibility/last-error | **DONE #514 + residual #744** — pure residual exhausted for outbox |
| `service/agent_dispatch.go` (**786** live) | `DispatchService` + residual ports, `dispatchPayload`, edge HTTP, trigger/dispatch/cancel/regenerate, **redispatch residual**, facades + thin pure aliases | **#563 thin first seam + #573 redispatch residual + #617 residual ports + #732→#811 pure helpers + #823 pure residual closed**; package-private DTO retained; further peel **#1068** |
| `service/dispatch/` (**~1963**) | pure loopback / runtime type / select / merge / prompt / history-text + Message/Payload DTO + Edge request + team/target/capability/redelivery + routing + task-access/events + mint + mappers | **DONE #732→#811; pure residual closed #823** — tip recount 2026-07-18 |
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
4. Pure residual after #514: status/eligibility/last-error helpers still lived on the orchestration side — **closed in #744**. Remaining free functions (`computeNextRetryAt`, `truncateString`) stay thin aliases for tests. Status strings (`DeliveryStatus*`) are thin aliases to pure `deliveryoutbox.Status*`.
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
- [x] Pure residual after #514 closed in #744 (status/eligibility/last-error)
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

#### Acceptance checklist — DeliveryOutbox pure residual (#744 this PR)

- [x] Status constants + Active/Cleanup status sets + eligibility cutoffs + dead-letter predicate + last-error truncate in `service/deliveryoutbox`
- [x] Thin aliases on `delivery_outbox.go` keep `DeliveryStatus*` / call sites stable
- [x] `service/deliveryoutbox` has **no** `*gorm.DB` / `*Service` / ws / cache imports
- [x] **No** model package move; **no** OpenAPI/handler/frontend; one seam only
- [x] Existing `TestOutbox_*` + pure package unit tests + `go test ./internal/service/ -short` green
- [x] Boundary map residual next = optional outbox model package move / optional typed DispatchService package move

#### Optional later — full package move (not blocking pure residual)

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

### 6c. SessionService thin first seam (#593)

#### File ownership (current, post-#593)

| Path | Owns | Notes |
|------|------|-------|
| `service/session.go` (~760) | `SessionService` + `sessionBus` / `sessionCache` ports; private/group create, list/search, members, leave/remove, transfer, dissolve, settings, delete-for-me, invited-agent cleanup | **#593 thin first seam** — methods already on typed service; ports hardened |
| `service/session_test.go` + behavior tests | lifecycle coverage + port no-op tests | Handler interface tests remain in `handler/` |
| `handler/session.go` | thin handler interface over `SessionService` methods | **Unchanged** |
| `app/wiring.go` | `NewSessionService(db, cache, bus)` | Signature still accepts `*cache.Client` / `*Bus` via ports (variadic bus) |

#### Landed thin shape (#593)

```go
type sessionBus interface {
    Publish(ctx context.Context, event Event)
}

type sessionCache interface {
    Invalidate(ctx context.Context, keys ...string) error
    InitSeqIfAbsent(ctx context.Context, sessionID string, seq int64) error
}

type SessionService struct {
    db          *gorm.DB
    cacheClient sessionCache
    bus         sessionBus
}

// NewSessionService(db, cacheClient, bus...)
// SetBus / SetCache for tests; publishEvent() nil-safe
```

- Methods stay on `*SessionService` (already extracted historically; #593 is port ownership, not method relocation).
- No package move; no OpenAPI / handler / frontend changes.
- Invited-agent cleanup remains package-private orchestration on `SessionService`.

#### Acceptance checklist — SessionService thin first seam (#593 this PR)

- [x] `sessionBus` / `sessionCache` ports on `SessionService` (same package)
- [x] Nil-safe `publishEvent`; `SetBus` / `SetCache` injectors
- [x] Ownership docs: private/group lifecycle, members, dissolve, settings
- [x] **No** package move; **no** OpenAPI/handler/frontend; **no** freestyle ContactService
- [x] Existing session tests green; port unit tests added
- [x] Boundary map residual next = ContactService ports or IM subpackages


### 6d. ContactService thin first seam (#594)

#### File ownership (current, post-#594)

| Path | Owns | Notes |
|------|------|-------|
| `service/contact/` (~400) | typed `Service` + Bus/Cache ports; search/request/accept/reject/list/remove/block/unblock/remark; GetFriendIDs; DTOs | **#685 package move** after **#594** thin ports |
| `service/contact/service_test.go` | search/request/list/block coverage + port no-op tests | Handler interface tests remain in `handler/` |
| `handler/contact.go` | thin handler interface over `contact.Service` methods | DTO imports updated (#685); contracts unchanged |
| `app/wiring.go` | `contact.NewService(db, bus, cache)` | Signature still accepts `*Bus` / `*cache.Client` via ports |

#### Landed thin shape (#594)

```go
type contactBus interface {
    Publish(ctx context.Context, event Event)
}

type contactCache interface {
    Invalidate(ctx context.Context, keys ...string) error
    IsOnline(ctx context.Context, userID string) (bool, error)
}

type ContactService struct {
    db          *gorm.DB
    bus         contactBus
    cacheClient contactCache
}

// NewContactService(db, bus, cacheClient)
// SetBus / SetCache for tests; publish() nil-safe
```

- Methods stay on `*ContactService` (already extracted historically; #594 is port ownership, not method relocation).
- No package move; no OpenAPI / handler / frontend changes.
- SessionService remains out of scope (#593).

#### Acceptance checklist — ContactService thin first seam (#594 this PR)

- [x] `contactBus` / `contactCache` ports on `ContactService` (same package)
- [x] Nil-safe `publish`; `SetBus` / `SetCache` injectors
- [x] Ownership docs: search/request/accept/reject/list/remove/block/unblock/remark
- [x] **No** package move; **no** OpenAPI/handler/frontend; **no** session.go freestyle
- [x] Existing contact tests green; port unit tests added
- [x] Boundary map residual next = AttachmentService ports or IM subpackages

### 6e. AttachmentService thin first seam (#606)

#### Decision: Option B over Option A

| Option | Risk | Verdict for #606 |
|--------|------|------------------|
| **A. Optional outbox model package move** (`deliveryOutboxRecord` → `model`/`repository`) | High — crosses package boundaries, touches GORM hooks/repo helpers/tests, still optional after #551 private ownership | **Deferred** — not lower risk |
| **B. AttachmentService thin first seam** (`ObjectStorage` ownership) | Low — same-package port pattern as Message/Session/Contact; storage already interface-shaped | **Chosen** |

#### File ownership (current, post-#606)

| Path | Owns | Notes |
|------|------|-------|
| `service/attachment.go` (~400) | `AttachmentService` + `ObjectStorage` port; LocalStorage / S3Storage implementers; probe/save/store/get/delete/presign/access; mime/size policy | **#606 thin first seam** — methods already on typed service; port ownership hardened |
| `service/attachment_test.go` | storage + metadata + mime coverage + port no-op / SetStorage tests | Handler interface tests remain in `handler/` |
| `handler/attachment.go` | thin handler interface over `AttachmentService` methods | **Unchanged** |
| `app/wiring.go` | `NewAttachmentService(db, uploadCfg, storage)` | Signature still accepts `ObjectStorage` via port |

#### Landed thin shape (#606)

```go
type ObjectStorage interface {
    Put(ctx context.Context, key string, body io.Reader, contentType string) (bool, error)
    Get(ctx context.Context, key string) (io.ReadCloser, error)
    Delete(ctx context.Context, key string) error
    LocalPath(key string) string
    PresignURL(ctx context.Context, key, contentType, contentDisposition string, expiresIn time.Duration) (string, error)
}

type AttachmentService struct {
    db        *gorm.DB
    uploadCfg config.UploadConfig
    storage   ObjectStorage
}

// NewAttachmentService(db, uploadCfg, storage)
// SetStorage for tests; storagePort() nil-safe on blob paths
```

- Methods stay on `*AttachmentService` (already extracted historically; #606 is port ownership, not method relocation).
- No package move; no OpenAPI / handler / frontend changes.
- Optional outbox model package move remains deferred/high-risk.

#### Acceptance checklist — AttachmentService thin first seam (#606 this PR)

- [x] `ObjectStorage` port ownership docs on `AttachmentService` (same package)
- [x] Nil-safe blob paths; `SetStorage` injector
- [x] Ownership docs: probe/save/store/get/delete/presign/access + mime policy
- [x] **No** package move; **no** OpenAPI/handler/frontend; **no** outbox model move
- [x] Existing attachment tests green; storage port unit tests added
- [x] Boundary map residual next = IM subpackages / optional outbox model package move

### 6f. DispatchService residual ports cleanup (#617)

#### Decision: residual ports over package move

| Option | Risk | Verdict for #617 |
|--------|------|------------------|
| **A. Full `DispatchService` package move** | Highest — exports `dispatchPayload` or redesigns Redispatcher opaque JSON; touches app wiring heavily | **Deferred** |
| **B. Residual ports / composition cleanup** (narrow cache/ws ports + Set* + nil-safe publish) | Low–med — same-package; keeps payload private; matches Message/Attachment port pattern | **Chosen** |

#### File ownership (current, post-#617)

| Path | Owns | Notes |
|------|------|-------|
| `service/agent_dispatch.go` (~1,1xx) | `DispatchService` + residual ports (`dispatchBus` / `dispatchOutbox` / `dispatchCache` / `dispatchWS` / relay); pure helpers; trigger/dispatch/cancel/regenerate/redispatch; facades | **#617 residual ports** after #563/#573 |
| `service/agent_logic_test.go` + `agent_test.go` + `delivery_outbox_test.go` | pure helper + dispatchTask + residual port unit tests | Handler interfaces unchanged |
| `service/agent.go` | composition `dispatch *DispatchService` via `NewDispatchService` | Signature still accepts concrete deps via ports |
| `service/delivery_outbox.go` | `dispatchRedispatcher` adapter only | Unchanged ownership |

#### Landed residual shape (#617)

```go
type dispatchCache interface {
    GetRoute(ctx context.Context, userID, deviceType string) (string, error)
    GetRouteForDevice(ctx context.Context, userID, deviceType, deviceID string) (string, error)
    PushPendingTask(ctx context.Context, userID, taskJSON string) error
    PushPendingTargetTask(ctx context.Context, userID, targetID, deviceID, taskJSON string) error
}

type dispatchWS interface {
    FindByConnID(connID string) *ws.Conn
    PushToConn(connID string, frame ws.Frame) ws.DeliveryResult
}

type DispatchService struct {
    db          *gorm.DB
    bus         dispatchBus
    mgr         dispatchWS
    cacheClient dispatchCache
    relay       relayDispatcher
    outbox      dispatchOutbox
}

// NewDispatchService(db, bus, mgr, cache, relay, outbox)
// SetBus / SetOutbox / SetCache / SetManager / SetRelay
// publish() + record/mark/dead-letter nil-safe
```

- Pure helpers remain package-private in `agent_dispatch.go` (covered by `agent_logic_test`).
- No package move; no OpenAPI / handler / frontend changes; `dispatchPayload` private.

#### Acceptance checklist — Dispatch residual ports (#617 this PR)

- [x] Narrow `dispatchCache` / `dispatchWS` ports on `DispatchService` (same package)
- [x] Nil-safe `publish` + outbox wrappers; `SetBus` / `SetOutbox` / `SetCache` / `SetManager` / `SetRelay`
- [x] Ownership docs: trigger/dispatch/cancel/regenerate/redispatch + pure helpers
- [x] **No** package move; **no** OpenAPI/handler/frontend; **no** `dispatchPayload` export
- [x] Existing dispatch + outbox tests green; residual port unit tests added
- [x] Boundary map residual next = IM subpackages / optional outbox model package move

### 6g. First IM typed-service package move (#662 landed; sketch from #651)

#### Status

**DONE in #662.** Package `hub-server/internal/service/messagereaction` owns typed reaction orchestration. Flat `service/message_reaction.go` removed. Pure helpers remain in `service/im`.

### 6h. Second IM typed-service package move (#673 landed; Workspace)

#### Status

**DONE in #673.** Package `hub-server/internal/service/workspace` owns typed workspace project/thread orchestration. Flat `service/workspace.go` removed. Pure helpers remain in `service/im`. Service stays **DB-only** — no bus/cache ports invented.

#### Decision for #651

| Option | Risk | Verdict for #651 |
|--------|------|------------------|
| **A. Invent workspace bus/cache ports** | Low code, **wrong seam** — WorkspaceService has no bus/cache consumers; inventing ports adds dead injectors | **Rejected** |
| **B. Pure residual + typed-move sketch** (workspace name/description + reaction summary helpers; document first package move) | Lowest real residual | **Chosen** |
| **C. Big-bang typed IM package move** (message+session+contact+attachment+reaction+workspace) | Highest — multi-service wiring, handler interface churn risk | **Out of scope** |

#### Why MessageReaction first (recommended next PR)

| Candidate | Approx prod LOC | Ports already | External deps | Why rank |
|-----------|----------------:|---------------|---------------|----------|
| **`MessageReactionService`** | ~210 | `messageReactionBus` | pure `im` + repo | **Smallest** typed IM service; bus port + pure helpers closed; fewest call sites |
| `WorkspaceService` | ~360 | none (DB-only) | pure `im` + repo | Independent but projection DTOs + thread/message orchestration; better after reaction move proves package pattern |
| `ContactService` | ~380 | bus+cache | repo | Medium; ports done, but larger than reaction |
| `AttachmentService` | ~420 | `ObjectStorage` | storage implementers | Storage package edge more coupled |
| `SessionService` | ~760 | bus+cache | agent cleanup | Larger lifecycle surface |
| `MessageService` | ~780 | bus+cache | attachments | Largest IM orchestration; move last among IM |

#### Landed package shape (#662)

```go
// hub-server/internal/service/messagereaction/  (not service/im)
package messagereaction

type Bus interface {
    Publish(ctx context.Context, event service.Event)
}

type Service struct {
    db  *gorm.DB
    bus Bus
}

// Methods + DTOs moved:
// AddMessageReaction / RemoveMessageReaction / ListMessageReactions
// MessageReactionResponse / MessageReactionEventPayload
// + private access/snapshot helpers
// Pure helpers stay in service/im (already)
```

**Acceptance (#662)**

- [x] New package owns typed reaction methods + response/event DTOs
- [x] Injected bus port stays interface-shaped; `*service.Bus` satisfies from wiring
- [x] Pure helpers remain in `service/im` (no re-embed into typed package)
- [x] Wiring/app/handler/tests point at new package without OpenAPI change
  (flat type aliases not used — import cycle with `service.Event`)
- [x] **One** service only — no multi-service move in the same PR
- [x] `go test` green for new package + residual flat service/app/handler/router tests
- [x] No OpenAPI / handler contract / frontend redesign

#### File ownership (current, post-#662/#673)

| Path | Owns | Notes |
|------|------|-------|
| `service/im/` (~280) | pure content/attachment/reaction/workspace-content/workspace-fields + reaction summary | **#628/#639/#651** pure only |
| `service/messagereaction/` (~217) | typed `Service` + `Bus` + DTOs + add/remove/list | **#662** first IM typed package |
| `service/workspace/` (~370) | typed `Service` (DB-only) + DTOs + project/thread CRUD | **#673** second IM typed package |
| `handler/message.go` | thin handler interface; reaction DTOs from `messagereaction` | compile path only; JSON names stable |
| `handler/workspace.go` | thin handler interface; workspace DTOs from `workspace` | compile path only; JSON names stable |
| `app/wiring.go` | `messagereaction.NewService(db, bus)`, `workspace.NewService(db)` | agentteam-style import |

**Acceptance (#673)**

- [x] New package owns typed workspace methods + response/request DTOs
- [x] DB-only construction (`NewService(db)`); **no** invented bus/cache ports
- [x] Pure helpers remain in `service/im` (no re-embed into typed package)
- [x] Wiring/handler/tests point at new package without OpenAPI change
- [x] **One** service only — no multi-service move in the same PR
- [x] `go test` green for new package + residual flat service/app/handler tests
- [x] No OpenAPI / handler contract / frontend redesign

### 6i. Third IM typed-service package move (#685 landed; Contact)

#### Status

**DONE in #685.** Package `hub-server/internal/service/contact` owns typed contact/friendship orchestration. Flat `service/contact.go` removed. Bus + Cache ports (from #594) remain interface-shaped. No pure helpers lived under contact to leave in `service/im`.

#### Landed package shape (#685)

```go
// hub-server/internal/service/contact/  (not service/im)
package contact

type Bus interface {
    Publish(ctx context.Context, event service.Event)
}

type Cache interface {
    Invalidate(ctx context.Context, keys ...string) error
    IsOnline(ctx context.Context, userID string) (bool, error)
}

type Service struct {
    db  *gorm.DB
    bus Bus
    cacheClient Cache
}

// Methods + DTOs moved:
// SearchUser / SendFriendRequest / ListFriendRequests / Accept/Reject
// ListContacts / RemoveContact / Block/Unblock / UpdateRemark / GetFriendIDs
// SearchResult / RequestInfo / ContactInfo
```

**Acceptance (#685)**

- [x] New package owns typed contact methods + response DTOs
- [x] Injected bus + cache ports stay interface-shaped; `*service.Bus` / `*cache.Client` satisfy from wiring
- [x] Wiring/app/handler/tests point at new package without OpenAPI change
- [x] **One** service only — no multi-service move in the same PR
- [x] `go test` green for new package + residual flat service/app/handler tests
- [x] No OpenAPI / handler contract / frontend redesign

#### File ownership (current, post-#662/#673/#685/#697)

| Path | Owns | Notes |
|------|------|-------|
| `service/im/` (~280) | pure content/attachment/reaction/workspace-content/workspace-fields + reaction summary | **#628/#639/#651** pure only |
| `service/messagereaction/` (~217) | typed `Service` + `Bus` + DTOs + add/remove/list | **#662** first IM typed package |
| `service/workspace/` (~370) | typed `Service` (DB-only) + DTOs + project/thread CRUD | **#673** second IM typed package |
| `service/contact/` (~400) | typed `Service` + Bus/Cache + DTOs + search/request/list/block | **#685** third IM typed package |
| `service/attachment/` (~420) | typed `Service` + ObjectStorage + LocalStorage/S3Storage + DTOs | **#697** fourth IM typed package |
| `handler/attachment.go` | thin handler interface; `service.IsValidAttachmentHash` thin aliases | compile path only; JSON names stable |
| `app/wiring.go` | `messagereaction.NewService`, `workspace.NewService`, `contact.NewService`, `attachment.NewService` | agentteam-style import |

### 6j. Fourth IM typed-service package move (#697 landed; Attachment)

#### Status

**DONE in #697.** Package `hub-server/internal/service/attachment` owns typed attachment orchestration + ObjectStorage port + LocalStorage/S3Storage implementers + NewS3StorageFromConfig. Flat `service/attachment.go` stripped to thin aliases (`IsValidAttachmentHash`/`PathFromHash`/`NormalizeAttachmentMetadataJSON` → `im`). Flat `service/s3_client.go` and `service/attachment_test.go` removed. Pure helpers remain in `service/im`.

#### Landed package shape (#697)

```go
// hub-server/internal/service/attachment/  (not service/im)
package attachment

type ObjectStorage interface {
    Put(ctx context.Context, key string, body io.Reader, contentType string) (bool, error)
    Get(ctx context.Context, key string) (io.ReadCloser, error)
    Delete(ctx context.Context, key string) error
    LocalPath(key string) string
    PresignURL(ctx context.Context, key, contentType, contentDisposition string, expiresIn time.Duration) (string, error)
}

type Service struct {
    db        *gorm.DB
    uploadCfg config.UploadConfig
    storage   ObjectStorage
}

// Methods + storage port moved:
// ProbeAttachment / SaveAttachment / SaveAttachmentWithMetadata / StoreBlob / GetBlob
// DeleteBlob / BlobLocalPath / PresignBlobURL / GetAttachmentByID / MaxUploadSize
// IsAttachmentMimeTypeAllowed
// + LocalStorage / S3Storage implementers + NewS3StorageFromConfig
// Pure helpers stay in service/im (already)
```

**Acceptance (#697)**

- [x] New package owns typed attachment methods + ObjectStorage port + LocalStorage/S3Storage
- [x] ObjectStorage port stays interface-shaped; `attachment.NewS3Storage` / `attachment.NewLocalStorage` provide impls
- [x] Pure helpers remain in `service/im` (no re-embed into typed package)
- [x] Wiring/app/handler/tests point at new package without OpenAPI change
- [x] Thin aliases (`IsValidAttachmentHash`/`PathFromHash`/`NormalizeAttachmentMetadataJSON`) preserved in flat `service` for handler/test call sites
- [x] Flat `s3_client.go` moved to new package; `attachment_test.go` moved to new package
- [x] **One** service only — no multi-service move in the same PR
- [x] `go test` green for new package + residual flat service/app/handler/router tests
- [x] No OpenAPI / handler contract / frontend redesign

### 6k. Sixth IM typed-service package move (`service/message`, #720)

| Field | Value |
|-------|-------|
| Title | Sixth IM typed-service package move Message |
| Depends on | #708 Session package move; #585 Message bus+cache ports |
| Scope | Move **only** `MessageService` to `service/message` (agentteam-style); keep pure helpers in `service/im`; preserve handler contracts |
| Non-goals | Multi-service move; OpenAPI/frontend redesign; DispatchService package move; outbox model package move |
| Primary files | `service/message.go` → `service/message/`; `app/wiring.go` / `app.go`; handler/tests; boundary map |
| Decision | **Landed #720** — Bus+Cache ports stay interface-shaped; pure helpers remain in `im`; flat `message.go` removed |

## 7. Bottom line

- **Map:** six domains in flat package; **agent_runtime** still dominates residual flat surface; **agentteam** is the extract template; **`agentevent`** + **`deliveryoutbox`** + **`im`** + **`dispatch`** (~1963 pure) are pure seams; **`messagereaction`** + **`workspace`** + **`contact`** + **`attachment`** + **`session`** + **`message`** are IM typed-service extracts; **`RunEventService`**, **`EdgeCallbackService`**, **`DeliveryOutbox`**, and **`DispatchService`** (**786** orchestration live) remain orchestration type extracts still flat (#478/#505/#540/#563/#573/#617 + later peels).
- **Highest remaining coupling:** package flatness + `AgentService` facade/custom-agent surface; runtime redispatch + residual ports + **Dispatch pure residual closed** (#732→#823) on `DispatchService` / `service/dispatch`; optional outbox model package move still high-risk; primary IM typed-service package moves **closed** (#662/#673/#685/#697/#708/#720). Live open peels: Phase 61 **#1067–#1069** — see `docs/progress/MASTER.md`.
- **Landed:** pure **`agentevent`** (#468) + **`RunEventService`** (#478) + **`EdgeCallbackService`** (#505) + pure **`deliveryoutbox`** (#514) + **#528 docs sketch** + **#540 thin `DeliveryOutbox` + opaque `Redispatcher`** + **#551 model residual** + **#563 thin `DispatchService` first seam** + **#573 redispatch residual** + **#585 MessageService thin first seam** + **#593 SessionService thin first seam** + **#594 ContactService thin first seam** + **#606 AttachmentService thin first seam** + **#617 DispatchService residual ports** + pure **`im`** (#628) + deeper pure **`im`** + **MessageReaction bus port** (#639) + workspace field pure helpers + reaction summary pure helpers + typed-move sketch (#651) + **first IM typed package `messagereaction` (#662)** + **second IM typed package `workspace` (#673)** + **third IM typed package `contact` (#685)** + **fourth IM typed package `attachment` (#697)** + **fifth IM typed package `session` (#708)** + **sixth IM typed package `message` (#720)** + pure **`dispatch`** (#732→#811) + **Dispatch pure residual closed (#823)** + Phase 58 partial peels (#1030–#1032/#1034 closed).
- **Pure residual (runtime / dispatch):** **closed** (#732→#823) with ongoing orchestration peels under Phase 61 (#1068). **Pure residual (IM):** first + deeper + #651 residual **landed** (#628/#639/#651). **IM typed package residual:** **closed** for primary surfaces (#662/#673/#685/#697/#708/#720).
- **#540 decision:** thin same-package extract **landed**. Redispatch initially stayed on `AgentService` behind port; no DispatchService big-bang.
- **#551 decision:** model ownership residual **landed** (option A). Private GORM record + repo helpers on `DeliveryOutbox`; `DeliveryOutboxEntry` scan view; redispatch `redispatchTarget`; edge-callback acker removed. Full package move deferred.
- **#563 decision:** thin same-package `DispatchService` **landed**. Trigger/dispatch/cancel/regenerate + edge HTTP/capability/history moved; facades preserve handlers; `dispatchPayload` stays private.
- **#573 decision:** redispatch residual **landed** on `DispatchService`. `dispatchRedispatcher` injects DispatchService into `DeliveryOutbox`; lazy adapter avoids test-literal construction recursion; payload remains private.
- **#585 decision:** MessageService thin first seam **landed**. Ports `messageBus` / `messageCache` + nil-safe publish; methods already on typed service; no package move.
- **#593 decision:** SessionService thin first seam **landed**. Ports `sessionBus` / `sessionCache` + nil-safe publishEvent; methods already on typed service; no package move.
- **#594 decision:** ContactService thin first seam **landed**. Ports `contactBus` / `contactCache` + nil-safe publish; methods already on typed service; no package move.
- **#606 decision:** AttachmentService thin first seam **landed** (Option B). `ObjectStorage` ownership + `SetStorage` + nil-safe blob paths; methods already on typed service; Option A outbox model package move deferred as higher risk.
- **#617 decision:** DispatchService residual ports cleanup **landed**. Narrow `dispatchCache` / `dispatchWS` + Set* injectors + nil-safe publish/outbox; pure helpers stay package-private; no package move / payload export.
- **#628 decision:** first IM subpackage seam **landed** as pure helpers only (`service/im` content normalize + attachment hash/path/metadata). Chosen over agent_dispatch residual pure helpers because IM helpers are lower coupling and directly start the IM package boundary. Thin aliases preserve same-package/handler surfaces; typed IM service package moves deferred.
- **#639 decision:** deeper IM residual **landed** as pure reaction/workspace-content helpers plus `MessageReactionService` `messageReactionBus` thin port. Chosen over inventing workspace bus/cache ports (WorkspaceService is DB-only) and over typed IM package moves (still higher risk). Thin aliases preserve same-package surfaces; no OpenAPI/handler/frontend.
- **#651 decision:** workspace ports residual **closed as N/A** (still DB-only). Landed remaining pure workspace name/description helpers + reaction summary projection helpers in `service/im`, plus §6g first typed-move sketch recommending **MessageReactionService** as the smallest next package extract. No big-bang typed IM move; no OpenAPI/handler/frontend.
- **#662 decision:** first IM typed-service package move **landed** as `service/messagereaction` (agentteam-style). Bus port + DTOs + methods moved; pure helpers stay in `service/im`; wiring/app/handler/tests updated; flat aliases avoided (import cycle with `service.Event`). One service only; no OpenAPI/handler/frontend redesign.
- **#673 decision:** second IM typed-service package move **landed** as `service/workspace` (agentteam-style). DTOs + methods moved; pure helpers stay in `service/im`; DB-only (no invented bus/cache ports); wiring/handler/tests updated; flat `workspace.go` removed. One service only; no OpenAPI/handler/frontend redesign.
- **#685 decision:** third IM typed-service package move **landed** as `service/contact` (agentteam-style). Bus+Cache ports + DTOs + methods moved; wiring/app/handler/tests updated; flat `contact.go` removed. One service only; no OpenAPI/handler/frontend redesign.
- **#697 decision:** fourth IM typed-service package move **landed** as `service/attachment` (agentteam-style). ObjectStorage port + LocalStorage/S3Storage + Service + methods moved; wiring/app/handler/tests updated; flat `attachment.go` stripped to thin aliases (`IsValidAttachmentHash`/`PathFromHash`/`NormalizeAttachmentMetadataJSON` → `im`); `s3_client.go` moved into new package. Pure helpers stay in `service/im`; thin aliases preserved for handler/test call sites. One service only; no OpenAPI/handler/frontend redesign.
- **#708 decision:** fifth IM typed-service package move **landed** as `service/session` (agentteam-style). Bus+Cache ports + DTOs + methods moved; wiring/app/handler/tests updated; flat `session.go` removed. One service only; no OpenAPI/handler/frontend redesign.
- **#720 decision:** sixth IM typed-service package move **landed** as `service/message` (agentteam-style). Bus+Cache ports + DTOs + methods moved; pure helpers remain in `service/im`; wiring/app/handler/tests updated; flat `message.go` removed. One service only; no OpenAPI/handler/frontend redesign.
- **#732→#811 decision:** Dispatch pure residual **continued** into `service/dispatch` (Message/Payload DTOs, Edge request, team/target/capability/redelivery, routing classifiers, task-access/events, mint resolve, model→DTO mappers, redispatch prep). Pure package tip ~1963 prod LOC; thin aliases retained; typed package move deferred.
- **#823 decision:** Dispatch pure residual **closed**. Boundary map + ownership comments refreshed to match code (#756–#811 chain). No further pure-only extract (remaining free funcs are thin aliases; redispatch body is WS/cache/DB orchestration). Next real seam = optional typed `DispatchService` package move (high risk) or leave flat. No OpenAPI/handler/frontend; no payload JSON redesign.
- **Phase 61 tip recount (2026-07-18):** tip `a26a2828` (progress baseline clean via #1072–#1076); `agent_dispatch.go` **786**; `delivery_outbox.go` **469** (+ facade/model companions); pure `dispatch/` ~1963. Open residual peels: **#1067** process_executor · **#1068** agent_dispatch · **#1069** sqlite_store (see `docs/progress/MASTER.md`).
- **Next code step:** Phase 61 open peels only (#1067–#1069); optional outbox model package move / optional `DispatchService` package move remain deferred/high-risk.

## Key paths

- `hub-server/internal/service/`
- `hub-server/internal/service/agentevent/`
- `hub-server/internal/service/deliveryoutbox/`
- `hub-server/internal/service/agentteam/`
- `hub-server/internal/service/agent_run_event.go` (`RunEventService`)
- `hub-server/internal/service/agent_edge_callback.go` (`EdgeCallbackService`)
- `hub-server/internal/service/delivery_outbox.go` (`DeliveryOutbox` + private model ownership + Redispatcher adapter; **469** LOC + companions)
- `hub-server/internal/service/agent_dispatch.go` (`DispatchService` + redispatch residual + facades; private `dispatchPayload`; **786** orchestration at tip; pure residual closed #823; further peel **#1068**)
- `hub-server/internal/service/dispatch/` (pure helpers ~1963 prod LOC; #732→#811; pure residual closed #823)
- `hub-server/internal/service/message/` (typed `message.Service` + Bus/Cache ports; flat `message.go` **removed** #720)
- `hub-server/internal/service/session/` (typed `session.Service` + Bus/Cache ports; flat `session.go` **removed** #708)
- `hub-server/internal/service/attachment.go` (`ObjectStorage` thin aliases after #697)
- `hub-server/internal/service/attachment/` (typed attachment Service + ObjectStorage + LocalStorage/S3Storage + s3_client; #606 + #697)
- `hub-server/internal/service/s3_client.go` (**removed in #697**; moved to `service/attachment/s3_client.go`)
- `hub-server/internal/service/messagereaction/` (typed reaction Service + Bus + DTOs; #662)
- `hub-server/internal/service/workspace/` (typed workspace Service + DTOs; DB-only; #673)
- `hub-server/internal/service/contact/` (typed contact Service + Bus/Cache + DTOs; #685)
- `hub-server/internal/service/im/` (pure IM content/attachment/reaction/workspace-content/workspace-fields helpers; #628/#639/#651)
- `hub-server/internal/app/wiring.go` (`StartDeliveryRetryLoop`, `NewMessageService`, `NewSessionService`, `attachment.NewService`, `messagereaction.NewService`, `workspace.NewService`, `contact.NewService`)
- `docs/analysis/cleanup-strategy.md` (archived-program pointer)
- `docs/progress/MASTER.md` (live Phase 61 progress SSOT)
