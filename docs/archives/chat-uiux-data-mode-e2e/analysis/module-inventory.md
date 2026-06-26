# Chat UIUX Data Mode E2E Module Inventory

| Module | Responsibility | Dependencies | Complexity | S.U.P.E.R Score |
|---|---|---|---|---|
| `app/shared/src/demo/dataMode.ts` | Product data-mode contract and capability flags | none beyond shared TS | Medium | S🟡 U🟢 P🟡 E🟢 R🟡 |
| `app/shared/src/testing/e2eDataModeContract.ts` | Pure E2E scenario/request boundary contract | shared dataMode | Medium | S🟢 U🟢 P🟢 E🟢 R🟡 |
| `app/shared/src/transcript/*` | Normalize Hub/Edge/thread events into `TranscriptBlock` | shared types | High | S🟡 U🟢 P🟢 E🟢 R🟡 |
| `app/shared/src/chatview/*` | Render `TranscriptBlock` through shared card/bubble UI | React, i18n, Markdown | High | S🟡 U🟢 P🟡 E🟢 R🟡 |
| `app/shared/src/workbench/ConversationHost.tsx` | Composer, optimistic user blocks, transcript bridge | platform port, composer, transcript | High | S🟡 U🟡 P🟢 E🟢 R🟡 |
| `app/desktop/src/App.tsx` | Desktop entry/workbench composition and Edge health status | Desktop hooks, shared workbench | High | S🟡 U🟡 P🟡 E🟡 R🟡 |
| `app/desktop/src/hooks/useHealth.ts` | Local Edge health polling | Edge client, config | Low | S🟢 U🟢 P🟡 E🟢 R🟢 |
| `app/desktop/src/platform/useDesktopWorkbenchModel.ts` | Desktop workbench data source selection | Edge hooks, Hub hooks, dataMode | High | S🟡 U🟡 P🟡 E🟡 R🟡 |
| `app/web/src/App.tsx` | Web workbench composition and auth/modal entry | Hub auth, shared workbench | Medium | S🟡 U🟢 P🟡 E🟢 R🟡 |
| `app/web/src/platform/useWebWorkbenchModel.ts` | Hub session/runtime replay model | Hub client/query hooks, shared transcript | High | S🟡 U🟢 P🟡 E🟢 R🟡 |
| `app/desktop/src/__e2e__/chat-flow-ui.spec.ts` | Desktop visible chat-flow and boundary E2E | Playwright, shared E2E contract | Medium | S🟡 U🟡 P🟢 E🟢 R🟡 |
| `app/web/src/__e2e__/*` | Web Hub replay/chat-flow E2E | Playwright, Hub stubs, shared E2E contract | Medium | S🟡 U🟢 P🟢 E🟢 R🟡 |

## Hotspots

### Desktop Entry And Runtime Split

- `App.tsx` intentionally enables `useHealth` during entry preflight.
- `DesktopWorkbenchApp` uses workbench mode to decide whether Edge health should continue.
- E2E currently has no phase marker, so allowed entry requests are misclassified as mock runtime violations.

### Data Mode Contract

- `dataMode.ts` is useful but overloaded: it expresses mock/fixture availability, Hub allowance, Local Edge fallback, auth requirements, and strict-real semantics.
- E2E should not add more product semantics into Playwright specs directly. A small shared test contract is the right port.

### Shared Chat Rendering

- `ConversationHost` owns optimistic pending user blocks and removes them only after matching confirmed messages.
- `Transcript` owns auto-follow; Playwright should protect this because regressions are user-visible.
- `AgentGroup`/`RowItem` own merged card stacks and markdown bubbles; Web E2E should protect table rendering and tool call/result pairing.

## S.U.P.E.R Notes

- Highest priority P/R improvement: make the E2E boundary contract phase-aware without coupling it to Playwright.
- Highest priority U improvement: keep all platform data normalized into `TranscriptBlock` before shared chat rendering.
- Highest priority S improvement: keep mode/status metadata out of message bubble rendering.
