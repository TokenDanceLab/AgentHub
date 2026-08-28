# Self-hosted fonts (#2024)

This folder replaces the Google Fonts `<link>` tags previously loaded by
`app/desktop/index.html`, so Material Symbols ligature icons render offline
in the packaged shell. No request to fonts.googleapis.com / fonts.gstatic.com
remains; `app/e2e/fontBlocker.ts` keeps guarding this invariant in E2E.
Web additionally self-hosts Hanken Grotesk (see app/web/public/fonts/).

## Files

| File | Family | Bytes | Source | License |
| --- | --- | --- | --- | --- |
| material-symbols-outlined.woff2 | Material Symbols Outlined (variable: wght 100..700, FILL 0..1, GRAD, opsz) | 1,127,988 | fonts.gstatic.com/s/materialsymbolsoutlined/v368/kJEPBvYX7BgnkSrUwT8OhrdQw4oELdPIeeII9v6oDMzBwG-RpA6RzaxHMPdY40KH8nGzv3fzfVJO1Q.woff2 | Apache-2.0 (LICENSE-ApACHE-2.0.txt) |

Fetched 2026-08-28 with a desktop Chrome user agent from the Google Fonts
css2 endpoint `family=Material+Symbols+Outlined:wght,FILL@100..700,0..1`
(v368), keeping `font-display: swap` in fonts.css.

Update procedure: re-download from the URL above, replace the file, and
update the size/version in this README.
