# AgentHub 48h Sprint Roadmap

> Last updated: 2026-06-09 00:45 +08:00
> Baseline: `origin/dev/delicious233 @ 4700ad0b`
> Integration worktree: `codex/p0-remote-control-integration` / `.worktrees/p0-remote-control-integration`

Old merge history remains in `docs/archive/roadmap-pre-refresh-20260608-1008.md` and `docs/archive/roadmap-full-history-20260605.md`. This file is the short sprint board and branch ledger.

## 48h P0

Make Desktop and Web usable through one remote-control loop:

```text
Web -> Hub -> registered Desktop/Edge -> Local Edge -> CLI adapter
```

The sprint succeeds when Web can start or control work through Hub, Hub targets one owner-scoped registered Desktop/Edge, Desktop receives the dispatch, Local Edge starts the run through an adapter, and Web/Desktop can replay the run state plus evidence. Mobile is out of implementation scope for this thread, but the same Hub-mediated protocol must remain reusable by Mobile.

## Current Baseline

- Backend is mainlined for this sprint: Hub/Edge contracts, target-bound dispatch, fake/local login gates, Desktop packaged Local Edge SQLite, Edge SQL readmodel, TeamRun fixture evidence, Web Projects/Icons, Tauri/macOS dry policy, and SDK fixture mapper are already on dev.
- The local main worktree is dirty and behind; do not use it for implementation or evidence. Use isolated worktrees and integrate through `codex/p0-remote-control-integration`.
- Global owner covers Web, Hub, Desktop, Edge, CLI adapter, evidence, packaging/deploy readiness, and docs. Mobile is external.
- Web remains Hub-only. Desktop remains Local Edge/Tauri/host-capability only. No Web direct Local Edge access and no Desktop direct CLI spawn.

## P0 Critical Path

| Step | Deliverable | Minimum proof |
|---|---|---|
| 1. Login/device readiness | Web and Desktop have Hub session/device state sufficient for routing, using fake/local gates unless real TokenDanceID is approved. | `scripts/verify-oidc-flow.ps1 -LocalOnly -SkipTD`; Desktop `/edge/devices/register`; Hub WS auth evidence. |
| 2. Web -> Hub dispatch | Web starts a task or TeamRun with a concrete `target_id`; Hub persists `target_id` and `edge_device_id`. | Hub focused tests for `ExecutionTarget`, dispatch/control, offline exact-device queue, and no fallback. |
| 3. Hub -> registered Desktop/Edge | Hub sends `agent.dispatch` / `agent.control` only to the recorded Desktop device or its queue. | Desktop `useHubIntegration` focused test plus captured WS payload shape. |
| 4. Desktop -> Local Edge | Desktop active path mounts the Hub task bridge, converts dispatch into a Local Edge run, and never starts CLI directly. | Desktop App/bridge tests with Hub task id, Edge run id, adapter id, and failure/completion callback. |
| 5. Local Edge -> CLI adapter | Edge validates adapter id, rejects unknown explicit agent ids, and emits normalized runtime events. | Edge focused tests for API, adapter, lifecycle, and `cmd/agenthub-edge`; `-RealCli` remains explicit. |
| 6. Evidence replay | Web/Hub and Desktop/Edge show transcript/task/event/evidence state for the same run. | TeamRun/ByteDance fixture rehearsal or approved real evidence package, clearly labeled. |

## Mock/Fixture Vs Real Tested Mode

| Mode | Allowed in 48h | Claims allowed |
|---|---|---|
| Mock/fixture rehearsal | Fake/local login, fixture TeamRun, fixture/fake adapter events, static evidence package. | UI/protocol/evidence-shape readiness only. Not final runtime proof. |
| Real tested mode | Only after explicit approval for real TokenDanceID, real CLI/model, environment, budget, and redaction. | Live remote-control chain proof for the approved runtime only. |
| Submission evidence | Requires real recording plus state/events/tasks/assignments/runtime proof. | Final competition/demo claim. Fixture-only evidence must fail submission mode. |

ByteDance/TeamRun evidence must always state whether it is fixture rehearsal or real tested evidence. `docs/competition/teamrun-e2e-evidence.md` remains the evidence entrypoint.

## Practical Audit Lanes

| Lane | Purpose | Current owner/worktree | Exit proof |
|---|---|---|---|
| Tauri compile/package | Prove Desktop can actually build with bundled Local Edge policy. Signing/notarization remains gated. | P0 follow-up after bridge mount; stale `tauri-package-next` is reference only. | `app/desktop` typecheck, targeted Tauri Rust tests, then approved dry build/installer smoke. |
| Web deploy/readiness | Prove Web production build and Hub-only boundary. Actual public deploy needs environment approval. | Web remote target worker first, deployment worker next. | Web typecheck/build, `verify-web-hub-boundary.ps1`, deployment dry manifest. |
| Login and chat | Prove Web/Desktop auth topology, Hub sessions/messages, WS sync, and no silent demo fallback in real mode. | `codex/login-e2e-topology`; future real auth gate requires approval. | Fake/local auth topology gate, Hub session/message focused tests, real TokenDanceID only after approval. |
| Hub/Edge dispatch sync | Prove exact target routing, offline queue semantics, callbacks, and event replay. | Hub dispatch, TeamRun target routing, queue/vocabulary workers. | Hub service/cache tests plus Desktop bridge tests. |
| CLI adapter and permission control | Prove runtime id validation, no unknown fallback, and Hub `agent.control` can unblock or deny real permission waits. | Edge CLI evidence and Edge permission control workers. | Edge adapter/lifecycle/API tests; real CLI/model only after approval. |
| Agent SDK strategy | Decide SDK value without leaking SDK objects into Hub/Web/Tauri product model. | `codex/sdk-agent-report` report-only. | Report and fixture-only next steps; no SDK package install or API/model call. |
| Real E2E evidence | Produce final demo evidence after the chain is wired. | Evidence worker plus final QA pass. | Evidence manifest in `RealTested` or `Submission` mode, screenshots/log/API refs, video path, redaction status. |

