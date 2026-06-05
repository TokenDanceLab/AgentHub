# AgentHub Mobile

AgentHub Mobile is the secondary client surface for the AgentHub product line. Desktop remains the primary implementation track; Mobile follows Desktop concepts and adapts them for a phone-first Tauri 2 shell.

## Current Scope

- Tauri project: `app/mobile/src-tauri/`
- Vite dev port: `5174`
- Android package: `com.agenthub.mobile`
- Frontend stack: React 19, TypeScript, TanStack Query, `@agenthub/shared`
- Runtime model: Mobile talks to Hub APIs. It does not start Local Edge or own Desktop runtime orchestration.
- Hub API host: `https://hub.vectorcontrol.tech` for REST and `wss://hub.vectorcontrol.tech/ws` for WebSocket. The shared client appends `/v1`; `visual:qa` mocks both the current host and the older `api.hub.vectorcontrol.tech` host to keep local browser QA off production CORS.

## UI Status

The current UI is a native Mobile adaptation of the Desktop information architecture:

- `Threads`: Hub thread inventory with connection status, compact metrics, explicit refresh-in-progress feedback, dense list rows, and Desktop-style handoff context.
- `Threads` rows: handoff queue rows now match Runs triage density with last-activity metadata and project context under the title. Status is carried by badges and icons, not colored left rails.
- `Threads` filters: phone-sized All / Active / Archived chips replace the earlier non-functional search placeholder. Empty filtered states include a 44px Show all recovery action, and the Continue handoff shortcut is hidden when the Archived filter is active so the screen stays scoped to archived work.
- `Threads` recovery: Hub/API failures now stay in the queue context with a compact recovery card, timestamped retry affordance, Retry plus Account actions, and 44px controls instead of a dead-end centered error state. The header distinguishes deployed Hub reachability from workflow JSON sync failures.
- `Chat`: selected thread conversation surface with a compact thread context panel, Mobile-native bubbles, 44px copy actions with inline Copied feedback, a scroll-aware Latest jump control, activity cards for non-message thread items, a phone-sized composer with persistent reply scope, visible send pending/error/success feedback, thread timeline recovery actions, empty-state CTA back to Threads, active-tab root return, and real `createThreadMessage` wiring.
- `Runs`: recent Hub run queue with compact execution metrics, explicit refresh-in-progress feedback, and a full-card phone-first Next review shortcut; selecting a run opens the mobile run detail/log surface with a summary strip plus sticky section navigator for review, diff, structured blocks, outputs, and logs.
- `Runs` navigation: tapping the Runs bottom tab while a run detail is retained now returns to the Runs queue, matching mobile tab root behavior without requiring the top Back button or leaking stale detail state after visiting Account/Threads.
- `Runs` rows: queue rows include thread context under the timestamp, so Review/Active/Closed states remain scannable after filtering without colored left rails.
- `Run summary`: the run detail summary strip now covers Review, Diff, Blocks, Outputs, and Logs so mobile reviewers can judge all evidence surfaces before scrolling.
- `Run section navigation`: the sticky Review / Diff / Blocks / Outputs / Logs chips keep an active state after tap navigation and update while the user scrolls, so long mobile review pages show the current section context. Active chips auto-reveal with nearest-edge scrolling and inline scroll padding, avoiding hard edge clipping when moving between Blocks, Outputs, and Logs on a 390px phone viewport.
- `Runs` filters: All / Review / Active / Closed chips let mobile reviewers collapse the queue to the action state they need. The four chips fit in the 390px viewport without clipping counts, empty filtered states include a 44px Show all recovery action, Closed counts finished/failed/cancelled runs consistently with the filter, and the Next review shortcut is hidden outside All/Review so Closed and Active filters stay focused.
- `Runs` recovery: execution queue failures use the same Mobile recovery card pattern so reviewers know not to approve stale work from another device. The queue mirrors Threads by showing `Reachable` when `/health` is OK but run workflow JSON is still unavailable, and the card can jump directly to Account for native session/bridge checks.
- `Review dock`: pending approval runs keep Approve / Reject actions pinned above the bottom navigation while the user scrolls through diff, blocks, outputs, and logs. Approval decisions now open decision-specific bottom confirmation sheets before submission to reduce mobile tap mistakes, the sheet keeps submission pending/error feedback visible near the confirm action, and resolved approvals replace disabled decision buttons with a read-only decision lock.
- `Structured blocks`: run items render as a phone-first review timeline with per-block index chips and kind/role/time metadata chips; state is expressed through badges/icons/borders rather than type-colored rails.
- `Run logs`: raw stdout/stderr now render as mobile log rows with line numbers, source chips, wrapping text, review/diff/mobile/error tones, and 44px log filter chips instead of a single terminal-style `<pre>`.
- `Account`: Mobile TokenDance ID sign-in, Hub session checks, native session clear, notification permission, language, client surfaces, and about surface. The phone-first bottom navigation exposes Account as the rightmost tab instead of burying sign-in under a Desktop-style Settings destination; the first panel now uses the TokenDance mark, Desktop/Web-style glass identity copy, three compact identity chips, and immediate 44px Sign in / Check session / Clear actions. Native action failures keep a 44px Retry action in the status panel for mobile login/session recovery, and action feedback scrolls to a header-aware start position with dedicated Account bottom scroll reserve so the retry target stays visible without clipping the surrounding context. The destructive Clear session action now opens a bottom confirmation sheet, keeps clear pending/error feedback inside the sheet, and only closes after a successful native clear.
- `Account surface registry`: Account now renders Threads / Chat / Runs / Account from `@agenthub/shared` `surfaceMetadata`, so Mobile follows the same Desktop/Web information architecture registry while still adapting identity to a native bottom-tab pattern.
- `i18n`: Mobile now initializes `i18next`/`react-i18next`, defaults to the device language, persists manual overrides in local storage, syncs `<html lang>`, and exposes an English / 简体中文 language switch in Account. The translated surface now covers the global shell, bottom navigation, Chat empty state, shared recovery actions, Account readiness/account/notification/about cards, native action statuses, retry actions, clear-session confirmation sheet, Threads/Runs queue shell, filters, recovery states, refresh feedback, and queue status badges; remaining feature copy should migrate incrementally as each screen is touched.
- `BottomNav`: 4-tab mobile navigation is now Threads / Chat / Runs / Account, driven by shared Mobile surface metadata with 48dp touch targets, TokenDance glass/tint styling, compact task badges for active Threads plus pending review Runs, explicit active styling that stays legible during browser hover QA, and a minimum Android gesture-area bottom buffer for WebViews where `env(safe-area-inset-bottom)` reports `0`; approval decisions invalidate the Runs cache so the pending badge clears after the checkpoint is resolved.
- `Queue status badges`: Threads and Runs queue rows now consume shared `@agenthub/shared/components` `StatusBadge` with localized Mobile labels and Mobile glass status classes. Mobile no longer maintains a separate `MobileStatusBadge` wrapper.
- `Glassmorphism`: Mobile now follows the Desktop glass direction instead of the earlier gradient-heavy treatment. Core list rows, overview panels, run detail panels, recovery cards, approval/diff/log surfaces, and Account cards use shared `--td-*` rgba/backdrop tokens mapped to `@agenthub/shared` `designTokens`; status color is limited to badges, borders, icons, and chips so the UI reads closer to the Desktop command center.

