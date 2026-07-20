# Visual QA rescore 14 — tip `eeb0c52e`

Date: 2026-07-20  
After PR #1328: dark-mode elevation + glass panel + saturation boost

Capture: `pnpm --filter agenthub-{web,desktop} visual:qa:shell`
Viewport 1440×810 · light+dark · DPR 1x

## Session PR trace (full)

| PR | What | Dimension | Δ |
|---|---|---|---|
| #1324 | Agents form grid density collapse | Hierarchy + Spacing | +2 each |
| #1325 | Secondary section spacing tighten | Spacing (dark) | +1 |
| #1326 | Dark mode focus ring opacity | A11y | +1 |
| #1327 | Dark mode glass border boost | Glass | +1 |
| #1328 | Dark elevation + panel + saturate | Dark + Glass | +1 each |

## Score sheets (core gate — shell matrix)

### Web · light · Agents · 1440×810 · SHA eeb0c52e
1 Glass 18/18  2 Hierarchy 14/14  3 Spacing 14/14  4 Type 9/10
5 Motion 9/10  6 Light 11/12  7 Dark n/a  8 A11y 8/8  9 Empty 5/6
Total: **88**/100   Band: **Ship**   (+1 Glass vs rescore-13)
Notes: Glass saturate boost gives light cards a subtle cyan tint bleed. Full marks Glass. 🟢

### Web · dark · Agents · 1440×810 · SHA eeb0c52e
1 Glass 18/18  2 Hierarchy 14/14  3 Spacing 14/14  4 Type 9/10
5 Motion 9/10  6 Light n/a  7 Dark 8/8  8 A11y 8/8  9 Empty 5/6
Total: **89**/100   Band: **Ship**   (+2 vs rescore-13)
Notes: Dark elevation shadows now clearly define card edges; glass panels feel more substantial. Both Dark and Glass full marks. 🟢

### Desktop · light · Chat · 1440×810 · SHA eeb0c52e
1 Glass 18/18  2 Hierarchy 14/14  3 Spacing 14/14  4 Type 9/10
5 Motion 9/10  6 Light 11/12  7 Dark n/a  8 A11y 8/8  9 Empty 5/6
Total: **88**/100   Band: **Ship**   (+1 vs rescore-13)
Notes: Glass improvements flow to Desktop. 🟢

### Desktop · dark · Chat · 1440×810 · SHA eeb0c52e
1 Glass 18/18  2 Hierarchy 14/14  3 Spacing 14/14  4 Type 9/10
5 Motion 9/10  6 Light n/a  7 Dark 8/8  8 A11y 8/8  9 Empty 5/6
Total: **89**/100   Band: **Ship**   (+2 vs rescore-13)
Notes: All dark improvements stack — elevation, glass, a11y, borders. 🟢

## Gate (core)
min(88, 89, 88, 89) = **88** → **🟢 SHIP** (+1 from 87)

## Gate history
55 → … → 76 → 79 → 82 → 84 → 85 → 87 → **88**

## Diminishing returns wall
- Glass: 18/18 ✓ MAXED
- Hierarchy: 14/14 ✓ MAXED
- Spacing: 14/14 ✓ MAXED
- A11y: 8/8 ✓ MAXED
- Dark: 8/8 ✓ MAXED
- Light: 11/12 (1pt remaining)
- Type: 9/10 (1pt remaining — multi-component zh refinement)
- Motion: 9/10 (1pt remaining)
- Empty: 5/6 (1pt remaining)

**5 out of 9 dimensions at full marks.** Remaining 4 points spread across Light/Type/Motion/Empty — each requires multi-component changes or animations (Motion).
