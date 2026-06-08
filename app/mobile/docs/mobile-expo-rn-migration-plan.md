# AgentHub Mobile Expo / React Native Migration Plan

> Status: planning and migration-control source. This document does not create the Expo app, delete Tauri code, change Hub contracts, or define a release gate.

## Decision

AgentHub Mobile should move toward **Expo + React Native** for the long-term mobile mainline. The current `app/mobile` Tauri implementation is frozen as a legacy prototype and product-reference surface. New platform work should happen in a separate `app/mobile-rn` package until it reaches the replacement gate.

Default spike target:

| Area | Choice |
|---|---|
| Framework | Expo + React Native |
| Preferred SDK | Expo SDK 56 / React Native 0.85 / React 19.2.x |
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

Goal: create a minimal Expo/RN package that proves the stack without replacing the legacy app.

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

## Parallel Worker Plan

The work can be parallelized once the `app/mobile-rn` package scaffold exists.

| Worker | Ownership | Output |
|---|---|---|
| A. Expo infrastructure | `app/mobile-rn/package.json`, config files, Metro/pnpm setup | Expo app starts; typecheck/test scripts exist |
| B. RN shell/navigation | `app/mobile-rn/src/App.tsx`, `src/navigation/**`, tab shell | Threads/Chat/Runs/Account routes and phone push flow |
| C. API/session | `src/api/**`, `src/session/**`, `src/config/**` | Hub REST/WS facade, SecureStore session, AuthSession/Linking boundary |
| D. Theme/i18n | `src/theme/**`, `src/i18n/**`, RN primitive components | TokenDance theme object and zh/en critical copy |
| E. Threads/Runs read-only | `src/screens/ThreadsScreen.tsx`, `RunsScreen.tsx`, `src/components/queue/**` | list/empty/error/refresh/pending-review states |
| F. Chat/review | `src/screens/ChatScreen.tsx`, `src/components/chat/**`, `src/components/review/**` | messages, composer, approval sheet, send pending/error/retry |
| G. QA harness | `scripts/**`, `e2e/**`, README verification section | typecheck/test/start/emulator screenshot gates |

The integration owner alone should edit workspace-level files such as `app/pnpm-workspace.yaml`, `app/package.json`, lockfiles, and roadmap status.

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
