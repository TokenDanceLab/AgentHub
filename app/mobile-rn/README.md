# AgentHub Mobile RN

Expo + React Native is the active Mobile implementation. Mobile is currently a boundary and QA framework lane, not an Android/iOS release candidate.

Historical longform notes are indexed in [docs/history.md](../../docs/history.md). Do not use archived handoff text as current branch, device, or release proof.

## Scope

- Keep Mobile aligned with Desktop/Web workbench terminology and Hub event contracts.
- Keep shared imports RN-safe; do not import shared Web/Desktop UI, CSS modules, Tauri APIs, browser storage, or raw runtime execution code.
- **Hub-only data plane**: Mobile talks to Hub (`/client/*`, `/web/*` via shared hubClient). It must **not** open Local Edge (`127.0.0.1:3210`), raw process/runtime APIs, or Desktop Tauri host commands. Local execution remains Desktop + Local Edge.
- Hub client SSOT is `@agenthub/shared/hub/hubClient`. `src/api/hubClient.ts` is a thin shell (async SecureStore token, fixture snapshot, WS helpers only). Do not add new REST methods on Mobile — add them to shared first.
- Treat Feishu/Lark mobile screenshots as density and interaction references only.
- Do not claim native/device/live-Hub/TokenDance-ID proof unless the relevant approved-real or development-build gate was run in the current task and evidence was recorded.

## Commands

Run from `app/mobile-rn` unless a command uses `--filter`.

```powershell
corepack pnpm install
corepack pnpm verify
corepack pnpm run doctor
corepack pnpm dev:web
```

Mock Hub and visual QA:

```powershell
corepack pnpm mock:hub
corepack pnpm mock:hub:check
corepack pnpm visual:qa
corepack pnpm verify:qa
```

Native readiness and development builds:

```powershell
corepack pnpm native:check
corepack pnpm android
corepack pnpm android:package
corepack pnpm ios
```

`dev:web` serves the Expo Web preview on `http://localhost:5177`. `mock:hub` serves a no-secret local simulator on `http://127.0.0.1:8088`.

## Evidence Boundaries

| Gate | Command | What it proves | What it does not prove |
|---|---|---|---|
| Static RN boundary | `corepack pnpm verify` | Typecheck, lint, brand assets, import boundaries, and unit tests pass for current source (incl. shared auth-core session flows, deep-link/notification intent routing, lifecycle bridge behavior). | Native device behavior, live Hub, real login, push delivery, or packaged release. |
| Mock Hub contract | `corepack pnpm mock:hub:check` | Local simulator endpoints and typed update stream shape are coherent. | Real Hub availability or auth. |
| Expo Web visual QA | `corepack pnpm visual:qa` | 5177 browser preview layout, i18n, privacy text, and interaction geometry remain stable. | Native renderer, device APIs, or backend correctness. |
| Native readiness shape | `corepack pnpm native:check` | Expo config and development profiles are no-secret and structurally valid. | Install/open proof, SecureStore persistence, notifications, media picker behavior, or real OIDC. |
| Android packaging | `corepack pnpm android:package` | A local installable APK can be built when the Android toolchain is available. | Device proof unless the APK is installed/opened in the same task and evidence is recorded. |

All mock, fixture, readiness-only, and preview-only results must be recorded with `real_tested=false`. `approved-real` is an evidence mode label, not proof by itself.

## Push and notification capabilities

Verified boundary (lane C-1824, 2026-08-23): **hub-server has no push delivery facility.** Evidence: zero hits across hub-server Go sources for FCM/APNs/Expo-push/`push_token`/ntfy/pushover; `go.mod` carries no push/notification dependency; `registerDevice` (hub-server/internal/handler/device.go + shared `HubRegisterDeviceRequest`) has no token field — there is no device-token store and no sender/queue consuming one.

Current Mobile behavior:

- Notification **permission** and the Expo push token are collected for **local (on-device) notification handling only**. The token is deliberately never forwarded to the Hub (forwarding without a delivery path would be a half-wired claim).
- Notification **click intents** resolve through `notificationBridge` + shared `notificationIntents` into in-app routing (thread / run / approval / activity) — this routing IS wired and unit-tested.
- Until the Hub side ships a delivery path (device token storage + sender), Mobile does not claim server-side push. Do not add `push_token` to `registerDevice` before a consumer exists.

## Auth and deep-link boundaries

- Mobile login runs the **real TokenDance ID OIDC flow** against the Hub OIDC endpoints through the shared auth state machine (`@agenthub/shared/api/auth` createHubAuthCore, issue #1537): PKCE -> Hub authorize -> `expo-web-browser` -> `agenthub://auth/callback` deep link -> code exchange -> SecureStore-backed session (tokens) with refresh fallback and signed-out cleanup on refresh failure.
- OIDC callback **pending state (PKCE verifier) is memory-only** — parity with the Desktop Tauri local-callback-server mode. The callback returns to the same process; if the OS kills the app mid-login, the user restarts login (no silent callback acceptance without the verifier).
- Deep links use the `agenthub://` scheme (app.config.ts). Cold start (`getInitialURL`) and warm start (`url` listener) are wired to in-app routing. **If AgentHub is not installed there is no handler and no web fallback** — an uninstalled deep link is a no-op by design.
- `hubSync` status on the account surface remains fixture/preview-backed: the mobile live data plane (Hub event stream over the lifecycle bridge) is not yet the UI source of truth. The lifecycle bridge itself (suspend/foreground-resume/resync-cursor behavior) is unit-tested (#1824).


## Data Modes

| Mode | Meaning | Network boundary |
|---|---|---|
| `mock` | JS fixtures and local preview data. | No real Hub or Local Edge proof. |
| `observed` | Read-only Hub observation with a valid Hub token. | No mutations or task execution claims. |
| `approved-real` | Operator-approved real path for live Hub and execution behavior. | Requires explicit approval, current manifest/evidence, and no silent mock fallback claims. |

Mobile must not connect directly to Local Edge. Web and Mobile client work should use Hub-facing contracts; Desktop/Edge owns local execution.

## Current Required Gates

Use the smallest relevant gate for the changed surface:

| Change | Minimum gate |
|---|---|
| TypeScript, API, session, i18n, theme, import boundaries | `corepack pnpm verify` |
| Visual/layout/privacy text | `corepack pnpm visual:qa` |
| Mock Hub or event stream shape | `corepack pnpm mock:hub:check` |
| Expo config, native plugin list, bundle IDs, app assets | `corepack pnpm native:check` |
| Android installable artifact claim | `corepack pnpm android:package` plus current install/open evidence |

Before broad Mobile UI/native work, create a dedicated task. Current repo-governance SPEC keeps Mobile work to framework and boundary clarity.
