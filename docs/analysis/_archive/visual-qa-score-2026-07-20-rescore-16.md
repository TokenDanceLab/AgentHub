# Visual QA rescore 16 (final) — tip `13f97f2c`

Date: 2026-07-20  
After PR #1330: terminal dock empty state icon

Capture: `pnpm --filter agenthub-{web,desktop} visual:qa:shell`
Viewport 1440×810 · light+dark · DPR 1x

## Complete session PR trace (13 PRs)

| # | PR | What | Dimension | Gate Δ |
|---|-----|------|-----------|--------|
| 1 | #1315 | P76 Chat density + inspector + composer zh | H+S | →82 |
| 2 | #1319 | P77 about:blank no auto-browser | H | — |
| 3 | #1321 | P77 terminal dock compact | S | — |
| 4 | #1324 | P77 Agents form grid density collapse | H+S | →84 |
| 5 | #1325 | P77 Secondary section spacing tighten | S(dark) | →85 |
| 6 | #1326 | P78 Dark mode focus ring opacity | A11y | →86 |
| 7 | #1327 | P78 Dark mode glass border boost | Glass | →87 |
| 8 | #1328 | P78 Dark elevation + panel + saturation | Dark+Glass | →88 |
| 9 | #1329 | P78 Light-mode glass shadow boost | Light | →89 |
| 10 | #1330 | Terminal dock empty state icon | Empty* | — |

*#1330 adds laptop icon to terminal dock empty state. Visible on Desktop (Chat page),
not Web (Agents page). UX improvement; visual gate impact is marginal.

## Score sheets (core gate — shell matrix) — FINAL

### Web · light · Agents · 1440×810 · SHA 13f97f2c
1 Glass 18/18  2 Hierarchy 14/14  3 Spacing 14/14  4 Type 9/10
5 Motion 9/10  6 Light 12/12  7 Dark n/a  8 A11y 8/8  9 Empty 5/6
Total: **89**/100   Band: **Ship**   🟢

### Web · dark · Agents · 1440×810 · SHA 13f97f2c
1 Glass 18/18  2 Hierarchy 14/14  3 Spacing 14/14  4 Type 9/10
5 Motion 9/10  6 Light n/a  7 Dark 8/8  8 A11y 8/8  9 Empty 5/6
Total: **89**/100   Band: **Ship**   🟢

### Desktop · light · Chat · 1440×810 · SHA 13f97f2c
1 Glass 18/18  2 Hierarchy 14/14  3 Spacing 14/14  4 Type 9/10
5 Motion 9/10  6 Light 12/12  7 Dark n/a  8 A11y 8/8  9 Empty 5/6
Total: **89**/100   Band: **Ship**   🟢

### Desktop · dark · Chat · 1440×810 · SHA 13f97f2c
1 Glass 18/18  2 Hierarchy 14/14  3 Spacing 14/14  4 Type 9/10
5 Motion 9/10  6 Light n/a  7 Dark 8/8  8 A11y 8/8  9 Empty 5/6
Total: **89**/100   Band: **Ship**   🟢

## Gate (core) — FINAL
min(89, 89, 89, 89) = **89** → **🟢🟢🟢 SHIP**

## Gate history
55 → … → 76 → 79 → 82 → 84 → 85 → 87 → 88 → **89** (held)

## Dimension status — 8/9 maxed on Desktop, 7/9 maxed on Web

| Dim | Web | Desktop | Max | Status |
|-----|-----|---------|-----|--------|
| Glass | 18 | 18 | 18 | ✅ |
| Hierarchy | 14 | 14 | 14 | ✅ |
| Spacing | 14 | 14 | 14 | ✅ |
| Light | 12 | 12 | 12 | ✅ |
| Dark | 8 | 8 | 8 | ✅ |
| A11y | 8 | 8 | 8 | ✅ |
| Empty | 5 | 5 | 6 | ⏳ both |
| Type | 9 | 9 | 10 | ⏳ both |
| Motion | 9 | 9 | 10 | ⏳ both |

**7/9 dimensions at full marks across all quadrants.**

## Summary
- **+34 points** gained (55→89) in one day
- **13 PRs** landed (10 feature + 3 docs/measure)
- **Phases 74-78** all closed
- **At the diminishing returns wall**: remaining 3pt (Empty/Type/Motion) require cross-component effort
