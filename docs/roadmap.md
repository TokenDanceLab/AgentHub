# AgentHub 48h Remote-Control Roadmap

> Last updated: 2026-06-09 07:35 +08:00
> Stable baseline: `origin/dev/delicious233` / `v0.3.0-rc.5` at `19079563`
> Active integration candidate: `origin/codex/p1-critical-evidence-integration` at `cc13a48e`
> Current delta: integration is `ahead 73 / behind 0` from stable baseline
> Next tag candidate after accepted merge only: `v0.3.0-rc.6`

This file is the sprint control board. Long history is archived in
`docs/archive/roadmap-pre-refresh-20260608-1008.md` and
`docs/archive/roadmap-full-history-20260605.md`. Detailed proof remains in
`docs/audit/`.

## Mission

Ship a usable remote-control loop:

```text
Web -> Hub -> registered Desktop target -> Desktop Local Edge sidecar
    -> CLI/SDK adapter -> Hub events/replay -> Web rendering
```

Mobile is owned by thread `019ea616-0dbf-7263-a785-87fdb2e9d8a4`; coordinate
only protocol drift. Web must stay Hub-only. Desktop must execute through the
Local Edge sidecar. Real TokenDanceID login, real CLI/model spend, public
deploy, signing, notarization, updater metadata, and release upload remain
explicit approval gates.

## Baseline And Branch Control

| Item | Current truth | Action |
|---|---|---|
| Stable dev | `origin/dev/delicious233 = 19079563`, tagged `v0.3.0-rc.5` | Keep stable. Do not move tag. |
| Main worktree | `D:\Code\TokenDance\AgentHub` is stale, behind remote, and dirty | Quarantine. Do not develop or merge there. |
| Integration candidate | `origin/codex/p1-critical-evidence-integration = cc13a48e` | Review, gate, then merge to dev if accepted. |
| Next release marker | `v0.3.0-rc.6` | Create only after explicit release approval. |
| Git maintenance | Auto-gc reports bad tree `fff550960821b6454a476d755465c71d9deaa258` | No destructive repair without approval. |

## What Is Already In The Candidate

The integration candidate bundles the reviewed P1 remote-control evidence line:

| Area | Evidence now present | Still not claimed |
|---|---|---|
| Hub dispatch proof | `agent.dispatch` carries `target_id` and `edge_device_id`; Desktop rejects mismatched proof before handoff | Real deployed multi-device dispatch |
| Desktop Local Edge readiness | UI distinguishes signed-out/loading/error/offline/missing/degraded/ready using exact `deviceId` and target health | Signed installer or macOS package |
| Edge CLI/SDK contract | Provider-neutral JSON fixture mapping for Claude/OpenAI/OpenCode/custom Agent shapes, recursive redaction, safe trace refs | Real SDK/model invocation |
| Web event rendering | TeamRun console renders runtime summaries, target IDs, Edge run IDs, tool results, file changes, and failures | Live selected-run WebSocket proof |
| Local stack gates | Fixture/readiness/approved-real runner plus live-chain topology verifier | Real login or real CLI by default |
| Login harness | Approval-gated real login E2E harness with secret redaction and safe artifact roots | Disposable TokenDanceID account proof |
| Tauri packaging | Unsigned Windows NSIS setup and portable zip evidence report | Signing/notary/updater/release upload |
| Web Projects state | Real/signed-out mode requires Hub sign-in instead of silently falling back to mock data | Full Projects CRUD UX polish |

## 48h Priority Order

| Priority | Workstream | Owner mode | Definition of done |
|---|---|---|---|
| P0 | Merge-gate `p1-critical-evidence-integration` | Controller + reviewer | Read-only review returns no blocker; focused gates pass; branch merges to `dev/delicious233`; no rc.6 tag without approval. |
| P0 | Local product-loop evidence | Worker + controller | One reproducible local run proves Hub/Web/Desktop/Local Edge/adapter fixture flow and produces sanitized evidence. |
| P0 | Desktop usable package | Worker | Windows unsigned installer/portable package can launch Desktop, show Hub sign-in state, start/diagnose Local Edge, and preserve logs. |
| P0 | Web real-mode remote UX | Worker | Web can select a Hub target, dispatch a task, and render replay/error states without mock fallback or direct Local Edge calls. |
| P1 | Edge durable store alpha | Worker + reviewer | SQLite row-first store covers store contract key paths without regressing FileStore or migration guard. |
| P1 | SDK/custom Agent product path | Researcher + worker | OpenAI/Claude/OpenCode/custom Agent registration fields and adapter contract are documented and mapped to concrete implementation slices. |
| P1 | Runtime/tool icons | Worker | LobeHub icons cover major model/runtime/tool brands with fallback and tests. |
| P1 | Release/deploy gates | Worker + controller | Web build/deploy, Tauri signing/notary/updater, and real CLI spend gates are documented as approval-controlled operations. |

