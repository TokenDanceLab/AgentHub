# AgentHub Chat UIUX Data Mode E2E Progress

## Task

修复并框架化 Desktop/Web 共享聊天流 UIUX 与数据模式边界：消息展示、Agent 回复、工具/审批/产物卡片、markdown/table、自动跟随、响应式宽度、Demo/Local/Login/Observed/Approved Real 分界，必须由高价值 E2E、focused Vitest 和半自动截图验证保护。

## Tracking

- Mode: `LOCAL_ONLY`
- Branch: `fix/chat-flow-uiux-contract`
- Base: `dev/delicious233`
- SPEC: `docs/plan/chat-uiux-data-mode-e2e-spec.md`
- Analysis: `docs/analysis/project-overview.md`, `docs/analysis/module-inventory.md`, `docs/analysis/risk-assessment.md`
- Plan: `docs/plan/task-breakdown.md`, `docs/plan/dependency-graph.md`, `docs/plan/milestones.md`

## Current Status

- [x] SPEC-first docs exist and define mode taxonomy, E2E phases, test value policy, acceptance gates.
- [x] Desktop entry preflight and workbench runtime network validation are phase-aware.
- [x] Shared chat-flow E2E covers user message stability, duplicate messages, auto-follow, overflow, merged card stack, Web ordering, markdown/table, tool/result pairing, inspector-only route/subagent details.
- [x] Semi-auto `1440x810` Desktop/Web visual checks are versioned under each app's `scripts/`; screenshots remain under `.tmp/`.
- [x] Stubbed Hub replay is named as stubbed replay, not real login/model/CLI evidence.
- [x] Outdated Desktop/Web UI restriction text was removed from `CLAUDE.md`; `AGENTS.md` no longer hardcodes a stale Phase/branch.
- [x] Active SPEC/plan wording no longer describes closed failures as current state; stubbed replay UI/test strings avoid claiming "Real Hub" execution evidence.

## Fresh Evidence

```powershell
cd app/desktop
corepack.cmd pnpm exec vitest run ../shared/src/testing/e2eDataModeContract.test.ts --config vitest.shared-ci.config.ts
```

Result: 1 test file passed, 5 tests passed. Covers phase-aware E2E data-mode boundary contract.

```powershell
cd app/desktop
corepack.cmd pnpm exec vitest run src/__tests__/useHealth.test.ts src/platform/useDesktopWorkbenchModel.test.tsx --config vitest.config.ts
```

Result: 2 test files passed, 11 tests passed. Covers Desktop health gating and explicit mock/fixture workbench isolation.

```powershell
cd app/desktop
corepack.cmd pnpm run test:e2e:chat-flow
```

Result: 4 passed. Covers submitted user message visibility, duplicate rendering, auto-follow, 1440x810 overflow, narrow overflow, approval/preview merged stack.

```powershell
cd app/desktop
corepack.cmd pnpm run test:visual:chat-flow
```

Result: passed. Screenshot: `app/desktop/.tmp/manual-chat-flow-uiux/desktop-1440x810-chat-flow.png`. Metrics: `firstUserBubbles=1`, `repeatedUserBubbles=2`, `sawVisible=true`, `disappearedAfterVisible=false`, `scrollGap=0`, `horizontalOverflow=0`, merged stack inner radii `0`.

```powershell
cd app/desktop
corepack.cmd pnpm typecheck
```

Result: passed.

```powershell
cd app/desktop
corepack.cmd pnpm build
```

Result: passed. Vite emitted existing dynamic-import/chunk-size warnings; no build failure.

```powershell
cd app/web
corepack.cmd pnpm exec vitest run src/platform/useWebWorkbenchModel.test.ts --config vitest.config.ts
```

Result: 1 test file passed, 25 tests passed. Covers Web workbench model state and Hub replay behavior.

```powershell
cd app/web
corepack.cmd pnpm run test:e2e:chat-flow
```

Result: 1 passed. Covers Hub messages and runtime events in one ordered transcript.

```powershell
cd app/web
corepack.cmd pnpm run test:visual:chat-flow
```

Result: passed after replay wording cleanup. Screenshot: `app/web/.tmp/manual-chat-flow-uiux/web-1440x810-chat-flow.png`. Metrics: `tableCount=1`, `horizontalOverflow=0`, `scrollGap=0`, chronological order preserved, inspector-only report absent from transcript, `transcriptHasModeDebug=false`, `dataSource=stubbed-hub-session`, `real_tested=false`.

