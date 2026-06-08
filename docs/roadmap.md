# AgentHub 48h P0 Roadmap

> Last updated: 2026-06-09 02:12 +08:00
> SSOT branch: `codex/p0-remote-control-integration`
> Code baseline before this roadmap sync: `4a20709a feat(web): wire auth root deploy readiness`

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
| Unified P0 baseline | integrated | Branch `codex/p0-remote-control-integration`, code baseline `4a20709a`, ahead of `origin/dev/delicious233`. |
| Fixture remote-control E2E | integrated | `scripts/verify-remote-control-fixture-e2e.ps1` passes 107/0; negative tests cover missing refs and missing adapter callback. |
| SDK adapter fixture | integrated | OpenCode running/completed/error fixture coverage absorbed; `go test ./internal/adapters -run SDKFixture -short -count=1` passes. |
| Web auth/deploy readiness | integrated | Web auth root mounted; no silent demo fallback in real mode; Web build plus deploy readiness 16/16 passes after production build. |
| Desktop device registration | integrated | Desktop registers stable device and refreshes execution targets before Hub WS integration. |
| Desktop packaging dry | blocked-fixing | Worker found Windows path-prefix delete risk in `verify-tauri-package-dry.ps1`; do not absorb until fixed and re-reviewed. |
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
| P0-A | Desktop packaging dry fix | `scripts/verify-tauri-package-dry.ps1`, `tests/scripts/verify-tauri-package-dry.ps1`, optional audit doc | Current path safety blocker. |
| P0-B | End-to-end fixture runner | Fixture scripts/docs only; no production services | Needs current baseline and packaging/Web readiness evidence. |
| P0-C | Web/Desktop replay UX audit | `app/web`, `app/desktop`, shared workbench tests only if scoped | Must preserve Web Hub-only and Desktop Local Edge-only boundaries. |
| P0-D | Edge CLI real-readiness proposal | Edge adapter/lifecycle docs/scripts only | Real CLI/model run needs explicit approval. |
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

- Real TokenDanceID login: needs approved OAuth client, disposable/test account, Hub environment, browser evidence boundary, and no token disclosure.
- Real CLI/model run: needs runtime choice, budget approval, redaction policy, and artifact upload policy.
- Public Web deploy: needs target environment, env var ownership, callback URL confirmation, and no-secret deploy log boundary.
- Desktop release: signing, notarization, stapling, updater metadata, and release upload are separate approval slices.
- Mobile implementation remains owned by the mobile thread; coordinate only on protocol drift.
