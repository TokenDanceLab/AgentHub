# ROADMAP

Last updated: 2026-05-23 01:04 +08:00

## Current Goal

Build a maintainable Web UI architecture on top of the latest `feat/client-dev` client integration branch, using `ROADMAP.md` to record progress, decisions, verification, and next steps.

## Principles

- Keep the Web UI aligned with the current Hub-Edge-Runner design: REST JSON commands plus WebSocket typed events.
- Reuse `app/shared/` TypeScript contracts and the proven Desktop client patterns before adding new abstractions.
- Treat the Web app as a three-pane Agent workspace shell: Project/Thread navigation, IM run stream, and Diff/Preview/Logs inspection.
- Keep this slice engineering-focused; leave final visual polish and product skin to the UI design workstream.
- Do not change API contracts or Go services unless the current Web slice proves an actual contract gap.
- Keep local Edge control restricted to trusted local origins and avoid any secrets, private paths, or real workspace data in code/docs.

## Milestones

- [x] Sync Web worktree to the latest `origin/feat/client-dev` base.
- [x] Establish the first `app/web` React + TypeScript architecture slice.
- [x] Reuse current Local Edge REST and WebSocket contracts for health, runners, runs, and event stream.
- [x] Add deterministic tests for Web state folding, API errors, and shell layout semantics.
- [x] Document Web UI development and verification steps for the next frontend/UI contributor.

## Active Work

- [x] Create `feat/frontend-webui` from `origin/feat/client-dev`.
- [x] Add Web UI test skeleton for API client, event reducer, and three-pane shell semantics.
- [x] Implement Web API client, event reducer/store, hooks, and shell components.
- [x] Run targeted Web tests and build.
- [x] Run repository validation checks that match the touched surface.
- [x] Update handoff docs with the new `app/web` entrypoint.

## Review Gates

- [x] Baseline verified against latest `feat/client-dev`.
- [x] Tests or deterministic checks updated.
- [x] Implementation passes targeted Web tests.
- [x] Documentation synchronized.
- [x] Git status reviewed.

## Verification Log

- 2026-05-23 00:56 +08:00: `cd app/web; pnpm test` passed, 3 files / 5 tests.
- 2026-05-23 00:59 +08:00: `cd app/web; pnpm test` passed after reinstalling dependencies from the current Web package manifest.
- 2026-05-23 01:00 +08:00: `cd app/web; pnpm build` passed, TypeScript + Vite production build.
- 2026-05-23 01:07 +08:00: `cd app/web; pnpm test` passed, 3 files / 5 tests.
- 2026-05-23 01:07 +08:00: `cd app/web; pnpm build` passed, TypeScript + Vite production build.
- 2026-05-23 01:07 +08:00: `git diff --check` passed.
- 2026-05-23 01:07 +08:00: OpenAPI YAML parse check passed with `yaml ok`.

## Backlog

- [ ] Add Web Playwright coverage after the UI design workstream lands stable screens.
- [ ] Move Project / Thread / Diff / Approval / Preview panels from placeholders to real API-backed panels after M4 contracts are implemented.
- [ ] Evaluate whether `app/desktop` and `app/web` should share hooks/API clients through `app/shared` after both surfaces stabilize.
