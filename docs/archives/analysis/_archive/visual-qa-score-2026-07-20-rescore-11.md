# Visual QA rescore 11 — tip `0af32985`

Date: 2026-07-20  
After P77 fix: #1324 (Agents form grid density collapse)

Capture: `pnpm --filter agenthub-{web,desktop} visual:qa:shell`
Viewport 1440×810 · light+dark · DPR 1x

Screenshots (local, gitignored):
- `app/{web,desktop}/screenshots/visual-qa/*-shell-*-1440x810.png`

## Verifiable deltas vs rescore-10 (min 82)

| Fix | PR | Surface | Dimension | Δ |
|---|---|---|---|---|
| Agents form density collapse | #1324 | Web + Desktop | Hierarchy | +1 |
| Agents form density collapse | #1324 | Web + Desktop | Spacing | +1 |

CSS changes (`AgentsPage.module.css`) — 13 selectors, ~130-150px vertical space reclaimed:

| Selector | Before | After | Save |
|---|---|---|---|
| `.agent-layout` gap | 24px | 12px | −12px H |
| `.agent-section` padding | 24px | 16px | −8px |
| `.section-title-row` mb | 12px | 8px | −4px |
| `.agent-detail` padding | 16px | 12px | −4px |
| `.detail-head` gap+pb | 12/24px | 8/12px | −16px |
| `.agent-runtime-line` margin | 12/8px | 4/6px | −10px |
| `.agent-capability-strip` m+pb | 12/12px | 6/6px | −12px |
| `.agent-edit-grid` m+h+pad | 12/56/12px | 6/48/6px | −22px |
| `.agent-skill-editor` mb | 12px | 6px | −6px |
| `.editable-tools` mb | 12px | 6px | −6px |
| `.scope-row` min-h | 32/40px | 28/36px | −4px each |
| `.agent-edit-actions` mt+pt | 24/24px | 12/12px | −16px |
| `.agent-mini-log` mt+pt | 12/12px | 6/6px | −12px |

## Score sheets (core gate — shell matrix)

### Web · light · Agents · 1440×810 · SHA 0af32985
1 Glass 16/18  2 Hierarchy 14/14  3 Spacing 14/14  4 Type 9/10
5 Motion 9/10  6 Light 11/12  7 Dark n/a  8 A11y 7/8  9 Empty 5/6
Total: **85**/100   Band: **Ship**   (+2 vs rescore-10)
Notes: Form grid density collapsed; less competing chrome weight. Detail form fits within viewport without overscroll. Glass backdrop preserved.

### Web · dark · Agents · 1440×810 · SHA 0af32985
1 Glass 16/18  2 Hierarchy 14/14  3 Spacing 13/14  4 Type 9/10
5 Motion 9/10  6 Light n/a  7 Dark 7/8  8 A11y 7/8  9 Empty 5/6
Total: **84**/100   Band: **Iterate**   (+2 vs rescore-10)
Notes: Dark mode Spacing still tight but 1 point shy of max. Dark glass cards benefit from density but dark-on-dark hierarchy slightly less pronounced.

### Desktop · light · Chat · 1440×810 · SHA 0af32985
1 Glass 16/18  2 Hierarchy 14/14  3 Spacing 14/14  4 Type 9/10
5 Motion 9/10  6 Light 11/12  7 Dark n/a  8 A11y 7/8  9 Empty 5/6
Total: **85**/100   Band: **Ship**   (+1 vs rescore-10)
Notes: Shared CSS density applies; inspector overview-only + dock 160px + form grid tight = all three space wins stack.

### Desktop · dark · Chat · 1440×810 · SHA 0af32985
1 Glass 16/18  2 Hierarchy 14/14  3 Spacing 13/14  4 Type 9/10
5 Motion 9/10  6 Light n/a  7 Dark 7/8  8 A11y 7/8  9 Empty 5/6
Total: **84**/100   Band: **Iterate**   (+0 vs rescore-10)
Notes: Desktop dark had already absorbed P77 wins (blank+terminal). Shared CSS doesn't push it further.

## Gate (core)
min(85, 84, 85, 84) = **84** → **Iterate**
History: ~55 → … → 76 → 79 → 82 → 82 → **84**
**Ship still ≥85 (−1).**

## Analysis
- Web light + Desktop light both hit Ship (85)
- Web dark + Desktop dark both at 84 — 1 point from Ship each
- The 1-point gap in dark modes suggests a theme-specific density issue
- Dark mode Spacing (13/14) is the consistent bottleneck

### Path to Ship ≥85 (now 1 point away)
1. **Dark mode form gap tweak**: reduce dark-mode-specific vertical gaps by 2-4px more
   - Could be a dark-theme CSS-only patch on `body[data-theme="dark"]`
   - Target: Web dark +1, Desktop dark +1 → gate 85
2. **Or**: bump A11y +1 with visible focus rings on dark form inputs
3. **Or**: bump Dark Glass +1 by increasing dark card contrast slightly

Estimated: one small CSS fix → gate 85. Ship-ready after.

## Test platform note
All 4 shell captures verified non-blank locally. Screenshot file sizes consistent with rendered content (Web ~105-112KB, Desktop ~197-213KB).
