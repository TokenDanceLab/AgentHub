# AgentHub Mobile Expo / React Native Migration Plan

> Status: planning and migration-control source. This document does not create the Expo app, delete Tauri code, change Hub contracts, or define a release gate.

## Decision

AgentHub Mobile should move toward **Expo + React Native** for the long-term mobile mainline. The current `app/mobile` Tauri implementation is frozen as a legacy prototype and product-reference surface. New platform work should happen in a separate `app/mobile-rn` package until it reaches the replacement gate.

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
- Feishu/Lark mobile IM is the primary interaction reference; Codex mobile chat is the secondary thread/composer reference.

## Design System Boundary

Mobile is an AgentHub v4 surface first and a Feishu-style mobile interaction surface second. The design direction is:

1. **Visual source of truth**: inherit AgentHub Desktop/Web v4 and `agenthub-design/desktop` through the current shared workbench, Desktop theme tokens, and `app/shared/src/designTokens.ts`.
2. **Interaction reference**: use Feishu/Lark mobile IM for queue density, identity badges, bottom navigation, search/new entry placement, unread handling, recovery, and native phone ergonomics.
3. **Native adaptation**: implement RN primitives that preserve the AgentHub v4 material, density, status semantics, and typography while adapting safe areas, touch targets, sheets, gestures, keyboard avoidance, and tablet split panes.

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

Current status: slice 1 scaffold has started in `app/mobile-rn`. It includes Expo/RN package wiring, AgentHub Desktop-aligned RN tokens, theme provider, primitives, layout shell, stateful Threads/Chat/Runs/Account surfaces, mock Hub/session/deep-link facades, and focused tests. This is not the replacement gate.

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

- [ ] Scaffold `app/mobile-rn` with Expo development-build assumptions and pnpm workspace wiring.
- [ ] Add `app.config.ts` with `agenthub` scheme, Android/iOS bundle identifiers, notification placeholders, and no production secrets.
- [ ] Add `src/theme/tokens.ts` with AgentHub Desktop-aligned light/dark/OLED-ready token objects.
- [ ] Add `src/theme/AgentHubThemeProvider.tsx`, navigation theme mapping, and a reduced-motion flag.
- [ ] Add RN primitives: `Button`, `IconButton`, `Surface`, `Badge`, `StatusPill`, `ListRow`, `SearchField`, `SegmentedControl`, `BottomSheet`, `EmptyState`, `ErrorNotice`.
- [ ] Add layout primitives: `AppShell`, `BottomTabs`, `ScreenHeader`, `QueueList`, `ThreadPane`, `InspectorSheet`.
- [ ] Add four placeholder-but-stateful surfaces: Threads, Chat, Runs, Account. Each must use realistic seeded AgentHub workflow data, not blank cards.
- [ ] Add OIDC/session/API/WS interfaces as typed facades with mock/local adapters; do not wire production hosts.
- [ ] Add design snapshot fixtures for `390x844` phone and `768x1024` tablet budgets.
- [ ] Add README verification commands and clearly label unsupported native build steps if local EAS/device setup is missing.

### Slice 1 Verification Commands

Use the final command names from the scaffold, but the first slice should provide equivalents for:

```powershell
cd app\mobile-rn
corepack pnpm install
corepack pnpm typecheck
corepack pnpm test
corepack pnpm expo-doctor
corepack pnpm start -- --clear
```

When visual automation is available, add a focused RN screenshot or story harness that checks:

- `390x844` Threads full queue, Chat long thread/composer, Runs pending approval, Account session/error.
- `768x1024` queue + thread split and inspector sheet/pane behavior.
- light and dark token rendering.
- no horizontal overflow and no touch target below 44px.

Current verified commands:

```powershell
cd app
corepack pnpm --filter agenthub-mobile-rn typecheck
corepack pnpm --filter agenthub-mobile-rn test
corepack pnpm --filter agenthub-mobile-rn run doctor
corepack pnpm --filter agenthub-mobile-rn lint
```

Current verified results:

- TypeScript passed.
- Vitest passed: 5 files, 12 tests.
- Expo doctor passed: 21/21 checks.
- ESLint passed for `app/mobile-rn/src`.

## Parallel Worker Plan

The work can be parallelized once the `app/mobile-rn` package scaffold exists.

| Worker | Ownership | Output |
|---|---|---|
| A. Expo infrastructure | `app/mobile-rn/package.json`, config files, Metro/pnpm setup | Expo app starts; typecheck/test scripts exist |
| B. Design foundation | `src/theme/**`, `src/components/primitives/**`, `src/components/icons/**` | Desktop-aligned tokens, RN primitives, icon semantics, long-label/error/loading states |
| C. RN shell/navigation | `app/mobile-rn/src/App.tsx`, `src/navigation/**`, `src/components/layout/**` | Feishu-style bottom tabs, queue/thread push flow, tablet split shell using AgentHub v4 surfaces |
| D. API/session | `src/api/**`, `src/session/**`, `src/config/**` | Hub REST/WS facade, SecureStore session, AuthSession/Linking boundary |
| H. Theme/i18n governance | `src/i18n/**`, README design section | zh/en critical copy, identity/API-key wording, design-source notes |
| E. Threads/Runs read-only | `src/screens/ThreadsScreen.tsx`, `RunsScreen.tsx`, `src/components/queue/**` | list/empty/error/refresh/pending-review states |
| F. Chat/review | `src/screens/ChatScreen.tsx`, `src/components/chat/**`, `src/components/review/**` | messages, composer, approval sheet, send pending/error/retry |
| G. QA harness | `scripts/**`, `e2e/**`, README verification section | typecheck/test/start/emulator screenshot gates |

The integration owner alone should edit workspace-level files such as `app/pnpm-workspace.yaml`, `app/package.json`, lockfiles, and roadmap status.

Worker conflict rules:

- Worker B owns primitives and token files; screen workers consume them and must not add local palettes or one-off button styles.
- Worker C owns navigation/layout containers; screen workers provide content slots and do not rewrite app-level routing.
- Worker D owns API/session facades; UI workers call typed interfaces and do not fetch directly from screens.
- Worker E and F may run in parallel only after primitives and layout names are stable.
- Worker G can add harness files but must not change screen behavior to satisfy screenshots.

## Replacement Gate

Do not replace or delete the Tauri package until `app/mobile-rn` proves:

- Android development build installs and opens.
- iOS development build route is documented and at least locally validated where possible.
- `agenthub://auth/callback` opens the app and completes mocked or local TokenDance ID / Hub session exchange.
- Hub session persists in SecureStore and clears on logout.
- REST health/list and WebSocket typed event flow work against mock/local Hub.
- Foreground/background lifecycle reconnects without stale approval state.
- Push or local notification can route to a thread/run.
- Four main surfaces exist: Threads, Chat, Runs, Account.
- AgentHub Desktop/Web v4 design semantics are visible in RN: neutral glass surfaces, compact list rows, status pills, approval/diff/run cards, readable muted text, and restrained semantic accents.
- Feishu-style mobile interaction ergonomics are visible without replacing AgentHub vocabulary: bottom tabs, dense queue, search/new entry, unread/recovery states, sheets, and native-safe touch behavior.
- Phone `390x844` and tablet `768x1024` have no horizontal overflow and keep primary touch targets at least 44px.
- Light/dark states are covered for Threads, Chat, Runs, and Account.
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
git diff --check -- app/mobile/README.md app/mobile/docs/mobile-v4-plan.md app/mobile/docs/mobile-expo-rn-migration-plan.md
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