This pass removed the broken Tailwind-style dependency assumption. Mobile now uses local semantic CSS classes in `src/styles/global.css` instead of relying on a Tailwind build pipeline that does not exist in this package.

The latest Desktop-aligned glass pass also restored Mobile i18n initialization in `src/main.tsx`, reworked tab roots so Runs and Chat do not open to blank content, and rewired Chat send through `createThreadMessage`.

Account readiness now uses a filled Desktop-style identity panel plus dense rows for TokenDance ID deep link, native Hub session storage, and notification permission checks instead of sparse placeholder metric tiles. The Account identity panel renders the shared `TokenDanceMark` UI component backed by `app/shared/src/assets/tokendance-icon-rounded.svg`, matching Web without maintaining a second Mobile-only SVG copy or local `<img>` contract. This keeps the Mobile native adaptation visible without adding gradient cards or colored left rails.

## Source Layout

```text
src/
  App.tsx                         # Mobile route state and tab dispatch
  components/
    BottomNav.tsx                 # 4-tab mobile navigation
    MobileRecoveryPanel.tsx       # Shared Mobile Hub/API recovery state
  hooks/
    useHubSocket.ts               # Hub WebSocket hook with reconnect/backoff
  native/
    hubHealth.ts                  # Deployed Hub /health reachability check
    hubTransport.ts               # Browser fetch / Tauri hub_request transport switch
    mobileCommands.ts             # Tauri command + notification plugin bridge
    resourceActions.ts            # Tauri shell/browser fallback for output links
  views/
    ThreadListView.tsx            # Hub thread list
    ChatView.tsx                  # Selected thread chat
    RunListView.tsx               # Recent run queue
    RunStatusView.tsx             # Selected run output
    AccountView.tsx               # Mobile Account / identity shell
  styles/
    global.css                    # TokenDance tokens and Mobile semantic classes
```

Mobile empty states consume `@agenthub/shared/ui` `EmptyState` with Mobile glass/touch-target class overrides, so Chat root and Web empty states share one component contract.

## Verification

Commands used for the latest UI/native bridge pass:

```powershell
cd app/mobile
corepack.cmd pnpm typecheck
corepack.cmd pnpm build
node --check scripts/visual-qa.mjs
$env:MOBILE_QA_URL='http://127.0.0.1:5184/'
corepack.cmd pnpm visual:qa
git diff --check -- app/mobile/src app/mobile/scripts app/mobile/README.md docs/development/handoffs/STATE.md
$env:JAVA_HOME='C:\Program Files\Android\Android Studio\jbr'
corepack.cmd pnpm tauri android build --debug
$env:ADB_SERIAL='emulator-5556'
$env:AGENTHUB_EMULATOR_LAUNCH_DELAY_MS='9000'
corepack.cmd pnpm emulator:qa
```

Emulator evidence was captured from cold-booted Android Studio AVD `agenthub-emu` / `emulator-5556` at `1080x2400` portrait after installing the rebuilt debug APK:

```text
app/mobile/screenshots/mobile-ui-threads-emulator.png
app/mobile/screenshots/mobile-ui-chat-empty-emulator.png
app/mobile/screenshots/mobile-ui-runs-empty-emulator.png
app/mobile/screenshots/mobile-ui-settings-emulator.png
app/mobile/screenshots/mobile-ui-threads-emulator-csp-fixed.png
app/mobile/screenshots/mobile-ui-settings-emulator-csp-fixed.png
app/mobile/screenshots/mobile-ui-threads-native-bridge-emulator.png
app/mobile/screenshots/mobile-ui-runs-native-bridge-emulator.png
app/mobile/screenshots/mobile-ui-settings-native-bridge-emulator.png
app/mobile/screenshots/mobile-ui-threads-health-reachable-emulator.png
app/mobile/screenshots/mobile-ui-runs-health-reachable-emulator.png
app/mobile/screenshots/mobile-ui-threads-emulator-current.png
app/mobile/screenshots/mobile-ui-chat-emulator-current.png
app/mobile/screenshots/mobile-ui-runs-emulator-current.png
app/mobile/screenshots/mobile-ui-settings-emulator-current.png
app/mobile/screenshots/mobile-ui-settings-login-recovery-emulator.png
```

The screenshots are local verification artifacts and are not required source files.

Latest Mobile design-system evidence captured with Playwright at 390x844 dark color scheme and mocked Hub workflow data:

```text
app/mobile/screenshots/mobile-design-after-threads-mocked-dark.png
app/mobile/screenshots/mobile-design-bottom-nav-badges-mocked-dark.png
app/mobile/screenshots/mobile-design-threads-handoff-mocked-dark.png
app/mobile/screenshots/mobile-design-threads-filter-archived-mocked-dark.png
app/mobile/screenshots/mobile-design-threads-refreshing-mocked-dark.png
app/mobile/screenshots/mobile-design-threads-empty-filter-mocked-dark.png
app/mobile/screenshots/mobile-design-after-chat-mocked-dark.png
app/mobile/screenshots/mobile-design-chat-context-mocked-dark.png
app/mobile/screenshots/mobile-design-chat-latest-jump-mocked-dark.png
app/mobile/screenshots/mobile-design-chat-copy-feedback-mocked-dark.png
app/mobile/screenshots/mobile-design-chat-empty-cta-mocked-dark.png
app/mobile/screenshots/mobile-design-chat-activity-cards-mocked-dark.png
app/mobile/screenshots/mobile-design-chat-composer-scope-mocked-dark.png
app/mobile/screenshots/mobile-design-chat-tab-root-mocked-dark.png
app/mobile/screenshots/mobile-design-chat-recovery-mocked-dark.png
app/mobile/screenshots/mobile-design-chat-send-pending-mocked-dark.png
app/mobile/screenshots/mobile-design-chat-send-error-mocked-dark.png
app/mobile/screenshots/mobile-design-chat-send-error-retry-mocked-dark.png
app/mobile/screenshots/mobile-design-chat-send-retry-success-mocked-dark.png
app/mobile/screenshots/mobile-design-chat-send-success-mocked-dark.png
app/mobile/screenshots/mobile-design-after-runs-mocked-dark.png
app/mobile/screenshots/mobile-design-runs-triage-mocked-dark.png
app/mobile/screenshots/mobile-design-runs-filter-review-mocked-dark.png
app/mobile/screenshots/mobile-design-runs-filter-closed-mocked-dark.png
app/mobile/screenshots/mobile-design-runs-refreshing-mocked-dark.png
app/mobile/screenshots/mobile-design-runs-empty-filter-mocked-dark.png
app/mobile/screenshots/mobile-design-runs-tab-return-mocked-dark.png
app/mobile/screenshots/mobile-design-after-run-detail-mocked-dark.png
app/mobile/screenshots/mobile-design-run-summary-mocked-dark.png
app/mobile/screenshots/mobile-design-run-summary-shortcut-blocks-mocked-dark.png
app/mobile/screenshots/mobile-design-diff-lines-mocked-dark.png
app/mobile/screenshots/mobile-design-review-action-dock-mocked-dark.png
app/mobile/screenshots/mobile-design-approval-confirm-sheet-mocked-dark.png
app/mobile/screenshots/mobile-design-reject-confirm-sheet-mocked-dark.png
app/mobile/screenshots/mobile-design-approval-submit-pending-mocked-dark.png
app/mobile/screenshots/mobile-design-approval-submit-error-mocked-dark.png
app/mobile/screenshots/mobile-design-rejection-submit-error-mocked-dark.png
app/mobile/screenshots/mobile-design-approval-submit-retry-success-mocked-dark.png
app/mobile/screenshots/mobile-design-rejection-submit-retry-success-mocked-dark.png
app/mobile/screenshots/mobile-design-approval-submit-success-mocked-dark.png
app/mobile/screenshots/mobile-design-rejection-submit-success-mocked-dark.png
app/mobile/screenshots/mobile-design-after-settings-mocked-dark.png
app/mobile/screenshots/mobile-design-settings-readiness-mocked-dark.png
app/mobile/screenshots/mobile-design-settings-readiness-tile-action-mocked-dark.png
app/mobile/screenshots/mobile-design-settings-compact-feedback-mocked-dark.png
app/mobile/screenshots/mobile-design-settings-action-feedback-mocked-dark.png
app/mobile/screenshots/mobile-design-settings-login-recovery-mocked-dark.png
app/mobile/screenshots/mobile-design-settings-clear-confirm-mocked-dark.png
app/mobile/screenshots/mobile-design-settings-clear-error-mocked-dark.png
app/mobile/screenshots/mobile-design-threads-recovery-mocked-dark.png
app/mobile/screenshots/mobile-design-runs-recovery-mocked-dark.png
app/mobile/screenshots/mobile-design-runs-recovery-settings-mocked-dark.png
app/mobile/screenshots/mobile-design-approval-diff-mocked-dark.png
app/mobile/screenshots/mobile-design-run-section-nav-outputs-mocked-dark.png
app/mobile/screenshots/mobile-design-run-blocks-mocked-dark.png
app/mobile/screenshots/mobile-design-run-scroll-spy-blocks-mocked-dark.png
app/mobile/screenshots/mobile-design-run-scroll-spy-logs-mocked-dark.png
app/mobile/screenshots/mobile-design-run-resources-mocked-dark.png
app/mobile/screenshots/mobile-design-run-logs-mocked-dark.png
app/mobile/screenshots/mobile-design-run-logs-filter-error-mocked-dark.png
app/mobile/screenshots/mobile-design-resource-action-feedback-mocked-dark.png
app/mobile/screenshots/mobile-design-resource-detail-sheet-mocked-dark.png
app/mobile/screenshots/mobile-design-resource-detail-copy-mocked-dark.png
app/mobile/screenshots/mobile-design-light-threads-mocked.png
app/mobile/screenshots/mobile-design-light-threads-handoff-mocked.png
app/mobile/screenshots/mobile-design-light-threads-recovery-mocked.png
app/mobile/screenshots/mobile-design-light-threads-empty-filter-mocked.png
app/mobile/screenshots/mobile-design-light-chat-empty-cta-mocked.png
app/mobile/screenshots/mobile-design-light-chat-activity-cards-mocked.png
app/mobile/screenshots/mobile-design-light-chat-composer-scope-mocked.png
app/mobile/screenshots/mobile-design-light-chat-tab-root-mocked.png
app/mobile/screenshots/mobile-design-light-chat-send-error-retry-mocked.png
app/mobile/screenshots/mobile-design-light-chat-send-retry-success-mocked.png
app/mobile/screenshots/mobile-design-light-chat-recovery-mocked.png
app/mobile/screenshots/mobile-design-light-runs-triage-mocked.png
app/mobile/screenshots/mobile-design-light-runs-filter-closed-mocked.png
app/mobile/screenshots/mobile-design-light-runs-recovery-mocked.png
app/mobile/screenshots/mobile-design-light-runs-empty-filter-mocked.png
app/mobile/screenshots/mobile-design-light-run-summary-mocked.png
app/mobile/screenshots/mobile-design-light-run-blocks-mocked.png
app/mobile/screenshots/mobile-design-light-resource-action-feedback-mocked.png
app/mobile/screenshots/mobile-design-light-resource-detail-sheet-mocked.png
app/mobile/screenshots/mobile-design-light-resource-detail-copy-mocked.png
app/mobile/screenshots/mobile-design-light-settings-readiness-mocked.png
app/mobile/screenshots/mobile-design-light-settings-action-feedback-mocked.png
app/mobile/screenshots/mobile-design-light-settings-login-recovery-mocked.png
app/mobile/screenshots/mobile-design-light-settings-clear-confirm-mocked.png
app/mobile/screenshots/mobile-design-light-settings-clear-error-mocked.png
app/mobile/screenshots/mobile-design-light-review-dock-mocked.png
app/mobile/screenshots/mobile-design-light-approval-confirm-sheet-mocked.png
app/mobile/screenshots/mobile-design-light-approval-submit-error-mocked.png
app/mobile/screenshots/mobile-design-light-rejection-submit-error-mocked.png
app/mobile/screenshots/mobile-design-light-approval-submit-retry-success-mocked.png
app/mobile/screenshots/mobile-design-light-rejection-submit-retry-success-mocked.png
app/mobile/screenshots/mobile-design-light-approval-submit-success-mocked.png
app/mobile/screenshots/mobile-design-light-runs-after-approval-return-mocked.png
app/mobile/screenshots/mobile-design-light-rejection-submit-success-mocked.png
app/mobile/screenshots/mobile-design-light-runs-after-rejection-return-mocked.png
app/mobile/screenshots/mobile-design-settings-language-zh-mocked-dark.png
app/mobile/screenshots/mobile-design-threads-zh-mocked-dark.png
app/mobile/screenshots/mobile-design-runs-zh-mocked-dark.png
```

