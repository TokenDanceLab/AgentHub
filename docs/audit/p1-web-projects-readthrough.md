# P1 Web Projects Read-Through

Date: 2026-06-09
Branch: `codex/p1-web-projects-readthrough`
Base: `codex/p1-critical-evidence-integration` at `219cadb0`

## Scope

- Web real-mode project list read-through.
- Hub `/web/projects` client boundary and shared workbench projection.
- Demo/mock fallback separation for Projects data.

## Evidence

- `app/web/src/api/hubClient.ts` exposes `listWorkspaceProjects()` on `GET /web/projects` and injects the Hub bearer token through the shared Hub client request path.
- `app/web/src/platform/useWebWorkbenchModel.ts` calls `hubClient.listWorkspaceProjects({ pageSize: 50 })` only when Web is Hub-ready and maps Hub workspace projects into shared `ProjectInfo` cards with no mock runs, artifacts, members, or feed.
- Demo mode remains explicit: `resolveWebWorkbenchProjects()` returns `undefined` only for demo fallback, while real/auto non-demo empty states use `[]` so the shared workbench does not silently substitute mock projects.
- Real mode without Hub readiness now surfaces `Sign in to Hub to load workspace projects.` instead of a silent empty Projects state.

## Tests

- `app/web/src/api/hubClient.test.ts` covers the `/web/projects` request path and auth header behavior.
- `app/web/src/platform/useWebWorkbenchModel.test.ts` covers Hub workspace projection, demo fallback separation, real-mode loading/error/action status, and the signed-out real-mode Projects state.

## Non-Goals

- No backend API changes.
- No direct Web to Local Edge or localhost runtime calls.
- No mobile changes.
- No real login, deployment, push, merge, tag, or roadmap edits.
