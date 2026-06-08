# AgentHub 48h P0 Roadmap

> Last updated: 2026-06-09 03:11 +08:00
> SSOT branch: `codex/p0-remote-control-integration`
> Integration baseline: `f6196b6f docs(roadmap): restore real login approval gate wording`

Archived merge history remains in `docs/archive/roadmap-pre-refresh-20260608-1008.md` and `docs/archive/roadmap-full-history-20260605.md`. This file is only the active sprint board.

## P0 Target

Ship one usable remote-control loop:

```text
Web -> Hub -> registered Desktop/Edge -> Local Edge -> CLI/SDK adapter
```

P0 is not a unit-test milestone. The minimum usable proof is a Hub-mediated Desktop/Web flow where Web selects a registered `local_edge` target, Hub routes to that exact Desktop/Edge device, Desktop starts Local Edge, Edge emits adapter events, and Web/Desktop can replay the same task/run evidence.

Mobile stays outside this implementation thread, but the Hub protocol must remain reusable by Mobile. Real TokenDanceID login, real CLI/model spend, public deploy, signing/notarization, updater metadata, and release upload remain approval-gated.

## Current Baseline

- `origin/dev/delicious233` has the backend/API foundation merged. Do not use the dirty local main worktree for implementation.
- `codex/p0-remote-control-integration` is the active integration branch and the only branch eligible to merge back after combined gates.
- Absorbed into the integration branch: target-bound dispatch/control, Web target selection, TeamRun target routing, Desktop Hub bridge mount, Desktop device registration, Edge CLI validation, brokered permission decision path, shared `agent.control`, FIFO replay, login fixture topology, remote evidence taxonomy, fixture E2E gate, SDK fixture mapper, and Web auth/deploy readiness.
- Web remains Hub-only. Desktop remains Local Edge/Tauri/host-capability only. No Web direct Local Edge access and no Desktop direct CLI spawn.

## Active Board

| Area | State | Evidence / next action |
|---|---|---|
| Unified P0 baseline | integrated | Branch `codex/p0-remote-control-integration`, integration baseline `f6196b6f`, ahead of `origin/dev/delicious233`. |
| Fixture remote-control E2E | integrated | `scripts/verify-remote-control-fixture-e2e.ps1` passes 107/0; negative tests cover missing refs and missing adapter callback. |
| SDK adapter fixture | integrated | OpenCode running/completed/error fixture coverage absorbed; `go test ./internal/adapters -run SDKFixture -short -count=1` passes. |
| Web auth/deploy readiness | integrated | Web auth root mounted; no silent demo fallback in real mode; Web build plus deploy readiness 16/16 passes after production build. |
| Desktop device registration | integrated | Desktop registers stable device and refreshes execution targets before Hub WS integration. |
| Desktop packaging dry | integrated | Local unsigned packaging dry gate, SQLite app-data sidecar policy, and sibling-path delete guard are absorbed; signing/notarization/updater metadata remain approval-gated. |
| Fixture umbrella gate | integrated | `verify-p0-remote-control-fixture.ps1` runs login topology, Web boundary, fixture E2E, TeamRun contract, and SDK fixture gates in FixtureRehearsal mode. |
| Runtime/model icons | integrated | LobeHub icon mapping for runtime/model/provider badges is absorbed; focused shared tests and Web typecheck pass. |
| Replay UX evidence | integrated | Hub replay run-session cards now show source/mode/target/task/run/adapter/device evidence; opaque IDs stay conservative, explicit real/verified/live modes show Real. |
| Edge CLI real-readiness | integrated | Proposal-only CLI readiness gate records supported adapters and no-fallback evidence; RealTested/Submission stay blocked for an independent real-run verifier. |
| Real login / real CLI / public deploy | approval-gated | Fixture/readiness only. No real TokenDanceID browser login, model/API spend, or public upload has been run. |

## Worktree Rules

1. The main worktree `D:\Code\TokenDance\AgentHub` is read-only for this sprint because it is stale/dirty.
2. New implementation worktrees fork from `codex/p0-remote-control-integration`, not from main.
3. Worker branches use disjoint write sets and report SHA, changed files, verification, and blockers. Workers do not push or merge.
4. Every worker result needs one read-only review before cherry-pick into the integration branch.
5. Absorbed or obsolete agents are closed promptly. Running workers continue only while they own a current board item.

## Parallel Topology

| Priority | Worker lane | Write scope | Blocked by |
|---|---|---|---|
| P0-A | Combined P0 final gate | Integration branch only | Run umbrella gate, Web build/deploy readiness, desktop packaging dry, focused Hub/Edge/Web/Desktop tests. |
| P0-B | Approved real-run plan | New worktree after approval | Real TokenDanceID, real CLI/model, public deploy, signing, and release evidence remain separate approval-gated slices. |
| P1 | Edge SQL/store migration | Edge store worktree only | After P0 remote-control proof stabilizes. |
| P1 | Release packaging/signing | Tauri release workflow/docs only | Requires signing/notarization/release approval. |

## Verification Gates

Run per touched slice, then run the combined gate before merging the integration branch:

```powershell
git diff --check origin/dev/delicious233...HEAD
.\scripts\verify-login-fixture-topology.ps1
.\scripts\verify-oidc-flow.ps1 -LocalOnly -SkipTD
.\scripts\verify-web-hub-boundary.ps1
.\scripts\verify-packaged-login-real-readiness.ps1 -RepoRoot .
.\scripts\verify-remote-control-fixture-e2e.ps1 -Stamp final-local
.\tests\scripts\verify-remote-control-fixture-e2e.ps1 -RepoRoot .
cd app\web; corepack.cmd pnpm typecheck; corepack.cmd pnpm build
cd app\desktop; corepack.cmd pnpm typecheck
cd edge-server; go test ./internal/api ./internal/adapters ./internal/lifecycle ./cmd/agenthub-edge -short -count=1
cd hub-server; go test ./internal/handler ./internal/service ./internal/router -short -count=1
```

`verify-web-deploy-readiness.ps1` requires `app/web/dist`, so run the Web production build first. Windows PowerShell 5.1 may fail scripts that use newer .NET APIs; `pwsh` is the preferred shell for those gates.

## Approval Gates

- Real TokenDanceID/OIDC login, real CLI/model spend, public deploy, signing/notarization, updater metadata, and release upload remain explicit approval gates.
- Real TokenDanceID login: requires approved OAuth client, disposable/test account, Hub environment, browser evidence boundary, and no token disclosure.
- Real CLI/model run: needs runtime choice, budget approval, redaction policy, and artifact upload policy.
- Public Web deploy: needs target environment, env var ownership, callback URL confirmation, and no-secret deploy log boundary.
- Desktop release: signing, notarization, stapling, updater metadata, and release upload are separate approval slices.
- Mobile implementation remains owned by the mobile thread; coordinate only on protocol drift.