The glassmorphism pass is covered by the refreshed mocked screenshots above, especially:

```text
app/mobile/screenshots/mobile-design-after-threads-mocked-dark.png
app/mobile/screenshots/mobile-design-run-blocks-mocked-dark.png
app/mobile/screenshots/mobile-design-settings-language-zh-mocked-dark.png
app/mobile/screenshots/mobile-design-threads-zh-mocked-dark.png
app/mobile/screenshots/mobile-design-runs-zh-mocked-dark.png
app/mobile/screenshots/mobile-design-light-runs-after-rejection-return-mocked.png
```

`src/styles/global.css` currently has no `linear-gradient`, `radial-gradient`, or `conic-gradient` usage in the Mobile source.

The current Settings i18n pass is covered by `app/mobile/screenshots/mobile-design-settings-language-zh-mocked-dark.png`; the screenshot verifies the 390x844 Chinese Settings surface, localized readiness/account/notification/about cards, localized action buttons, no horizontal overflow, and no sub-44px touch targets.

The current queue i18n pass is covered by `app/mobile/screenshots/mobile-design-threads-zh-mocked-dark.png` and `app/mobile/screenshots/mobile-design-runs-zh-mocked-dark.png`; the screenshots verify localized Threads/Runs titles, filters, recovery/refresh shell copy, and localized queue status badges such as `在线`, `离线`, `运行中`, `审阅`, and `完成` at 390x844 without horizontal overflow.

The current in-app browser glass pass is covered by `app/mobile/screenshots/mobile-glass-threads-iab-390x844.png` and `app/mobile/screenshots/mobile-glass-runs-i18n-iab-390x844.png`; the probes verified `scrollWidth=390`, no visible gradient backgrounds, no colored left-border state rails, and no raw i18n keys on the Runs root.

After shared/Web strict typing was repaired, the same pass was reverified with `app/mobile/screenshots/mobile-glass-final-typechecked-threads-iab-390x844.png` and `app/mobile/screenshots/mobile-glass-final-typechecked-runs-iab-390x844.png`; `corepack.cmd pnpm typecheck` and `corepack.cmd pnpm build` both pass.

The current in-app browser native/i18n Settings pass is covered by `app/mobile/screenshots/mobile-desktop-aligned-settings-native-iab-390x844.png`; the probe verified `innerWidth=390`, `scrollWidth=390`, `gradients=0`, `leftBorders=0`, no raw i18n keys, `lang=zh-Hans`, localized title `设置`, and 44px+ visible native action buttons for sign-in, session check, clear, notification probe, and bottom navigation.

The current Settings language-control source pass is covered by:

```text
app/mobile/screenshots/mobile-settings-language-en-pw-390x844.png
app/mobile/screenshots/mobile-settings-language-zh-pw-390x844.png
app/mobile/screenshots/mobile-settings-language-pw-390x844.probe.json
app/mobile/screenshots/mobile-settings-shared-glass-readiness-pw-390x844.png
app/mobile/screenshots/mobile-settings-shared-glass-readiness-pw-390x844.probe.json
app/mobile/screenshots/mobile-settings-surface-registry-pw-390x844.png
app/mobile/screenshots/mobile-settings-surface-registry-pw-390x844.probe.json
app/mobile/screenshots/mobile-settings-shared-surface-status-pw-390x844.png
app/mobile/screenshots/mobile-settings-shared-surface-status-pw-390x844.probe.json
app/mobile/screenshots/mobile-bottom-nav-shared-surfaces-pw-390x844.png
app/mobile/screenshots/mobile-bottom-nav-shared-surfaces-pw-390x844.probe.json
```