## Active Worktree Board

| Worktree / branch | State | P0 action |
|---|---|---|
| `.worktrees/p0-remote-control-integration` / `codex/p0-remote-control-integration` | active integration | Cherry-pick reviewed P0 slices, resolve docs conflicts, run combined gates, then return to dev. |
| `.worktrees/roadmap-48h` / `codex/roadmap-48h` | clean, ahead 1 | Source of the short roadmap/governance sync. |
| `.worktrees/p0-web-remote-target` / `codex/p0-web-remote-target` | clean, ahead 1 | Web target selection and Hub task start proof; review pending. |
| `.worktrees/p0-hub-target-dispatch` / `codex/p0-hub-target-dispatch` | clean, ahead 1 | Hub target-bound dispatch/control proof; reviewed with no blockers. |
| `.worktrees/p0-desktop-edge-bridge` / `codex/p0-desktop-edge-bridge` | clean, ahead 1 | Desktop dispatch bridge proof; found active App mount blocker. |
| `.worktrees/p0-desktop-bridge-mount` / `codex/p0-desktop-bridge-mount` | running | Mount Desktop Hub task bridge in the real v4 App active path. |
| `.worktrees/p0-edge-cli-evidence` / `codex/p0-edge-cli-evidence` | clean, ahead 1 | Edge adapter/runtime event evidence proof; review pending. |
| `.worktrees/p0-edge-permission-control` / `codex/p0-edge-permission-control` | running | Make `agent.control permission.decide` unblock or deny actual pending CLI permissions. |
| `.worktrees/p0-teamrun-target-routing` / `codex/p0-teamrun-target-routing` | dirty | Propagate `target_id` through TeamRun supervisor and assignment dispatch. |
| `.worktrees/p0-control-vocabulary-queue` / `codex/p0-control-vocabulary-queue` | running | Add shared `agent.control` vocabulary and FIFO offline replay if confirmed. |
| `.worktrees/p0-remote-evidence` / `codex/p0-remote-evidence` | clean, ahead 1 | Evidence replay/package protocol proof. |
| `.worktrees/login-e2e-topology` / `codex/login-e2e-topology` | clean, ahead 1 | Mock/topology auth gate; real TokenDanceID remains approval-gated. |
| `.worktrees/sdk-agent-report` / `codex/sdk-agent-report` | report staged/uncommitted | P1 SDK value report; not a P0 blocker. |
| `.worktrees/edge-sql-store` / `codex/edge-sql-store` | broken object | Do not use for P0 unless recreated. |
| `.worktrees/tauri-package-next` / `codex/tauri-package-next` | dirty, behind dev | P1 packaging reference only. |
| `mobile-*` | external | Do not edit. |
| main `dev/delicious233` | dirty and behind | Read-only reference at most. |

## Approval Gates

- Real TokenDanceID login: requires approved OAuth client, test account, Hub test environment, browser window, and no-secret evidence boundary.
- Real CLI/model run: requires runner, budget, environment approval, runtime redaction, and artifact upload policy.
- Actual Web deployment: requires target environment, env var ownership, auth callback URL, and no-secret deploy log boundary.
- Signing, notarization, stapling, updater production metadata, and release upload: separate release approval.
- Mobile implementation: separate owner; this sprint does not change mobile files.

## Verification Commands

Run the relevant focused gates per slice; the roadmap-level gate is:

```powershell
git diff --check origin/dev/delicious233...HEAD
```

Suggested slice gates:

```powershell
.\scripts\verify-oidc-flow.ps1 -LocalOnly -SkipTD
.\scripts\verify-web-hub-boundary.ps1
cd hub-server; go test ./internal/handler ./internal/service ./internal/router -run "ExecutionTarget|AgentTask|TeamRun|Dispatch|Control" -short -count=1
cd app/desktop; corepack.cmd pnpm exec vitest run src/__tests__/useHubIntegration.test.ts
cd edge-server; go test ./internal/api ./internal/adapters ./internal/lifecycle ./cmd/agenthub-edge -short -count=1
.\scripts\verify-teamrun-demo-readiness.ps1 -EvidencePath .tmp\teamrun-evidence\<stamp>\teamrun-evidence.json -Mode FixtureRehearsal
```

## Next 6-12 Hours

1. Integrate reviewed P0 slices into `codex/p0-remote-control-integration`: roadmap, Hub exact target, Edge CLI validation, evidence gate, login topology, Web target submit after review.
2. Finish missing active-path and contract gaps: Desktop bridge mount, TeamRun `target_id`, Edge blocking permission control, queue FIFO/shared `agent.control`.
3. Run combined focused gates and fix integration breakages.
4. Only after green integration: update dev from the clean integration branch, then tag a new RC candidate.
