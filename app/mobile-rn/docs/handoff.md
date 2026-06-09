# AgentHub Mobile Expo RN Handoff

Last updated: 2026-06-09

## Ownership

- Scope: AgentHub Mobile only, under `app/mobile-rn` plus mobile migration docs.
- Branch: `codex/mobile-delivery-sprint`.
- Worktree: use the AgentHub mobile delivery worktree, not the main checkout.
- Main AgentHub checkout stays read-only for this mobile lane.
- Legacy `app/mobile` remains the frozen Tauri prototype/reference until the replacement gate passes.

## Current Direction

- New mainline is Expo SDK 56 + React Native 0.85 + React 19.2.
- Use Expo development builds, not Expo Go.
- Default visual mode is light/white-first.
- i18n follows system language through Expo localization, with zh/en strings in `src/i18n/strings.ts`.
- Mock and preview data must stay limited to `Delicious233`, `TokenDance`, and `AgentHub`.
- User-visible UI must not expose raw transport/debug details such as WebSocket reconnect state, localhost URLs, REST paths, or `/v1` endpoints.

## Design Contract

- Mobile IA maps Desktop/Web v4 workbench into phone and tablet navigation:
  - Bottom tabs: chats, docs, tasks, projects, more.
  - More holds Contacts, Agent Profiles, Settings, and account/profile entry points.
  - Chat detail stays under the chats flow.
  - Account/profile is a drawer/sheet, not a primary tab.
  - Tablet uses a parallel-view split: bottom tabs stay inside the left list pane, while transcript and inspector panes remain full-height detail surfaces.
- Design reference:
  - AgentHub Desktop/Web v4 and TokenDance design contract are the source of truth.
  - Feishu/Lark screenshots are ergonomic references for mobile IM density, avatar placement, bottom tabs, account drawer, channel rows, pinned chat cards, and composer controls.
  - Do not create a Feishu-branded clone.
- Brand assets:
  - Expo app icon, splash, favicon, adaptive icon, and notification icon use `agenthub-*` product assets copied from the TokenDance workspace canonical logo source, `../logo/products/agenthub/`.
  - Do not use legacy TokenDance asset filenames or TokenDance Org three-bar assets for AgentHub Mobile app identity.

## Implemented Slice

- `app/mobile-rn` Expo/RN scaffold with app config, EAS config, scripts, tests, and preview fixtures.
- AgentHub product icon assets wired through `app.config.ts` and checked by `verify:brand` plus `native:check`.
- Local design preview on port `5177` through `pnpm dev:web`.
- Local mock Hub on port `8088` through `pnpm mock:hub`.
- Safe preview fallback that hides transport failures from user-facing UI.
- RN Hub client/event stream lifecycle tests.
- TokenDance ID AuthSession planning/wiring module tests.
- SecureStore adapter/session state tests.
- Notification bridge and notification intent tests.
- Desktop-aligned mobile token aliases and theme tests.
- Visual QA script with multiple mobile scenarios.
- Native readiness config checker for development build prerequisites.

## Commands

Run from the AgentHub worktree root.

```powershell
corepack pnpm --filter agenthub-mobile-rn verify
corepack pnpm --filter agenthub-mobile-rn run verify:brand
corepack pnpm --filter agenthub-mobile-rn native:check
corepack pnpm --filter agenthub-mobile-rn mock:hub:check
corepack pnpm --filter agenthub-mobile-rn verify:qa
```

For live preview:

```powershell
corepack pnpm --filter agenthub-mobile-rn mock:hub
corepack pnpm --filter agenthub-mobile-rn dev:web
```

Open `http://localhost:5177/` for the mobile visual preview.

## Replacement Gate

Do not replace `app/mobile` until these are proven in development builds:

- Android development build installs and opens.
- iOS simulator or EAS development build route is verified.
- TokenDance ID AuthSession + PKCE round trip works with the `agenthub://` scheme.
- SecureStore persists Hub session and logout clears it.
- Notifications deliver and tap through to the correct task/chat intent.
- Native app reads Hub snapshot and update stream from mock/local/live Hub without showing raw transport state.
- Visual QA confirms Desktop-aligned light UI, Feishu-like mobile ergonomics, zh/en parity, and no private mock data.

## Known Gaps

- 5177 is a design/visual preview, not native proof.
- The current delivery branch was created from the latest `origin/dev/delicious233` available at branch creation and should be rebased before handoff if that remote moves again.
- Feishu reference polish is ongoing: list density, avatar detail, chat composer, account drawer, and typography still need more visual QA rounds.
- Desktop/Web parity is not complete outside Chat/Tasks. `contacts`, `docs`, `agents`, `projects`, and `settings` currently share a generic mobile surface; the next slice should split them into page-specific mobile screens that preserve Desktop page semantics instead of only listing rows.
- Keep the explicit route mapping documented: Desktop route `runs` is the mobile primary tab `tasks`; legacy run/approval/activity deep links and notifications route into Tasks context instead of separate primary screens.
- Settings must add Desktop panes such as appearance, notifications, agent/defaults, local/runtime state while keeping mobile-only identity/session controls in account/profile surfaces.
- Native device proof is still missing.
- Push/PR should keep this branch isolated from backend/desktop feature work.
