# TeamRun E2E Evidence Plan

> Status: merged into `dev/delicious233` via PR #270. This document records the verified bridge chain and the remaining proof needed for the competition demo. It does not claim that a recorded two-runtime demo is complete.

## Goal

Competition reviewers need to see that AgentHub is not only a chat UI: a supervisor Agent Profile can route work to another Agent Profile, the child task is dispatched, and the transcript/evidence endpoints keep the route, task, tool, and artifact trail.

R1 therefore focuses on the smallest credible TeamRun loop:

1. Hub starts a TeamRun and dispatches the supervisor task.
2. Desktop receives `agent.dispatch`, starts a Local Edge run, and remembers the Hub task to Edge run mapping.
3. Runtime emits `run.agent.route_decision`, or emits `run.agent.result` with `structuredOutput`.
4. Desktop posts the supervisor route decision to Hub.
5. Hub records `team.route.decided` / `team.route.rejected`, creates a child assignment when accepted, and exposes replayable state/events/tasks.

## Verified Code Chain

| Layer | Evidence | What it proves |
|---|---|---|
| API event contract | `api/events.md` | `agent.dispatch` carries TeamRun context; `run.agent.route_decision` is the runtime-to-Hub bridge event. |
| Desktop bridge | `app/desktop/src/hooks/useHubIntegration.ts` | Dispatch creates Edge runs; route decisions are normalized and posted through `postTeamRouteDecision`; duplicate structured output is ignored. |
| Desktop focused test | `app/desktop/src/__tests__/useHubIntegration.test.ts` | Supervisor route decisions are posted, non-supervisor decisions are ignored, and nested `model_params.agenthub_team_context` is covered. |
| Hub REST client | `app/desktop/src/api/hubClient.ts` | Desktop calls `POST /web/agent-teams/:id/runs/:run_id/route-decisions`. |
| Hub route | `hub-server/internal/router/router.go` | The route-decision endpoint is mounted under `/web/agent-teams/:id/runs/:run_id/route-decisions`. |
| Hub handler/service | `hub-server/internal/handler/agent_team.go`, `hub-server/internal/service/agent_team.go` | Accepted decisions create assignments and route events; rejected decisions are recorded as auditable TeamRun events. |

## Route Decision Payload

```json
{
  "action": "delegate",
  "next_worker": "member-executor",
  "instructions": "Implement focused tests.",
  "reasoning": "Executor owns this slice.",
  "correlation_id": "route-1"
}
```

The Desktop bridge accepts equivalent payloads from:

- a typed `run.agent.route_decision` event body;
- `run.agent.result.structuredOutput`;
- legacy aliases such as `structured_output`, `routeDecision`, `route_decision`, or nested `decision`.

## Validation Commands

Run from `app/` after installing workspace dependencies:

```powershell
corepack.cmd pnpm install --frozen-lockfile --offline
```

Run from `app/desktop/`:

```powershell
corepack.cmd pnpm exec vitest run src/__tests__/useHubIntegration.test.ts
```

Current R1 focused result:

```text
Test Files  1 passed (1)
Tests       37 passed (37)
```

Repository-level hygiene:

```powershell
git diff --check
python -c "import yaml, pathlib; yaml.safe_load(pathlib.Path('api/openapi.yaml').read_text(encoding='utf-8')); print('yaml ok')"
```

Offline evidence readiness and packaging:

```powershell
.\scripts\export-teamrun-demo-fixture-evidence.ps1
.\scripts\verify-remote-control-fixture-e2e.ps1
.\scripts\verify-teamrun-demo-readiness.ps1 -EvidencePath .tmp\teamrun-evidence\<stamp>\teamrun-evidence.json -Mode FixtureRehearsal
.\scripts\verify-teamrun-demo-readiness.ps1 -EvidencePath .tmp\teamrun-evidence\<stamp>\mock-remote-control-evidence.json -Mode Mock
.\scripts\verify-teamrun-demo-readiness.ps1 -EvidencePath .tmp\teamrun-evidence\<stamp>\real-remote-control-evidence.json -Mode RealTested
.\scripts\package-teamrun-demo-evidence.ps1 -EvidencePath .tmp\teamrun-evidence\<stamp>\teamrun-evidence.json
.\scripts\verify-teamrun-demo-readiness.ps1 -EvidencePath .tmp\submission-evidence\<stamp>\teamrun-evidence.json -Mode FixtureRehearsal
.\scripts\verify-teamrun-demo-readiness.ps1 -EvidencePath .tmp\submission-evidence\<stamp>\teamrun-evidence.json -VideoPath .tmp\submission-evidence\<stamp>\demo.mp4
```

