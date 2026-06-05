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

## Demo Evidence To Capture

The final competition package still needs a real run, not only unit tests:

- Screen recording: one group/team conversation where the user mentions or starts the supervisor Agent Profile, the supervisor delegates to a worker Agent Profile, and the worker returns a visible result.
- Screenshot set: Desktop transcript, right-side evidence inspector, TeamRun Console state, route/task/event list.
- Exported event proof: responses from `/web/agent-teams/:teamId/runs/:runId/state`, `/events`, `/tasks`, and `/assignments`.
- Runtime proof: the two participating Agent Profiles must be real configured profiles. Runtime adapter IDs such as `claude-code`, `codex`, or `opencode` are execution mechanisms, not user-facing Agent identities.

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