This pass wires the existing i18n storage and `<html lang>` behavior to a real Account segmented control instead of keeping language switching as an unrendered resource. The probe verifies English -> 简体中文 switching, `lang=zh-Hans`, persisted `agenthub.mobile.language=zh`, `scrollWidth=390`, no gradients, no left-only rails, no raw i18n keys, and two 163x44 language buttons. The shared-glass readiness probe also verifies three dense native readiness rows for TokenDance ID deep link, Hub session secure store, and notification local probe, with `smallTargets=[]`, `leftInsetShadowCount=0`, and no horizontal overflow. The surface registry probe verifies four shared Mobile IA rows, `scrollWidth=390`, `gradientCount=0`, `leftOnlyBorderCount=0`, `leftInsetShadowCount=0`, `smallTargets=[]`, and `rawI18nKeys=[]`. The shared-surface-status probe verifies Mobile now renders registry states through `@agenthub/shared` `getSurfaceStatusMetadata()` / `surface.status.*` labels, with `Real snapshot` and `Local source` visible and the old local `Live` label absent. The bottom-nav shared-surface probe verifies the rightmost Mobile tab is now `Account`, its aria label comes from `surface.mobile.account.description`, Account opens to visible Sign in / Check session / Clear actions, and the 390x844 viewport still has no overflow, no gradients, no left rails, no inset rails, no small targets, and no raw i18n keys.

The current Settings clear-session confirmation pass is covered by:

```text
app/mobile/screenshots/mobile-settings-clear-sheet-pw-390x844.png
app/mobile/screenshots/mobile-settings-clear-sheet-pw-390x844.probe.json
app/mobile/screenshots/mobile-settings-clear-retry-pw-390x844.png
app/mobile/screenshots/mobile-settings-clear-retry-pw-390x844.probe.json
```

This pass makes the destructive Clear session action match the documented Mobile behavior: tapping Clear opens a bottom confirmation sheet instead of immediately calling the native command. The sheet keeps storage/effect context, pending/error status, Cancel, and Confirm clear inside the same glass surface. Browser-preview native bridge failure stays inside the sheet and turns Confirm clear into a 44px `Retry clear` action. The probes verify `scrollWidth=390`, no gradients, no left-only rails, no raw i18n keys, a 390px-wide bottom sheet pinned to the bottom, and 44px+ close/cancel/confirm/retry targets.

The current Runs no-rail status pass is covered by `app/mobile/screenshots/mobile-runs-status-no-rails-pw-390x844.png`; the probe `app/mobile/screenshots/mobile-runs-status-no-rails-pw-390x844.probe.json` verifies `scrollWidth=390`, `gradientCount=0`, `leftOnlyBorderCount=0`, `leftInsetShadowCount=0`, `smallTargetCount=0`, no raw i18n keys, 370x86 run rows, 1px balanced borders on both sides, status-filled glass row backgrounds, and `lastRunClearsBottomNav=true` after scrolling the final row above the bottom navigation.

The current Threads filter/recovery pass is covered by:

```text
app/mobile/screenshots/mobile-threads-filters-handoff-pw-390x844.png
app/mobile/screenshots/mobile-threads-filter-archived-no-rails-pw-390x844.png
app/mobile/screenshots/mobile-threads-recovery-settings-pw-390x844.png
app/mobile/screenshots/mobile-threads-filter-archived-zh-pw-390x844.png
app/mobile/screenshots/mobile-threads-filters-recovery-pw-390x844.probe.json
```

This pass moves the real `ThreadListView` source to the documented Desktop-aligned queue behavior: All / Active / Archive segmented filters, a Continue handoff shortcut hidden while viewing archived work, localized status labels, a localized Local workspace fallback, and the shared `MobileRecoveryPanel` with Retry plus Settings actions. The probe verifies English and Chinese 390x844 states with `scrollWidth=390`, `gradientCount=0`, `leftOnlyBorderCount=0`, `leftInsetShadowCount=0`, `smallTargets=[]`, `rawI18nKeys=[]`, three 87x44 segmented buttons, and 168x44 recovery actions.

`corepack.cmd pnpm visual:qa` expects the Mobile Vite preview to be running on `localhost:5174`. It mocks Hub API responses, captures the screenshot set above, clicks the mobile filter chips, verifies Threads/Runs recovery states with mocked Hub 503 responses, checks both dark and light color schemes for key surfaces, and fails on horizontal overflow, sub-44px touch targets, or unexpected browser console output.

Codex in-app browser is the preferred interactive surface for Mobile frontend development against `localhost:5174`; use a 390x844 viewport for manual tab, language, and recovery-flow checks, then keep `visual:qa` and `emulator:qa` as the screenshot/evidence gates. The in-app browser can inspect DOM and interact with the app directly; packaged Android/emulator remains required for Tauri WebView, native command, safe-area, and gesture-handle validation.

`corepack.cmd pnpm emulator:qa` expects an installed debug APK and one online emulator/device. It resolves `adb`, launches `com.agenthub.mobile`, waits for the Tauri WebView cold-start window, captures `mobile-ui-current-emulator.png` plus `mobile-ui-threads-emulator-current.png`, taps Chat and captures `mobile-ui-chat-emulator-current.png`, taps Runs and captures `mobile-ui-runs-emulator-current.png`, taps Settings and captures `mobile-ui-settings-emulator-current.png`, then taps Sign in and captures `mobile-ui-settings-login-recovery-emulator.png`. Set `ADB_SERIAL` when more than one device is attached. Set `AGENTHUB_EMULATOR_LAUNCH_DELAY_MS` only when a slower cold boot needs a longer first-screen wait.

