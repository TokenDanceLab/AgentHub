# AgentHub 48h Remote-Control Roadmap

> Last updated: 2026-06-09 06:52 +08:00
> Stable baseline: `origin/dev/delicious233` / `v0.3.0-rc.5` at `19079563`
> Review branch: `origin/codex/p1-remote-control-integration` at `fd94c54d`
> Evidence integration branch: `codex/p1-remote-control-evidence-integration`
> Next-wave integration branch: `codex/p1-next-wave-integration`
> Active controller integration branch: `codex/p1-critical-evidence-integration`
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
| P1 evidence integration | ready-for-review | Adds reviewed localhost product-loop fixture, Edge SDK JSON replay readiness, Desktop workspace picker UI, duplicate target preflight, Web visual smoke report, unsigned Tauri build report, and Agent SDK integration report. |
| P1 next-wave integration | testing | Adds Edge CLI approval gate, Edge SQLite readiness report, localhost readiness-only real-services gate, Web real-mode UX closure, LobeHub runtime/tool icons, and Tauri package readiness hardening. |
| P1 critical evidence integration | active | Pushed at `cbe9b5d5`; includes approved SQLite unknown-migration guard plus observed localhost dispatch verifier and RealTested overclaim fix. |
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
| Edge CLI real-run approval gate | next-wave branch | Static approval/readiness verifier only; no real CLI/model execution. |
| Edge SQLite readiness | next-wave branch | Planning/readiness report only; production row-first durable store remains separate. |
| Edge SQLite migration guard | critical evidence branch | Unknown applied migration versions now fail before pending migrations run; production row-first durable store remains separate. |
| Tauri packaging evidence | evidence branch | Unsigned Windows local build smoke only; no signing/notary/updater/release. |
| Tauri package readiness polish | next-wave branch | Generated schema cleanliness/deletion gates and post-build readiness evidence; still no signing/notary/release upload. |
| Agent SDK research | evidence branch | Treat OpenAI/Claude SDKs as Edge adapter inputs, not product model. |
| Localhost real-services readiness | next-wave branch | Explicit opt-in health/topology consistency gate; always `real_tested=false` until observed Hub/Desktop dispatch evidence exists. |
| Observed localhost dispatch verifier | critical evidence branch | Requires observed Hub/Desktop/Edge chain proof and keeps `real_tested=false` unless observed validation succeeds and approval gate is explicit. |
| Web real-mode UX | next-wave branch | Target-required dispatch, Hub error/replay states, and non-nested team/run controls. |
| Runtime/tool icons | next-wave branch | Shared LobeHub icon component, fallback rendering, and Storybook coverage. |

## Operating Rules

1. Controller owns `docs/roadmap.md`, integration branches, tags, final gates, and worker cleanup.
2. Workers use isolated `.worktrees/*` branches from the current approved integration base, currently `codex/p1-critical-evidence-integration`.
3. Workers must not push, merge, tag, edit this roadmap, or touch the dirty main worktree.
4. Every worker result must include commit SHA, clean status, changed paths, verification, and explicit non-goals.
5. No SHA plus clean status means not ready. No read-only review means not integrated.
6. Web remains Hub-only. Web must not call Local Edge, Tauri, or localhost runtime directly.
7. Desktop must use the Local Edge sidecar for CLI execution. Renderer UI cannot grant host paths by itself.
8. Real login, real CLI/model, deploy, signing, notarization, and release upload require explicit approval and separate evidence.
9. Mobile worktrees are owned by the mobile thread; controller only intervenes for protocol drift.
10. Cleanup reports are advisory until reviewed. Do not delete worktrees while active workers have dirty edits or unique commits.

## Priority Topology

| Priority | Workstream | Parallelism | Gate |
|---|---|---|---|
| P0 | Review/merge evidence integration | controller | Do not move `v0.3.0-rc.5`; do not push `v0.3.0-rc.6` tag without release approval. |
| P1 | Finish next-wave integration | controller | Focused gates for Edge CLI approval, localhost readiness, Web real-mode UX, shared icons, Edge SQLite readiness, and Tauri package readiness. |
| P1 | Desktop package/install polish | controller | Integrated into next-wave; keep signing/notary/release upload as separate approval slices. |
| P1 | Web Projects read-through | worker active | Connect Web real mode to Hub `/web/projects`; preserve demo/mock fallback; no direct Local Edge calls. |
| P1 | Desktop Local Edge launch flow | worker active | Improve Desktop target/sidecar readiness path; no CLI bypass, no signing/release. |
| P1 | Tauri build/package evidence | worker active | Produce local Windows package evidence and macOS readiness notes; no signing/notary/upload. |
| P1 | Observed real localhost dispatch | integrated in critical evidence | Requires deriving target/dispatch evidence from live Hub/Desktop path, not caller-supplied URLs; failed observed validation keeps `real_tested=false`. |
| P1 | Login E2E approval harness | worker done, review active | TokenDanceID test client/account/env, callback URL, browser evidence, no token disclosure; approval-gated path is not real evidence until run. |
| P1 | Edge real CLI evidence gate | worker active | Default no-spend/fail-closed; real CLI/model evidence only under explicit approval. |
| P2 | Edge durable store implementation | worker + reviewer | SQLite migration guard is approved; full row-first durable store still separate from CLI execution. |
| P2 | Agent SDK product integration | worker active | Decide SDK-as-adapter vs custom runtime path using official docs; no code/model calls. |
| P2 | Public deploy and macOS packaging | worker + reviewer | Separate approval for env, signing/notary, updater metadata, and release upload. |

