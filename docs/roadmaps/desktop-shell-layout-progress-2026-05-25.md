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
- `app/desktop/src/components/SettingsPage.module.css`
- `app/desktop/src/components/WelcomeScreen.tsx`
- `app/desktop/src/components/WelcomeScreen.module.css`
- `app/desktop/src/__tests__/WelcomeScreen.test.tsx`

## Completed

- Moved Desktop shell layout state from local `App` state into persistent `useUIStore`.
- Persisted left sidebar width, right panel width, left sidebar collapsed state, and right run panel open state under `agenthub-ui-shell`.
- Added a Codex-like collapsed right rail when a run exists and the run detail panel is closed.
- The collapsed right rail exposes icon-only controls for reopening run detail, opening Tasks, and opening Agent Scheduling.
- Added a live status dot on the collapsed right rail so active runs remain visible without occupying the full right panel.
- Added i18n for the collapsed run detail rail aria label.
- Added shell keyboard shortcuts: `Cmd/Ctrl+B` toggles the left sidebar and `Cmd/Ctrl+J` toggles the run detail panel.
- Updated the shortcut help dialog and Settings keyboard page so the navigation shortcuts are discoverable.
- Added explicit focus-visible states for shell icon buttons, window controls, run panel tabs, and shortcut dialog close.
- Added ARIA state to collapsed/expanded shell controls and made the left/right resize separators keyboard-adjustable with arrow keys, Home, and End.
- Reworked Settings cards to use a shared macOS-style glass surface: translucent fill, thin highlight border, blur/saturation, and softer shadows.
- Fixed Settings navigation overflow so the left settings directory scrolls independently on desktop and switches to horizontal scrolling on mobile.
- Replaced the old generic welcome screen with an Agent dispatch launcher that separates Runtime, Agent Profile, and Execution Target.
- Made send feedback immediate: the user message appears before the run request resolves, and runs without agent text streams are projected into the main chat from run output/status instead of only the right panel.
- Added a persisted Desktop model settings store under `agenthub-model-settings`.
- Turned Settings > Models from static placeholder rows into editable local defaults for model, provider, reasoning effort, and provider fallback.
- Turned Settings > Model Mapping into editable alias routing for `opus`, `sonnet`, and `haiku`, including concrete model, provider, reasoning effort, and enable state.
- Turned Settings > cc-switch into editable local provider health rows with model counts, health state, and operator notes.
- Tightened Settings mobile navigation into horizontal glass chips so Android/Web-sized viewports keep the active settings content in the first screen.

## Verification

- `cd app/desktop && corepack.cmd pnpm vitest run src\__tests__\uiStore.test.ts src\__tests__\SettingsPage.test.tsx`
- `cd app/desktop && corepack.cmd pnpm vitest run src\__tests__\ShortcutHelp.test.tsx src\__tests__\SettingsPage.test.tsx src\__tests__\uiStore.test.ts`
- `cd app/desktop && corepack.cmd pnpm typecheck`
- `cd app/desktop && corepack.cmd pnpm vitest run src\__tests__\WelcomeScreen.test.tsx src\__tests__\PromptInput.test.tsx src\__tests__\useChatMessages.test.ts`
- Playwright visual checks at `1440x900`, `1280x720`, and `390x844`: no console errors or warnings, no raw i18n keys, and no horizontal overflow.
- Playwright keyboard checks: Tab reaches the left rail control, `Ctrl+B`/`Ctrl+J` still toggle shell panels, and focused separators expose current width through ARIA.
- Playwright send-flow check against `http://127.0.0.1:5173/`: `/v1/runs` returned `202`, center chat showed the submitted user text plus mock runner output, and there were no console errors.
- Playwright Settings check: Agent Market left nav scrolled from `scrollTop=0` to `344`, glass card CSS resolved to `rgba(31, 31, 38, 0.46)` with `blur(22px) saturate(1.18)`, and there were no console errors.
- `cd app/desktop && python -m json.tool src\i18n\locales\en.json > $null; python -m json.tool src\i18n\locales\zh.json > $null`
- `cd app/desktop && corepack.cmd pnpm vitest run src\__tests__\SettingsPage.test.tsx src\__tests__\uiStore.test.ts`
- `cd app/desktop && corepack.cmd pnpm typecheck`
- Playwright Settings model-config/model-mapping/cc-switch checks at `1440x960` and `390x844`: no console errors or warnings, no raw i18n keys, no horizontal overflow, controls editable, and screenshots refreshed under `app/desktop/screenshots/settings-*-local-*.png`.

## Follow-up

- Fold the status into `docs/roadmap.md` batch B once the current parallel docs edits settle.
- Next layout step: add shared tooltip primitives for shell icon buttons once the shared UI package is ready for cross-app adoption.
- Inject persisted model defaults and alias resolution into the Edge `StartRunRequest` path after the current Edge/API edits settle.
- Sync the same model/cc-switch settings with Hub/TokenDance ID once the account/auth boundary is stable.
