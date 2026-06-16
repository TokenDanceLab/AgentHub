# ChatView Migration — Comprehensive Action Plan

> Auto-generated 2026-06-17 | Autonomous execution mode

## Phase 1: Audit ✅
- [x] Workflow `audit-demo-data-and-components` — 3 agents auditing demo modes, data contracts, component reuse
- [x] Synthesis agent produces prioritized action list
- [x] Review — 10/10 PASS (architecture, dead code, TS, CSS, I18n, adapter, integration, docs, git, server)
- [x] Demo audit — 10 findings (3 rich conversations, 5 issues found)

## Phase 2: Fix P0 Blockers ✅
- [x] Attachment block: `String(a.attachmentRef)` → extract `.name` + `.size`
- [x] Adapter adapter.test.ts — 11 tests covering all block kinds
- [x] Verify all TranscriptBlock required fields in fixtures (deploy runId added)

## Phase 3: Fix P1 High Priority ✅
- [x] ChatViewTranscript empty state ('No messages yet')
- [x] 7/10 conversations now rich fixtures (was 3/10)
- [ ] Web/desktop App.tsx duplication audit (workflow pending)
- [ ] Platform adapter consolidation (workflow pending)
- [ ] i18n key de-duplication (workflow pending)
- [ ] CSS token unification (workflow pending)

## Phase 4: Fix P2 Medium Priority (in progress)

## Phase 5: Fix P3 Low Priority
- [ ] Stale docs cleanup
- [ ] Naming consistency sweep
- [ ] Desktop verification (ChatView in Tauri)

## Phase 6: Edge Runtime Integration
- [ ] Desktop edge events → ChatViewTranscript streaming
- [ ] Real agent runtime transcript data testing
- [ ] Hub API → TranscriptBlock roundtrip validation
