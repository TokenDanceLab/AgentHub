# AgentHub Mobile v4 Plan

> Status: low-priority planning source. This document does not implement UI, change ports, start services, or define a release gate.
> Owner scope: `app/mobile/README.md`, `app/mobile/docs/**`, optional `docs/mobile/**`, and one short `docs/roadmap.md` status line.

## Positioning

Mobile v4 is a secondary AgentHub client surface. It should make remote collaboration reviewable and controllable from phones and tablets, while Desktop/Web remain the primary v4 shared workbench implementation track.

The product direction is:

- Primary reference: Feishu/Lark IM mobile, especially conversation density, identity badges, bottom navigation, search/new entry placement, unread handling, and recovery in context.
- Secondary reference: Codex mobile chat, especially long task-thread reading, inline command/run status, bottom composer, model/permission/context chips, and stop/send action placement.
- Execution model: Hub-mediated remote control. Mobile talks to Hub and remote targets; it does not start Local Edge, own Desktop runtime orchestration, or expose local filesystem capability.
- Design model: one AgentHub design system across Desktop, Web, and Mobile. Mobile adapts layout, safe areas, gestures, confirmations, and native bridge behavior, but does not create a separate visual language.

## Current Boundaries

| Area | Boundary |
|---|---|
| Priority | P1/P2 planning branch; do not mix into Desktop/Web v4 gates. |
| Implementation | No UI implementation in this consolidation pass. |
| Dev port | Mobile is allocated `5175` as the strict preview/dev boundary; the existing app config may still need a later code slice to migrate from older local values. |
| Remote control | Mobile controls or observes Hub/Edge-mediated remote runs only through Hub contracts, approvals, stop/retry actions, and read-only evidence surfaces. |
| Identity | TokenDance ID remains the identity source. Feishu/Lark is an IM/collaboration reference and integration entry, not a second login system. |
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

- Token layer: map Mobile CSS through `--td-*` design tokens; add aliases before hardcoding colors, radii, shadows, or focus states.
- Shared contracts: reuse transcript, evidence, run state, approval state, surface metadata, status labels, and i18n semantics.
- Stable shared components: prefer shared empty states, status notices, badges, bottom sheets, segmented controls, activity cards, code/file previews, and TokenDance mark where they fit Mobile ergonomics.
- Local-only components: keep native safe-area handling, keyboard avoidance, bottom navigation, pull/retry gestures, platform bridge readiness, and mobile confirmation flow inside `app/mobile`.
- Promotion rule: promote a Mobile component to `app/shared` only when at least one Desktop/Web surface can also consume it without platform assumptions.

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
| M1 | Port and QA harness alignment for `5175`. | Mobile dev/preview starts on `5175`; QA scripts target `5175`. |
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
