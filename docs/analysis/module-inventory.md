# Module Inventory

| Module | Responsibility | Cleanup Pressure | S.U.P.E.R Notes |
|---|---|---|---|
| `AGENTS.md` | Single project rule surface | Keep, update only if durable workflow rules change | S/U/R: good; avoid moving rules into plan docs |
| `docs/README.md` / `docs/roadmap.md` / `docs/architecture.md` | Active docs navigation, product roadmap, architecture entry | Keep short; update links after archive/ADR migration | S/U: good after prior cleanup |
| `docs/architecture/` | Current module architecture | Keep active | P/E: owns current contracts and evidence wording |
| `docs/governance/` | Current governance/security/threat docs | Keep active, no dated evidence | S: good if only owner docs remain |
| `docs/reference/` | Small current reference docs | Keep active | R: should stay short and link to external archive when history moves |
| Former history trees | Historical longform, dated material, completed SPEC artifacts, and archived skills | External TokenDance docs archive; AgentHub keeps `docs/history.md` only | S/R: source repo no longer carries history bulk |
| `docs/decisions.md` | Compact current architecture decision summary | Keep active; old ADR bodies stay in external archive | S/R: active summary is useful, body sprawl is not |
| `scripts/` | Developer, verify, smoke, release, package, evidence helpers | Keep categorized; no root wrapper files | R: callers reference typed subdirectories directly |
| `scripts/lib/evidence/` | Evidence helper scripts | Keep as evidence helper owner | P/R: approved-real scripts depend on these helpers |
| `scripts/dev/git-hooks/` | Local git hook helpers | Keep as dev setup hook path | E/R: setup scripts configure this path directly |
| `tests/fixtures/` | Deterministic fixtures | Keep stable or update references | P: already target shape |
| `tests/contract/scripts/` | Script contract tests and approved-real fixtures | Keep as the active contract path after workflow/test updates | P/R: release-readiness must watch this path |
| `.github/workflows/` | CI and release-readiness path contracts | Keep categorized script paths aligned with verifier coverage | E/R: validates migration |
| `app/desktop/src-tauri` + Desktop tests | Readiness script path contract | Keep categorized readiness path | P/E: Desktop/shared constants point to `scripts/verify/verify-edge-cli-real-readiness.ps1` |
