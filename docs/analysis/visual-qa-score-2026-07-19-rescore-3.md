# Visual QA rescore 3 — tip `9c19e98f`

Date: 2026-07-19
After residual #1233–#1235 / PRs #1238–#1240 (+ notes #1237)

## Score sheets

### Desktop · light · 1440×810 · SHA 9c19e98f
1 Glass 15/18  2 Hierarchy 12/14  3 Spacing 11/14  4 Type 8/10
5 Motion 8/10  6 Light 10/12  7 Dark n/a  8 A11y 6/8  9 Empty 5/6
Deductions: none   Total: **75**/100   Band: **Iterate**
Notes: Whiter canvas + glass chrome/composer/preview frame; terminal empty glass; not yet Ship frosted product.

### Desktop · dark · 1440×810 · SHA 9c19e98f
1 Glass 14/18  2 Hierarchy 12/14  3 Spacing 11/14  4 Type 8/10
5 Motion 8/10  6 Light n/a  7 Dark 7/8  8 A11y 6/8  9 Empty 5/6
Deductions: none   Total: **71**/100   Band: **Iterate**
Notes: Ambient + glass panels good; iframe document still pure white (content void).

### Web · light · 1440×810 · SHA 9c19e98f
1 Glass 13/18  2 Hierarchy 11/14  3 Spacing 11/14  4 Type 8/10
5 Motion 7/10  6 Light 9/12  7 Dark n/a  8 A11y 6/8  9 Empty 4/6
Deductions: none   Total: **69**/100   Band: **Block**
Notes: Catch-up landed in many web modules; shell capture still workbench-dominant; browser white void remains.

### Web · dark · 1440×810 · SHA 9c19e98f
1 Glass 13/18  2 Hierarchy 11/14  3 Spacing 11/14  4 Type 8/10
5 Motion 7/10  6 Light n/a  7 Dark 6/8  8 A11y 6/8  9 Empty 4/6
Deductions: none   Total: **66**/100   Band: **Block**
Notes: Same hierarchy hit from pure white preview document.

## Gate
min(75, 71, 69, 66) = **66** → **Block** (was 64 → 61 → 55)

## Highest-weight fails next
1. Preview iframe document void (mock blank page fill / empty-state inside frame)
2. Web shell capture path still under-represents frosted page modules
3. Residual density/spacing in terminal dock + inspector empty