```powershell
cd app/web
corepack.cmd pnpm run test:e2e:stubbed-hub
```

Result: 7 passed. Covers signed-out approved-real state, no-target blocker, healthy target replay, Projects/Agents/Tasks pages, inspector evidence, Hub-only task creation, approval/artifact endpoint consumption, no Local Edge access from Web, and replay wording that does not claim real Hub/CLI execution.

```powershell
cd app/desktop
corepack.cmd pnpm exec vitest run ../shared/src/workbench/AgentHubWorkbench.test.tsx --config vitest.shared-ci.config.ts
```

Result: 1 test file passed, 53 tests passed. Covers shared workbench rendering, including the Hub replay Tasks empty state wording.

```powershell
cd app/web
corepack.cmd pnpm typecheck
```

Result: passed.

```powershell
cd app/web
corepack.cmd pnpm build
```

Result: passed. Vite emitted existing chunk-size warnings; no build failure.

```powershell
git diff --check
```

Result: passed; output only contained Windows LF-to-CRLF working-copy warnings.

## Current Verification Gates

1. [x] Desktop `corepack.cmd pnpm run test:e2e:chat-flow`
2. [x] Desktop `corepack.cmd pnpm run test:visual:chat-flow`
3. [x] Desktop focused Vitest gates
4. [x] Desktop `corepack.cmd pnpm typecheck`
5. [x] Desktop `corepack.cmd pnpm build`
6. [x] Web `corepack.cmd pnpm run test:e2e:chat-flow`
7. [x] Web `corepack.cmd pnpm run test:visual:chat-flow`
8. [x] Web `corepack.cmd pnpm run test:e2e:stubbed-hub`
9. [x] Web focused Vitest gate
10. [x] Web `corepack.cmd pnpm typecheck`
11. [x] Web `corepack.cmd pnpm build`
12. [x] `git diff --check`

## Archive Closeout

Date: 2026-06-27

- Moved this workflow's `docs/analysis/`, `docs/progress/`, and Chat UIUX plan files under `docs/archives/chat-uiux-data-mode-e2e/`.
- Kept unrelated `docs/plan/wave-a-implementation-plan.md` active in `docs/plan/`.
- Updated `AGENTS.md`, `CLAUDE.md`, `docs/README.md`, `docs/roadmap.md`, and `docs/governance/workflow-standard.md` so active progress, completed archives, and general workflow gates no longer conflict.
- Replaced the misleading Web task-contract error badge with `Hub task error`.
- Fixed Desktop/Web visual scripts on Windows to terminate their spawned Vite process trees; the first Web visual closeout attempt produced a screenshot but timed out before this fix.

Fresh closeout evidence:

```powershell
cd app/web
corepack.cmd pnpm exec vitest run src/platform/useWebWorkbenchModel.test.ts --config vitest.config.ts
```

Result: 1 test file passed, 25 tests passed.

```powershell
cd app/web
corepack.cmd pnpm run test:e2e:chat-flow
```

Result: 1 passed.

```powershell
cd app/web
corepack.cmd pnpm run test:e2e:stubbed-hub
```

Result: 7 passed.

```powershell
cd app/web
corepack.cmd pnpm run test:visual:chat-flow
```

Result: passed after Windows process-tree cleanup fix. Metrics included `tableCount=1`, `horizontalOverflow=0`, `scrollGap=0`, `transcriptHasInspectorOnlyText=false`, `inspectorHasReviewer=true`, `transcriptHasModeDebug=false`, `dataSource=stubbed-hub-session`, `real_tested=false`.

```powershell
cd app/desktop
corepack.cmd pnpm run test:visual:chat-flow
```

Result: passed. Metrics included `sawVisible=true`, `disappearedAfterVisible=false`, `scrollGap=0`, `horizontalOverflow=0`, merged card stack present, inner radii `0`.

## Known Limits

- Vite renderer E2E does not prove packaged Tauri sidecar bundling, Windows installer behavior, app icon, Edge/sqlite packaging, signing, or native window behavior.
- Web stubbed Hub replay is not real TokenDance ID login, real CLI/model execution, real Gateway/API spend, deploy, signing, or release evidence.
- Demo/mock/debug metadata must stay in status/settings/manifest surfaces, not in main chat message bubbles.

## Next Step

Continue with broader review only where the SPEC identifies remaining real UIUX or data-mode risk.
