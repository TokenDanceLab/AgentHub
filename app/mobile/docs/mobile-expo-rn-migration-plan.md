# AgentHub Mobile Expo / React Native Migration Plan

> Status: planning and migration-control source. This document does not create the Expo app, delete Tauri code, change Hub contracts, or define a release gate.

## Decision

AgentHub Mobile should move toward **Expo + React Native** as the long-term mobile mainline. The current `app/mobile` Tauri implementation is frozen as a legacy prototype and product-reference surface. New platform work should happen in a separate `app/mobile-rn` package until it reaches the replacement gate.

Default spike target:

| Area | Choice |
|---|---|
| Framework | Expo + React Native |
| Preferred SDK | Expo SDK 56 / React Native 0.85 / React 19.2.3 |
| Conservative fallback | Expo SDK 55 if SDK 56 proves unstable in pnpm/Metro or device builds |
| Build model | Expo development builds, not Expo Go |
| Release path | EAS Build / Submit / Update after native capability proof |

Expo/RN is preferred over Tauri Mobile because AgentHub Mobile depends on mature mobile deep links, secure session storage, push notifications, app foreground/background lifecycle, native gestures, and Android/iOS packaging. Tauri remains useful as a reference but should not be expanded as the main mobile platform.

## Product Boundary

Mobile remains a Hub-mediated remote review and control client:

- Mobile talks to Hub REST/WebSocket only.
- Mobile does not start Local Edge.
- Mobile does not expose local filesystem capability.
- Mobile does not consume TokenDance API keys or provider tokens.
- TokenDance ID remains the identity source; Hub remains the product session and authorization boundary.
- Feishu/Lark mobile IM is an interaction reference for mobile ergonomics only; Codex mobile chat is the secondary thread/composer reference.
- System locale drives the initial language choice. The RN app keeps zh/en copy in its own i18n layer and aligns Agent Runtime/Profile/Configuration/Execution Target, TokenDance ID, and TokenDance API key wording with AgentHub docs.

## Design System Boundary

Mobile is an AgentHub v4 surface first and a Feishu-style mobile interaction surface second. The design direction is:

1. **Visual source of truth**: inherit AgentHub Desktop/Web v4 and `agenthub-design/desktop` through the current shared workbench, Desktop theme tokens, TokenDance/AgentHub design-system docs, and `app/shared/src/designTokens.ts`.
2. **Light-first theme**: start visual QA and polish from the white/light appearance. Dark/OLED/system theme modes remain defined and testable, but they do not replace the light-first default.
3. **Interaction reference**: use Feishu/Lark mobile IM only for queue density, identity badges, bottom navigation, search/new entry placement, unread handling, recovery, and native phone ergonomics.
4. **Native adaptation**: implement RN primitives that preserve the AgentHub v4 material, density, status semantics, and typography while adapting safe areas, touch targets, sheets, gestures, keyboard avoidance, and tablet split panes.
5. **Brand asset source**: AgentHub Mobile app icon, splash, favicon, adaptive icon, and notification icon must use `agenthub-*` product assets from the TokenDance workspace canonical logo source, `../logo/products/agenthub/`. Do not use legacy TokenDance asset filenames or the TokenDance Org three-bar mark for AgentHub app identity.

This is not a separate Mobile visual language and not a Feishu clone. Feishu informs the phone/tablet workflow; AgentHub v4 owns the tokens, component semantics, status colors, execution vocabulary, and visual hierarchy.

### Mobile Design Foundation

The first Expo/RN slice must establish design foundations before building feature screens:

| Layer | RN target | Source |
|---|---|---|
| Token object | `src/theme/tokens.ts` exports light/dark/OLED-ready AgentHub mobile tokens | `app/desktop/src/styles/themes.css`, `app/shared/src/designTokens.ts`, legacy `app/mobile/src/styles/global.css` |
| Theme provider | `src/theme/AgentHubThemeProvider.tsx` maps tokens to RN `StyleSheet` helpers and navigation theme | `--td-*` intent contract and Desktop light/dark semantics |
| Primitives | `src/components/primitives/**` for Button, IconButton, Surface, Badge, StatusPill, ListRow, SearchField, SegmentedControl, BottomSheet, EmptyState, ErrorNotice | shared workbench component semantics, rewritten for RN |
| Icons | `src/components/icons/**` uses RN-safe SVG/vector icons with AgentHub names | shared `DesignNavIcon` semantics, not React DOM SVG components |
| Layout | `src/components/layout/**` for AppShell, BottomTabs, Header, QueueList, ThreadPane, InspectorPane | Feishu-style mobile IA adapted to AgentHub v4 surfaces |
| Motion | `src/theme/motion.ts` with 150-300ms transform/opacity rules and reduced-motion switch | TokenDance design playbook |

