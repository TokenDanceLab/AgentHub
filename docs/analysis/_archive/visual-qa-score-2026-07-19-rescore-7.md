# Visual QA rescore 7 — tip `8282447a`

Date: 2026-07-19
After residual #1275–#1277 / PR #1276 (dual-scroll + Chinese-first Agents)

## Score sheets

### Desktop · light · 1440×810 · SHA 8282447a
1 Glass 16/18  2 Hierarchy 13/14  3 Spacing 12/14  4 Type 8/10
5 Motion 9/10  6 Light 11/12  7 Dark n/a  8 A11y 7/8  9 Empty 5/6
Total: **81**/100   Band: **Iterate**
Notes: chat workbench frost stable; terminal empty glass; themed about:blank; no Agents list regression on Desktop shell path.

### Desktop · dark · 1440×810 · SHA 8282447a
1 Glass 16/18  2 Hierarchy 13/14  3 Spacing 12/14  4 Type 8/10
5 Motion 9/10  6 Light n/a  7 Dark 7/8  8 A11y 7/8  9 Empty 5/6
Total: **77**/100   Band: **Iterate**
Notes: dark chrome holds; still short of Ship product polish on transcript density.

### Web · light · 1440×810 · SHA 8282447a
1 Glass 16/18  2 Hierarchy 13/14  3 Spacing 12/14  4 Type 8/10
5 Motion 8/10  6 Light 11/12  7 Dark n/a  8 A11y 7/8  9 Empty 5/6
Total: **80**/100   Band: **Iterate**
Notes: Agents installed dual-scroll keeps 3 list rows in viewport; Chinese-first stats/meta; AgentSpec dump removed; role free of Runtime/Model stuffing; status shows 就绪.

### Web · dark · 1440×810 · SHA 8282447a
1 Glass 16/18  2 Hierarchy 13/14  3 Spacing 12/14  4 Type 8/10
5 Motion 8/10  6 Light n/a  7 Dark 7/8  8 A11y 7/8  9 Empty 5/6
Total: **76**/100   Band: **Iterate**
Notes: same dual-scroll + zh copy lift; capability chips still dense but product language.

## Gate
min(81, 77, 80, 76) = **76** → **Iterate**
History: ~55 → 61 → 64 → 66 → 71 → 70 → ~75 → 70 → **76** (web list void fixed)
Ship still ≥85.

## Highest-weight residuals next
1. Detail panel still multi-card dense (capability strip + summary + form) — thin toward one primary card
2. Proper-noun EN remains (Codex / openai / model ids) — keep; avoid engineering EN microcopy
3. Dual capture matrix (chat workbench + Agents) if gate stays shell-path bound
4. Desktop chat transcript density / frosted Ship polish
