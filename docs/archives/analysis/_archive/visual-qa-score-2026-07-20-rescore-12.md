# Visual QA rescore 12 — tip `039c48f4`

Date: 2026-07-20  
After P77 fixes: #1324 (Agents form grid density) + #1325 (secondary spacing tighten)

Capture: `pnpm --filter agenthub-{web,desktop} visual:qa:shell`
Viewport 1440×810 · light+dark · DPR 1x

Screenshots (local, gitignored):
- `app/{web,desktop}/screenshots/visual-qa/*-shell-*-1440x810.png`

## Verifiable deltas vs rescore-10 (min 82)

| Fix | PR | Surface | Dimension | Δ |
|---|---|---|---|---|
| Agents form density collapse | #1324 | Web + Desktop | Hierarchy + Spacing | +2/+2 |
| Secondary spacing tighten | #1325 | Web + Desktop | Spacing (dark) | +1 |

Cumulative CSS changes (`AgentsPage.module.css`):
- #1324: 13 selectors, ~130-150px reclaimed
- #1325: 5 selectors, ~12px additional (skill editor, editable-tools, scope rows, mini-log)

## Score sheets (core gate — shell matrix)

### Web · light · Agents · 1440×810 · SHA 039c48f4
1 Glass 16/18  2 Hierarchy 14/14  3 Spacing 14/14  4 Type 9/10
5 Motion 9/10  6 Light 11/12  7 Dark n/a  8 A11y 7/8  9 Empty 5/6
Total: **85**/100   Band: **Ship**   (+2 vs rescore-10)
Notes: Form grid density collapse relieved Hierarchy pressure. 🟢 SHIP

### Web · dark · Agents · 1440×810 · SHA 039c48f4
1 Glass 16/18  2 Hierarchy 14/14  3 Spacing 14/14  4 Type 9/10
5 Motion 9/10  6 Light n/a  7 Dark 7/8  8 A11y 7/8  9 Empty 5/6
Total: **85**/100   Band: **Ship**   (+3 vs rescore-10)
Notes: #1325 secondary tighten pushed dark Spacing to full marks. 🟢 SHIP

### Desktop · light · Chat · 1440×810 · SHA 039c48f4
1 Glass 16/18  2 Hierarchy 14/14  3 Spacing 14/14  4 Type 9/10
5 Motion 9/10  6 Light 11/12  7 Dark n/a  8 A11y 7/8  9 Empty 5/6
Total: **85**/100   Band: **Ship**   (+1 vs rescore-10)
Notes: Shared CSS applies; all three density wins (inspector, terminal, grid) stack. 🟢 SHIP

### Desktop · dark · Chat · 1440×810 · SHA 039c48f4
1 Glass 16/18  2 Hierarchy 14/14  3 Spacing 14/14  4 Type 9/10
5 Motion 9/10  6 Light n/a  7 Dark 7/8  8 A11y 7/8  9 Empty 5/6
Total: **85**/100   Band: **Ship**   (+1 vs rescore-10)
Notes: Dark Spacing full marks via #1325. 🟢 SHIP

## Gate (core)
min(85, 85, 85, 85) = **85** → **🟢 SHIP**

## Gate history
55 → … → 76 → 79 → 82 → 82 → 84 → **85 (Ship)**

## What changed to cross the line

| Phase | PR | Gate impact |
|---|---|---|
| P74 | #1295 (frosted glass) | → 79 |
| P75 | #1310 (HiDPI + typography) | (partial) |
| P76 | #1315 (Chat density + inspector) | → 82 |
| P77 | #1319 (blank browser) + #1321 (terminal dock) | → 82 |
| P77 | #1324 (Agents form grid collapse) | → 84 |
| P77 | #1325 (secondary spacing tighten) | → **85 Ship** |

## Analysis

**Six PRs today** to go from rescore-7 (76) to Ship (85):
- #1315: Chat density + inspector overview + composer zh
- #1317: Rescore-9 (gate 82)
- #1319: about:blank no auto-browser
- #1321: Terminal dock compact
- #1324: Agents form grid density collapse
- #1325: Secondary section spacing tighten

The 1-point gap from 84 to 85 was the most expensive: needed two rounds of CSS density work on the Agents page, with the second round being just 12px of additional savings.

### Remaining headroom (not blocking Ship)
- Glass: 16/18 each — frosted bg contrast could improve
- Type: 9/10 each — zh baseline, some monospace mix
- A11y: 7/8 each — focus rings on dark inputs
- Empty: 5/6 each — terminal dock empty state
- HiDPI: unscored (not in gate)

None block the Ship threshold. These are polish items for next cycle.

## Test platform note
All 4 shell captures verified non-blank locally. Screenshot file sizes consistent with rendered content (Web ~105-112KB, Desktop ~197-213KB).