Design foundation gates:

- No component-level hardcoded palette outside `src/theme/**`.
- No React DOM, CSS module, browser-only storage, or Tauri import in `app/mobile-rn/src/**`.
- Core primitives expose loading, disabled, focus/pressed, error, and long-label behavior from the first slice.
- All touchable controls are at least 44px high; primary bottom-nav and composer controls target 48px.
- Phone `390x844` and tablet `768x1024` layout budgets are encoded before feature screens grow.
- Light and dark token snapshots exist even if only one theme is enabled in the first dev build.

### Component Reuse Policy

Reuse **contracts and design semantics**, not web components:

- Import RN-safe shared TypeScript types, transcript/event normalizers, surface metadata, labels, and fixtures when they do not pull DOM/CSS/Tauri transitively.
- Mirror shared workbench component responsibilities with RN implementations: rail becomes bottom tabs, sidebar becomes queue list, transcript becomes native thread list, inspector becomes sheet or tablet pane, composer becomes keyboard-aware dock.
- Keep component names aligned where useful (`ApprovalCard`, `DiffCard`, `RunStepGroup`, `StatusPill`) so Desktop/Web/Mobile review the same product concept.
- If a shared helper needs extraction, create a pure contract slice in `app/shared` only through the integration owner; Mobile workers must not casually modify shared UI internals.

## Directory Strategy

Use a side-by-side package first:

```text
app/
  mobile/      # Legacy Tauri Mobile prototype, frozen
  mobile-rn/   # New Expo + React Native mainline candidate
```

Do not replace `app/mobile` in the first slice. A side-by-side package preserves the old mobile behavior reference, avoids deleting Tauri Android evidence before RN is proven, and lets Expo/RN work proceed without destabilizing Desktop/Web/Backend.

After `app/mobile-rn` reaches the replacement gate, do a separate switch proposal:

1. Rename or archive `app/mobile` as legacy.
2. Promote `app/mobile-rn` to the canonical Mobile package.
3. Update `AGENTS.md`, package scripts, risk docs, and roadmap.
4. Delete old Tauri code only after replacement evidence exists.

## Reuse Rules

Reuse from `@agenthub/shared` only when the import is RN-safe:

Can reuse:

- TypeScript types and event contracts.
- API and event normalizers that do not import DOM, CSS, React DOM, browser-only storage, or Tauri.
- Transcript/run/approval state machines and pure helpers.
- Surface metadata, status labels, i18n keys, and sanitized fixtures.

Must rewrite for RN:

- React DOM components.
- CSS modules and web design primitives.
- `lucide-react` web icons.
- Tauri invoke bridges.
- Browser storage assumptions.
- Desktop/Web workbench shell layout.

If a useful shared helper currently pulls DOM/CSS/Tauri transitively, extract a small RN-safe pure module in a separate `app/shared` contract slice before consuming it from `app/mobile-rn`.

## Capability Mapping

| Capability | Expo/RN implementation | Gate |
|---|---|---|
| OIDC login | `expo-auth-session`, `expo-web-browser`, `expo-linking`, custom scheme `agenthub://auth/callback` | PKCE state verified; Hub session received; deep link opens app |
| Secure session | `expo-secure-store` | Hub session survives app restart; logout clears it |
| REST | RN `fetch` with injectable base URL and auth headers | Hub health and first list endpoint work against mock/local Hub |
| WebSocket | RN `WebSocket` with cursor/resync policy | Foreground connect, background disconnect or suspend, foreground resync |
| Push/local notification | `expo-notifications` and Hub device registration | approval/run notification opens target thread/run |
| Foreground/background | RN `AppState` | active/background transitions do not lose session or stale WS state |
| Build | Expo development build + EAS profiles | Android dev build installs; iOS dev build plan documented |
| OTA | EAS Update only for JS/assets | native permission/config changes force rebuild |

## First Implementation Slice

Goal: create a minimal Expo/RN package that proves the stack and locks the Mobile design system boundary without replacing the legacy app.