`docs/competition/teamrun-demo-scenario.json` freezes the fixture-only evidence
contract used before the final recording exists. The exporter emits local
fixture evidence from that scenario manifest only. These scripts only export,
validate, or package local evidence files. They do not run real CLI/model gates,
start services, upload artifacts, or make the final video claim unless
real evidence is checked in default `Submission` mode with an existing
recording. Fixture evidence must pass readiness only with
`-Mode FixtureRehearsal`; the default `Submission` gate intentionally rejects
fixture-only evidence.

`scripts/verify-remote-control-fixture-e2e.ps1` is the stricter P0 local-chain
fixture gate. It exports the frozen scenario, validates it through
`verify-teamrun-demo-readiness.ps1 -Mode FixtureRehearsal`, then checks that the
fixture evidence explicitly ties `hubTaskId`, `targetId`, `edgeDeviceId`,
`edgeRunId`, and `adapterId` through:

```text
Web TeamRun start -> Hub exact route -> Desktop bridge -> Local Edge run -> adapter event/callback -> Hub replay
```

This gate is offline and does not run TokenDanceID, a real CLI/model, mobile,
deployment, or live services.

## Evidence Taxonomy

The readiness gate intentionally separates four evidence levels. Do not use a
stronger label until the listed proof exists.

| Mode | Accepted input | Explicitly blocked from | Required proof |
|---|---|---|---|
| `FixtureRehearsal` | Frozen fixture scenario/exported fixture evidence with `source.fixture_only=true` and all real/runtime/submission claims false | `Submission`, real demo claims | Existing fixture contract fields only. This proves shape and rehearsal plumbing, not execution. |
| `Mock` | Synthetic remote-control evidence with `source.mock_only=true` or `remote_control_manifest.mode=Mock` and all real/runtime/submission claims false | `RealTested`, `Submission` | `remote_control_manifest` fields for the chain, but no real runtime proof. This is useful for offline script tests only. |
| `RealTested` | A real Web -> Hub -> Desktop Edge -> Local Edge -> CLI adapter run with real runtime claims true | `Submission` unless final recording/submission claims and video exist | `remote_control_manifest` plus `real_proof` refs for web action, Hub dispatch, Desktop Edge dispatch, Local Edge run, CLI adapter run, and Hub state export. |
| `Submission` | Final package evidence from a real run | Fixture/mock packages | Everything from `RealTested`, plus `final_recording_complete=true`, `submission_ready=true`, and an existing `-VideoPath`. |

The remote-control manifest required by `Mock`, `RealTested`, and `Submission`
evidence is deterministic JSON and does not require live services to validate:

```json
{
  "remote_control_manifest": {
    "hubTaskId": "hub-task-001",
    "targetId": "target-desktop-edge-001",
    "edgeDeviceId": "desktop-edge-device-001",
    "edgeRunId": "edge-run-001",
    "adapterId": "codex-cli-adapter",
    "mode": "RealTested",
    "startedAt": "2026-06-09T00:00:00+08:00",
    "eventRefs": [
      "hub:agent.dispatch:evt-001",
      "desktop-edge:task.accepted:evt-002",
      "local-edge:run.started:evt-003",
      "adapter:run.completed:evt-004"
    ],
    "redaction": {
      "status": "redacted",
      "checkedAt": "2026-06-09T00:05:00+08:00"
    }
  }
}
```

For `RealTested` and `Submission`, the evidence JSON must also include:

```json
{
  "real_proof": {
    "webActionRef": "screenshot:web-start-teamrun.png",
    "hubDispatchRef": "api:/web/agent-teams/<teamId>/runs/<runId>/events#evt-001",
    "desktopEdgeRef": "desktop-edge-log:dispatch-accepted",
    "localEdgeRunRef": "local-edge:/v1/runs/<edgeRunId>",
    "cliAdapterRef": "adapter-log:<adapterId>-run-001",
    "hubStateExportRef": "api:/web/agent-teams/<teamId>/runs/<runId>/state"
  }
}
```

