# P1 Desktop Edge Launch Flow

Last updated: 2026-06-09

## Scope

- Worktree: `D:\Code\TokenDance\AgentHub\.worktrees\p1-desktop-edge-launch-flow`
- Branch: `codex/p1-desktop-edge-launch-flow`
- Base: `219cadb0`
- Allowed surface: Desktop Local Edge readiness and target registration UX.

## Change

- Settings > Execution Targets now shows a Local Edge target readiness callout.
- The callout checks Hub `/web/execution-targets` pages for a `local_edge` target whose `device_id` matches the current Desktop device ID.
- The UI does not infer readiness from a sole `local_edge` target; readiness requires a current Desktop device ID, Local Edge online, a matching Hub target, `is_online=true`, and non-degraded Hub target health.
- The UI distinguishes signed-out, loading, read failure, missing device ID, Local Edge offline, pagination-limited inventory, missing Hub target, stale/offline Hub target, degraded/unknown Hub target, and registered-ready states.

## Verification

- `corepack.cmd pnpm exec vitest run src/__tests__/executionTargetQueries.test.tsx src/components/settings/sections/ExecutionTargetsSection.test.tsx --config vitest.config.ts --reporter=dot`
- Full desktop typecheck and `git diff --check` are expected before commit.

## Remaining Before Real CLI Remote Control

- Hub-driven remote control still needs live end-to-end evidence from Hub task dispatch to the registered Desktop target.
- The Desktop task bridge still depends on existing Hub auth/device registration and Local Edge availability; this change only surfaces readiness, it does not add backend APIs.
- CLI execution continues to go through Local Edge; the renderer still does not grant host paths or execute CLI work directly.
