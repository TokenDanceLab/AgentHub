# AgentHub Mobile RN

Expo + React Native is the AgentHub Mobile mainline. The old Tauri Mobile package has been removed from the active source tree; new Mobile work stays in this package.

Current branch handoff, ownership boundaries, and native release gates are tracked in [docs/handoff.md](docs/handoff.md).

## Design Boundary

Mobile inherits AgentHub Desktop/Web v4, the shared workbench semantics, and `agenthub-design/desktop` direction. AgentHub Desktop and the TokenDance/AgentHub design-system docs are authoritative for visual tokens, component semantics, status language, and execution vocabulary. Feishu/Lark mobile is only an IM interaction reference for information architecture and native interaction density: bottom tabs, queue scanning, badges, search/new entry placement, unread state, recovery, and sheets.

The RN app is light-first by default. Dark/OLED/system theme modes are kept ready, but new screenshots and user-visible polish start from the white/light experience. Locale should default to the device/system locale, with zh/en copy kept in the RN i18n layer and aligned to AgentHub terminology.

AgentHub Mobile app icons, splash art, favicon, and notification icon use the AgentHub product icon assets from the TokenDance workspace canonical logo source, `../logo/products/agenthub/`. Mobile must not use legacy TokenDance asset filenames or the TokenDance Org three-bar mark for AgentHub app identity. The checked-in app assets are:

- `assets/agenthub-icon.png`
- `assets/agenthub-adaptive-icon.png`
- `assets/agenthub-splash-icon.png`
- `assets/agenthub-favicon.png`
- `assets/agenthub-notification-icon.png`

The first slice intentionally creates a design foundation before feature depth:

- `src/theme/**`: AgentHub-aligned light/dark/OLED-ready tokens, motion, theme provider.
- `src/components/primitives/**`: RN controls with loading, disabled, pressed, error, and long-label behavior.
- `src/components/layout/**`: app shell, bottom tabs, headers, queue/thread/inspector structure.
- `src/screens/**`: stateful Threads, Chat, Tasks, Projects, Docs, More, Agent/Profile, Settings, and Account surfaces using local Hub preview data with safe fixture fallback.
- `src/api/**`, `src/session/**`, `src/integrations/**`, `scripts/mock-hub.mjs`: typed Hub/session/deep-link facades and a local mock Hub with snapshot plus typed update checks.

## Commands

```powershell
cd app\mobile-rn
corepack pnpm install
corepack pnpm verify
corepack pnpm run doctor
corepack pnpm start -- --clear
```

Dedicated browser preview:

```powershell
corepack pnpm dev:web
```

The Expo Web visual preview is fixed at `http://localhost:5177` for browser inspection. The default preview first reads the local mock Hub snapshot from port 8088 and refetches that snapshot when local update events arrive; if the mock Hub is not running, it falls back to safe fixture data. It is a design and layout preview only; native capabilities still require a development build.

Local mock Hub:

```powershell
corepack pnpm mock:hub
corepack pnpm mock:hub:check
```

`mock:hub` starts a no-secret local Hub simulator on `http://127.0.0.1:8088` by default. It serves `GET /health`, `GET /v1/mobile/snapshot`, `GET /v1/threads`, and a typed update stream at `GET /v1/events`. Android emulator builds can use `http://10.0.2.2:8088`; physical devices should use the host machine LAN URL. Override the port with `AGENTHUB_MOBILE_MOCK_HUB_PORT`.

Visual QA:

```powershell
corepack pnpm visual:qa
corepack pnpm verify:qa
```

`visual:qa` starts or reuses the 5177 preview, captures phone and tablet screenshots under `app/mobile-rn/screenshots/visual-qa/`, and checks zh/en locale, horizontal overflow, light-surface brightness, five AgentHub workbench primary bottom tabs, tablet split-pane tabs scoped to the left list pane, thread/account tab hiding, forbidden private text in visible and accessibility text, readable font size, and no visible tab touch target below 44px. It covers default chat queue/chat/tasks/account, evidence inspector sheet, More overflow, Settings, Agent Profiles, Projects, Docs, OLED account, tablet tasks, tablet Chat two-column split-pane, `>=1024px` tablet Chat three-column inspector, inspector Overview/Files/Browser tabs, reduced-motion composer interactions on phone and tablet split-pane, and scenario previews for empty queue, offline chat, notification intent, deep link, send-error retry, send pending, compact keyboard send pending/error, approval confirmation/error/resolved, dense diff preview, many-file/empty file preview, and browser preview loading/ready/error/empty states. `verify:qa` runs `typecheck`, `lint`, boundary checks, tests, Expo doctor, the mock Hub self-check, native readiness config check, and visual QA together. Screenshots are local artifacts and are ignored by Git.

