# ChatView Migration — Comprehensive Action Plan

> Auto-generated 2026-06-17 | Autonomous execution mode

## Phase 1: Audit (in progress)
- [ ] Workflow `audit-demo-data-and-components` — 3 agents auditing demo modes, data contracts, component reuse
- [ ] Synthesis agent produces prioritized action list

## Phase 2: Fix P0 Blockers
- [ ] Attachment block: `String(a.attachmentRef)` → `[object Object]` — extract `.name` or `.url`
- [ ] Adapter adapter.test.ts — zero test coverage for blocksToTranscriptItems
- [ ] verify all TranscriptBlock required fields are populated in fixtures

## Phase 3: Fix P1 High Priority
- [ ] Eliminate web/desktop App.tsx duplication
- [ ] Platform adapter consolidation
- [ ] i18n key de-duplication (react-i18next + custom I18nProvider)
- [ ] CSS token unification (shared/chatview vs web/styles vs desktop/styles)
- [ ] Remove dead workbench code references
- [ ] Add adapter unit tests

## Phase 4: Fix P2 Medium Priority
- [ ] Empty state for ChatViewTranscript (transcript: [])
- [ ] 7 fallback conversations need richer fixture data
- [ ] Streaming simulation test harness
- [ ] Add missing card type coverage in mock fixtures
- [ ] Document all data contracts

## Phase 5: Fix P3 Low Priority
- [ ] Stale docs cleanup
- [ ] Naming consistency sweep
- [ ] Desktop verification (ChatView in Tauri)

## Phase 6: Edge Runtime Integration
- [ ] Desktop edge events → ChatViewTranscript streaming
- [ ] Real agent runtime transcript data testing
- [ ] Hub API → TranscriptBlock roundtrip validation
