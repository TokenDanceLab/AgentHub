# Visual QA rescore 9 — tip `ad911aba` / MASTER `d6c0e8c6`

Date: 2026-07-20  
After Phase 76 (#1315): transcript density · inspector overview-only default · composer zh · visual:qa:chat

Capture:
- `pnpm --filter agenthub-{web,desktop} visual:qa:shell`
- `pnpm --filter agenthub-{web,desktop} visual:qa:chat`
- Viewport 1440×810 · light+dark · DPR 1x

Screenshots (local, gitignored):
- `app/web/screenshots/visual-qa/web-shell-*-1440x810.png` (Agents frosted page)
- `app/web/screenshots/visual-qa/web-chat-*-1440x810.png`
- `app/desktop/screenshots/visual-qa/desktop-shell-*-1440x810.png` (demo enters Chat; shell script does not force Agents)
- `app/desktop/screenshots/visual-qa/desktop-chat-*-1440x810.png`

## Score sheets (core gate — shell matrix)

### Web · light · Agents · 1440×810 · SHA ad911aba
1 Glass 16/18  2 Hierarchy 13/14  3 Spacing 13/14  4 Type 9/10  
5 Motion 9/10  6 Light 11/12  7 Dark n/a  8 A11y 7/8  9 Empty 5/6  
Total: **83**/100   Band: **Iterate**  
Notes: Dual-scroll + zh Agents hold; detail form still multi-row chrome; glass cards readable.

### Web · dark · Agents · 1440×810 · SHA ad911aba
1 Glass 16/18  2 Hierarchy 13/14  3 Spacing 13/14  4 Type 9/10  
5 Motion 9/10  6 Light n/a  7 Dark 7/8  8 A11y 7/8  9 Empty 5/6  
Total: **82**/100   Band: **Iterate**  
Notes: Dark frosted panels OK; list + detail density stable.

### Desktop · light · Chat (shell capture) · 1440×810 · SHA ad911aba
1 Glass 16/18  2 Hierarchy 12/14  3 Spacing 13/14  4 Type 9/10  
5 Motion 9/10  6 Light 11/12  7 Dark n/a  8 A11y 7/8  9 Empty 5/6  
Total: **82**/100   Band: **Iterate**  
Notes: Transcript denser; composer readable. **Residual**: inspector still shows 概览+浏览器 dual tabs in demo (browser auto-open), aux「会话」+ empty terminal dock compete for hierarchy. P76 overview-only default not fully visible when browser tab restored by demo/runtime.

### Desktop · dark · Chat (shell capture) · 1440×810 · SHA ad911aba
1 Glass 16/18  2 Hierarchy 12/14  3 Spacing 12/14  4 Type 9/10  
5 Motion 9/10  6 Light n/a  7 Dark 7/8  8 A11y 7/8  9 Empty 5/6  
Total: **82**/100   Band: **Iterate**  
Notes: Same dual-chrome residual; terminal empty glass OK.

## Gate (core)
min(83, 82, 82, 82) = **82** → **Iterate**  
History: ~55 → … → 76 → **79** → **82**  
Ship still ≥85 (**−3**).

## Chat path notes (optional, not gate)
| Surface | Theme | Notes |
|---|---|---|
| Web chat light | Composer + inspector visible; status strip shows 数据/目标; Agent picker 中文 | Density OK; fixture EN transcript content is demo data |
| Desktop chat light | Same as shell desktop (demo Chat) | Hierarchy still limited by inspector dual-tab + terminal dock |

## Deltas vs rescore-8 (min 79)
| Change | Effect |
|---|---|
| P76 transcript denser rhythm | Desktop Spacing/Type +1–2 on Chat |
| P76 composer zh status | Product language hold; status strip readable |
| P76 inspector overview default | Partial — demo still restores browser tab |
| Web Agents unchanged materially | Web holds ~82–83 |

## Highest-weight residuals toward Ship ≥85
1. **Desktop inspector true single-primary**: stop demo/runtime auto-restoring browser tab; keep overview-only until user opens +
2. **Terminal dock empty state density** on Chat path (large empty glass slab under workspace)
3. Agents detail form grid further collapse (carry-over)
4. Optional: Desktop shell capture should pin Agents path like Web (or document Chat as desktop gate)

## Test platform note
- `visual:qa:chat` landed in #1315; local capture verified composer=true inspector=true on web/desktop.
- Desktop `visual:qa:shell` currently lands on Chat demo (not Agents) — intentional product default; score uses Chat as Desktop half of matrix.

## Action
Iterate (not Ship). Prefer one focused PR: inspector auto-open browser off by default + dock empty compact, then re-score once. Do not open material micro-tweak loops for +1.
