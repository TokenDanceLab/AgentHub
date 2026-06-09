# P1 Live Chain Topology Audit

Date: 2026-06-09
Branch: `codex/p1-live-chain-topology-audit`
Base: `origin/codex/p1-critical-evidence-integration` at `020d6876d5b8401873ff05a0c251b983463fa146`

Scope: code-grounded audit of the product chain:

`Web -> Hub -> execution target inventory -> Desktop/Edge target -> Desktop task bridge -> Local Edge -> CLI/SDK adapter -> Hub replay -> Web rendering`

Non-goals honored: no real login, no real CLI/model run, no product code edits, no mobile, no `docs/roadmap.md` edits.

## Status Legend

| Status | Meaning |
|---|---|
| implemented/proven | The code path exists and has static, unit, smoke, or fixture proof in this repository. |
| implemented but unproven | The code path exists, but the requested live/product proof is absent or outside this task's approval boundary. |
| implemented but runtime-unproven | The code path exists and static pieces are verified, but no dedicated bridge harness or live run proves the runtime path. |
| missing | The required product path is not implemented for this chain. |
| blocked-by-approval | Verification would require real login, real Local Edge/CLI/model execution, or live infrastructure access outside this task. |

## Chain Evidence

| Chain step | Status | Code evidence | Proof evidence | Next code slice |
|---|---|---|---|---|
| Web composer dispatch requires Hub and selected online `local_edge` target | implemented/proven | `app/web/src/platform/webPlatform.ts`: `createWebPlatform`, `submitWebComposerIntent`, `resolveWebDispatchTarget`, `triggerMentionedAgent`; Hub endpoint `POST /web/agent-tasks` via `app/web/src/api/hubClient.ts:triggerAgentTask`. `resolveWebDispatchTarget` filters `target_type === 'local_edge'`, `is_online === true`, and `health_state !== 'offline'`. | `app/web/src/platform/webPlatform.test.ts` checks `target_id` is sent and dispatch failure is surfaced. This audit's verifier checks the selected online `local_edge` filter patterns and production Web source for no direct `127.0.0.1:3210`, `/v1/runs`, `/v1/events`, legacy Edge hooks, or Desktop/Tauri imports. | Keep Web-only dispatch work in `app/web/src/platform/webPlatform.ts` and `app/web/src/api/hubClient.ts`; do not add browser calls to Local Edge. |
| Web TeamRun target selection requires online `local_edge` target | implemented/proven | `app/web/src/views/TeamRunConsole.tsx`: `useHubExecutionTargets`, online `local_edge` filtering, `handleStartRun`, request body `{ trigger_message, target_id }`; `app/web/src/api/hubClient.ts:startTeamRun` uses `POST /web/agent-teams/{id}/runs` | `app/web/src/views/TeamRunConsole.test.tsx` checks selected online `local_edge` target id, no-start when no online `local_edge`, target switching, and dispatch-denied errors. This audit's verifier checks `target_type === 'local_edge'`, `is_online === true`, `health_state !== 'offline'`, and `target_id: selectedRunTarget.id`. | Keep TeamRun launch edits in `app/web/src/views/TeamRunConsole.tsx`; expand tests there when adding target UX states. |
| Hub route surface for Web tasks, target inventory, TeamRun, and Edge callbacks | implemented/proven | `hub-server/internal/router/router.go`: `/web/agent-tasks`, `/web/execution-targets`, `/web/agent-teams/...`, `/edge/devices/register`, `/edge/agent-tasks/:id/ack`, `/stream`, `/done`, and `/fail`. Handlers: `hub-server/internal/handler/agent.go`, `agent_team.go`, `execution_target.go`, `device.go` | `hub-server/internal/handler/device_openapi_test.go` verifies OpenAPI/router route parity and device-type metadata. `hub-server/internal/handler/edge_protocol_test.go` covers device registration, Web trigger, target id pass-through, callbacks, and event summary. This audit's verifier now checks all four callback route registrations. | Route additions must update `hub-server/internal/router/router.go`, handler tests, and `api/openapi.yaml` together. |
| Hub target-bound task validation | implemented/proven | `hub-server/internal/service/agent_dispatch.go`: `TriggerAgentTask`, `validateDispatchTarget`, `dispatchTargetBoundTask`. Validation accepts only owner-owned `local_edge` targets bound to owner-owned Desktop devices. It rejects non-`local_edge`, missing device, wrong owner, and non-Desktop device. | `hub-server/internal/handler/edge_protocol_test.go` proves `target_id` reaches service. Existing static verifier in this branch checks the concrete validation symbols. | Next dispatch expansion belongs in `validateDispatchTarget` first, then `dispatchTargetBoundTask`, with tests proving each allowed target type and rejection case. |
| Hub execution target inventory | implemented/proven for local Edge inventory; implemented but unproven for remote/cloud dispatch | `hub-server/internal/service/execution_target.go`: CRUD/list/ping, `UpsertLocalEdgeForDesktopDevice`, `Ping`. `Ping` marks `local_edge` online directly and probes `remote_ssh`, `tailscale`, `cloud_edge` via `/v1/health`; `hub_relay` depends on relay online proof. Migration `hub-server/migrations/0047_execution_target_local_edge_uniqueness.up.sql` keeps active local Edge unique per owner/device. | `hub-server/internal/handler/execution_target_test.go`, `hub-server/internal/handler/device_test.go`, and OpenAPI route tests cover inventory surface. | Remote/cloud/relay cannot become Web-dispatchable until `validateDispatchTarget` and delivery semantics are implemented and tested. |
| Desktop Hub task bridge readiness | implemented/proven statically; live login/registration unproven | `app/desktop/src/components/DesktopHubTaskBridge.tsx` gates bridge activation on Hub auth and registered Desktop device. It calls `useHubIntegration` only after `deviceReady`. | Static verifier checks bridge component and hook presence. Product-live proof requires real Desktop login/device registration, which is out of scope. | Add an integration test around `DesktopHubTaskBridgeActive` if bridge readiness regresses; keep product logic in `useHubIntegration`. |
| Desktop task bridge from Hub to Local Edge | implemented but runtime-unproven | `app/desktop/src/hooks/useHubIntegration.ts`: listens for Hub `agent.dispatch`, ensures Edge thread, `fetch(`${edgeBaseUrl}/v1/runs`, ...)`, maps Hub task id to Edge run id, calls `ackTask`, subscribes Local Edge `/v1/events`, forwards typed events using `streamTaskEvent`, posts `doneTask`/`failTask`, handles `agent.cancel` and `agent.control` permission decisions. | Static verifier checks the bridge symbols, and Edge/Hub tests prove compatible REST shapes separately. No dedicated hook harness or live Desktop-to-Local-Edge run proves this runtime bridge yet. | Add `app/desktop/src/hooks/useHubIntegration.test.tsx` or equivalent fixture harness that mocks Hub WS, Local Edge REST/WS, and Hub callback client. |
| Local Edge run API | implemented/proven | `edge-server/internal/api/handlers.go`: `PostRuns` implements `POST /v1/runs`, validates project/thread, workspace allowlist, permission mode, active run conflict, executor availability, unknown `agentId`, and carries `hubTaskId` into `lifecycle.RunProcessContext`. `GetEvents` implements `/v1/events`. `edge-server/internal/httpserver/server.go` wires executor, adapters, local token auth, and Hub callback client. | `edge-server/tests/hub_integration_test.go` simulates Hub dispatch arriving at Edge `/v1/runs`; `edge-server/tests/hub_e2e_test.go` spins up a real Edge server plus mock Hub and verifies callbacks. | Local Edge API changes belong in `edge-server/internal/api/handlers.go`; executor wiring changes belong in `edge-server/internal/httpserver/server.go`. |
| CLI adapter execution | implemented but unproven against real model | `edge-server/internal/lifecycle/process_executor.go`: `ProcessExecutor.Start`, `run`, `publishStructuredOutput`, `fireHubAck`, `fireHubStream`, `fireHubDone`, `fireHubFail`. `edge-server/internal/adapters/adapter.go` defines `BuildCommand`. `edge-server/internal/adapters/codex.go` builds `codex exec --json --skip-git-repo-check --cd ...`; capabilities mark streaming false for phase 1. | Existing Edge tests use no-op commands, mock Hub, and fixture streams. This task did not run a real Codex/Claude/OpenCode CLI or model. | Real adapter proof needs an approved local smoke such as `scripts/verify-edge-cli-real-readiness.ps1` plus a safe workspace and real CLI credentials. |
| SDK adapter projection | implemented but fixture-only | `edge-server/internal/adapters/sdk_fixture_mapper.go`: `SDKFixtureStream`, `MapSDKFixtureStream`, fixture loader. | `tests/scripts/verify-edge-cli-dispatch-evidence.ps1` references lifecycle fixture replay; no real SDK provider is exercised by this task. | Replace or supplement fixture mapper with provider-backed SDK adapter tests before claiming production SDK support. |
| Edge-to-Hub replay/callback storage | implemented/proven | Desktop bridge uses `hubClient.streamTaskEvent`, `doneTask`, `failTask`; Edge direct callback path uses `ProcessExecutor` Hub callback helpers when `HubTaskID` and Hub callback config are set. Hub persists callbacks through `hub-server/internal/handler/agent.go` and agent service callback methods. | `hub-server/internal/handler/edge_protocol_test.go` covers callback lifecycle and summary; `edge-server/tests/hub_e2e_test.go` verifies Edge direct callback format. | Decide whether Desktop-mediated callbacks or Edge direct callbacks are the product default, then document and test only that primary path end-to-end. |
| Web replay/rendering | implemented/proven for Web workbench messages/runtime transcript; implemented but partial for live TeamRun stream | `app/web/src/platform/useWebWorkbenchModel.ts`: loads Hub messages, pins, contacts, projects, `useHubExecutionTargets`, `useWebHubRealtime`, `resolveWebWorkbenchTranscript`, and exposes `composerExecutionTargets`. `app/web/src/views/TeamRunConsole.tsx` loads team run/state/tasks/events via Hub polling/refetch. | `app/web/src/platform/useWebWorkbenchModel.test.ts` and TeamRunConsole tests cover rendering states. TeamRun live rendering is not a true live event stream; it is Hub replay/refetch driven. | Add live TeamRun event subscription or explicit polling cadence tests in `TeamRunConsole.tsx` and `app/web/src/api/hubClient.ts` before claiming live TeamRun rendering. |
| Full product live chain | blocked-by-approval | Chain requires Web Hub auth, Desktop Hub auth/device registration, Local Edge sidecar, real CLI credentials, workspace allowlist, and model/API execution. | This task explicitly forbids real login and real CLI/model runs. | Approval slice: run a bounded local product smoke with a throwaway workspace and record the exact Web session id, target id, Hub task id, Edge run id, callback/event seq ids, and rendered Web transcript evidence. |

