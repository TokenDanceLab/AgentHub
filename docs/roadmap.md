# AgentHub 48h Remote-Control Roadmap

> Last updated: 2026-06-09 04:36 +08:00
> Stable baseline: `origin/dev/delicious233` / `v0.3.0-rc.5` at `19079563`
> Active integration branch: `codex/p1-remote-control-integration`
> Next candidate tag after merge: `v0.3.0-rc.6`

Archived history stays in `docs/archive/roadmap-pre-refresh-20260608-1008.md` and `docs/archive/roadmap-full-history-20260605.md`. This file is the current sprint board only.

## Goal

Ship a usable remote-control loop within 48h:

```text
Web -> Hub -> registered Desktop/Edge -> Local Edge -> CLI/SDK adapter
```

P0 fixture/readiness is merged and tagged at `v0.3.0-rc.5`. P1 now closes the gaps between fixture proof and a localhost/product-usable Desktop + Web flow. Mobile is owned by the mobile thread; only protocol drift is coordinated here.

Real TokenDanceID login, real CLI/model spend, public deploy, signing/notarization, updater metadata publication, and release upload remain explicit approval gates.

## Current Integration State

| Lane | State | Notes |
|---|---|---|
| Stable baseline | done | `origin/dev/delicious233` is `19079563`; `v0.3.0-rc.5` must not move. |
| P1 integration | ready-for-review | `codex/p1-remote-control-integration` contains the reviewed rc.6 slice set and final local gates are green. |
| Edge SQLite preview | integrated | SQLite diff projection with collision-safe IDs; Edge full short tests pass. |
| Localhost smoke harness | integrated | Plan/FixtureOnly/LocalOnly gates pass; localhost services remain separate. |
| Desktop Local Edge launch diagnostics | integrated | Fail-closed token startup, health URL, stdout/stderr log paths, dry gate coverage. |
| Web explicit target gate | integrated | Real-mode composer and TeamRun require explicit Hub target; targetless dispatch fails before Hub side effects. |
| Desktop release rc.6 gate | integrated | Desktop metadata is `0.3.0-rc.6`; hyphenated tags are GitHub prereleases; no rc.5 tag move. |
| Desktop target registration | integrated | Desktop registration creates/refreshes owner-scoped `local_edge`; race fix adds active target uniqueness and conflict re-read. |
| Tauri file permission boundary | integrated | File/git/search commands are Rust state-bound; renderer store sync cannot grant host dirs; trusted folder picker bridge exists. |

## Operating Rules

1. Do not use `D:\Code\TokenDance\AgentHub` for implementation. It is stale and dirty.
2. Workers use isolated `.worktrees/*` branches with disjoint write sets.
3. Workers do not push, merge, tag, or edit this roadmap.
4. Every implementation commit needs a read-only review before cherry-pick into `codex/p1-remote-control-integration`.
5. The controller owns roadmap, branch ordering, final gates, and cleanup.
6. Close completed/obsolete agents promptly; keep only active workers and reviewers running.

## Priority Topology

| Priority | Work | Owner branch | Gate |
|---|---|---|---|
| 1 | Push/review rc.6 integration branch | integration branch | Keep `v0.3.0-rc.5` fixed; do not push a `v0.3.0-rc.6` tag until release approval. |
| 2 | Start localhost product loop | new worktree after rc.6 integration | Start local Hub/Web/Desktop/Local Edge fixture services and prove Web selects Desktop target. |
| 3 | Wire trusted workspace picker in Desktop UI | small Desktop worktree | `chooseWorkspaceRootFromBackend()` exists; visible UI hookup is still follow-up. |
| 4 | Add migration preflight for target duplicates | backend/script worktree | Before deployment, detect active duplicate `local_edge` targets that would block migration `0047`. |
| 5 | Real login approval slice | separate worktree | Requires approved OAuth client/test account/env/evidence boundary. |
| 6 | Real CLI/model approval slice | separate worktree | Requires runtime, budget, redaction, artifact policy. |
| 7 | Public deploy and signed release | separate worktrees | Requires target env, signing/notary/release upload approval. |

## Verification Queue

Run on `codex/p1-remote-control-integration` before push/merge:

```powershell
git diff --check origin/dev/delicious233...HEAD
pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-p0-local-smoke.ps1 -RepoRoot .
pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-web-hub-boundary.ps1
pwsh -NoProfile -ExecutionPolicy Bypass -File .\tests\scripts\verify-tauri-package-readiness.ps1 -RepoRoot .
pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-tauri-package-readiness.ps1 -RepoRoot .
pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-tauri-package-dry.ps1 -RepoRoot . -SkipInstall -SkipExecutableCompile
cd edge-server; go test ./... -short -count=1
cd hub-server; go test ./... -short -count=1
cd app\shared; corepack.cmd pnpm exec vitest run src\workbench\UnifiedComposer.test.tsx src\workbench\AgentHubWorkbench.test.tsx --reporter=dot
cd app\web; corepack.cmd pnpm typecheck; corepack.cmd pnpm exec vitest run src\platform\webPlatform.test.ts src\views\TeamRunConsole.test.tsx src\platform\useWebWorkbenchModel.test.ts src\App.test.tsx --reporter=dot
cd app\desktop; corepack.cmd pnpm typecheck
```

Use precise `pnpm exec vitest run <files>` commands in package directories. Workspace-level `pnpm --filter ... test -- --run ...` currently expands into unrelated stale tests.

## Approval Gates

- Real TokenDanceID login: needs OAuth client, disposable/test account, Hub environment, callback URL confirmation, browser evidence boundary, and no token disclosure.
- Real CLI/model run: needs runtime choice, budget approval, redaction policy, and artifact upload policy.
- Public Web deploy: needs target environment, env var ownership, callback URL confirmation, and no-secret deploy logs.
- Desktop release: signing, notarization, stapling, updater metadata publication, and release upload are separate approval slices.
- macOS packaging is not assumed automatically compatible; current rc.6 work only records unsigned policy boundaries and future sidecar/package expectations.
