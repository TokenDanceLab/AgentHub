# AgentHub Mobile RN

Expo + React Native is the active Mobile implementation. Mobile is a boundary and QA validation target, not an Android/iOS release candidate.

## Scope

- Keep Mobile aligned with Desktop/Web workbench terminology and Hub event contracts.
- Keep shared imports RN-safe; do not import shared Web/Desktop UI, CSS modules, Tauri APIs, browser storage, or raw runtime execution code.
- **Hub-only data plane**: Mobile must not connect directly to Local Edge (`127.0.0.1:3210`), raw process/runtime APIs, or Desktop Tauri host commands. It talks to Hub (`/client/*`, `/web/*` via shared hubClient); local execution remains Desktop + Local Edge.
- Hub client SSOT is `@agenthub/shared/hub/hubClient`. `src/api/hubClient.ts` is a thin shell (async SecureStore token, fixture snapshot, WS helpers only). Do not add new REST methods on Mobile — add them to shared first.

## Commands

Run from `app/mobile-rn` unless a command uses `--filter`.

```bash
corepack pnpm install
corepack pnpm verify
corepack pnpm run doctor
corepack pnpm dev:web
```

Mock Hub and visual QA:

```bash
corepack pnpm mock:hub
corepack pnpm mock:hub:check
corepack pnpm visual:qa
corepack pnpm verify:qa
```

Native readiness and development builds:

```bash
corepack pnpm native:check
corepack pnpm android
corepack pnpm android:package
corepack pnpm ios
```

`dev:web` serves the Expo Web preview on `http://localhost:5177`. `mock:hub` serves a no-secret local simulator on `http://127.0.0.1:8088`.

## Evidence Boundaries

| Gate | Command | What it proves | What it does not prove |
|---|---|---|---|
| Static RN boundary | `corepack pnpm verify` | Typecheck, lint (import boundaries via `pnpm lint:boundaries`), brand/Metro config tests, and unit tests pass for current source (incl. shared auth-core session flows, deep-link/notification intent routing). | Native device behavior, live Hub, real login, push delivery, or packaged release. |
| Mock Hub contract | `corepack pnpm mock:hub:check` | Local simulator endpoints and typed update stream shape are coherent. | Real Hub availability or auth. |
| Expo Web visual QA | `corepack pnpm visual:qa` | 5177 browser preview layout, i18n, privacy text, and interaction geometry remain stable. | Native renderer, device APIs, or backend correctness. |
| Native readiness shape | `corepack pnpm native:check` | Expo config and development profiles are no-secret and structurally valid. | Install/open proof, SecureStore persistence, notifications, media picker behavior, or real OIDC. |
| Android packaging | `corepack pnpm android:package` | A local installable APK can be built on Windows (the script uses cmd.exe, mklink junctions, and gradlew.bat) when the Android toolchain is available. | Device proof unless the APK is installed/opened in the same task and evidence is recorded. |

All mock, fixture, readiness-only, and preview-only results must be recorded with `real_tested=false`. `approved-real` is an evidence mode label, not proof by itself.

## Push and notification capabilities

**Hub-server has no push delivery facility**: `registerDevice` (hub-server/internal/handler/device.go + shared `HubRegisterDeviceRequest`) carries no token field, so the Expo push token stays **local (on-device) only** and is never forwarded to the Hub. Notification click intents route in-app via `notificationBridge` + shared `notificationIntents`.

## Auth and deep-link boundaries

- Login runs the real TokenDance ID OIDC flow through the shared auth core (`@agenthub/shared/api/auth` createHubAuthCore): PKCE → Hub authorize → `expo-web-browser` → `agenthub://auth/callback` → code exchange → SecureStore-backed session with refresh fallback and signed-out cleanup on refresh failure.
- The OIDC pending state (PKCE verifier) is memory-only — parity with Desktop Tauri mode; if the OS kills the app mid-login the user restarts (no silent callback acceptance without the verifier).
- Deep links (`agenthub://`, app.config.ts) cover cold start (`getInitialURL`) and warm start (`url` listener); **if the app is not installed there is no handler and no web fallback** — no-op by design.
- Account `hubSync` status stays fixture/preview-backed until the mobile live data plane becomes the UI truth.

## Data Modes

| Mode | Meaning | Network boundary |
|---|---|---|
| `mock` | JS fixtures and local preview data. | No real Hub or Local Edge proof. |
| `observed` | Read-only Hub observation with a valid Hub token. | No mutations or task execution claims. |
| `approved-real` | Operator-approved real path for live Hub and execution behavior. | Requires explicit approval, current manifest/evidence, and no silent mock fallback claims. |
