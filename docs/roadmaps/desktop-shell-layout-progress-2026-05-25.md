# Desktop shell layout progress - 2026-05-25

## Scope

This note records Desktop client progress for roadmap batch B, "Codex App layout fusion and sidebar recovery".

Write scope:

- `app/desktop/src/App.tsx`
- `app/desktop/src/App.module.css`
- `app/desktop/src/stores/uiStore.ts`
- `app/desktop/src/__tests__/uiStore.test.ts`
- `app/desktop/src/i18n/locales/en.json`
- `app/desktop/src/i18n/locales/zh.json`

## Completed

- Moved Desktop shell layout state from local `App` state into persistent `useUIStore`.
- Persisted left sidebar width, right panel width, left sidebar collapsed state, and right run panel open state under `agenthub-ui-shell`.
- Added a Codex-like collapsed right rail when a run exists and the run detail panel is closed.
- The collapsed right rail exposes icon-only controls for reopening run detail, opening Tasks, and opening Agent Scheduling.
- Added a live status dot on the collapsed right rail so active runs remain visible without occupying the full right panel.
- Added i18n for the collapsed run detail rail aria label.

## Verification

- `cd app/desktop && corepack.cmd pnpm vitest run src\__tests__\uiStore.test.ts src\__tests__\SettingsPage.test.tsx`
- `cd app/desktop && corepack.cmd pnpm typecheck`
- Playwright visual checks at `1440x900`, `1280x720`, and `390x844`: no console errors or warnings, no raw i18n keys, and no horizontal overflow.

## Follow-up

- Fold the status into `docs/roadmap.md` batch B once the current parallel docs edits settle.
- Next layout step: add keyboard shortcuts for left sidebar collapse and right run panel reopen, then validate focus order.
