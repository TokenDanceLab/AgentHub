# AgentHub Mobile RN

Expo + React Native is the active Mobile implementation. Mobile is currently a boundary and QA framework lane, not an Android/iOS release candidate.

Historical longform notes are indexed in [docs/history.md](../../docs/history.md). Do not use archived handoff text as current branch, device, or release proof.

## Scope

- Keep Mobile aligned with Desktop/Web workbench terminology and Hub event contracts.
- Keep shared imports RN-safe; do not import shared Web/Desktop UI, CSS modules, Tauri APIs, browser storage, or raw runtime execution code.
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
| Static RN boundary | `corepack pnpm verify` | Typecheck, lint, brand assets, import boundaries, and unit tests pass for current source. | Native device behavior, live Hub, real login, push delivery, or packaged release. |
| Mock Hub contract | `corepack pnpm mock:hub:check` | Local simulator endpoints and typed update stream shape are coherent. | Real Hub availability or auth. |
| Expo Web visual QA | `corepack pnpm visual:qa` | 5177 browser preview layout, i18n, privacy text, and interaction geometry remain stable. | Native renderer, device APIs, or backend correctness. |
| Native readiness shape | `corepack pnpm native:check` | Expo config and development profiles are no-secret and structurally valid. | Install/open proof, SecureStore persistence, notifications, media picker behavior, or real OIDC. |
| Android packaging | `corepack pnpm android:package` | A local installable APK can be built when the Android toolchain is available. | Device proof unless the APK is installed/opened in the same task and evidence is recorded. |

All mock, fixture, readiness-only, and preview-only results must be recorded with `real_tested=false`. `approved-real` is an evidence mode label, not proof by itself.

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