Browser preview on `localhost:5174` still hits production Hub CORS if requests are not mocked. Packaged Android now registers a native `hub_request` bridge for Tauri runtime fetches to `http://api.hub.vectorcontrol.tech`, so Mobile no longer depends on production Hub allowing the WebView origin `http://tauri.localhost`. Use `visual:qa` mocked API responses for full layout/interaction evidence.

Android was rebuilt, reinstalled, and recaptured after the native bridge + recovery-state pass. The new emulator screenshots show the current Threads/Chat/Runs/Settings bottom-tab matrix in the real WebView on a portrait Pixel 7 AVD, and logcat no longer shows CSP, CORS, or `Access-Control` failures. Threads and Runs now check deployed Hub reachability through `http://api.hub.vectorcontrol.tech/health` separately from workflow sync. When `/health` is reachable but `http://api.hub.vectorcontrol.tech/v1/*` does not return workflow JSON, the header shows `Reachable`, the command center says `Hub reachable; workflow sync pending` or `Hub reachable; run sync pending`, and the recovery card is labeled `Workflow recovery`. `app/mobile/screenshots/mobile-ui-chat-emulator-current.png` covers the Chat root empty state with its `Browse threads` recovery CTA in the installed APK. `app/mobile/screenshots/mobile-ui-settings-login-recovery-emulator.png` was captured after installing the rebuilt APK on the emulator and tapping real Mobile Sign in; it shows the Rust OIDC stub error and the in-panel `Retry sign in` recovery action in the Tauri WebView. The remaining live-Hub blocker is API contract alignment: `/v1/health`, `/v1/threads`, and `/v1/runs` currently do not provide compatible workflow JSON for the shared Edge-style endpoints that Mobile calls. Mobile therefore still needs a Hub workflow API/session contract pass before live Threads/Runs can replace the recovery state.

The current run detail surface includes mobile actions for output resources: artifact rows expose `Copy` for the artifact path, preview rows expose `Open` for the preview URL, and the resource icon/title block is a full-width phone target for the detail sheet instead of relying on a small trailing info icon. Dark and light screenshots cover resource copy feedback plus the detail sheet, and `visual:qa` verifies these controls remain at least 44px tall.

The current structured blocks surface is covered by `app/mobile/screenshots/mobile-design-run-blocks-mocked-dark.png` and `app/mobile/screenshots/mobile-design-light-run-blocks-mocked.png`. The screenshots show approval, diff, code, and file blocks with index chips, compact metadata chips, status icons, and balanced glass borders; `visual:qa` verifies the surrounding run detail remains at `scrollWidth=390/innerWidth=390`.

The current output resource interaction is covered by `app/mobile/screenshots/mobile-design-resource-action-feedback-mocked-dark.png`, `app/mobile/screenshots/mobile-design-resource-detail-sheet-mocked-dark.png`, `app/mobile/screenshots/mobile-design-resource-detail-copy-mocked-dark.png`, `app/mobile/screenshots/mobile-design-light-resource-action-feedback-mocked.png`, `app/mobile/screenshots/mobile-design-light-resource-detail-sheet-mocked.png`, and `app/mobile/screenshots/mobile-design-light-resource-detail-copy-mocked.png`. The screenshots show artifact copy feedback and the resource detail bottom sheet in both color schemes, including the sheet-level `Copy path` action switching to `Copied`.

The current logs surface is covered by `app/mobile/screenshots/mobile-design-run-logs-mocked-dark.png` and `app/mobile/screenshots/mobile-design-run-logs-filter-error-mocked-dark.png`. The screenshots show stdout/stderr split into phone-readable rows with source chips, wrapped text, 44px All/Review/Diff/Mobile/Error filters, and pending review dock clearance.

The section navigator active state is visible in `app/mobile/screenshots/mobile-design-run-section-nav-outputs-mocked-dark.png` and `app/mobile/screenshots/mobile-design-run-logs-mocked-dark.png`, where the Outputs and Logs chips remain selected after tap navigation.

The section navigator scroll-spy behavior is visible in `app/mobile/screenshots/mobile-design-run-scroll-spy-blocks-mocked-dark.png`, where manually scrolling to the structured blocks area updates the sticky nav to the Blocks context without requiring a chip tap.

The section navigator active chip auto-reveal behavior is visible in `app/mobile/screenshots/mobile-design-run-scroll-spy-logs-mocked-dark.png`, where manually scrolling to the final Logs section updates the active section, uses the bottom-of-scroll boundary for the last section, and horizontally brings the Logs chip into view without centering the chip so aggressively that adjacent nav items are hard-clipped at the viewport edge.

The run summary shortcut behavior is visible in `app/mobile/screenshots/mobile-design-run-summary-shortcut-blocks-mocked-dark.png`, where tapping the Blocks summary tile from the top summary strip jumps directly to the structured blocks section and keeps the Blocks navigation state selected.

The current Threads queue row treatment is covered by `app/mobile/screenshots/mobile-design-threads-handoff-mocked-dark.png`, `app/mobile/screenshots/mobile-design-threads-filter-archived-mocked-dark.png`, and `app/mobile/screenshots/mobile-design-light-threads-mocked.png`. The screenshots show active and archived thread badges/icons, last-activity timestamps, project context, filled glass row surfaces, and 366x79 row touch targets without horizontal overflow.

The current empty-filter recovery treatment is covered by `app/mobile/screenshots/mobile-design-threads-empty-filter-mocked-dark.png`, `app/mobile/screenshots/mobile-design-runs-empty-filter-mocked-dark.png`, `app/mobile/screenshots/mobile-design-light-threads-empty-filter-mocked.png`, and `app/mobile/screenshots/mobile-design-light-runs-empty-filter-mocked.png`. The screenshots show empty filtered states with a direct Show all action so users do not have to infer how to recover from an empty chip selection.