Current status: slice 1 scaffold has started in `app/mobile-rn`. It includes Expo/RN package wiring, AgentHub Desktop-aligned RN tokens, theme provider, primitives, layout shell, stateful Chat/Thread detail/Tasks/Projects/Agent Profiles/More overflow/Settings/Account surfaces, preview scenario fixtures, mock Hub/session/deep-link facades, local mock Hub REST/event-stream script, injectable Hub event stream, AppState-driven Hub lifecycle bridge, default Expo AuthSession/WebBrowser/SecureStore/Linking/Notifications bridge loaders, notification/deep-link bridge contracts, and focused tests. This is not the replacement gate.

Preview port: `app/mobile-rn` uses `http://localhost:5177` for Expo Web visual inspection and screenshot QA. This port is only a browser preview for design review; Android/iOS development builds remain the native capability gate.

Worker J documentation write set: `app/mobile-rn/README.md`, `app/mobile/docs/mobile-expo-rn-migration-plan.md`, and `app/mobile/docs/mobile-v4-plan.md`. Concurrent implementation workers may own code/config/test slices under their assigned paths, but they must preserve the Expo/RN mainline direction, 5177 preview boundary, light-first/system-locale/i18n direction, Desktop/design-system authority, Feishu-only interaction-reference boundary, and the visual QA gate.

Allowed write set:

- `app/mobile-rn/package.json`
- `app/mobile-rn/app.config.ts`
- `app/mobile-rn/tsconfig.json`
- `app/mobile-rn/babel.config.js`
- `app/mobile-rn/metro.config.js`
- `app/mobile-rn/src/**`
- `app/mobile-rn/README.md`
- `app/pnpm-workspace.yaml`
- `app/package.json`
- lockfile changes caused by `pnpm install`
- optional short status line in `docs/roadmap.md`

Do not modify in the first implementation slice:

- `app/mobile/src-tauri/**`
- `app/mobile/src/**`
- `app/mobile/scripts/**`
- `app/desktop/**`
- `app/web/**`
- `hub-server/**`
- `edge-server/**`
- `api/openapi.yaml`

### Slice 1 Task Checklist

- [x] Scaffold `app/mobile-rn` with Expo development-build assumptions and pnpm workspace wiring.
- [x] Add `app.config.ts` with `agenthub` scheme, AgentHub product icon/splash/favicon/notification assets, Android/iOS bundle identifiers, localization/notification/SecureStore plugin declarations, and no production secrets.
- [x] Add no-secret `eas.json` development/preview/production build profiles.
- [x] Add `src/theme/tokens.ts` with AgentHub Desktop-aligned light/dark/OLED-ready token objects.
- [x] Add `src/theme/AgentHubThemeProvider.tsx`, navigation theme mapping, and a reduced-motion flag.
- [x] Add RN primitives: `Button`, `IconButton`, `Surface`, `Badge`, `StatusPill`, `ListRow`, `SearchField`, `SegmentedControl`, `BottomSheet`, `EmptyState`, `ErrorNotice`.
- [x] Add layout primitives: `AppShell`, `BottomTabs`, `ScreenHeader`, `InspectorSheet`.
- [x] Add Desktop-aligned stateful surfaces: Chat, Thread detail, Tasks, Projects, Agent Profiles, More overflow, Settings, Account. Each must use realistic seeded AgentHub workflow data, not blank cards.
- [x] Align Chat composer and transcript details with shared workbench semantics: first-screen text/send/recovery controls, review-context chips, structured approval/diff/run/tool evidence blocks, and no visible no-op attachment buttons.
- [x] Add OIDC/session/API/WS interfaces as typed facades with mock/local adapters and default Expo native bridge loaders; do not wire production hosts.
- [x] Add fixed-port 5177 preview scenarios for More, Settings, Agent Profiles, Projects, evidence inspector sheet, empty queue, offline chat, notification intent, deep-link selection, send-error retry, send pending, compact keyboard send pending/error, approval confirmation/error/resolved, diff preview, many-file/empty file preview, and browser preview loading/ready/error/empty states.
- [x] Add local Hub HTTP contract tests, AuthSession helper tests, SecureStore adapter tests, deep-link bridge tests, and notification response bridge tests.
- [x] Add a no-secret local mock Hub script for `GET /health`, `GET /v1/mobile/snapshot`, `GET /v1/threads`, and `GET /v1/events`, plus a self-check command.
- [x] Add injectable AppState/Hub WebSocket lifecycle tests for foreground connect, background suspend, foreground resync, remote-close reconnect, and listener cleanup.
- [x] Add design snapshot fixtures for `390x844` phone and `768x1024` tablet budgets.
- [x] Add tablet Chat two-column split-pane screenshots for `768x1024` and `1024x768` budgets.
- [x] Add `>=1024px` tablet Chat three-column inspector screenshot with queue, transcript, and persistent run/evidence pane.
- [x] Add tablet inspector Overview/Files/Browser tab screenshots with read-only file/diff preview and browser/artifact readiness states.
- [x] Add README verification commands and clearly label unsupported native build steps if local EAS/device setup is missing.
- [ ] Prove Android development build install on a device or emulator.
- [ ] Prove iOS development build or simulator path through macOS/Xcode or EAS Build.
- [ ] Prove TokenDance ID AuthSession, SecureStore, notification, and deep-link behavior in a development build.
- [ ] Prove Hub REST/WS against a live or locally deployed Hub from a development build, not only Expo Web.