## Exact Implementation Gaps

1. **No approved full live proof from Web to rendered replay.**
   - Gap: existing evidence is composed from unit/static/fixture tests, not a single product run.
   - Next files/endpoints: `app/web/src/platform/webPlatform.ts`, `hub-server/internal/service/agent_dispatch.go`, `app/desktop/src/hooks/useHubIntegration.ts`, `edge-server/internal/api/handlers.go`, `hub-server/internal/handler/agent.go`, `app/web/src/platform/useWebWorkbenchModel.ts`; endpoints `POST /web/agent-tasks`, Hub WS `agent.dispatch`, Local Edge `POST /v1/runs`, Local Edge `GET /v1/events`, Hub callbacks `POST /edge/agent-tasks/{id}/{ack,stream,done,fail}`, Web replay `GET /web/agent-tasks/{id}/events` and `/summary`.
   - Proof needed: one bounded real smoke with concrete ids across every hop.

2. **Remote/cloud/relay execution targets are inventory/health concepts, not Web-dispatchable product targets.**
   - Gap: `validateDispatchTarget` rejects every target type except `local_edge`.
   - Next files/functions: `hub-server/internal/service/agent_dispatch.go:validateDispatchTarget`, `dispatchTargetBoundTask`; `hub-server/internal/service/execution_target.go:Ping`; `hub-server/internal/repository/execution_target*.go`; route tests in `hub-server/internal/handler/edge_protocol_test.go`.
   - Proof needed: target-type-specific allow/deny tests and delivery tests for remote SSH, Tailscale, cloud Edge, or relay before exposing them in Web dispatch.

