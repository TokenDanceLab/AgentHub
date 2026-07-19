# Visual QA rescore 4 — tip `f0d8673a`

Date: 2026-07-19
After residual #1241–#1242 / PRs #1245–#1246 (+ notes #1244)

## Score sheets

### Desktop · light · 1440x810 · SHA f0d8673a
1 Glass 15/18  2 Hierarchy 12/14  3 Spacing 11/14  4 Type 8/10
5 Motion 8/10  6 Light 10/12  7 Dark n/a  8 A11y 6/8  9 Empty 5/6
Deductions: none   Total: **75**/100   Band: **Iterate**
Notes: Preview empty fill softer; composer/chrome glass; terminal empty glass.

### Desktop · dark · 1440x810 · SHA f0d8673a
1 Glass 14/18  2 Hierarchy 12/14  3 Spacing 11/14  4 Type 8/10
5 Motion 8/10  6 Light n/a  7 Dark 7/8  8 A11y 6/8  9 Empty 5/6
Deductions: none   Total: **71**/100   Band: **Iterate**
Notes: preview.example.com still paints white document (cross-origin content).

### Web · light · 1440x810 · SHA f0d8673a
1 Glass 14/18  2 Hierarchy 12/14  3 Spacing 12/14  4 Type 8/10
5 Motion 7/10  6 Light 10/12  7 Dark n/a  8 A11y 6/8  9 Empty 5/6
Deductions: none   Total: **74**/100   Band: **Iterate**
Notes: Agents page capture shows frosted list/detail chrome.

### Web · dark · 1440x810 · SHA f0d8673a
1 Glass 14/18  2 Hierarchy 12/14  3 Spacing 12/14  4 Type 8/10
5 Motion 7/10  6 Light n/a  7 Dark 7/8  8 A11y 6/8  9 Empty 5/6
Deductions: none   Total: **71**/100   Band: **Iterate**

## Gate
min(75, 71, 74, 71) = **71** -> **Iterate** (was 66 -> 64 -> 61 -> 55)

## Highest-weight fails next
1. Demo preview URL loads white external page — switch demo/fixture preview to themed about:blank / data URL
2. Agents form field density/glass residual
3. Micro-motion/a11y polish toward Ship >=85
