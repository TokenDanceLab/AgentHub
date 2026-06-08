# AgentHub Mobile RN

Expo + React Native is the new AgentHub Mobile mainline candidate. The legacy Tauri prototype remains in `app/mobile` until the replacement gate is met.

## Design Boundary

Mobile inherits AgentHub Desktop/Web v4, the shared workbench semantics, and `agenthub-design/desktop` direction. Feishu/Lark mobile is used only for information architecture and native interaction density: bottom tabs, queue scanning, badges, search/new entry placement, unread state, recovery, and sheets.

The first slice intentionally creates a design foundation before feature depth:

- `src/theme/**`: AgentHub-aligned light/dark/OLED-ready tokens, motion, theme provider.
- `src/components/primitives/**`: RN controls with loading, disabled, pressed, error, and long-label behavior.
- `src/components/layout/**`: app shell, bottom tabs, headers, queue/thread/inspector structure.
- `src/screens/**`: stateful Threads, Chat, Runs, and Account surfaces using realistic workflow fixtures.
- `src/api/**`, `src/session/**`, `src/integrations/**`: typed Hub/session/deep-link facades with mock/local-safe defaults.

## Commands

```powershell
cd app\mobile-rn
corepack pnpm install
corepack pnpm typecheck
corepack pnpm test
corepack pnpm run doctor
corepack pnpm start -- --clear
```

Native development builds:

```powershell
corepack pnpm android
corepack pnpm ios
```

iOS requires macOS/Xcode or EAS Build. Android requires Android Studio/SDK and a device or emulator. Do not use Expo Go for capability validation because OIDC deep links, SecureStore, notifications, and native config must be validated in a development build.

## Current Slice Status

This package is a scaffold plus design foundation, not the replacement gate. Current code proves the RN runtime shape, design token contract, stateful workflow surfaces, and pure tests. It does not yet prove real TokenDance ID OIDC exchange, SecureStore persistence on device, Hub REST/WS against a live Hub, push notification delivery, screenshot automation, or Android/iOS development build installation.

Current verified slice:

- Expo SDK 56 / React Native 0.85.3 / React 19.2.3 package scaffold.
- AgentHub Desktop-aligned light/dark/OLED-ready tokens and theme provider.
- RN primitives and layout shell: Button, IconButton, Surface, Badge, StatusPill, ListRow, SearchField, SegmentedControl, BottomSheet, EmptyState, ErrorNotice, AppShell, BottomTabs, ScreenHeader, InspectorSheet.
- Stateful Threads, Chat, Runs, Account surfaces with realistic workflow fixture data.
- Typed mock Hub facade, WebSocket URL mapping, Hub session reducer, and `agenthub://auth/callback` deep-link helpers.

Verification evidence from this slice:

```powershell
corepack pnpm --filter agenthub-mobile-rn typecheck
corepack pnpm --filter agenthub-mobile-rn test
corepack pnpm --filter agenthub-mobile-rn run doctor
corepack pnpm --filter agenthub-mobile-rn lint
```

Validated results:

- TypeScript passed.
- Vitest passed: 5 files, 12 tests.
- Expo doctor passed: 21/21 checks.
- ESLint passed for `src`.