The current shortcut-card interaction is visible in `app/mobile/screenshots/mobile-design-threads-handoff-mocked-dark.png`, `app/mobile/screenshots/mobile-design-runs-triage-mocked-dark.png`, and `app/mobile/screenshots/mobile-design-light-runs-triage-mocked.png`. Continue handoff and Next review are full-card buttons at 366x80 rather than small arrow-only actions.

The current filter-scoped shortcut behavior is visible in `app/mobile/screenshots/mobile-design-threads-filter-archived-mocked-dark.png`, `app/mobile/screenshots/mobile-design-runs-filter-closed-mocked-dark.png`, and `app/mobile/screenshots/mobile-design-light-runs-filter-closed-mocked.png`. Archived/Closed filters hide unrelated shortcut cards so the phone viewport is not spent on actions outside the selected state.

The current refresh feedback behavior is covered by `app/mobile/screenshots/mobile-design-threads-refreshing-mocked-dark.png` and `app/mobile/screenshots/mobile-design-runs-refreshing-mocked-dark.png`. The screenshots show Threads/Runs overview panels exposing a compact `Refreshing ...` status pill plus spinning refresh icon while a refetch is in flight, so phone users get persistent feedback after tapping the 44px refresh control.

The current bottom navigation badge and safe-area behavior is covered by `app/mobile/screenshots/mobile-design-bottom-nav-badges-mocked-dark.png` plus the portrait emulator captures `app/mobile/screenshots/mobile-ui-threads-emulator-current.png`, `app/mobile/screenshots/mobile-ui-chat-emulator-current.png`, `app/mobile/screenshots/mobile-ui-runs-emulator-current.png`, and `app/mobile/screenshots/mobile-ui-settings-login-recovery-emulator.png`. The screenshots show the global nav exposing active thread and pending review counts without shrinking the tab targets, and the real Android WebView keeps a minimum bottom buffer above the gesture handle even when `env(safe-area-inset-bottom)` is zero.

The current approval submission behavior is covered by `app/mobile/screenshots/mobile-design-approval-submit-pending-mocked-dark.png`, `app/mobile/screenshots/mobile-design-approval-submit-error-mocked-dark.png`, `app/mobile/screenshots/mobile-design-rejection-submit-error-mocked-dark.png`, `app/mobile/screenshots/mobile-design-approval-submit-retry-success-mocked-dark.png`, `app/mobile/screenshots/mobile-design-rejection-submit-retry-success-mocked-dark.png`, `app/mobile/screenshots/mobile-design-approval-submit-success-mocked-dark.png`, `app/mobile/screenshots/mobile-design-light-approval-submit-error-mocked.png`, `app/mobile/screenshots/mobile-design-light-rejection-submit-error-mocked.png`, `app/mobile/screenshots/mobile-design-light-approval-submit-retry-success-mocked.png`, `app/mobile/screenshots/mobile-design-light-rejection-submit-retry-success-mocked.png`, `app/mobile/screenshots/mobile-design-light-approval-submit-success-mocked.png`, `app/mobile/screenshots/mobile-design-rejection-submit-success-mocked-dark.png`, and `app/mobile/screenshots/mobile-design-light-rejection-submit-success-mocked.png`. The screenshots show the bottom confirmation sheet staying open while the decision POST is pending, disabling dismiss/confirm controls during submission, surfacing Hub/session failure feedback inside the sheet instead of only behind it in the approval panel in dark and light coverage, keeping the approve and reject failure sheets actionable with Confirm and Cancel controls, recovering from transient approve and reject POST failures after a second confirm tap across both color schemes, and then returning to Run detail with a done/error header badge, a moss/danger Review summary tile, a read-only approved/rejected decision lock instead of disabled Approve/Reject buttons, a refreshed Runs tab without the stale pending badge, plus a 44px `Back to queue` next-step action after Hub marks the checkpoint approved or rejected.

The current post-decision queue return is covered by `app/mobile/screenshots/mobile-design-runs-after-approval-return-mocked-dark.png`, `app/mobile/screenshots/mobile-design-runs-after-rejection-return-mocked-dark.png`, `app/mobile/screenshots/mobile-design-light-runs-after-approval-return-mocked.png`, and `app/mobile/screenshots/mobile-design-light-runs-after-rejection-return-mocked.png`. It verifies that tapping `Back to queue` after approval or rejection returns to the Runs queue with `Review0`, no stale `Next review` shortcut, no pending review badge in the bottom navigation, and a Closed count that includes failed rejected runs in both dark and light coverage.

The current tab-root navigation behavior is covered by `app/mobile/screenshots/mobile-design-runs-tab-return-mocked-dark.png`. It verifies that tapping the active Runs bottom tab from a run detail returns to the queue while preserving the 390px no-overflow layout.

The current recovery action path is covered by `app/mobile/screenshots/mobile-design-threads-recovery-mocked-dark.png`, `app/mobile/screenshots/mobile-design-runs-recovery-mocked-dark.png`, `app/mobile/screenshots/mobile-design-light-threads-recovery-mocked.png`, `app/mobile/screenshots/mobile-design-light-runs-recovery-mocked.png`, and `app/mobile/screenshots/mobile-design-runs-recovery-settings-mocked-dark.png`. The screenshots show Threads/Runs recovery cards retaining queue context with Retry and Settings actions in both color schemes, then verify that the Settings action opens the native bridge readiness surface.

The current Chat activity surface is covered by `app/mobile/screenshots/mobile-design-chat-activity-cards-mocked-dark.png` and `app/mobile/screenshots/mobile-design-light-chat-activity-cards-mocked.png`. The screenshots show approval and diff thread items as compact mobile activity cards instead of dropping them from the chat timeline.

