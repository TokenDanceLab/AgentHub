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
.\scripts\verify-teamrun-demo-readiness.ps1 -EvidencePath .tmp\teamrun-evidence\<stamp>\teamrun-evidence.json -Mode FixtureRehearsal
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

## Demo Evidence To Capture

The final competition package still needs a real run, not only unit tests:

- Screen recording: one group/team conversation where the user mentions or starts the supervisor Agent Profile, the supervisor delegates to a worker Agent Profile, and the worker returns a visible result.
- Screenshot set: Desktop transcript, right-side evidence inspector, TeamRun Console state, route/task/event list.
- Exported event proof: responses from `/web/agent-teams/:teamId/runs/:runId/state`, `/events`, `/tasks`, and `/assignments`.
- Runtime proof: the two participating Agent Profiles must be real configured profiles. Runtime adapter IDs such as `claude-code`, `codex`, or `opencode` are execution mechanisms, not user-facing Agent identities.
- Submission package proof: `.tmp/submission-evidence/<stamp>/manifest.md`
  generated by `scripts/package-teamrun-demo-evidence.ps1`, then checked by
  `scripts/verify-teamrun-demo-readiness.ps1`.

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
