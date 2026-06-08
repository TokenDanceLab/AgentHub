# AgentHub Roadmap

> Last updated: 2026-06-08 22:10 +08:00
> Fact source: `origin/dev/delicious233`
> Current dev baseline: `7f393bfb` after runtime evidence inspector and macOS unsigned dry policy
> Stable RC tag: `v0.3.0-rc.1 @ 0c79f277`

Historical merge logs are archived in [archive/roadmap-pre-refresh-20260608-1008.md](archive/roadmap-pre-refresh-20260608-1008.md) and [archive/roadmap-full-history-20260605.md](archive/roadmap-full-history-20260605.md). This file tracks only current status, next slices, blockers, and cleanup.

## Goal

AgentHub must become a runnable multi-agent collaboration product for IM chat, single/group conversations, multi-agent orchestration, persistent context, artifact/diff/preview evidence, and Desktop/Web/Hub/Edge/CLI adapter end-to-end operation.

Competition requirements live in `D:\Code\TokenDance\docs\competition\bytedance.md`. Current AgentHub evidence starts at [competition/teamrun-e2e-evidence.md](competition/teamrun-e2e-evidence.md); it is dry/offline evidence, not final real runtime demo proof.

## Current State

| Area | Status | Next decision |
|---|---|---|
| Baseline | `origin/dev/delicious233 @ 7f393bfb`; main worktree is dirty/stale and must stay read-only | Continue from isolated `.worktrees/*` only |
| Backend merge | Long backend thread is closed; backend merge Agent still absorbs old backend line by small slices | Do not whole-merge `feat/backend-edge-hub`; preserve semantic slice rule |
| Web boundary | Web remains Hub-only; no Local Edge/Tauri/filesystem direct access | Keep `verify-web-hub-boundary.ps1` in every Web/shared slice |
| Desktop boundary | Desktop may use Local Edge and Tauri host; it must not spawn CLI directly | Finish target preference and Tauri host readiness |
| Projects | Hub `/web/projects` list/create/get/update and Web create/update UI are merged | Define delete/soft-delete/orphan policy and artifact/workspace relation |
| Agent/runtime inventory | AgentProfile read/mutate and ExecutionTarget request contracts are merged; LobeHub runtime branding is merged on dev | Marketplace publish/install and routing behavior stay separate |
| Edge store | SQLite opt-in snapshot backend and relational migration tests are merged | Repair/reconcile stale `codex/edge-sql-store` worktree before cleanup |
| Runtime evidence | Edge read-only diff/artifact/preview indexes, runtime evidence writer, metadata lookup, content planned/404 contract, preview stop metadata, and shared inspector consumption are merged | Implement preview start/fake runner; artifact content source fields before content route |
| Login | Fake/local and packaged readiness gates are merged | Real TokenDanceID packaged E2E requires approved test OAuth client, account, browser window, and no-secret evidence |
| Tauri packaging | Version/readiness checks, installer smoke, release dry topology, and macOS unsigned dry policy are merged | Full build, signing, notarization, staple, and release upload remain approval-gated |
| Mobile | Separate low-priority owner track | Do not mix with Desktop/Web/Hub/Edge critical path |

## P0 Topology

1. **Stabilize baseline and cleanup**
   - Correct docs against live `origin/dev/delicious233`.
   - Delete only clean merged worktrees after final `status` and ancestor checks.
   - Preserve dirty, mobile-owned, backend-owned, and broken worktrees.

2. **Edge artifact/preview production path**
   - Next worker: preview fake runner and `POST /v1/previews` contract.
   - Next proposal: artifact content source fields in memory/file/sqlite stores.
   - Non-goals: real process management, browser launching, Web direct Edge, Hub preview store, mobile, real CLI/model.

3. **Desktop local execution closure**
   - Finish Desktop target preference/Tauri host readiness if not fully merged.
   - Verify Desktop uses Local Edge runtime ids and never bypasses Edge to spawn CLI.
   - Keep Web unchanged.

4. **TeamRun/ByteDance demo evidence**
   - Upgrade from dry fixture evidence to real UI/runtime evidence where allowed.
   - Keep D3 real CLI/model blocked until runner, budget, environment approval, and artifact redaction are approved.

5. **Login real E2E**
   - Use existing fake/local and packaged readiness gates as preconditions.
   - Real login test needs explicit approval for test OAuth client, test account, Hub test environment, browser window, and evidence boundaries.