The current Chat copy feedback behavior is covered by `app/mobile/screenshots/mobile-design-chat-copy-feedback-mocked-dark.png`. The screenshot shows message bubbles exposing a 44px Copy action and switching the tapped row to inline Copied feedback, so phone reviewers can copy Agent output or user instructions without relying on text selection.

The current Chat latest-jump behavior is covered by `app/mobile/screenshots/mobile-design-chat-latest-jump-mocked-dark.png`. The screenshot shows a 92x44 floating Latest control when the reviewer scrolls away from the newest message, and `visual:qa` clicks it to verify the button returns the thread to the latest bubble.

The current Chat empty state is covered by `app/mobile/screenshots/mobile-design-chat-empty-cta-mocked-dark.png` and `app/mobile/screenshots/mobile-design-light-chat-empty-cta-mocked.png`. The screenshots show the Browse threads CTA at 160x44 so a cold Chat tab no longer dead-ends before a thread is selected.

The current Chat tab-root behavior is covered by `app/mobile/screenshots/mobile-design-chat-tab-root-mocked-dark.png` and `app/mobile/screenshots/mobile-design-light-chat-tab-root-mocked.png`. The screenshots show that tapping the active Chat bottom tab from a selected thread returns to the Chat root empty state with the Browse threads CTA, matching the Runs tab-root behavior.

The current Chat thread recovery behavior is covered by `app/mobile/screenshots/mobile-design-chat-recovery-mocked-dark.png` and `app/mobile/screenshots/mobile-design-light-chat-recovery-mocked.png`. The screenshots show the thread context remaining visible when timeline sync fails, plus Retry and Threads actions at 166x44 each so phone users can recover without losing their place. The composer switches to a read-only paused state in this recovery mode, so Mobile does not offer a stale Send action against an unsynced timeline.

The current Chat send feedback behavior is covered by `app/mobile/screenshots/mobile-design-chat-send-pending-mocked-dark.png`, `app/mobile/screenshots/mobile-design-chat-send-error-mocked-dark.png`, `app/mobile/screenshots/mobile-design-chat-send-error-retry-mocked-dark.png`, `app/mobile/screenshots/mobile-design-chat-send-retry-success-mocked-dark.png`, `app/mobile/screenshots/mobile-design-light-chat-send-error-retry-mocked.png`, `app/mobile/screenshots/mobile-design-light-chat-send-retry-success-mocked.png`, and `app/mobile/screenshots/mobile-design-chat-send-success-mocked-dark.png`. The screenshots show outgoing replies entering the conversation as `Sending`, `Not sent`, or `Sent` user bubbles, the composer dock carrying the send pending/error status next to the input, the draft restored on failure, an explicit 44px `Retry` action in the failed-send status row, retry recovery after a transient Hub 503, and a local sent bubble retained until Hub replay includes the new user message across dark and light coverage.

The current Settings destructive-action guard is covered by `app/mobile/screenshots/mobile-design-settings-clear-confirm-mocked-dark.png`, `app/mobile/screenshots/mobile-design-settings-clear-error-mocked-dark.png`, `app/mobile/screenshots/mobile-design-light-settings-clear-confirm-mocked.png`, and `app/mobile/screenshots/mobile-design-light-settings-clear-error-mocked.png`. The screenshots show the Clear action opening a bottom confirmation sheet with explicit `Confirm clear` and `Cancel` controls before native session storage is changed, then keeping native clear failure feedback and the `Retry clear` action inside the sheet instead of closing to the Settings page in both dark and light coverage.

The current Account identity/readiness behavior is covered by `app/mobile/screenshots/mobile-design-settings-readiness-mocked-dark.png`, `app/mobile/screenshots/mobile-design-light-settings-readiness-mocked.png`, `app/mobile/screenshots/mobile-design-settings-readiness-tile-action-mocked-dark.png`, and `app/mobile/screenshots/mobile-design-settings-compact-feedback-mocked-dark.png`. The screenshots verify that the first Account panel renders the TokenDance logo, `AgentHub Mobile` identity copy, three compact identity chips, and immediate 44px account actions; the Runtime readiness tiles remain direct 334x54 mobile command targets, keep a visible active anchor for the most recent native action, and auto-scroll native action feedback into view on a compact 390x640 phone viewport after a tile command is triggered.

The current Settings login recovery behavior is covered by `app/mobile/screenshots/mobile-design-settings-login-recovery-mocked-dark.png` and `app/mobile/screenshots/mobile-design-light-settings-login-recovery-mocked.png`. The screenshots show TokenDance ID sign-in failure staying in the native status panel with a 44px `Retry sign in` action instead of leaving phone users to infer that they should tap the original account button again. The status panel now scrolls toward the viewport center after native action feedback, leaving room around the retry target instead of pinning it directly above the bottom navigation.

## Android Notes

- Debug APK output: `src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`
- The debug APK is large because it contains debug Rust libraries for four ABIs.
- Release build and single-ABI build are still pending and should be handled separately from UI/native bridge work.
- Android Studio JBR is the known-good Java runtime on this machine.
- `src-tauri/capabilities/default.json` grants `notification:default` for the Mobile webview notification probe.
- `src-tauri/tauri.conf.json` allows Mobile WebView connections to `http://api.hub.vectorcontrol.tech` and `ws://api.hub.vectorcontrol.tech`; the Rust `hub_request` command additionally allowlists the same Hub API prefix.

## Next Mobile Work

1. Implement TokenDance ID OIDC deep link flow with `agenthub://` and PKCE.
2. Replace secure-store stubs with Android secure storage.
3. Close the `tauri android dev` hot reload loop on port `5174`.
4. Verify Android 13+ runtime notification permission behavior on emulator/device after reinstalling the APK.
5. Align Mobile's workflow API/session contract with the deployed Hub routes so live Threads/Runs no longer depend on Edge-style `/v1/*` responses.
6. Extend `visual:qa` to cover a real Android emulator pass after the `tauri android dev` loop is stable.