The readiness script checks this shape offline. It does not prove that a local
machine has the logs or screenshots named by those refs; the demo operator must
keep those files in the ignored evidence package and record the final video
before using `Submission`.

## Demo Evidence To Capture

The final competition package still needs a real run, not only unit tests:

- Screen recording: one group/team conversation where the user mentions or starts the supervisor Agent Profile, the supervisor delegates to a worker Agent Profile, and the worker returns a visible result.
- Screenshot set: Desktop transcript, right-side evidence inspector, TeamRun Console state, route/task/event list.
- Exported event proof: responses from `/web/agent-teams/:teamId/runs/:runId/state`, `/events`, `/tasks`, and `/assignments`.
- Remote-control chain proof: one manifest tying together `hubTaskId`, `targetId`, `edgeDeviceId`, `edgeRunId`, `adapterId`, mode, start time, event refs, and redaction status for Web -> Hub -> Desktop Edge -> Local Edge -> CLI adapter.
- Runtime proof: the two participating Agent Profiles must be real configured profiles. Runtime adapter IDs such as `claude-code`, `codex`, or `opencode` are execution mechanisms, not user-facing Agent identities.
- Submission package proof: `.tmp/submission-evidence/<stamp>/manifest.md`
  generated by `scripts/package-teamrun-demo-evidence.ps1`, then checked by
  `scripts/verify-teamrun-demo-readiness.ps1`.

## Fixture E2E Requirement Matrix

Authoritative competition inputs for this matrix are this document,
`docs/competition/teamrun-demo-scenario.json`, and the ByteDance Demo Value
section in `docs/reference/sdk-agent-strategy.md`. No `bytedance.md` source is
present in this repository.

| Requirement | FixtureRehearsal evidence | RealTested evidence still required |
|---|---|---|
| IM `@Agent` or TeamRun start | `evt-remote-001` records `web.teamrun.start`; the fixture uses TeamRun start as the offline start surface. | Screenshot/API proof of the real Web or IM action that started the run. |
| `target_id` | `remote_control_manifest.targetId`, `state.target_id`, and start/dispatch events all use `target-local-edge-fixture-001`. | Real Hub request/export preserving the selected owner-scoped `target_id`. |
| Exact Desktop/Edge device | `remote_control_manifest.edgeDeviceId`, `state.edge_device_id`, task metadata, and dispatch events all use `desktop-edge-device-fixture-001`. | Real Hub route/replay logs proving no fallback to another Desktop device. |
| Edge run id | `remote_control_manifest.edgeRunId`, task metadata, Local Edge event, and Hub done event all use `edge-run-fixture-001`. | Real Desktop/Edge logs plus Hub state export showing the same `edge_run_id`. |
| Adapter id | `remote_control_manifest.adapterId`, task metadata, Local Edge event, and adapter result event all use `codex-fixture-adapter`. | Real adapter id such as `codex`, `claude-code`, or `opencode`, with unknown-runtime fallback rejected. |
| Route/task/event replay | Fixture events include `run.agent.route_decision`, `team.route.decided`, dispatch, Edge run, adapter result, and Hub done events. | Real `/state`, `/events`, `/tasks`, and `/assignments` exports replaying the same chain. |
| Transcript/render evidence | `ui_evidence_capture` names the Desktop fixture harness and transcript/inspector screenshots. | Real screenshot/video showing transcript and evidence inspector surfaces. |
| Artifact/diff/preview | Fixture marks artifact/diff/preview as `not_available` instead of silently omitting it. | Real package should include artifact, diff, preview, or a run-specific not-applicable note. |
| FixtureRehearsal vs RealTested labels | `source.fixture_only=true`, manifest mode is `FixtureRehearsal`, and real/runtime/submission claims stay false. | `RealTested` must use `real_proof` refs, real runtime claims, and no fixture/mock-only label. |

## Fixture UI Evidence Harness

The fixture UI capture gate is
`app/desktop/src/__e2e__/teamrun-ui-evidence.spec.ts`. It opens the real
Desktop Vite entry, selects the shared demo conversation
`bytedance-teamrun`, and captures:

