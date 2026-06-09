# AgentHub Mobile Expo RN Handoff

Last updated: 2026-06-10

## Ownership

- Scope: AgentHub Mobile only, under `app/mobile-rn` plus active Mobile governance references.
- Branch: `codex/mobile-delivery-sprint`.
- Worktree: use the AgentHub mobile delivery worktree, not the main checkout.
- Main AgentHub checkout stays read-only for this mobile lane.
- The old Tauri Mobile package has been removed from the active source tree. Do not restore it.

## Current Direction

- New mainline is Expo SDK 56 + React Native 0.85 + React 19.2.
- Use Expo development builds, not Expo Go.
- Default visual mode is light/white-first.
- i18n follows system language through Expo localization, with zh/en strings in `src/i18n/strings.ts`.
- Reduced motion is a release gate. The visual QA harness must keep interaction scenes under `prefers-reduced-motion: reduce` free of active CSS transitions or animations.
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
- Native camera/photo/document/storage capability adapter tests.
- Desktop-aligned mobile token aliases and theme tests.
- Visual QA script with multiple mobile scenarios.
- Visual QA includes phone and tablet split-pane composer interaction scenes with reduced motion enabled.
- Native readiness config checker for development build prerequisites.
- Local Windows Android release APK packager at `scripts/package-android.ps1`, defaulting to short real paths `D:\ah\agenthub-mobile` and `D:\p\agenthub-mobile` to avoid RN/Expo/Gradle root mismatches and CMake/ninja path-length failures. The `v0.3.0-rc.7` proof used explicit paths `D:\ah\a` and `D:\p\a`.
- Android release APK install/open proof on Wi-Fi ADB device `192.168.1.105:5555` (`V2405A`), with the app launching into the bundled demo instead of requiring Metro.

## Commands

Run from the AgentHub worktree root.

```powershell
corepack pnpm --filter agenthub-mobile-rn verify
corepack pnpm --filter agenthub-mobile-rn run verify:brand
corepack pnpm --filter agenthub-mobile-rn native:check
corepack pnpm --filter agenthub-mobile-rn mock:hub:check
corepack pnpm --filter agenthub-mobile-rn android:package -- -Version 0.3.0-rc.7 -InstallSerial 192.168.1.105:5555 -Launch
corepack pnpm --filter agenthub-mobile-rn verify:qa
```

Gate mapping:

| Gate | Command | Notes |
|---|---|---|
| Light default | `corepack pnpm --filter agenthub-mobile-rn visual:qa` | Light scenes must meet the surface brightness threshold. |
| zh/en/i18n | `corepack pnpm --filter agenthub-mobile-rn verify` | i18n tests keep zh/en dictionaries aligned and system-locale fallback covered. |
| Reduced motion | `corepack pnpm --filter agenthub-mobile-rn visual:qa` | Reduced-motion interaction scenes verify the media query and reject active CSS motion samples. |
| Privacy scan | `corepack pnpm --filter agenthub-mobile-rn verify` plus `visual:qa` | Static and rendered checks reject private names, secret patterns, raw transport/debug strings, and API paths. |
| Android release APK proof | `corepack pnpm --filter agenthub-mobile-rn android:package -- -InstallSerial 192.168.1.105:5555 -Launch` | Builds an installable `assembleRelease` APK with embedded JS, installs over Wi-Fi ADB, and launches the app. `native:check` remains config readiness only. |

For live preview:

```powershell
corepack pnpm --filter agenthub-mobile-rn mock:hub
corepack pnpm --filter agenthub-mobile-rn dev:web
```

Open `http://localhost:5177/` for the mobile visual preview.

## Native Release Gate

Do not publish a full Android/iOS Mobile GA release until these are proven in development builds:

- Android release APK install/open is proven locally on Wi-Fi ADB, but production signing and store distribution are not configured.
- iOS simulator or EAS development build route is verified.
- TokenDance ID AuthSession + PKCE round trip works with the `agenthub://` scheme.
- SecureStore persists Hub session and logout clears it.
- Notifications deliver and tap through to the correct task/chat intent.
- Camera capture, photo/video picker, document picker, and evidence cache cleanup work in a development build.
- Native app opens the bundled demo offline; Hub snapshot and update stream against mock/local/live Hub still need device proof.
- Visual QA confirms Desktop-aligned light UI, Feishu-like mobile ergonomics, zh/en parity, and no private mock data.
- Visual QA confirms reduced-motion interaction scenes and tablet split-pane panes remain stable.

## Known Gaps

- 5177 is a design/visual preview, not native proof.
- `native:check` is not Android install proof; it only validates config and profile readiness.
- The current delivery branch was created from the latest `origin/dev/delicious233` available at branch creation and should be rebased before handoff if that remote moves again.
- Feishu reference polish is ongoing: list density, avatar detail, chat composer, account drawer, and typography still need more visual QA rounds.
- Desktop/Web parity is not complete outside Chat/Tasks. Contacts, Docs, Agents, Projects, and Settings need more page-specific mobile screens that preserve Desktop page semantics instead of only listing rows.
- Keep the explicit route mapping documented: Desktop route `runs` is the mobile primary tab `tasks`; legacy run/approval/activity deep links and notifications route into Tasks context instead of separate primary screens.
- Settings must add Desktop panes such as appearance, notifications, agent/defaults, local/runtime state while keeping mobile-only identity/session controls in account/profile surfaces.
- Native device proof is still missing for media permissions, camera/photo/document picker behavior, storage cleanup, SecureStore persistence, notifications, real Hub update stream, and iOS. Android install/open is proven with the local release APK.
- Push/PR should keep this branch isolated from backend/desktop feature work.