The visual harness also runs a source hygiene pass over RN primitives, layout, and screens before opening the browser. It rejects component-level raw hex/rgb palettes, raw shadow style fields, negative letter spacing, decorative gradients, viewport-scaled type, and visible/accessibility privacy or transport/debug strings. Add new colors, shadows, type, or status language through `src/theme/**` and i18n strings first.

For concurrent Mobile workers, keep code, config, docs, tests, and screenshots in assigned `app/mobile-rn/**` slices unless a root-level Mobile governance file explicitly needs to change. Do not weaken the 5177 visual QA gate to pass.

Release gates covered by local commands:

| Gate | Command | Pass condition |
|---|---|---|
| Light default visual surface | `corepack pnpm visual:qa` | Light scenes meet luminance threshold and do not rely on OLED/dark mode. |
| zh/en and i18n structure | `corepack pnpm verify` | i18n tests keep zh/en dictionaries aligned and locale fallback covered. |
| Reduced motion interactions | `corepack pnpm visual:qa` | Reduced-motion scenes report `prefers-reduced-motion: reduce` and no active CSS transition/animation samples. |
| Privacy scan | `corepack pnpm verify` and `corepack pnpm visual:qa` | Source/docs/config/script tests plus rendered text checks reject private names, secret patterns, localhost/debug transport strings, and raw API paths. |
| Native readiness shape | `corepack pnpm native:check` | Expo config and EAS development profiles are no-secret, include identity/session/notification/media/storage plugins, and target the expected mock Hub URLs. |

Native development builds:

```powershell
corepack pnpm native:check
corepack pnpm android
corepack pnpm android:package
corepack pnpm ios
npx eas-cli@20.1.0 build --profile development --platform android
npx eas-cli@20.1.0 build --profile development --platform ios
```

`native:check` verifies the no-secret development-build shape before any device install: Expo scheme, bundle IDs, localization, notification, SecureStore, image picker, document picker, file-system dependencies, EAS development profiles, and target-specific mock Hub base URLs. By default it checks Android emulator and iOS simulator defaults. For a physical device, run it with a LAN Hub URL:

```powershell
$env:AGENTHUB_MOBILE_NATIVE_TARGET = "physical"
$env:EXPO_PUBLIC_AGENTHUB_HUB_URL = "http://<host-lan-ip>:8088"
corepack pnpm native:check
```

iOS requires macOS/Xcode or EAS Build. Android requires Android Studio/SDK and a device or emulator. `eas.json` defines development, preview, and production profiles but intentionally does not include account-specific project IDs, credentials, or secrets. Do not use Expo Go for capability validation because OIDC deep links, SecureStore, notifications, camera/photo/file access, storage cleanup, and native config must be validated in a development build.

Android development-build proof is separate from the 5177 web preview. Before claiming Android proof, run `corepack pnpm android` against an emulator/device, `npx eas-cli@20.1.0 build --profile development --platform android`, or the local release APK packager below, install the generated build, open it, and verify the expected Hub snapshot/deep-link/session behavior on device. `native:check` is config readiness only.

Local Android APK packaging on Windows:

```powershell
corepack pnpm android:package

# Build, install, and launch on a Wi-Fi ADB device:
corepack pnpm android:package -- -Version 0.3.0-rc.7 -InstallSerial 192.168.1.105:5555 -Launch
```

