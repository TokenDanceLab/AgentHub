# Self-hosted fonts (#2024)

This folder replaces the Google Fonts `<link>` tags previously loaded by
`app/web/index.html`. No request to fonts.googleapis.com / fonts.gstatic.com
remains; `app/e2e/fontBlocker.ts` keeps guarding this invariant in E2E.

## Files

| File | Family | Bytes | Source | License |
| --- | --- | --- | --- | --- |
| material-symbols-outlined.woff2 | Material Symbols Outlined (variable: wght 100..700, FILL 0..1, GRAD, opsz) | 1,127,988 | fonts.gstatic.com/s/materialsymbolsoutlined/v368/kJEPBvYX7BgnkSrUwT8OhrdQw4oELdPIeeII9v6oDMzBwG-RpA6RzaxHMPdY40KH8nGzv3fzfVJO1Q.woff2 | Apache-2.0 (LICENSE-ApACHE-2.0.txt) |
| hanken-grotesk-latin.woff2 | Hanken Grotesk (variable wght 400..800, latin subset) | 34,704 | fonts.gstatic.com/s/hankengrotesk/v12/ieVn2YZDLWuGJpnzaiwFXS9tYtpd59A.woff2 | SIL OFL 1.1 (LICENSE-OFL-1.1.txt) |
| hanken-grotesk-latin-ext.woff2 | Hanken Grotesk (variable wght 400..800, latin-ext subset) | 19,588 | fonts.gstatic.com/s/hankengrotesk/v12/ieVn2YZDLWuGJpnzaiwFXS9tYtpT59CjCQ.woff2 | SIL OFL 1.1 (LICENSE-OFL-1.1.txt) |

Fetched 2026-08-28 with a desktop Chrome user agent from the Google Fonts
css2 endpoints `family=Material+Symbols+Outlined:wght,FILL@100..700,0..1`
(v368) and `family=Hanken+Grotesk:wght@400;500;600;700;800` (v12), keeping
`font-display: swap` and the `unicode-range` subset splits in fonts.css.

Note: the Hanken Grotesk css2 response serves one variable wght file per
subset for every requested static weight (400/500/600/700/800 all share the
same URL), so two files are shipped instead of five duplicates per subset;
fonts.css declares `font-weight: 400 800` to cover the same range.

Update procedure: re-download from the URLs above, replace the files, and
update the sizes/versions in this README.