## Active Worktrees

| Branch | Worktree | Owner | State | Integration rule |
|---|---|---|---|---|
| `codex/p1-critical-evidence-integration` | `.worktrees/p1-critical-evidence-integration` | controller | active, clean, pushed at `cbe9b5d5` | Append only reviewed slices; run integration gates before push. |
| `codex/p1-web-projects-readthrough` | `.worktrees/p1-web-projects-readthrough` | worker | active | Review then cherry-pick; reject direct Local Edge calls. |
| `codex/p1-desktop-edge-launch-flow` | `.worktrees/p1-desktop-edge-launch-flow` | worker | active | Review then cherry-pick; reject renderer-only host authority. |
| `codex/p1-tauri-build-package-evidence` | `.worktrees/p1-tauri-build-package-evidence` | worker | active | Evidence/report only unless package config fix is minimal and tested. |
| `codex/p1-edge-real-cli-evidence` | `.worktrees/p1-edge-real-cli-evidence` | worker | active | Review no-spend semantics before integration. |
| `codex/p1-sdk-integration-product-report` | `.worktrees/p1-sdk-integration-product-report` | worker | active | Docs/report only; cite official sources. |
| `codex/p1-observed-localhost-dispatch` | `.worktrees/p1-observed-localhost-dispatch` | worker | integrated | Source branch can be cleaned only after final cleanup approval; commits are in `codex/p1-critical-evidence-integration`. |
| `codex/p1-login-e2e-approval-harness` | `.worktrees/p1-login-e2e-approval-harness` | worker | ready, review active | Approval-gated harness only; no real login claim. |
| `codex/worktree-cleanup-audit` | `.worktrees/worktree-cleanup-audit` | worker | blocked | Report inventory must be refreshed before any cleanup decision. |

## Verification Queue

Run on the active integration branch before push/merge:

```powershell
git diff --check origin/codex/p1-remote-control-integration...HEAD
pwsh -NoProfile -ExecutionPolicy Bypass -File .\tests\scripts\verify-localhost-product-loop.ps1 -RepoRoot .
pwsh -NoProfile -ExecutionPolicy Bypass -File .\tests\scripts\verify-localhost-real-services.ps1 -RepoRoot .
pwsh -NoProfile -ExecutionPolicy Bypass -File .\tests\scripts\verify-p0-local-smoke.ps1 -RepoRoot .
pwsh -NoProfile -ExecutionPolicy Bypass -File .\tests\scripts\check-local-edge-target-duplicates.ps1 -RepoRoot .
pwsh -NoProfile -ExecutionPolicy Bypass -File .\tests\scripts\verify-edge-cli-real-readiness.ps1 -RepoRoot .
cd hub-server; go test ./internal/handler ./internal/service ./internal/repository -short -count=1
cd edge-server; go test ./internal/store -short -count=1
cd edge-server; go test ./internal/adapters ./internal/lifecycle ./cmd/agenthub-edge -short -count=1
cd app\shared; corepack.cmd pnpm exec vitest run src\workbench\UnifiedComposer.test.tsx src\workbench\AgentHubWorkbench.test.tsx --reporter=dot
cd app\shared; corepack.cmd pnpm exec vitest run src\ui\RuntimeIcon.test.tsx src\workbench\RuntimeBrandIcon.test.tsx src\ui\ToolTimeline.test.tsx src\workbench\blocks\ToolCardBlock.test.tsx --reporter=dot
cd app\web; corepack.cmd pnpm typecheck; corepack.cmd pnpm exec vitest run src\platform\webPlatform.test.ts src\views\TeamRunConsole.test.tsx src\platform\useWebWorkbenchModel.test.ts src\App.test.tsx --reporter=dot
cd app\desktop; corepack.cmd pnpm typecheck; corepack.cmd pnpm exec vitest run src\utils\workspaceStore.test.ts src\components\settings\sections\WorktreeSection.test.tsx src\i18n\locales.test.ts --reporter=dot
pwsh -NoProfile -ExecutionPolicy Bypass -File .\tests\scripts\verify-tauri-package-readiness.ps1 -RepoRoot .
pwsh -NoProfile -ExecutionPolicy Bypass -File .\tests\scripts\verify-tauri-package-dry.ps1 -RepoRoot .
pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-tauri-package-readiness.ps1 -RepoRoot .
```

Use precise package-local `pnpm exec vitest run <files>` commands. Workspace-level test commands still expand into unrelated stale tests.