`android:package` runs `scripts/package-android.ps1`. On Windows it creates or reuses a short real-path junction at `D:\ah\agenthub-mobile`, installs dependencies with a short pnpm virtual store at `D:\p\agenthub-mobile`, regenerates the ignored native Android project from Expo config, builds `assembleRelease` by default so the JS bundle is embedded, and writes the APK plus `android-package-manifest.json` under `.tmp/android-package/`. Use `-Version` when producing a release-candidate artifact; otherwise the artifact name follows `app/mobile-rn/package.json`. Use this for local installable APK proof; `assembleDebug` is a Metro/dev-server build and is not valid offline install proof. The `v0.3.0-rc.7` local device proof used the explicit short paths `D:\ah\a` and `D:\p\a`.

The Android launcher label is intentionally `AgentHub` so phone launchers do not truncate the name. The product lane remains AgentHub Mobile in repo docs and package naming. `assets/agenthub-adaptive-icon.png` is an Android adaptive-icon foreground with transparent padding; do not replace it with the full rounded app icon, or Android launchers can crop the mark.

Native proof status:

| Capability | Current evidence | Remaining gate |
|---|---|---|
| Expo config | `expo-doctor`, `native:check`, `app.config.ts`, `eas.json`, and the local `android:package` release APK prove the no-secret native shape, AgentHub product icon assets, localization, notifications, SecureStore, `agenthub` scheme, Android package, iOS bundle ID, and default mock Hub URLs. | iOS simulator or EAS development build route remains unverified. |
| TokenDance ID OIDC | AuthSession helpers, default `expo-auth-session` redirect URI bridge, default `expo-web-browser` auth-session launcher, and `agenthub://auth/callback` parsing are covered by pure tests. | Complete mocked or local TokenDance ID + Hub session exchange in a development build. |
| SecureStore | SecureStore adapter, default `expo-secure-store` adapter loader, and Hub session storage contracts are covered by tests/typecheck. | Prove persistence and logout clearing on device. |
| Notifications | Notification intent parsing, response routing, default `expo-notifications` response bridge, and Android review channel configuration are covered by tests/typecheck and preview fixtures. | Prove native delivery/response opens the target thread or run on device. |
| Media/files/storage | `expo-image-picker`, `expo-document-picker`, and `expo-file-system` are declared in config/dependencies; typed adapters cover camera/photo permission normalization, evidence media/document mapping, storage budget, and evidence cache cleanup. Settings and Account expose device capability rows. | Prove camera capture, photo/video picker, document picker, and evidence cache cleanup in a development build. |
| Hub REST/WS | Typed client, event stream, lifecycle bridge, mock Hub, local HTTP contract, and Android release APK launch are covered by tests, `mock:hub:check`, and Wi-Fi ADB install/open proof. | Prove against a live or local deployed Hub from a development build. |

## Current Slice Status

This package is the active Mobile implementation, but it is not yet an Android/iOS release candidate. Current code proves the RN runtime shape, design token contract, stateful workflow surfaces, pure tests, local Hub contract path, native config parsing, Expo Web visual preview path, and typed native media/storage capability boundaries. It does not yet prove real TokenDance ID OIDC exchange, SecureStore persistence on device, Hub REST/WS against a live deployed Hub, camera/photo/document picker behavior on device, evidence cache cleanup on device, push notification delivery, or Android/iOS development build installation.

Current verified slice:

