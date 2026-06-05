# Frontend Issue Closeout Evidence - 2026-06-01
n> ⚠️ 已归档（2026-06-05）：内容过时/已迁移。当前权威文档见 `docs/architecture.md` 和 `docs/roadmap.md`。

This note records which open frontend/client issues are already covered by current Desktop tests after PR #229 landed on `dev/delicious233`.

## Close candidates

- #181 `Fix the Desktop frontend CI test script name`: `.github/workflows/checks.yml` now runs `pnpm test:ci`, and `app/desktop/package.json` defines `test:ci`.
- #155 / #125 Hub response envelopes: `app/desktop/src/api/hubClient.ts` unwraps `{ code, data }` responses and parses Hub error envelopes. Covered by `hubClient.test.ts`.
- #123 / #121 / #119 Desktop IM Hub sessions: `useIMChat` loads Hub sessions, maps `session_id` as conversation id, creates private/group sessions, and sends messages through Hub session ids. Covered by `useIMChat.test.ts`.
- #118 / #92 Desktop IM lifecycle events: `useIMChat` handles `session.created`, `session.updated`, `session.dissolved`, read-through, mark-read, and message recall WebSocket updates. Covered by `useIMChat.test.ts`.
- #106 Desktop thread rename/delete: `ThreadPanel` wires rename/delete mutations with inline rename, delete confirmation, cancel paths, and offline disabled state. Covered by `ThreadPanel.test.tsx`.

## Keep open

- #126 Desktop Hub client separation: the Desktop client still intentionally exposes `/web/agent-tasks` and `/web/execution-targets` helpers for Hub dispatch and Execution Target routing. Close only after a follow-up design either namespaces these methods or explicitly accepts the mixed client surface.
- #102 Blocking approval: requires Edge runtime + Desktop decision plumbing and is not part of this frontend-only closeout.
- #14 M1 frontend epic: original mock/static acceptance is obsolete. Treat it as an epic summary; close only after linked Web/Desktop issues are resolved or replaced with current Run Workbench / IM / Execution Target criteria.

## Verification

- `cd app/desktop && corepack.cmd pnpm vitest run src/__tests__/hubClient.test.ts src/__tests__/useIMChat.test.ts src/__tests__/ThreadPanel.test.tsx`
- Result: 3 files passed, 66 tests passed.
