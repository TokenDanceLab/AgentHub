# Visual QA rescore 8 — tip `db2c2ec7`

Date: 2026-07-20  
After Wave1–2: #1280 detail density · #1283 terminal dock columns · #1284–#1287 test platform

Capture: `pnpm --filter agenthub-{web,desktop} visual:qa:shell` · 1440×810 · light+dark  
Screenshots (local, gitignored): `app/{web,desktop}/screenshots/visual-qa/*-shell-*-1440x810.png`

## Score sheets

### Desktop · light · 1440×810 · SHA db2c2ec7
1 Glass 16/18  2 Hierarchy 13/14  3 Spacing 13/14  4 Type 8/10  
5 Motion 9/10  6 Light 11/12  7 Dark n/a  8 A11y 7/8  9 Empty 5/6  
Total: **82**/100   Band: **Iterate**  
Notes: Frosted shell + inspector hold; terminal dock sits under workspace+inspector (not over channel cards). Conversation density still busy; inspector multi-card stack leaves Ship on table.

### Desktop · dark · 1440×810 · SHA db2c2ec7
1 Glass 16/18  2 Hierarchy 13/14  3 Spacing 12/14  4 Type 8/10  
5 Motion 9/10  6 Light n/a  7 Dark 7/8  8 A11y 7/8  9 Empty 5/6  
Total: **79**/100   Band: **Iterate**  
Notes: Dark translucent chrome OK; terminal empty glass readable; transcript/inspector still dense.

### Web · light · 1440×810 · SHA db2c2ec7
1 Glass 16/18  2 Hierarchy 13/14  3 Spacing 13/14  4 Type 9/10  
5 Motion 8/10  6 Light 11/12  7 Dark n/a  8 A11y 7/8  9 Empty 5/6  
Total: **82**/100   Band: **Iterate**  
Notes: Agents dual-scroll keeps three installed rows in viewport; Chinese-first stats/meta; detail single primary card (no AgentSpec dump / no Runtime stuffing); capability strip denser. Form grid still multi-row chrome.

### Web · dark · 1440×810 · SHA db2c2ec7
1 Glass 16/18  2 Hierarchy 13/14  3 Spacing 12/14  4 Type 9/10  
5 Motion 8/10  6 Light n/a  7 Dark 7/8  8 A11y 7/8  9 Empty 5/6  
Total: **79**/100   Band: **Iterate**  
Notes: Same Agents layout lift; dark frosted panels + chip readiness readable.

## Gate
min(82, 79, 82, 79) = **79** → **Iterate**  
History: ~55 → 61 → 64 → 66 → 71 → 70 → ~75 → 70 → 76 → **79**  
Ship still ≥85 (−6).

## Deltas vs rescore-7 (min 76)
| Change | Effect |
|---|---|
| #1283 dock not over sidebar | Desktop Hierarchy/Spacing +1–2 |
| #1280 detail density | Web Hierarchy/Spacing +1–2 |
| #1275–#1277 dual-scroll + zh copy (already in tip) | Web Type/Empty hold |
| Test platform #1284–#1287 | No direct score pts; regression net |

## Highest-weight residuals toward Ship ≥85
1. Desktop chat inspector + transcript density (still multi-slab)
2. Agents detail form grid — further collapse secondary sections
3. Optional dual capture matrix if chat path lags Agents path
4. Desktop visual:qa:shell path-filter CI (Web-only today)

## Test platform note
Geometry smoke + zh copy contract + path-filter non-blank shell CI now guard the failure modes that previously required manual rescore discovery.