- Expo SDK 56 / React Native 0.85.3 / React 19.2.3 package scaffold.
- AgentHub Desktop-aligned light/dark/OLED-ready tokens and theme provider.
- RN primitives and layout shell: Button, IconButton, Surface, Badge, StatusPill, ListRow, SearchField, SegmentedControl, BottomSheet, EmptyState, ErrorNotice, AppShell, BottomTabs, ScreenHeader, InspectorSheet.
- Stateful Chat, Thread detail, Tasks, Projects, Agent Profiles, More overflow, Settings, and Account surfaces with local mock Hub preview data and realistic AgentHub fixture fallback.
- Chat now keeps the first-screen composer to AgentHub shared-workbench essentials: text input, send, delivery recovery, and review-context chips. Approval, diff, run-session, and tool-call transcript blocks render as structured evidence cards instead of generic chat bubbles.
- Typed mock/REST Hub facade with API error redaction, local HTTP Hub contract test, local mock Hub snapshot/update script, injectable Hub update stream, event URL mapping, AppState-driven Hub lifecycle bridge, Hub session reducer/storage abstraction, SecureStore adapter plus default Expo SecureStore loader, TokenDance ID AuthSession helpers plus default Expo AuthSession/WebBrowser bridge, `agenthub://auth/callback` parser plus default Expo Linking bridge, AgentHub thread/run/approval deep-link bridge, notification response bridge plus default Expo Notifications bridge, and native camera/photo/document/storage capability adapters.
- Expo Web preview on fixed port 5177 plus screenshot-based visual QA for `390x844` phone, compact `390x560` phone, `768x1024` tablet, and `1024x768` tablet budgets, including zh/en light scenes, More/Settings/Agent/Profile/Projects semantics, an OLED account scene, reduced-motion composer interactions, tablet Chat two-column split-pane, `>=1024px` three-column inspector pane with Overview/Files/Browser tabs, and empty/offline/notification/deep-link/send-error/send-pending/approval-confirmation/approval-error/resolved-approval/diff-preview/file-preview/browser-preview states.
- Five primary mobile tabs mirror AgentHub workbench semantics on phone: Chat, Docs, Tasks, Projects, More. Tasks keeps review pressure visible without turning Chat into a run dashboard. Contacts, Agent/Profile, Settings, and Account are folded into More or the avatar entry; Thread detail and Account hide global tabs. On tablet split views, the same tabs stay inside the left list pane so transcript and inspector panes remain full-height details. Chat shows task pressure as a compact digest instead of mixing task rows into the conversation list. More is phone overflow, not a second navigation model.
- The 5177 preview now treats Feishu/Lark screenshots as density and interaction references only: continuous IM rows, lightweight badges, avatar/status semantics, a compact composer, and an account rail are implemented with AgentHub/TokenDance mock data and Desktop-aligned vocabulary. The mock Hub and fallback fixtures intentionally avoid private identity placeholders and generic social-account entries such as wallet/favorites.
- Privacy, boundary, and i18n gates: source/docs/config/script tests reject private identity placeholders and inline secret patterns, boundary tests prove forbidden shared/runtime imports fail, zh/en keys stay aligned, and zh system locale fallback is covered.
- Native build config: Expo config parses with AgentHub product icon/splash/favicon/notification assets, localization, notifications, secure-store, image-picker, document-picker, and file-system dependencies; `eas.json` provides no-secret development build profiles; `verify:brand` guards AgentHub product asset naming; `native:check` validates emulator/simulator defaults and physical-device LAN URL requirements without claiming device proof.

Verification evidence from this slice:

```powershell
corepack pnpm --filter agenthub-mobile-rn typecheck
corepack pnpm --filter agenthub-mobile-rn test
corepack pnpm --filter agenthub-mobile-rn run doctor
corepack pnpm --filter agenthub-mobile-rn lint
corepack pnpm --filter agenthub-mobile-rn run verify:brand
corepack pnpm --filter agenthub-mobile-rn run verify:boundaries
corepack pnpm --filter agenthub-mobile-rn run mock:hub:check
corepack pnpm --filter agenthub-mobile-rn visual:qa
corepack pnpm --filter agenthub-mobile-rn verify
corepack pnpm --filter agenthub-mobile-rn verify:qa
```

Validated results:

- TypeScript passed.
- Vitest passed: 15 files, 72 tests.
- Expo doctor passed: 21/21 checks.
- Expo config parsed with native plugins.
- Local mock Hub check passed for health, mobile snapshot, and typed event-stream upgrade.
- ESLint passed for `src`.
- Visual QA should pass on 5177 for all configured scenes, including phone zh/en chat queue, thread, evidence inspector sheet, tasks, account, More, Settings, Agent Profiles, Projects, OLED account, reduced-motion composer actions, tablet tasks, tablet Chat split-pane in zh/en, tablet three-column inspector Overview/Files/Browser tabs, empty queue, offline chat, notification intent, deep-link thread, send-error retry, send pending, compact keyboard send pending/error, approval approve/reject confirmation, approval submit error, resolved approval, phone/tablet diff preview, many-file/empty file preview, and browser preview loading/ready/error/empty states.