- `teamrun-transcript.png` for the shared Desktop transcript route.
- `teamrun-inspector-files.png` for the right inspector file/evidence list.

The spec uses deterministic fixture data from `app/shared/src/demo/` and
blocks TokenDance ID, Hub, Edge, external HTTP, real CLI/model, and secret
surfaces. It is a UI/evidence harness only. It does not claim a live Hub run,
does not open login, and does not replace the final competition recording.

## Fixture-Only Evidence Contract

The current frozen contract is `teamrun-demo-evidence-v1` in
`docs/competition/teamrun-demo-scenario.json`. It requires:

- `state`, `tasks`, `assignments`, `events`, and `runtime_profiles`.
- `remote_control_manifest` with `hubTaskId`, `targetId`, `edgeDeviceId`,
  `edgeRunId`, `adapterId`, `mode`, ordered chain labels, event refs, and
  redaction status.
- `evidence_matrix` rows for TeamRun/IM start, target id, exact Desktop/Edge
  device, Edge run id, adapter id, route/task/event replay, transcript/render,
  artifact/diff/preview availability, and explicit mode labels.
- `screenshot_or_video_rehearsal` metadata describing the rehearsal capture
  plan and explicitly preserving false runtime, recording, and submission
  claims.
- scenario-manifest `ui_evidence_capture` metadata naming the Desktop harness,
  fixture conversation id, screenshot filenames, covered UI surfaces, and
  blocked live-runtime surfaces.
- at least two runtime profile types, currently fixture labels only.
- explicit claims that `real_runtime_executed`, `final_recording_complete`,
  `live_hub_runtime_verified`, and `submission_ready` are all false.
- route evidence containing `run.agent.route_decision` and `team.route.decided`.

This fixture contract is useful for UI/readiness plumbing and reviewer-facing
evidence shape. It is not the final screen recording, not a live Hub proof, and
not evidence that Codex/OpenCode/Claude or any other real runtime executed.
The readiness gate blocks fixture evidence in `Submission` mode, and the package
script blocks `-PackageMode Submission` for fixture evidence.

## Edge CLI Readiness Evidence Taxonomy

Edge runtime smoke evidence has two explicit modes:

| Mode | Command shape | Evidence claim |
|---|---|---|
| Mock-only fixture | `pwsh -File scripts/edge-runtime-smoke.ps1` | Verifies Edge REST/WebSocket run plumbing, event capture, output redaction, and smoke harness behavior without resolving or running any real CLI/model. |
| Real CLI opt-in | `pwsh -File scripts/edge-runtime-smoke.ps1 -RealCli -Runtime <claude-code|codex|opencode>` | Verifies the selected runtime adapter against a real local CLI only after budget/environment approval. Missing CLI must fail with install/path guidance unless `-AllowMissingCli` is passed for an explicit skip. |

Only `claude-code`, `codex`, and `opencode` are direct real CLI adapter IDs.
Unknown runtime IDs must fail instead of falling back to the default adapter.
Structured runtime events are expected to carry stable event types, run scope,
bounded payloads, and redacted local paths/secrets before Hub/Web display.

## Demo Script

1. Prepare two Agent Profiles in Hub:
   - Supervisor: owns planning and route decisions.
   - Worker: owns the concrete implementation or review task.
2. Start a TeamRun from Desktop or TeamRun Console with a short implementation prompt.
3. Confirm the supervisor dispatch payload includes either top-level `team_id` / `team_run_id` / `team_member_role` or nested `model_params.agenthub_team_context`.
4. Let the supervisor runtime emit a delegate decision with `next_worker`.
5. Verify Hub appends `team.route.decided` and creates a worker assignment.
6. Let the worker complete and confirm the final transcript shows the result plus route/task evidence.
7. Save the state/events/tasks/assignments responses with the demo commit SHA.

## Known Limits

- This branch verifies the Desktop bridge contract and documents the evidence path. It does not replace the final recorded two-runtime demo.
- Desktop currently swallows `postTeamRouteDecision` failures in the bridge. The Hub event list still records accepted/rejected route decisions after the POST reaches Hub, but the local UI should later surface rejected route decisions.
- Remote/Cloud Edge is outside the competition R1 minimum. The demo can use Local Edge if the submission clearly states that boundary.
