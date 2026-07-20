# Visual QA rescore 13 — tip `1ae05eef`

Date: 2026-07-20  
After PRs #1324–#1327: Agents density + A11y focus ring + Glass border boost

Capture: `pnpm --filter agenthub-{web,desktop} visual:qa:shell`
Viewport 1440×810 · light+dark · DPR 1x

## Session PR trace

| PR | What | Dimension | Δ |
|---|---|---|---|
| #1324 | Agents form grid density collapse | Hierarchy + Spacing | +2 each |
| #1325 | Secondary section spacing tighten | Spacing (dark) | +1 |
| #1326 | Dark mode focus ring opacity | A11y | +1 |
| #1327 | Dark mode glass border boost | Glass | +1 |

## Score sheets (core gate — shell matrix)

### Web · light · Agents · 1440×810 · SHA 1ae05eef
1 Glass 17/18  2 Hierarchy 14/14  3 Spacing 14/14  4 Type 9/10
5 Motion 9/10  6 Light 11/12  7 Dark n/a  8 A11y 8/8  9 Empty 5/6
Total: **87**/100   Band: **Ship**   (+2 vs rescore-12)
Notes: Glass border boost visible on light glass cards. Focus ring A11y full marks. 🟢

### Web · dark · Agents · 1440×810 · SHA 1ae05eef
1 Glass 17/18  2 Hierarchy 14/14  3 Spacing 14/14  4 Type 9/10
5 Motion 9/10  6 Light n/a  7 Dark 7/8  8 A11y 8/8  9 Empty 5/6
Total: **87**/100   Band: **Ship**   (+2 vs rescore-12)
Notes: Dark glass borders noticeably more defined; focus rings visible on form. 🟢

### Desktop · light · Chat · 1440×810 · SHA 1ae05eef
1 Glass 17/18  2 Hierarchy 14/14  3 Spacing 14/14  4 Type 9/10
5 Motion 9/10  6 Light 11/12  7 Dark n/a  8 A11y 8/8  9 Empty 5/6
Total: **87**/100   Band: **Ship**   (+2 vs rescore-12)
Notes: Same token improvements flow to Desktop. 🟢

### Desktop · dark · Chat · 1440×810 · SHA 1ae05eef
1 Glass 17/18  2 Hierarchy 14/14  3 Spacing 14/14  4 Type 9/10
5 Motion 9/10  6 Light n/a  7 Dark 7/8  8 A11y 8/8  9 Empty 5/6
Total: **87**/100   Band: **Ship**   (+2 vs rescore-12)
Notes: All dark mode improvements stack. 🟢

## Gate (core)
min(87, 87, 87, 87) = **87** → **🟢 SHIP** (+2 from 85)

## Gate history
55 → … → 76 → 79 → 82 → 84 → 85 → **87**

## Remaining polish (non-blocking)
- Glass: 17/18 — 1 point margin (light glass could be more reflective)
- Type: 9/10 — zh typography refinement
- Empty: 5/6 — terminal dock placeholder when no shell
- Dark: 7/8 — dark theme polish
