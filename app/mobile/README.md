# AgentHub Mobile

AgentHub Mobile is the secondary client surface for AgentHub. Desktop and Web remain the primary v4 workbench tracks; Mobile focuses on phone and tablet remote review, approvals, run monitoring, and Hub-mediated control.

## Current Decision

The old `app/mobile` implementation is a **legacy Tauri Mobile prototype**, not the long-term Mobile mainline. It remains useful as a product and interaction reference, but new Mobile platform work should target **Expo + React Native** in a separate `app/mobile-rn` package until the replacement reaches the documented gates.

Planning sources:

- [Mobile v4 product plan](docs/mobile-v4-plan.md)
- [Expo React Native migration plan](docs/mobile-expo-rn-migration-plan.md)

## Legacy Tauri Prototype

The existing code in this package is still kept for reference:

- Tauri project: `src-tauri/`
- React/Vite UI: `src/`
- Visual and emulator QA scripts: `scripts/`
- Intended Mobile dev/QA boundary: `5175`
- Runtime model: Mobile talks to Hub only; it must not start Local Edge, own Desktop runtime orchestration, or expose local filesystem capability.

Known prototype gaps:

- `src-tauri/tauri.conf.json` still points at an older dev URL.
- `hub_request` exists in Rust and the frontend bridge, but the Tauri command is not registered in `lib.rs`.
- OIDC currently opens the browser only; deep-link callback and token exchange are not complete.
- Secure token storage is not Android Keystore / iOS Keychain backed.
- Notification capability and README-era Android evidence need revalidation before any Tauri claim is treated as current.

Do not expand the Tauri implementation unless a short-lived compatibility fix is explicitly approved. Prefer moving new work into `app/mobile-rn`.

## Expo / React Native Direction

The recommended Mobile mainline is Expo + React Native:

- React Native UI for phone/tablet interaction quality.
- AgentHub Desktop/Web v4 and `agenthub-design/desktop` define the Mobile visual system and component semantics; Feishu/Lark mobile IM is an interaction reference for queue density, bottom navigation, badges, search/new entry, unread, recovery, and native ergonomics.
- Expo SecureStore for Hub session persistence.
- Expo AuthSession/Linking for TokenDance ID OIDC + PKCE deep links.
- Expo Notifications for approval/run notifications.
- EAS Build/Submit/Update for Android and iOS packaging.
- `@agenthub/shared` reuse limited to RN-safe TypeScript contracts, normalizers, labels, fixtures, and pure helpers.

The first milestone is an `app/mobile-rn` spike with four surfaces: Threads, Chat, Runs, Account. It should prove session storage, deep linking, REST/WS, notifications, and Android/iOS development builds before replacing this package.

Current Expo/RN candidate status:

- `app/mobile-rn` now exists as the side-by-side Expo/RN package.
- The first slice has AgentHub-aligned RN tokens, theme provider, primitives, layout shell, and stateful Threads/Chat/Runs/Account surfaces.
- Verified so far: `typecheck`, unit tests, `expo-doctor`, and package-local lint.
- Not yet replacement-ready: real TokenDance ID exchange, SecureStore device persistence, live Hub REST/WS, notifications, screenshot automation, and Android/iOS dev build installation.

## Boundaries

- Mobile is Hub-only. It does not connect to Local Edge directly.
- Web/desktop React DOM components and CSS modules are not RN-compatible; reuse semantics, not DOM UI.
- Destructive cleanup of `src-tauri/`, Vite config, old QA scripts, and old screenshots is delayed until `app/mobile-rn` satisfies the replacement gate.
- The old Tauri README evidence has been intentionally collapsed; stale screenshots and emulator notes are not current release evidence.

## Verification For Planning Changes

```powershell
git diff --check -- app/mobile/README.md app/mobile/docs/mobile-v4-plan.md app/mobile/docs/mobile-expo-rn-migration-plan.md
git status --short --branch
```
