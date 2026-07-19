# Visual QA rescore 5 — tip `89fb96d1`

Date: 2026-07-19
After #1247 demo preview themed blank (#1250)

## Score sheets

### Desktop · light · 1440x810 · SHA 89fb96d1
1 Glass 16/18  2 Hierarchy 13/14  3 Spacing 11/14  4 Type 8/10
5 Motion 8/10  6 Light 11/12  7 Dark n/a  8 A11y 6/8  9 Empty 5/6
Total: **78**/100   Band: **Iterate**
Notes: about:blank themed soft tint; frosted chrome/composer/terminal empty.

### Desktop · dark · 1440x810 · SHA 89fb96d1
1 Glass 14/18  2 Hierarchy 12/14  3 Spacing 11/14  4 Type 8/10
5 Motion 8/10  6 Light n/a  7 Dark 6/8  8 A11y 6/8  9 Empty 5/6
Total: **70**/100   Band: **Iterate**
Notes: URL about:blank but document pure white in capture before #1251.

### Web · light · 1440x810 · SHA 89fb96d1
1 Glass 14/18  2 Hierarchy 12/14  3 Spacing 12/14  4 Type 8/10
5 Motion 7/10  6 Light 10/12  7 Dark n/a  8 A11y 6/8  9 Empty 5/6
Total: **74**/100   Band: **Iterate**
Notes: Agents page frosted capture.

### Web · dark · 1440x810 · SHA 89fb96d1
1 Glass 14/18  2 Hierarchy 12/14  3 Spacing 12/14  4 Type 8/10
5 Motion 7/10  6 Light n/a  7 Dark 7/8  8 A11y 6/8  9 Empty 5/6
Total: **71**/100   Band: **Iterate**

## Gate
min(78, 70, 74, 71) = **70** → **Iterate** (was 71 → 66 → 64 → 61 → 55)
Ship still >=85.

## Highest-weight fails next
1. Dark about:blank document pure white (#1251)
2. Density/form glass residual on Agents detail
3. Micro-motion/a11y polish toward Ship
