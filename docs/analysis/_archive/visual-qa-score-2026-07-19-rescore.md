# Visual QA rescore — tip `540b9808`

Date: 2026-07-19
Captures: desktop+web light/dark 1440×810 via `visual:qa:shell`
Prior residual landed: #1221 shell frost · #1222 main glass · #1223 web capture

## Score sheets

### Desktop · light · 1440×810 · SHA 540b9808
1 Glass 13/18  2 Hierarchy 11/14  3 Spacing 11/14  4 Type 8/10
5 Motion 8/10  6 Light 9/12  7 Dark n/a  8 A11y 6/8  9 Empty 4/6
Deductions: none (left rails removed)   Total: **70**/100   Band: **Iterate**
Notes: White frost stronger on chrome; composer capsule glass visible; empty transcript still sparse flat center; hierarchy improved vs pre-residual ~58.

### Desktop · dark · 1440×810 · SHA 540b9808
1 Glass 12/18  2 Hierarchy 10/14  3 Spacing 11/14  4 Type 8/10
5 Motion 8/10  6 Light n/a  7 Dark 6/8  8 A11y 6/8  9 Empty 4/6
Deductions: none   Total: **65**/100   Band: **Block** (borderline; treat as Iterate residual)
Notes: Translucent panels better; empty main still heavy void; dark hairlines improved.

### Web · light · 1440×810 · SHA 540b9808
1 Glass 11/18  2 Hierarchy 10/14  3 Spacing 10/14  4 Type 8/10
5 Motion 7/10  6 Light 8/12  7 Dark n/a  8 A11y 6/8  9 Empty 4/6
Deductions: none   Total: **64**/100   Band: **Block**
Notes: Non-blank shell (was ~15KB); Agents/list chrome still flatter than Desktop demo workbench; glass tokens apply but page modules lag.

### Web · dark · 1440×810 · SHA 540b9808
1 Glass 11/18  2 Hierarchy 10/14  3 Spacing 10/14  4 Type 8/10
5 Motion 7/10  6 Light n/a  7 Dark 5/8  8 A11y 6/8  9 Empty 4/6
Deductions: none   Total: **61**/100   Band: **Block**
Notes: Capture fixed; material still short of frosted product on list/page surfaces.

## Gate
min(70, 65, 64, 61) = **61** → **Block** (improved from ~55–58; still need residual peels)

## Highest-weight fails (next Issues)
1. Empty transcript / welcome center glass + density (Desktop+Web)
2. Web page modules (Agents/Contacts/Tasks list chrome) glass alignment to workbench shell
3. Dark main canvas ambient (reduce pure void under empty)
4. Optional: strengthen light frost on remaining solid surfaces in page routes