### Slice 1 Verification Commands

Use the final command names from the scaffold, but the first slice should provide equivalents for:

```powershell
cd app\mobile-rn
corepack pnpm install
corepack pnpm verify
corepack pnpm run doctor
corepack pnpm run verify:brand
corepack pnpm native:check
corepack pnpm start -- --clear
corepack pnpm dev:web
corepack pnpm visual:qa
corepack pnpm verify:qa
```

The first visual harness checks:

- `390x844` Chats full queue, Chat long thread/composer, Tasks pending review, Account session/error.
- `390x844` English light home and OLED account coverage.
- `390x844` More overflow, Settings, Agent Profiles, Projects, empty queue, offline chat, notification intent, deep-link selection, send-error retry, send pending, approval confirmation/error/resolved, and diff preview previews.
- `390x560` compact keyboard send pending/error previews.
- `768x1024` tablet budget with current Tasks surface.
- `768x1024` zh and `1024x768` en tablet Chat split-pane budget with queue and thread visible together.
- `1024x768` tablet Chat inspector budget with queue, transcript, persistent run inspector, changed files, approval action, and Hub session status visible together.
- `1024x768` tablet inspector Files and Browser tab budgets with changed-file rows, selected-file and empty-file states, read-only diff preview, browser preview loading/ready/error/empty states, artifact preview readiness, and remote target status.
- `768x1024` tablet diff-preview budget for dense changed-file rows.
- five primary bottom tabs mirror AgentHub workbench semantics on phone: Chat, Docs, Tasks, Projects, More. Tasks remains the primary review-pressure entry; Contacts, Agent/Profile, Settings, and Account are folded into More or the avatar entry; Thread detail and Account hide global tabs. Tablet split views keep the bottom tabs scoped to the left list pane so the transcript and inspector panes remain full-height details. Chat may show task pressure as a compact digest, but task rows stay in the Tasks queue.
- Feishu/Lark screenshot alignment is limited to mobile interaction density: continuous IM rows, inline identity badges, avatar/status placement, compact composer controls, and the account rail/drawer rhythm. Visible content stays AgentHub/Desktop aligned and uses only safe TokenDance/AgentHub/Delicious233 mock data.
- light-first white appearance, plus dark token coverage where the harness supports it.
- dark token rendering remains covered without replacing the light-first default.
- no horizontal overflow, no private identity placeholders in visible or accessibility text, no readable text below 11px, and no touch target below 44px.

Remaining visual depth before M2/M3 promotion: filtered-empty queue, long localized/long command stress, real artifact/browser URL evidence beyond the current readiness card, and native-device preview behavior.

Current verified commands:

```powershell
cd app
corepack pnpm --filter agenthub-mobile-rn typecheck
corepack pnpm --filter agenthub-mobile-rn test
corepack pnpm --filter agenthub-mobile-rn run doctor
corepack pnpm --filter agenthub-mobile-rn lint
corepack pnpm --filter agenthub-mobile-rn run verify:brand
corepack pnpm --filter agenthub-mobile-rn run mock:hub:check
corepack pnpm --filter agenthub-mobile-rn visual:qa
corepack pnpm --filter agenthub-mobile-rn verify
```

Current verified results:

- TypeScript passed.
- Vitest passed: 15 files, 72 tests.
- Expo doctor passed: 21/21 checks.
- Native readiness check passed for the no-secret Android emulator and iOS simulator development-build shape; physical devices still require a LAN Hub URL and install proof.
- ESLint passed for `app/mobile-rn/src`.
- Expo config parsed with localization, notifications, and secure-store plugins.
- Local mock Hub check passed for health, mobile snapshot, and typed event-stream upgrade.
- Security/privacy gates cover Hub API error redaction, forbidden shared/runtime import negative coverage, source/docs/config/script private-term scanning, inline secret pattern scanning, visual visible/accessibility privacy checks, and visual source hygiene scanning for raw component palettes/shadows/type drift.
- Visual QA passed on the fixed 5177 preview for 38+ scenes: zh/en light chat queue, thread, evidence inspector sheet, tasks, account, More, Settings, Agent Profiles, Projects, OLED account, tablet tasks, tablet Chat split-pane in zh/en, tablet Chat three-column inspector Overview/Files/Browser tabs, empty queue, offline chat, notification intent, deep-link thread, send-error retry, send pending, compact keyboard send pending/error, approval approve/reject confirmation, approval submit error, resolved approval, phone/tablet diff preview, many-file/empty file preview, and browser preview loading/ready/error/empty states.

Current native proof matrix:

| Capability | Current proof | Still missing for replacement |
|---|---|---|
| Expo native config | `app.config.ts`, `eas.json`, `expo-doctor`, config parsing, `verify:brand`, and `native:check` cover the no-secret dev-build shape, AgentHub product assets, and Android emulator/iOS simulator mock Hub URL defaults. | Android development build install and iOS/simulator build route; physical-device LAN Hub URL proof. |
| TokenDance ID OIDC | AuthSession helper, default Expo AuthSession redirect URI bridge, default Expo WebBrowser auth-session launcher, and `agenthub://auth/callback` parsing tests. | Mocked or local TokenDance ID + Hub session exchange inside a development build. |
| SecureStore | Adapter, default Expo SecureStore adapter loader, and Hub session storage tests with fake SecureStore. | Device persistence after restart and logout clearing. |
| Notifications | Notification intent parser, native response bridge tests, default Expo Notifications response bridge, Android review channel configuration, and preview scenario. | Device notification delivery and tap-to-thread/run navigation. |
| Hub REST/WS | Typed REST client, local HTTP contract, mock Hub health/snapshot/events, event stream parsing, and injectable lifecycle tests. | Development build proof against live or locally deployed Hub over device networking. |

## Parallel Worker Plan

The work can be parallelized once the `app/mobile-rn` package scaffold exists.

| Worker | Ownership | Output |
|---|---|---|
| A. Expo infrastructure | `app/mobile-rn/package.json`, config files, Metro/pnpm setup | Expo app starts; typecheck/test scripts exist |
| B. Design foundation | `src/theme/**`, `src/components/primitives/**`, `src/components/icons/**` | Desktop-aligned tokens, RN primitives, icon semantics, long-label/error/loading states |
| C. RN shell/navigation | `app/mobile-rn/src/App.tsx`, `src/navigation/**`, `src/components/layout/**` | Feishu-style bottom tabs, queue/thread push flow, tablet split shell using AgentHub v4 surfaces |
| D. API/session | `src/api/**`, `src/session/**`, `src/config/**` | Hub REST/WS facade, SecureStore session, AuthSession/Linking boundary |
| H. Theme/i18n governance | `src/i18n/**`, README design section | zh/en critical copy, identity/API-key wording, design-source notes |
| E. Threads/Tasks read-only | `src/screens/ThreadsScreen.tsx`, `TasksScreen.tsx`, `src/components/queue/**` | list/empty/error/refresh/pending-review states |
| F. Chat/review | `src/screens/ChatScreen.tsx`, `src/components/chat/**`, `src/components/review/**` | messages, composer, approval sheet, send pending/error/retry |
| G. QA harness | `scripts/**`, `e2e/**`, README verification section | typecheck/test/start/emulator screenshot gates |
| J. Planning alignment | `app/mobile-rn/README.md`, `app/mobile/docs/mobile-expo-rn-migration-plan.md`, `app/mobile/docs/mobile-v4-plan.md` | Expo/RN mainline, 5177 preview, light-first i18n direction, design authority, worker write sets, and visual QA gate stay explicit |

The integration owner alone should edit workspace-level files such as `app/pnpm-workspace.yaml`, `app/package.json`, lockfiles, and roadmap status.

Worker conflict rules:

- Worker B owns primitives and token files; screen workers consume them and must not add local palettes or one-off button styles.
- Worker C owns navigation/layout containers; screen workers provide content slots and do not rewrite app-level routing.
- Worker D owns API/session facades; UI workers call typed interfaces and do not fetch directly from screens.
- Worker E and F may run in parallel only after primitives and layout names are stable.
- Worker G can add harness files but must not change screen behavior to satisfy screenshots.
- Worker J owns planning text only and must not modify implementation files, worktree setup, or other workers' code/config outputs.

