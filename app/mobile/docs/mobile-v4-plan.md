# AgentHub Mobile v4 Plan

> Status: low-priority planning source. This document does not implement UI, change ports, start services, or define a release gate.
> Owner scope: `app/mobile/README.md`, `app/mobile/docs/**`, optional `docs/mobile/**`, and one short `docs/roadmap.md` status line.

## Positioning

Mobile v4 is a secondary AgentHub client surface. It should make remote collaboration reviewable and controllable from phones and tablets, while Desktop/Web remain the primary v4 shared workbench implementation track.

The product direction is:

- Visual and component source: AgentHub Desktop/Web v4 shared workbench plus `agenthub-design/desktop` semantics. Mobile inherits the same TokenDance/AgentHub token intent, neutral glass, compact operational density, status colors, transcript/run/approval concepts, and component vocabulary.
- Primary interaction reference: Feishu/Lark IM mobile, especially conversation density, identity badges, bottom navigation, search/new entry placement, unread handling, and recovery in context.
- Secondary interaction reference: Codex mobile chat, especially long task-thread reading, inline command/run status, bottom composer, model/permission/context chips, and stop/send action placement.
- Execution model: Hub-mediated remote control. Mobile talks to Hub and remote targets; it does not start Local Edge, own Desktop runtime orchestration, or expose local filesystem capability.
- Design model: one AgentHub design system across Desktop, Web, and Mobile. Feishu informs mobile information architecture; AgentHub Desktop/shared design owns visual hierarchy and component semantics. Mobile adapts layout, safe areas, gestures, confirmations, and native bridge behavior, but does not create a separate visual language.

## Current Boundaries

| Area | Boundary |
|---|---|
| Priority | P1/P2 planning branch; do not mix into Desktop/Web v4 gates. |
| Implementation | No UI implementation in this consolidation pass. |
| Technology direction | Expo + React Native is the recommended long-term Mobile mainline; the existing Tauri package is a frozen legacy prototype. See [mobile-expo-rn-migration-plan.md](mobile-expo-rn-migration-plan.md). |
| Dev port | Mobile is allocated `5175` as the strict preview/dev boundary; the existing app config may still need a later code slice to migrate from older local values. |
| Remote control | Mobile controls or observes Hub/Edge-mediated remote runs only through Hub contracts, approvals, stop/retry actions, and read-only evidence surfaces. |
| Identity | TokenDance ID remains the identity source. Feishu/Lark is an IM/collaboration reference and integration entry, not a second login system. |
| Design authority | AgentHub v4 shared workbench, `docs/architecture.md`, root TokenDance design docs, `app/shared/src/designTokens.ts`, and Desktop theme tokens. Feishu is reference material for mobile ergonomics, not a token or component authority. |
| Secrets | Do not document production hosts, secret paths, TokenDance API keys, provider tokens, private logs, or local operator paths. |

## Core Experience

### Phone

Phone should start from an actionable IM queue, not a scaled desktop shell:

1. Conversation list with Agent, human, group, bot, external, muted, unread, and recent-run state.
2. Thread view with messages, run steps, tool output, file changes, approvals, remote-control status, and results in one transcript.
3. Bottom composer with add/context entry, text input, send/stop, and horizontally scrollable model, permission, target, and runtime chips.
4. Run/review queue for pending approvals, active runs, failures, stopped runs, and next-review shortcuts.
5. Account/device surface for TokenDance ID session, Hub session, native bridge readiness, notification permission, language, and current device capability.

Remote-control affordances stay contextual: a thread-bound remote strip, approval bottom sheets, read-only logs/diff/file previews, stop/retry actions, and inline recovery when Hub session, WebSocket, or target reachability fails.

### Tablet

Tablet should not be a stretched phone UI:

| Viewport | Layout |
|---:|---|
| `< 700px` | Phone push-detail flow with bottom navigation. |
| `700-1023px` | Two columns: 280-320px queue plus thread; inspector and approvals use sheets. |
| `>= 1024px` | Three columns: queue, thread, inspector/remote-control/review detail. |

Tablet inspector semantics should match Desktop/Web: evidence, diff, file preview, approvals, run logs, artifact resources, and remote target status. The visual density and touch targets remain mobile-aware.

## Shared UI Reuse

Mobile v4 reuses shared semantics before inventing local UI:

- Token layer: map RN tokens from AgentHub Desktop/shared `--td-*` intent first. Add `app/mobile-rn/src/theme/tokens.ts` before feature screens and prohibit component-level hardcoded palettes.
- Shared contracts: reuse transcript, evidence, run state, approval state, surface metadata, status labels, and i18n semantics when imports are RN-safe.
- RN component layer: rewrite AgentHub component semantics as native primitives instead of importing React DOM/CSS modules. Required first primitives are Button, IconButton, Surface, Badge, StatusPill, ListRow, SearchField, SegmentedControl, BottomSheet, EmptyState, ErrorNotice, AppShell, BottomTabs, ScreenHeader, QueueList, ThreadPane, and InspectorSheet.
- Feishu-style adaptation: bottom tabs, queue density, unread/identity badges, search/new entry, contextual recovery, and sheet flows should feel mobile-native, but must use AgentHub v4 surfaces, status language, icons, and run/approval vocabulary.
- Local-only components: keep native safe-area handling, keyboard avoidance, bottom navigation, pull/retry gestures, platform bridge readiness, and mobile confirmation flow inside `app/mobile-rn`.
- Promotion rule: promote a Mobile component to `app/shared` only when at least one Desktop/Web surface can also consume it without platform assumptions.

## Mobile Design Contract

The RN app starts by defining a clean design foundation:

- `src/theme/**` owns all colors, radii, spacing, type, shadows, focus, status, light/dark/OLED-ready variants, and reduced-motion constants.
- `src/components/primitives/**` owns generic controls and must expose loading, disabled, pressed/focus, error, and long-label states.
- `src/components/layout/**` owns shell, bottom tabs, headers, queue/thread/inspector layout, safe-area behavior, and tablet split panes.
- `src/components/icons/**` owns RN-safe icon semantics aligned with shared `DesignNavIcon` names where possible.
- Screen components consume primitives and layout slots. They do not define one-off colors, new button styles, or separate typography scales.

AgentHub Desktop concepts map to Mobile as follows:

| Desktop/shared concept | Mobile RN adaptation |
|---|---|
| Global rail | Bottom tabs plus compact account/command entry |
| Conversation sidebar | Feishu-style queue list with search, unread, identity, status, and recovery rows |
| Workspace transcript | Native thread screen with message/run/tool/diff/approval blocks in one scroll flow |
| Unified composer | Keyboard-aware bottom composer dock with send/stop/context chips |
| Right inspector | Bottom sheet on phone; right pane on large tablet |
| Approval/diff/artifact cards | RN cards using the same status vocabulary and evidence-first hierarchy |
| Desktop glass surfaces | RN neutral glass-like surfaces where platform performance permits; OLED uses solid surfaces |

Design non-negotiables:

- No separate Mobile palette, rounded marketing cards, decorative gradients, or empty framed cards.
- No card nesting; use lists, panels, sheets, and compact status surfaces.
- Body text stays readable on mobile; touch targets are at least 44px.
- Agent Runtime, Agent Profile, Agent Configuration, Execution Target, TokenDance ID, and TokenDance API key wording stays aligned with AgentHub docs.
- Realistic workflow state is required before visual claims: full queue, active run, approval, diff/file preview, session failure, and send pending/error/retry.

## Visual QA Boundary

Mobile v4 visual QA must prove real mobile states, not only empty screens:

- Phone: `390x844` light and dark, no horizontal page overflow, no clipped Chinese labels, no touch targets below 44px.
- Compact phone: one shorter viewport for keyboard/recovery/action feedback.
- Tablet: `768x1024`, `1024x768`, and one `>= 1024px` three-column viewport before claiming tablet readiness.
- Required states: full IM queue, empty queue, filtered-empty queue, active remote run, pending approval, approval pending/error/resolved, remote target offline, Hub/session failure, long message, long command output, diff/file preview, send pending/error/retry, and bottom-sheet confirmation.
- Port separation: Mobile QA runs on `5175`; Desktop/Web/design comparisons remain on their own ports and should not share a running preview.

## Milestone Shape

This is a planning sequence, not a current implementation commitment:

| Milestone | Goal | Gate |
|---|---|---|
| M0 | Consolidate Mobile v4 plan and README pointer. | `git diff --check`, scoped status. |
| M1 | Expo/RN spike scaffold, design foundation, and Tauri freeze boundary. | `app/mobile-rn` starts, defines Desktop-aligned RN tokens/primitives/layout, imports only RN-safe shared contracts, and leaves `app/mobile` as legacy reference. |
| M2 | Feishu-style IM queue design and data projection. | Phone queue screenshots for full, filtered, empty, recovery, unread, muted, bot, Agent, external. |
| M3 | Codex-style thread/composer and inline run blocks. | Long-thread, send/stop, context chips, command blocks, file/diff/approval states. |
| M4 | Hub-mediated remote-control flow. | Stop/retry/approval/offline/session-failure states with confirmation sheets. |
| M5 | Tablet layout. | Two-column and three-column tablet screenshots with inspector evidence. |
| M6 | Shared UI cleanup and stale Mobile UI removal. | No active duplicate message model or second design system. |

## Verification For This Planning Slice

```powershell
git diff --check -- app/mobile/README.md app/mobile/docs/mobile-v4-plan.md docs/roadmap.md
git status --short --branch
```
