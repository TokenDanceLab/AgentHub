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
- Wired persisted model settings into Desktop run dispatch: `App.handleSend` now resolves default model/provider/reasoning settings and alias mappings before calling `/v1/runs`.
- Extended the shared `StartRunRequest` client contract with optional `provider`, `modelAlias`, `modelMappingEnabled`, and `providerFallbackEnabled` routing metadata so Edge/Hub can consume the same TokenDance model-routing envelope later.
- Added a compact run-route preview inside the prompt composer so users can see the resolved Provider, model, reasoning effort, and alias before dispatch.
- Turned Settings > Agent Profiles into a local Profile readiness view: Runtime inventory stays separate, and derived Profile cards now compose Runtime + model route + alias + configuration sources + Local Edge execution target.
- Upgraded the welcome screen into a live Agent dispatch launcher: it now reads real Local Edge Runtime adapters, previews the selected Profile route, supports Runtime/Profile/Target mode switching, and sends suggestion prompts with both `agentId` and the resolved Profile alias.
- Fixed the empty-thread welcome decision so stale agent-only Edge events no longer hide the welcome launcher before the user sends anything.
- Fixed welcome focus behavior by locating the prompt textarea through stable textarea selectors instead of an English-only placeholder.
- Shared the derived local Agent Profile alias logic across Settings, Welcome, and the prompt composer.
- Made the bottom prompt composer follow the selected Agent Profile route by default: selecting Codex now previews and sends `sonnet -> claude-sonnet-4-6 / anthropic / high` unless the user manually overrides the model.
- Replaced shell-level icon-only button `title` hints with a shared glass tooltip behavior for the window controls, mobile toolbar, collapsed rails, sidebar footer, workspace header, and right-panel collapse button.
- Preserved touch/mobile ergonomics by hiding tooltip popovers on touch-sized viewports while keeping `aria-label` and `aria-describedby` semantics for assistive technology.

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
- `cd app/desktop && corepack.cmd pnpm vitest run src\__tests__\modelSettingsStore.test.ts src\__tests__\edgeClient.test.ts src\__tests__\SettingsPage.test.tsx src\__tests__\PromptInput.test.tsx`
- Playwright request-body check: changed Settings > Models to `gpt-5.5` / `openai` / `max`, returned to chat, sent a prompt, intercepted the real `/v1/runs` POST body, and verified `model=gpt-5.5`, `provider=openai`, `reasoningEffort=max`, `modelMappingEnabled=true`, `providerFallbackEnabled=true`, with no console errors, raw i18n keys, or horizontal overflow. Screenshot: `app/desktop/screenshots/run-request-model-settings-body.png`.
- `cd app/desktop && corepack.cmd pnpm vitest run src\__tests__\PromptInput.test.tsx src\__tests__\modelSettingsStore.test.ts src\__tests__\edgeClient.test.ts`
- Playwright composer route-preview check at `1440x960` and `390x844`: Settings changed to `gpt-5.5` / `openai` / `max`, composer preview displayed those resolved values, `/v1/runs` POST body matched them, and both viewports had no console errors, raw i18n keys, or horizontal overflow. Screenshots: `app/desktop/screenshots/prompt-route-preview-desktop.png`, `app/desktop/screenshots/prompt-route-preview-mobile.png`.
- `cd app/desktop && python -m json.tool src\i18n\locales\en.json > $null`
- `cd app/desktop && python -m json.tool src\i18n\locales\zh.json > $null`
- `cd app/desktop && corepack.cmd pnpm vitest run src\__tests__\SettingsPage.test.tsx src\__tests__\modelSettingsStore.test.ts`
- `cd app/desktop && corepack.cmd pnpm typecheck`
- Playwright Settings Agent Profiles check at `1440x960` and `390x844`: real Local Edge data produced Claude Code / Codex / OpenCode local Profile cards, mapped to `opus` / `sonnet` / `haiku` model routes, with no console errors or warnings, no raw i18n keys, and no horizontal overflow. Screenshots: `app/desktop/screenshots/settings-agent-profiles-local-profiles.png`, `app/desktop/screenshots/settings-agent-profiles-local-profiles-mobile.png`.
- `cd app/desktop && python -m json.tool src\i18n\locales\en.json > $null`
- `cd app/desktop && python -m json.tool src\i18n\locales\zh.json > $null`
- `cd app/desktop && corepack.cmd pnpm vitest run src\__tests__\WelcomeScreen.test.tsx src\__tests__\MainView.test.ts src\__tests__\modelSettingsStore.test.ts`
- `cd app/desktop && corepack.cmd pnpm typecheck`
- Playwright welcome dispatch check at `1440x960` and `390x844`: with `/v1/threads` mocked empty and real Local Edge `/v1/agents`, selected Codex Runtime, previewed `sonnet -> claude-sonnet-4-6 / anthropic / high`, submitted a suggestion, and verified the `/v1/runs` request body carried `agentId=codex`, `modelAlias=sonnet`, `model=claude-sonnet-4-6`, `provider=anthropic`, with no console errors, raw i18n keys, or horizontal overflow. Screenshots: `app/desktop/screenshots/welcome-dispatch-profile-desktop.png`, `app/desktop/screenshots/welcome-dispatch-profile-mobile.png`.
- `cd app/desktop && corepack.cmd pnpm vitest run src\__tests__\PromptInput.test.tsx src\__tests__\WelcomeScreen.test.tsx src\__tests__\SettingsPage.test.tsx src\__tests__\modelSettingsStore.test.ts`
- `cd app/desktop && corepack.cmd pnpm typecheck`
- `cd app/desktop && python -m json.tool src\i18n\locales\en.json > $null; python -m json.tool src\i18n\locales\zh.json > $null`
- Playwright composer selected-Agent Profile route check at `1440x960` and `390x844`: with real Local Edge `/v1/agents`, selected Codex from the shell Agent list, verified the bottom composer preview displayed `anthropic / claude-sonnet-4-6 / high / sonnet`, submitted through Enter, and verified the `/v1/runs` body carried `agentId=codex`, `modelAlias=sonnet`, `model=claude-sonnet-4-6`, `provider=anthropic`, `reasoningEffort=high`, with no console errors or horizontal overflow. Screenshots: `app/desktop/screenshots/prompt-selected-agent-profile-route-desktop.png`, `app/desktop/screenshots/prompt-selected-agent-profile-route-mobile.png`.
- `cd app/desktop && corepack.cmd pnpm typecheck`
- Playwright shell tooltip check at `1440x960`: with `/v1/threads` mocked empty and real Local Edge status, hovered and keyboard-tabbed to the workspace share icon, verified `role=tooltip`, `aria-describedby`, visible opacity, glass `blur(18px) saturate(1.12)`, no console errors, and no horizontal overflow. Screenshot: `app/desktop/screenshots/shell-icon-tooltips-desktop.png`.
- Playwright mobile shell check at `390x844`: verified the mobile toolbar keeps tooltip nodes semantically attached but hides popovers with `display: none`, with no console errors or horizontal overflow. Screenshot: `app/desktop/screenshots/shell-icon-tooltips-mobile.png`.

## Follow-up

- Fold the status into `docs/roadmap.md` batch B once the current parallel docs edits settle.
- Next layout step: add shared tooltip primitives for shell icon buttons once the shared UI package is ready for cross-app adoption.
- Teach Edge/Hub to persist or act on the optional model-routing metadata once the current Edge/API edits settle; Desktop already sends it.
- Sync the same model/cc-switch settings with Hub/TokenDance ID once the account/auth boundary is stable.
- Next Agent Profile step: replace the derived readiness cards with editable local Profile persistence once the Agent/Profile API boundary lands.
- Next welcome step: surface a first-run empty state that can create a real thread explicitly once Edge exposes thread creation as a first-class client action.
- Next composer step: expose the selected Profile alias as a visible editable chip once persisted local Agent Profiles replace the derived mapping.
- Next shell polish step: move `ShellIconButton` into shared UI once `app/shared/src/ui` type resolution is stable, then apply the same tooltip primitive to Settings and RunDetail icon-only controls.