3. **Desktop `useHubIntegration` lacks a dedicated bridge harness.**
   - Gap: the hook owns the critical Hub WS -> Local Edge REST/WS -> Hub callback bridge, but no hook-level test proves it with mocked Hub WS and Edge endpoints.
   - Next files/functions: `app/desktop/src/hooks/useHubIntegration.ts`, `DesktopHubTaskBridge.tsx`; new test `app/desktop/src/hooks/useHubIntegration.test.tsx` or a narrow bridge fixture.
   - Proof needed: mock `agent.dispatch`, assert `POST /v1/runs` body includes task/profile/thread/model params, assert `ackTask`, `streamTaskEvent`, `doneTask`/`failTask`, cancel, and `agent.control` behavior.

4. **Real CLI/SDK adapter execution is not proven by this chain.**
   - Gap: `CodexAdapter.BuildCommand` builds a plausible command and fixture tests prove callback shapes, but no real CLI/model run occurred under this task.
   - Next files/functions: `edge-server/internal/adapters/codex.go:BuildCommand`, `edge-server/internal/lifecycle/process_executor.go:publishStructuredOutput`, `edge-server/internal/adapters/sdk_fixture_mapper.go`, `scripts/verify-edge-cli-real-readiness.ps1`.
   - Proof needed: approved local real CLI smoke that records command plan, run status, output events, and Hub callback/replay ids without leaking credentials.