6. **Packaging/release**
   - Internal Windows dry package evidence first.
   - macOS unsigned arm64 validation can be added as dry validation.
   - Authenticode, Developer ID signing, notarization, staple, updater production metadata, and release asset upload are separate approval slices.

## Active Parallel Queue

| Lane | Worktree / branch | Owner | Scope | State |
|---|---|---|---|---|
| Docs/control | `.worktrees/docs-projects-ui-status-sync` / `codex/docs-projects-ui-status-sync` | main | Roadmap compression and cleanup ledger | active |
| Cleanup audit | subagent read-only | main | merged/broken/dirty worktree classification | audit complete; cleanup pending |
| Backend merge | backend merge Agent | backend owner | old backend line small-slice absorption | external active |
| Mobile | mobile owner worktrees | mobile owner | Feishu-style mobile redesign | external active; not on critical path |
| Next Edge | new worktree TBD | worker | preview fake runner and start contract | ready to dispatch after docs push |
| Next artifact | new worktree TBD | worker/explorer | content source schema proposal | ready to dispatch after docs push |
| Next demo | new worktree TBD | worker/explorer | TeamRun real evidence topology | ready to dispatch after docs push |

## Blocked Gates

| Gate | Blocker | Required before unblocking |
|---|---|---|
| Real CLI/model D3 | runner, budget, environment approval, artifact redaction | Dedicated opt-in workflow and no-secret artifact policy |
| Real packaged login | no approved test OAuth/account/browser evidence boundary | Test OAuth client, test account, Hub test env, explicit browser approval |
| Artifact content route | no persisted safe content root/source fields | Store content source fields, path policy, MIME/size/checksum contract |
| Artifact apply/discard | mutation semantics not defined | Workspace ownership, reversible patch policy, audit trail |
| Preview real runner | process lifecycle policy not defined | Fake runner first, then process management proposal |
| Signing/notarization | secrets and release policy not approved | Separate release proposal and secret boundary |
| Projects delete | orphan policy undefined | `deleted_at` or hard-delete policy plus artifact/session relation rules |

## Branch And Worktree Ledger

Cleanup is staged. Do not bulk-delete.

| Category | Items | Action |
|---|---|---|
| Clean merged candidates | backend merge helper worktrees, `runtime-evidence-inspector`, `macos-unsigned-dry-policy`, `docs-projects-ui-status-sync` after push | Final status check, then remove worktree and local branch |
| Dirty merged/risky | `backend-merge-edge-control-stubs`, `message-attachments-readthrough`, `oidc-callback-redaction`, `tauri-package-next`, `ws-typing-membership`, `mobile-feishu-chat-redesign` | Preserve until dirty diff is audited |
| Broken | `.worktrees/edge-sql-store` missing object; unregistered residual dirs such as `lobe-icons-runtime-branding` and `edge-store-contract` | Recreate or inspect before deletion |
| Backend-owned | `backend*`, `feat/backend-edge-hub`, `integrate-codex-adapter-precheck` | Backend merge owner or explicit review only |
| Mobile-owned | `mobile-*` | Leave to mobile owner |
| Old `web-projects-readthrough` | branch-only, unique old docs/test shape | Keep until docs extraction and create/get-detail coverage decision are closed |

Minimum cleanup evidence per item:

```powershell
git status --short --branch
git rev-list --left-right --count HEAD...origin/dev/delicious233
git merge-base --is-ancestor HEAD origin/dev/delicious233
```

## Engineering Rules

- Use isolated worktrees for all implementation.
- Main worktree is read-only until explicitly cleaned.
- Coordinator owns topology, merge order, verification, cleanup, and roadmap.
- Subagents own bounded implementation/review slices with disjoint write scopes.
- Web cannot import Local Edge, Tauri, filesystem, or Desktop capability.
- Desktop cannot bypass Edge to start CLI.
- Shared UI cannot store backend URLs, tokens, or runtime-specific side effects.
- Mock/demo is never production evidence.
- Do not commit secrets, production logs, raw model outputs, private server paths, or personal local evidence.

## Next Dispatch

After this Roadmap slice is pushed:

1. Spawn Edge preview fake-runner worker.
2. Spawn artifact content-source proposal worker.
3. Spawn TeamRun real evidence topology explorer.
4. Spawn cleanup worker for clean merged worktrees only.
5. Keep mobile and backend merge owners isolated.
