# AgentHub 48h Sprint Roadmap

> Last updated: 2026-06-09 00:21 +08:00
> Baseline: `origin/dev/delicious233 @ 4700ad0b` after fetch
> Branch/worktree: `codex/roadmap-48h` / `.worktrees/roadmap-48h`

Old merge history remains in `docs/archive/roadmap-pre-refresh-20260608-1008.md` and `docs/archive/roadmap-full-history-20260605.md`. This file is only the short 48h sprint board.

## 48h P0

Make Desktop and Web usable through one remote-control loop:

```text
Web -> Hub -> registered Desktop/Edge -> Local Edge -> CLI adapter
```

The sprint succeeds when Web can start or control work through Hub, Hub targets one owner-scoped registered Desktop/Edge, Desktop receives the dispatch, Local Edge starts the run through an adapter, and Web/Desktop can replay the run state plus evidence.

## Current Baseline

- Backend is mainlined for this sprint: Hub/Edge contracts, target-bound dispatch, fake/local login gates, Desktop packaged Local Edge SQLite, Edge SQL readmodel, TeamRun fixture evidence, Web Projects/Icons, Tauri/macOS dry policy, and SDK fixture mapper are already on dev.
- The local main worktree is dirty and behind; do not use it for implementation or evidence. Use isolated worktrees.
- Global owner covers Web, Hub, Desktop, Edge, CLI adapter, evidence, and docs. Mobile is external.
- Web remains Hub-only. Desktop remains Local Edge/Tauri/host-capability only. No Web direct Local Edge access and no Desktop direct CLI spawn.

## P0 Critical Path

| Step | Deliverable | Minimum proof |
|---|---|---|
| 1. Login/device readiness | Web and Desktop have Hub session/device state sufficient for routing, using fake/local gates unless real TokenDanceID is approved. | `scripts/verify-oidc-flow.ps1 -LocalOnly -SkipTD`; Desktop `/edge/devices/register`; Hub WS auth evidence. |
| 2. Web -> Hub dispatch | Web starts a task or TeamRun with a concrete `target_id`; Hub persists `target_id` and `edge_device_id`. | Hub focused tests for `ExecutionTarget`, dispatch/control, offline exact-device queue, and no fallback. |
| 3. Hub -> registered Desktop/Edge | Hub sends `agent.dispatch` / `agent.control` only to the recorded Desktop device or its queue. | Desktop `useHubIntegration` focused test plus captured WS payload shape. |
| 4. Desktop -> Local Edge | Desktop converts dispatch into a Local Edge run and never starts CLI directly. | Desktop bridge evidence with Hub task id, Edge run id, adapter id, and failure/completion callback. |
| 5. Local Edge -> CLI adapter | Edge validates adapter id and emits normalized runtime events. | Edge focused tests for API, adapter, lifecycle, and `cmd/agenthub-edge`. |
| 6. Evidence replay | Web/Hub and Desktop/Edge show transcript/task/event/evidence state for the same run. | TeamRun/ByteDance fixture rehearsal or approved real evidence package, clearly labeled. |

## Mock/Fixture Vs Real Tested Mode

| Mode | Allowed in 48h | Claims allowed |
|---|---|---|
| Mock/fixture rehearsal | Fake/local login, fixture TeamRun, fixture/fake adapter events, static evidence package. | UI/protocol/evidence-shape readiness only. Not final runtime proof. |
| Real tested mode | Only after explicit approval for real TokenDanceID, real CLI/model, environment, budget, and redaction. | Live remote-control chain proof for the approved runtime only. |
| Submission evidence | Requires real recording plus state/events/tasks/assignments/runtime proof. | Final competition/demo claim. Fixture-only evidence must fail submission mode. |

ByteDance/TeamRun evidence must always state whether it is fixture rehearsal or real tested evidence. `docs/competition/teamrun-e2e-evidence.md` remains the evidence entrypoint.

## P1/P2 Demotions

