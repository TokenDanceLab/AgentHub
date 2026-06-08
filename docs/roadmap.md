# AgentHub 48h Remote-Control Roadmap

> Last updated: 2026-06-09 05:20 +08:00
> Stable baseline: `origin/dev/delicious233` / `v0.3.0-rc.5` at `19079563`
> Review branch: `origin/codex/p1-remote-control-integration` at `fd94c54d`
> Evidence integration branch: `codex/p1-remote-control-evidence-integration`
> Next candidate tag after accepted merge: `v0.3.0-rc.6`

Archived history stays in `docs/archive/roadmap-pre-refresh-20260608-1008.md` and `docs/archive/roadmap-full-history-20260605.md`. This file is the current sprint control board only.

## Goal

Ship a usable remote-control loop:

```text
Web -> Hub -> registered Desktop/Edge -> Local Edge -> CLI/SDK adapter
```

In the current P1 Desktop path, the registered Desktop/Edge target is the Desktop app's Local Edge sidecar boundary, and completed adapter events replay back through Hub.

Mobile is owned by the mobile thread. Coordinate only protocol drift. Real TokenDanceID login, real CLI/model spend, public deploy, signing/notarization, updater metadata publication, and release upload remain explicit approval gates.

## Current State

| Lane | State | Notes |
|---|---|---|
| Stable baseline | done | `v0.3.0-rc.5` points at `19079563` and must not move. |
| P1 rc.6 review branch | ready-for-review | `fd94c54d` contains the reviewed rc.6 remote-control slice set. |
| P1 evidence integration | testing | Adds reviewed localhost product-loop fixture, Edge SDK JSON replay readiness, Desktop workspace picker UI, duplicate target preflight, Web visual smoke report, unsigned Tauri build report, and Agent SDK integration report. |
| Main worktree | quarantined | `D:\Code\TokenDance\AgentHub` is stale/dirty; do not implement there. |
| Release tag | blocked | Do not push `v0.3.0-rc.6` until release approval; tag push can trigger release workflow. |

## Integrated P1 Capabilities

| Area | Status | Boundary |
|---|---|---|
| Edge SQLite preview | integrated | Diff projection and ID collision fix only; full DB migration remains separate. |
| Localhost smoke harness | integrated | Plan/FixtureOnly/LocalOnly evidence; no real services unless explicitly started. |
| Localhost product loop | evidence branch | Fixture service chain proves target routing and callback validation with `RealTested=false`. |
| Desktop Local Edge launch diagnostics | integrated | Token, health URL, stdout/stderr paths, and dry-gate coverage. |
| Desktop workspace picker | evidence branch | Visible trusted-folder picker delegates authority to Tauri backend. |
| Desktop target registration | integrated | Owner-scoped `local_edge` target upsert and race hardening. |
| Web explicit target gate | integrated | Real-mode dispatch requires explicit Hub execution target. |
| Edge SDK JSON readiness | evidence branch | Fixture JSON replay maps SDK-like events; no real CLI/model execution. |
| Tauri packaging evidence | evidence branch | Unsigned Windows local build smoke only; no signing/notary/updater/release. |
| Agent SDK research | evidence branch | Treat OpenAI/Claude SDKs as Edge adapter inputs, not product model. |

## Operating Rules

1. Controller owns `docs/roadmap.md`, integration branches, tags, final gates, and worker cleanup.
2. Workers use isolated `.worktrees/*` branches from the current approved integration base.
3. Workers must not push, merge, tag, edit this roadmap, or touch the dirty main worktree.
4. Every worker result must include commit SHA, clean status, changed paths, verification, and explicit non-goals.
5. No SHA plus clean status means not ready. No read-only review means not integrated.
6. Web remains Hub-only. Web must not call Local Edge, Tauri, or localhost runtime directly.
7. Desktop must use the Local Edge sidecar for CLI execution. Renderer UI cannot grant host paths by itself.
8. Real login, real CLI/model, deploy, signing, notarization, and release upload require explicit approval and separate evidence.

## Priority Topology

| Priority | Workstream | Parallelism | Gate |
|---|---|---|---|
| P0 | Finish evidence integration branch | controller | Focused Hub/Edge/Web/Desktop gates, roadmap sync, optional push for review. |
| P1 | Real localhost services loop | worker + reviewer | Start local Hub/Web/Desktop/Local Edge binaries and prove Web selects Desktop target; still no public deploy. |
| P1 | Edge CLI adapter real-readiness plan | worker + reviewer | Redaction, artifact policy, runner command matrix, and approval checklist before any real model spend. |
| P1 | Web real-mode UX closure | worker + reviewer | Target selection, run state, event replay, errors, empty states; Hub-only boundary preserved. |
| P1 | Desktop package/install polish | worker + reviewer | Installer smoke, sidecar placement, diagnostics, Windows unsigned evidence; signing remains blocked. |
| P2 | Edge durable store | worker + reviewer | SQLite/store migration proposal and focused tests; do not mix with CLI execution. |
| P2 | Login E2E approval slice | worker + reviewer | TokenDanceID test client/account/env, callback URL, browser evidence, no token disclosure. |
| P2 | Public deploy and macOS packaging | worker + reviewer | Separate approval for env, signing/notary, updater metadata, and release upload. |

## Verification Queue

Run on the active integration branch before push/merge:

```powershell
git diff --check origin/codex/p1-remote-control-integration...HEAD
pwsh -NoProfile -ExecutionPolicy Bypass -File .\tests\scripts\verify-localhost-product-loop.ps1 -RepoRoot .
pwsh -NoProfile -ExecutionPolicy Bypass -File .\tests\scripts\verify-p0-local-smoke.ps1 -RepoRoot .
pwsh -NoProfile -ExecutionPolicy Bypass -File .\tests\scripts\check-local-edge-target-duplicates.ps1 -RepoRoot .
cd hub-server; go test ./internal/handler ./internal/service ./internal/repository -short -count=1
cd edge-server; go test ./internal/adapters ./internal/lifecycle ./cmd/agenthub-edge -short -count=1
cd app\shared; corepack.cmd pnpm exec vitest run src\workbench\UnifiedComposer.test.tsx src\workbench\AgentHubWorkbench.test.tsx --reporter=dot
cd app\web; corepack.cmd pnpm typecheck; corepack.cmd pnpm exec vitest run src\platform\webPlatform.test.ts src\views\TeamRunConsole.test.tsx src\platform\useWebWorkbenchModel.test.ts src\App.test.tsx --reporter=dot
cd app\desktop; corepack.cmd pnpm typecheck; corepack.cmd pnpm exec vitest run src\utils\workspaceStore.test.ts src\components\settings\sections\WorktreeSection.test.tsx src\i18n\locales.test.ts --reporter=dot
```

Use precise package-local `pnpm exec vitest run <files>` commands. Workspace-level test commands still expand into unrelated stale tests.