5. **TeamRun replay is code-complete for state derivation but not proven as a live UX loop.**
   - Gap: `StartTeamRun`, route decisions, assignments, task bindings, state replay, approvals, artifacts, conflicts, and budget structures exist, but Web TeamRun rendering is refetch/replay driven and no real supervisor runtime route decision was executed.
   - Next files/functions/endpoints: `hub-server/internal/service/agent_team.go:StartTeamRun`, `HandleRouteDecision`, `DispatchAssignment`, `GetTeamRunState`; `app/desktop/src/hooks/useHubIntegration.ts:postRouteDecision`; `app/web/src/views/TeamRunConsole.tsx`; endpoints `POST /web/agent-teams/{id}/runs`, `POST /web/agent-teams/{id}/runs/{run_id}/route-decisions`, `POST /web/agent-teams/{id}/runs/{run_id}/assignments/{assignment_id}/dispatch`, `GET /web/agent-teams/{id}/runs/{run_id}/state`.
   - Proof needed: approved supervisor runtime run that emits `run.agent.route_decision`, Hub creates/dispatches assignment, worker result returns, and Web shows final state.

## Verifier Added

`scripts/verify-live-chain-topology.ps1` is a static guard for this audit. It checks:

- Required route/service/Web/Desktop/Edge files exist.
- Hub route and handler symbols for Web tasks, execution targets, TeamRun, Edge device registration, and all four Edge task callbacks (`ack`, `stream`, `done`, `fail`) exist.
- Hub dispatch validation still routes Web tasks only through target-bound Desktop `local_edge` inventory.
- Web composer and TeamRun still filter selected targets through online `local_edge` inventory (`target_type === 'local_edge'`, `is_online === true`, `health_state !== 'offline'`) and send `target_id`.
- Desktop bridge still owns `agent.dispatch` -> Local Edge `/v1/runs` and `/v1/events` -> Hub callback forwarding.
- Local Edge still exposes `/v1/runs`, carries `hubTaskId`, rejects unknown adapters, and uses `ProcessExecutor`.
- Codex adapter still builds the real CLI command through `BuildCommand`.
- Production Web source does not introduce direct Local Edge loopback, `/v1/runs`, `/v1/events`, legacy Edge bridge helpers, or Desktop/Tauri imports. The older broad `scripts/verify-web-hub-boundary.ps1` is still tracked as a required file, but this audit verifier does not call it because the current baseline includes test-only loopback references in `app/web/src/__e2e__/oidc-login.spec.ts`.

Wrapper: `tests/scripts/verify-live-chain-topology.ps1`.

## Verification Commands

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-live-chain-topology.ps1 -RepoRoot .
pwsh -NoProfile -ExecutionPolicy Bypass -File .\tests\scripts\verify-live-chain-topology.ps1 -RepoRoot .
git diff --check
```
