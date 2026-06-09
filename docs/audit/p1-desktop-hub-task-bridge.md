# P1 Desktop Hub Task Bridge Audit

> Last updated: 2026-06-09 07:08 +08:00
> Branch: `codex/p1-desktop-hub-task-bridge`
> Base: `origin/codex/p1-critical-evidence-integration` at `020d6876`

## Scope

This audit covers the Hub-to-Desktop remote-control task bridge contract:

- Hub session and WebSocket hookup in `DesktopHubTaskBridge`.
- Hub `agent.dispatch` producer payload for target-bound `local_edge` delivery.
- Desktop device registration and Hub execution-target inventory.
- `agent.dispatch` handoff from Hub to Local Edge via `useHubIntegration`.
- `agent.control` permission decision forwarding to Local Edge.

No Web, Edge Server, CLI/model runtime, signing, release upload, mobile, roadmap, or push/merge/tag changes are included.

## Current Findings

Desktop already had the mechanical task bridge:

- Registers the Desktop device with Hub and advertises `local_edge`, `agent.dispatch`, and `agent.control`.
- Opens the Hub WebSocket after Hub auth.
- Creates Local Edge threads and runs from `agent.dispatch`.
- Maps Hub task IDs to Local Edge run IDs.
- Forwards Local Edge run events back to Hub.
- Applies Hub-originated permission decisions to Local Edge `/v1/permissions/decide`.

The original Desktop gap was that `useHubIntegration` accepted any `agent.dispatch` frame with a `task_id`. That meant Desktop could start a Local Edge run without proving the frame named this Desktop's registered `local_edge` execution target and stable device ID.

The follow-up contract gap was that Hub target-bound dispatch already validated and stored `target_id` plus `edge_device_id`, but the produced `agent.dispatch` JSON payload only included `target_id`. Desktop could therefore fail closed on current Hub frames.

## Implemented Readiness Improvement

Desktop now derives a dispatch preflight from Hub execution-target inventory before enabling the Local Edge handoff:

- `DesktopHubTaskBridge` fetches Hub execution targets after device registration.
- It selects the exact `local_edge` target whose `device_id` matches the registered Desktop device ID.
- It enables `useHubIntegration` only when that target is online and `healthy`.
- It passes the exact `{ targetId, deviceId }` to the bridge hook.

`useHubIntegration` now fails closed when `dispatchTarget` is configured:

- `agent.dispatch` must include matching `target_id` and `edge_device_id` before Desktop creates a Local Edge thread or run.
- Mismatched or incomplete dispatch frames are marked failed locally and reported through `failTask`.
- `agent.control` permission decisions with a mismatched or incomplete target/device are refused before Desktop calls Local Edge.

This keeps Local Edge as the only CLI execution boundary and prevents the renderer from granting host paths or starting runs directly.

Hub producer compatibility is now implemented:

- `hub-server/internal/service/agent_dispatch.go` includes `edge_device_id` in target-bound `agent.dispatch` payloads.
- The focused Hub service tests assert queued and WebSocket target-bound payloads include both `target_id` and `edge_device_id`.
- `app/shared/src/hubClient.ts` exposes both proof fields on `HubAgentDispatchPayload`.

## Remaining Blockers

- Observed real dispatch still needs live Hub/Desktop evidence that a real target-bound task reaches the registered Desktop and then Local Edge with matching proof fields.
- Hub replay evidence is still required for offline target/device queues; Desktop now fails closed if replayed frames omit target/device proof.
- Remote SSH, Tailscale, cloud, relay provisioning, signing, release upload, and real CLI/model execution remain separate approval-gated work.
- This Desktop guard does not prove production TokenDance ID login or live Hub routing; it only makes the Desktop handoff boundary target-aware.

## Verification

Focused Desktop hook test:

```powershell
cd app\desktop
corepack.cmd pnpm exec vitest run src\__tests__\useHubIntegration.test.ts --reporter=dot
```

Expected result: `39 passed`.

Focused Hub producer tests:

```powershell
cd hub-server
go test ./internal/service -run "TestDispatchTaskIncludesTargetID|TestDispatchTaskRoutesTargetBoundTaskToBoundDevice|TestTriggerAgentTaskStoresAndDispatchesOwnedTarget" -count=1
```

Expected result: pass.
