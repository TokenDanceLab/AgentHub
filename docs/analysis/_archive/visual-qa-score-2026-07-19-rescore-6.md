# Visual QA rescore 6 — tip `88ddc886`

Date: 2026-07-19
After residual #1261–#1263 / PRs #1265–#1267 (+ MASTER #1268)

## Score sheets

### Desktop · light · 1440x810 · SHA 88ddc886
1 Glass 16/18  2 Hierarchy 13/14  3 Spacing 12/14  4 Type 8/10
5 Motion 9/10  6 Light 11/12  7 Dark n/a  8 A11y 7/8  9 Empty 5/6
Total: **81**/100   Band: **Iterate**
Notes: denser list/mainchain; terminal empty glass; themed about:blank; chrome motion tokens.

### Desktop · dark · 1440x810 · SHA 88ddc886
1 Glass 16/18  2 Hierarchy 13/14  3 Spacing 12/14  4 Type 8/10
5 Motion 9/10  6 Light n/a  7 Dark 7/8  8 A11y 7/8  9 Empty 5/6
Total: **77**/100   Band: **Iterate**
Notes: dark blank themed; terminal dock glass; still short of Ship frosted product polish.

### Web · light · 1440x810 · SHA 88ddc886
1 Glass 14/18  2 Hierarchy 12/14  3 Spacing 12/14  4 Type 8/10
5 Motion 7/10  6 Light 10/12  7 Dark n/a  8 A11y 6/8  9 Empty 4/6
Total: **73**/100   Band: **Iterate**
Notes: Agents capture; installed list empty pane still flat void; form glass improved (#1255).

### Web · dark · 1440x810 · SHA 88ddc886
1 Glass 14/18  2 Hierarchy 12/14  3 Spacing 12/14  4 Type 8/10
5 Motion 7/10  6 Light n/a  7 Dark 7/8  8 A11y 6/8  9 Empty 4/6
Total: **70**/100   Band: **Iterate**
Notes: same empty installed list void; nav hover still solid surface.

## Gate
min(81, 77, 73, 70) = **70** → **Iterate** (history ~55→…→~75→70 web-bound)
Ship still >=85.

## Highest-weight fails next
1. Agents installed empty list pane flat void (Web capture primary)
2. Agents nav-row hover + residual surface chrome
3. Optional: dual shell capture (workbench chat + Agents) for balanced gate