## Parallel Topology

Current active delegation wave:

| Agent | Lane | Write scope |
|---|---|---|
| P1 integration reviewer | Merge readiness | Read-only. |
| Edge durable store worker | Edge SQLite alpha | `edge-server/internal/store/**`, edge store audit docs only. |
| Tauri package worker | Desktop package/runtime evidence | `app/desktop/**`, Tauri scripts/tests/audit docs only. |
| SDK/custom Agent researcher | Product architecture | Read-only report. |
| Runtime icon worker | LobeHub icon polish | Shared runtime/icon UI and tests only. |

Controller owns this roadmap, integration branches, tags, final gates, cleanup,
and conflict resolution. Workers must not push, merge, tag, edit this roadmap,
or touch the dirty main worktree.

## Verification Gates

Run from `D:\Code\TokenDance\AgentHub\.worktrees\p1-critical-evidence-integration`.

Minimum merge-gate:

```powershell
git diff --check origin/dev/delicious233...HEAD
pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-live-chain-topology.ps1 -RepoRoot .
pwsh -NoProfile -ExecutionPolicy Bypass -File .\tests\scripts\verify-local-stack-e2e-readiness.ps1 -RepoRoot .
pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-edge-cli-dispatch-evidence.ps1 -RepoRoot .
corepack.cmd pnpm --dir app\web typecheck
corepack.cmd pnpm --dir app\web exec vitest run src\views\TeamRunConsole.test.tsx --reporter=dot
cd app\desktop
corepack.cmd pnpm typecheck
corepack.cmd pnpm exec vitest run src\__tests__\useHubIntegration.test.ts --reporter=dot
```

Expanded gates before `v0.3.0-rc.6` approval:

```powershell
cd hub-server
go test ./internal/handler ./internal/service ./internal/repository -short -count=1
cd ..\edge-server
go test ./internal/store -short -count=1
go test ./internal/adapters ./internal/lifecycle ./cmd/agenthub-edge -short -count=1
cd ..\app\shared
corepack.cmd pnpm exec vitest run src\ui\RuntimeIcon.test.tsx src\workbench\RuntimeBrandIcon.test.tsx --reporter=dot
cd ..\desktop
corepack.cmd pnpm exec vitest run src\utils\workspaceStore.test.ts src\components\settings\sections\WorktreeSection.test.tsx --reporter=dot
cd ..\..
pwsh -NoProfile -ExecutionPolicy Bypass -File .\tests\scripts\verify-login-e2e-readiness.ps1 -RepoRoot .
pwsh -NoProfile -ExecutionPolicy Bypass -File .\tests\scripts\verify-tauri-package-readiness.ps1 -RepoRoot .
```

Approved-real gates are separate. They require disposable login credentials,
explicit real CLI/model approval, sanitized artifact roots, and post-run evidence
review before any `real_tested=true` claim.

## Open Decisions

| Decision | Default until approved |
|---|---|
| Merge `cc13a48e` into `dev/delicious233` | Wait for reviewer and gate evidence. |
| Push `v0.3.0-rc.6` | Blocked. Needs explicit release approval. |
| Real TokenDanceID login test | Blocked. Needs disposable account/env approval. |
| Real OpenAI/Claude/OpenCode invocation | Blocked. Needs spend/API approval and redacted evidence path. |
| Tauri signing/notary/updater/release upload | Blocked. Needs signing identity and release approval. |
| Worktree cleanup | Blocked until cleanup audit is refreshed; do not delete unique dirty work. |

## Next Controller Actions

1. Finish read-only review and minimum merge-gate for `cc13a48e`.
2. Integrate or reject worker outputs by disjoint lane; do not widen scope.
3. If merge-gate passes, prepare merge instruction for `dev/delicious233`.
4. After dev merge, decide whether to request `v0.3.0-rc.6` approval.
5. Start approved local product-loop evidence run before any real spend.