## Replacement Gate

Do not replace or delete the Tauri package until `app/mobile-rn` proves:

- Android development build installs and opens.
- iOS development build route is documented and at least locally validated where possible.
- `agenthub://auth/callback` opens the app and completes mocked or local TokenDance ID / Hub session exchange.
- Hub session persists in SecureStore and clears on logout on a real development build. Current slice only proves the SecureStore adapter contract with a fake module.
- REST health/list and typed event flow work against mock/local Hub. Current slice proves local HTTP snapshot/error contract, local mock Hub health/snapshot/thread/event-stream self-check, injectable event parsing tests, injectable AppState/event lifecycle tests, and event URL typing; live Hub runtime remains pending.
- Foreground/background lifecycle reconnects without stale approval state. Current slice proves the injectable AppState state machine; native RN AppState plus runtime WebSocket proof remains pending.
- Push or local notification can route to a thread/run on device. Current slice proves notification response parsing, native-response listener wiring, duplicate-response suppression, and typed navigation targets through an injectable bridge; actual device delivery remains pending.
- Main surfaces exist for the Desktop mobile IA: Chat, Thread detail, Tasks, Projects, Agent Profiles, More overflow, Settings, Account, plus folded Contacts and Docs entries.
- AgentHub Desktop/Web v4 design semantics are visible in RN: neutral glass surfaces, compact list rows, status pills, approval/diff/run cards, readable muted text, and restrained semantic accents.
- Feishu-style mobile interaction ergonomics are visible without replacing AgentHub vocabulary: bottom tabs, dense queue, search/new entry, unread/recovery states, sheets, and native-safe touch behavior.
- Phone `390x844` and tablet `768x1024` have no horizontal overflow and keep primary touch targets at least 44px.
- Light/dark states are covered for Chat, Thread detail, Tasks, and Account.
- No React DOM, CSS module, Tauri, or browser-only API enters the RN runtime path through `@agenthub/shared`.

## Legacy Cleanup Policy

Freeze now:

- `app/mobile/src-tauri/**`
- `app/mobile/src/native/**`
- Tauri-specific Android/emulator evidence
- old Vite visual QA as release evidence

Keep as reference until RN replacement:

- screen copy and information architecture from `src/views/**`
- queue/thread/run/account state definitions
- `docs/mobile-v4-plan.md`
- sanitized visual state list

Delay destructive deletion:

- `app/mobile/src-tauri/**`
- `app/mobile/src/**`
- `app/mobile/scripts/**`
- `app/mobile/vite.config.ts`
- old package lock entries
- old screenshots/evidence directories
- AGENTS boundary rewrite from Mobile=Tauri to Mobile=Expo/RN

Deletion requires a separate switch proposal after the replacement gate.

## Known Tauri Prototype Gaps

The current legacy app has these known mismatches and should not be treated as release-ready:

- Mobile planning says `5175`, but older Tauri config and QA text may still reference `5174`.
- Rust `hub_api.rs` defines `hub_request`, but the command is not registered in `lib.rs`.
- Tauri capabilities do not fully match the README-era notification claims.
- OIDC deep-link callback and token exchange are not complete.
- Secure storage is not implemented with Android Keystore / iOS Keychain.
- Hub production host/CSP/native bridge claims need fresh verification.

## Verification For This Planning Slice

```powershell
git diff --check -- app/mobile-rn/README.md app/mobile/docs/mobile-expo-rn-migration-plan.md app/mobile/docs/mobile-v4-plan.md
git status --short --branch
```

## Reference Links

- Expo SDK latest: https://docs.expo.dev/versions/latest/
- Expo development builds: https://docs.expo.dev/develop/development-builds/introduction/
- Expo SecureStore: https://docs.expo.dev/versions/latest/sdk/securestore/
- Expo AuthSession: https://docs.expo.dev/versions/latest/sdk/auth-session/
- Expo Linking: https://docs.expo.dev/linking/into-your-app/
- Expo Notifications: https://docs.expo.dev/versions/latest/sdk/notifications/
- EAS Build: https://docs.expo.dev/build/introduction/
- EAS Submit: https://docs.expo.dev/submit/introduction/
- EAS Update: https://docs.expo.dev/eas-update/introduction/
- React Native networking: https://reactnative.dev/docs/network
- React Native AppState: https://reactnative.dev/docs/appstate
