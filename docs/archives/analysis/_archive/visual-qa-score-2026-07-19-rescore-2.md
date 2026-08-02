# Visual QA rescore 2 — tip `6cf91f30`

Date: 2026-07-19
After residual #1225–#1227 / PRs #1230–#1232 (+ notes #1229)

## Score sheets

### Desktop · light · 1440×810 · SHA 6cf91f30
1 Glass 14/18  2 Hierarchy 12/14  3 Spacing 11/14  4 Type 8/10
5 Motion 8/10  6 Light 9/12  7 Dark n/a  8 A11y 6/8  9 Empty 5/6
Deductions: none   Total: **73**/100   Band: **Iterate**
Notes: Composer + chrome frost clearer; terminal empty glass card; main canvas still soft lavender flat vs white frost.

### Desktop · dark · 1440×810 · SHA 6cf91f30
1 Glass 13/18  2 Hierarchy 11/14  3 Spacing 11/14  4 Type 8/10
5 Motion 8/10  6 Light n/a  7 Dark 7/8  8 A11y 6/8  9 Empty 5/6
Deductions: none   Total: **69**/100   Band: **Block** (borderline Iterate)
Notes: Ambient under empty improved; browser preview still pure white void slab.

### Web · light · 1440×810 · SHA 6cf91f30
1 Glass 12/18  2 Hierarchy 11/14  3 Spacing 10/14  4 Type 8/10
5 Motion 7/10  6 Light 8/12  7 Dark n/a  8 A11y 6/8  9 Empty 4/6
Deductions: none   Total: **66**/100   Band: **Block**
Notes: Shell non-blank; Agents page glass landed; right browser pane pure white.

### Web · dark · 1440×810 · SHA 6cf91f30
1 Glass 12/18  2 Hierarchy 11/14  3 Spacing 10/14  4 Type 8/10
5 Motion 7/10  6 Light n/a  7 Dark 6/8  8 A11y 6/8  9 Empty 4/6
Deductions: none   Total: **64**/100   Band: **Block**
Notes: Dark ambient partial; pure white browser iframe still kills frost hierarchy.

## Gate
min(73, 69, 66, 64) = **64** → **Block** (was 61 → 55)

## Highest-weight fails next
1. Browser / preview pane pure white void (Desktop+Web)
2. Light main canvas white frost (not muddy lavender flat)
3. Web shell glass still short of Desktop workbench
