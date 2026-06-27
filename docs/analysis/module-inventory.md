# Module Inventory

| Module | Responsibility | Cleanup Pressure | S.U.P.E.R Notes |
|---|---|---|---|
| `AGENTS.md` | Single project rule surface | Keep, update only if durable workflow rules change | S/U/R: good; avoid moving rules into plan docs |
| `docs/README.md` / `docs/roadmap.md` / `docs/architecture.md` | Active docs navigation, product roadmap, architecture entry | Keep short; update links after archive/ADR migration | S/U: good after prior cleanup |
| `docs/architecture/` | Current module architecture | Keep active | P/E: owns current contracts and evidence wording |
| `docs/governance/` | Current governance/security/threat docs | Keep active, no dated evidence | S: good if only owner docs remain |
| `docs/reference/` | Small current reference docs | Keep active | R: should stay short and link to external archive when history moves |
| `docs/archive/` | Historical longform and dated material | Move to external TokenDance docs archive; replace with `docs/history.md` | S: currently mixed into source repo |
| `docs/archives/` | Completed SPEC artifacts and archived skills | Move to external TokenDance docs archive; keep history index only | R: currently large but useful as history |
| `docs/adr/` | ADR body files and README summary | Compress to `docs/decisions.md`; old bodies move external | S/R: active summary is useful, body sprawl is not |
| `scripts/` | Developer, verify, smoke, release, package, evidence helpers | Reorganize wrapper-first into typed subdirs | R: many direct references require staged migration |
| `scripts/evidence/` | Evidence helper scripts | Preserve under `scripts/lib/` or `scripts/verify/` based on owner | P/R: avoid breaking approved-real scripts |
| `scripts/git-hooks/` | Local git hook helpers | Likely keep under `scripts/dev/git-hooks/` or `scripts/lib/git-hooks/` with wrapper | E/R: path used by hook docs/scripts |
| `tests/fixtures/` | Deterministic fixtures | Keep stable or update references | P: already target shape |
| `tests/scripts/` | Script contract tests and approved-real fixtures | Move to `tests/contract/scripts/` with workflow/test updates | P/R: release-readiness currently watches old path |
| `.github/workflows/` | CI and release-readiness path contracts | Update only with wrappers and verifier coverage | E/R: validates migration |
| `app/desktop/src-tauri` + Desktop tests | Readiness script path contract | Update only if wrappers or new path are proven | P/E: hard-coded `scripts/verify-edge-cli-real-readiness.ps1` appears in source and tests |
