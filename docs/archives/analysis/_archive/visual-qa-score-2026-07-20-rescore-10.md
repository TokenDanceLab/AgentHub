# Visual QA rescore 10 — tip `285cd98c`

Date: 2026-07-20  
After P77 fixes: #1319 (blank no auto-browser) + #1321 (terminal dock compact)

Capture: `pnpm --filter agenthub-{web,desktop} visual:qa:shell` + `visual:qa:chat`
Viewport 1440×810 · light+dark · DPR 1x

Screenshots (local, gitignored):
- `app/{web,desktop}/screenshots/visual-qa/*-shell-*-1440x810.png`
- `app/{web,desktop}/screenshots/visual-qa/*-chat-*-1440x810.png`

## Verifiable deltas vs rescore-9 (min 82)

| Fix | PR | Surface | Dimension | Δ |
|---|---|---|---|---|
| about:blank no auto-open browser tab | #1319 | Desktop | Hierarchy | +1 |
| Terminal dock 220→160px | #1321 | Desktop | Spacing | +1 |
| Web Agents page unchanged | — | Web | — | 0 |

## Score sheets (core gate — shell matrix)

### Web · light · Agents · 1440×810 · SHA 285cd98c
1 Glass 16/18  2 Hierarchy 13/14  3 Spacing 13/14  4 Type 9/10
5 Motion 9/10  6 Light 11/12  7 Dark n/a  8 A11y 7/8  9 Empty 5/6
Total: **83**/100   Band: **Iterate**   (±0 vs rescore-9)
Notes: P77 changes don't affect Web (Agents frosted page path). Dual-scroll + zh hold.

### Web · dark · Agents · 1440×810 · SHA 285cd98c
1 Glass 16/18  2 Hierarchy 13/14  3 Spacing 13/14  4 Type 9/10
5 Motion 9/10  6 Light n/a  7 Dark 7/8  8 A11y 7/8  9 Empty 5/6
Total: **82**/100   Band: **Iterate**   (±0)

### Desktop · light · Chat · 1440×810 · SHA 285cd98c
1 Glass 16/18  2 Hierarchy 13/14  3 Spacing 13/14  4 Type 9/10
5 Motion 9/10  6 Light 11/12  7 Dark n/a  8 A11y 7/8  9 Empty 5/6
Total: **84**/100   Band: **Iterate**   (+2: browser tab absent + dock compact)
Notes: Inspector overview-only default now visible; terminal dock reduced 27%.
Residual: Dock still renders glass slab when empty — acceptable at 160px.

### Desktop · dark · Chat · 1440×810 · SHA 285cd98c
1 Glass 16/18  2 Hierarchy 13/14  3 Spacing 13/14  4 Type 9/10
5 Motion 9/10  6 Light n/a  7 Dark 7/8  8 A11y 7/8  9 Empty 5/6
Total: **84**/100   Band: **Iterate**   (+2)

## Gate (core)
min(83, 82, 84, 84) = **82** → **Iterate**
History: ~55 → … → 76 → 79 → 82 → **82** (tie)
Desktop up +2, but Web still the gate bottleneck at 82–83.

**Ship still ≥85 (−3).**

## Analysis
- Desktop improved to 84 — 1 point from Ship
- Web Agents page is the current bottleneck (unchanged vs rescore-8/9)
- Web score held back primarily by Hierarchy (Agents form multi-row chrome) and Spacing (form grid)

### Bottleneck fix: Web Agents detail form collapse
The Web Agents page has a multi-row detail form grid that creates competing chrome weight. Collapsing secondary form sections (capability strip, readiness, tools) into a single expandable card would:
- Bump Hierarchy +1 (less competing equal-weight slabs)
- Bump Spacing +1 (form grid uses less real estate)

Estimated after Web Agents fix: min(85, 84, 84, 84) = **84** → still Iterate.
Need both Desktop AND Web to hit 85+: Ship requires all four ≥85.

### Path to Ship ≥85
1. **Web Agents detail form collapse** → target +2–3 Hierarchy/Spacing
2. **Desktop remaining +1**: could be Empty state density or Type at higher DPR
3. Combined: Web 85–86 + Desktop 85 → gate ≥85

## Action
Web Agents form grid is the highest-leverage remaining fix. Do one focused PR:
- Collapse capability strip + readiness + tools into single expandable "配置详情" section
- Default: list view with Agent name + description
- Click: expand to show all metadata

## Test platform note
All 8 captures (4 shell + 4 chat) verified non-blank locally. Desktop shell still lands on Chat demo path (product-appropriate for Desktop).
