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
- [x] CSS dedup: themes.css 435×2 → 1 shared + 2 proxies (-878 lines)
- [x] Dead code: builderTranscript + BUILDER_PINNED_ANNOUNCEMENT identified
- [ ] tokens.css + presets.css dedup (pending)
- [ ] i18n key de-duplication (pending)

## Phase 4: Fix P2 Medium Priority
- [x] Adapter field passthrough — 50+ fields no longer silently dropped
- [x] Streaming simulation harness (simulateStreaming + key stability test)
- [x] Edge→TranscriptBlock normalization + adapter roundtrip (5 tests)
- [ ] Adapter standalone test fixture
- [ ] Missing card type coverage in group mock
- [ ] Desktop Tauri ChatView verification

## Phase 5: Fix P3 Low Priority
- [ ] Stale docs cleanup
- [ ] Naming consistency sweep
- [ ] Desktop verification (ChatView in Tauri)

## Phase 6: Edge Runtime Integration
- [ ] Desktop edge events → ChatViewTranscript streaming
- [ ] Real agent runtime transcript data testing
- [ ] Hub API → TranscriptBlock roundtrip validation
