# ChatView Migration — Comprehensive Action Plan

> 2026-06-17 10:30 | **STATUS: HARDENING (Round 6)** — 37 commits, ~13.5K lines net cleaned, 6 workflow rounds, 45 tests, 0 TS errors.
> Since last COMPLETE mark (d7f2bff0): +11 commits fixing dark mode, i18n unification, CSS polish, layout bugs, React key dedup.
> Remaining: 7 items (5 P2, 2 P3) — all non-blocking.

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
- [x] tokens.css + presets.css dedup — presets 1027 shared + 15 platform, tokens 300 shared + 3 web + 1 desktop
- [x] i18n key de-duplication — unified to single react-i18next system, -618 lines (old custom provider + translations.ts removed)

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

## Phase 6: Round 6 Fixes (Discovered Post-"Complete") ✅

11 additional commits after the d7f2bff0 "plan marked complete" — CSS polish, i18n unification, layout bugs, dark mode restoration.

- [x] **Dark mode tokens restored** — ChatView cards no longer rendering white in dark mode (ThemeProvider removed, AgentHub theme now handles dark mode directly)
- [x] **i18n unified to single react-i18next system** — -618 lines: removed custom I18nProvider, translations.ts (412 lines), DesignSystemProvider, ThemeProvider, tokens-dark.css; added i18next-format resources.ts (179 lines) with `chatview` namespace; wired via `useTranslation('chatview')` in RowItem, UserMsg, ChatViewTranscript
- [x] **i18n: zh tool names unified** — no more mixed Chinese/English labels in tool cards
- [x] **CSS: tool card labels use sans-serif** — consistency with think card labels
- [x] **CSS: mono removed from tool body, file labels, deploy URL** — readability improvement
- [x] **Fixtures: all think blocks `isThinking: false`** — completed conversation state, no stray loading spinners
- [x] **Layout: ChatView wrapped in `.transcriptRegion` scroll container** — transcript now scrolls independently
- [x] **Layout: transcript padding reduced** — avatar closer to edge, removed double-layered `.transcript` padding
- [x] **ChatView: duplicate React keys fixed** — tool_call/tool_result merge logic corrected
- [x] **ChatView: per-conversation chatMode** — DM vs Group layout determined per conversation, not globally
- [x] **Adapter: 22 `as any` removed** — full type safety (done in earlier commits 7553cfaa..1f066a57)
- [x] **CSS token hardening** — 44 semantic spacing tokens in RowItem.css, dead RunGroup + inline styles removed

## Phase 7: Edge Runtime Integration
- [ ] Desktop edge events → ChatViewTranscript streaming
- [ ] Real agent runtime transcript data testing
- [ ] Hub API → TranscriptBlock roundtrip validation