| Area | New priority | Rule |
|---|---|---|
| SDK research/mapper | P1 | Keep as adapter-shape support. No SDK package/runtime integration in P0. |
| Packaging polish | P1/P2 | Packaged Local Edge SQLite and dry policies support demos; signing/release is not P0. |
| Artifact content/apply/discard | P2 | Read-only evidence is enough for P0. |
| Real preview process runner | P2 | Fake/read-only preview evidence is enough for P0. |
| Generic docs cleanup | P2 | Only update docs that unblock the remote-control chain. |
| Mobile redesign | External | Do not edit mobile. Mobile is a future remote-client consumer of the same Hub protocol. |

## Approval Gates

- Real TokenDanceID login: requires approved OAuth client, test account, Hub test environment, browser window, and no-secret evidence boundary.
- Real CLI/model run: requires runner, budget, environment approval, runtime redaction, and artifact upload policy.
- Signing, notarization, stapling, updater production metadata, and release upload: separate release approval.
- Mobile implementation: separate owner; this sprint does not change mobile files.

## Worktree Board

| Worktree / branch | State | P0 action |
|---|---|---|
| `.worktrees/roadmap-48h` / `codex/roadmap-48h` | clean, ahead 1 | Own roadmap/governance doc sync only. |
| `.worktrees/p0-web-remote-target` / `codex/p0-web-remote-target` | dirty | Web target selection and Hub task start proof. |
| `.worktrees/p0-hub-target-dispatch` / `codex/p0-hub-target-dispatch` | clean, ahead 1 | Hub target-bound dispatch/control proof. |
| `.worktrees/p0-desktop-edge-bridge` / `codex/p0-desktop-edge-bridge` | dirty | Desktop Hub dispatch to Local Edge bridge proof. |
| `.worktrees/p0-edge-cli-evidence` / `codex/p0-edge-cli-evidence` | dirty | Edge adapter/runtime event evidence proof. |
| `.worktrees/p0-remote-evidence` / `codex/p0-remote-evidence` | untracked evidence gate | Evidence replay/package protocol proof. |
| `.worktrees/login-e2e-topology` / `codex/login-e2e-topology` | conflicted docs, dirty | Do not integrate until conflicts are resolved; use only for login/device gate evidence. |
| `.worktrees/sdk-agent-report` / `codex/sdk-agent-report` | untracked report | P1 SDK value report; not a P0 blocker. |
| `.worktrees/edge-sql-store` / `codex/edge-sql-store` | broken object | Do not use for P0 unless recreated. |
| `.worktrees/tauri-package-next` / `codex/tauri-package-next` | dirty, behind dev | P1 packaging support only. |
| `mobile-*` | external | Do not edit. |
| main `dev/delicious233` | dirty and behind | Read-only reference at most. |

## Verification Commands

Run the relevant focused gates per slice; the roadmap-level gate is:

```powershell
git diff --check origin/dev/delicious233...HEAD
```

Suggested slice gates:

```powershell
.\scripts\verify-oidc-flow.ps1 -LocalOnly -SkipTD
cd hub-server; go test ./internal/handler ./internal/service ./internal/router -run "ExecutionTarget|AgentTask|TeamRun|Dispatch|Control" -short -count=1
cd app/desktop; corepack.cmd pnpm exec vitest run src/__tests__/useHubIntegration.test.ts
cd edge-server; go test ./internal/api ./internal/adapters ./internal/lifecycle ./cmd/agenthub-edge -short -count=1
.\scripts\verify-teamrun-demo-readiness.ps1 -EvidencePath .tmp\teamrun-evidence\<stamp>\teamrun-evidence.json -Mode FixtureRehearsal
```

## Next 6-12 Hours

1. Web/Hub worker: prove Web can start a task or TeamRun with `target_id` and replay Hub state/events.
2. Desktop/Edge worker: prove exact-device dispatch becomes a Local Edge run and returns completion or failure evidence.
3. Evidence worker: package TeamRun/ByteDance fixture rehearsal with explicit non-real labels.
4. Protocol reviewer: align `api/events.md`, `api/openapi.yaml`, Hub service/router, Desktop bridge, and shared client types around the same remote-control vocabulary.
