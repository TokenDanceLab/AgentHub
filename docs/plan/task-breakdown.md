# Task Breakdown

> Spec: repo-structure-doc-tooling-cleanup
> Tracking mode: `GITHUB_STANDARD`

## Phases

| Phase | Goal | Tasks |
|---|---|---|
| 1 | Design and reference graph baseline | T1.1, T1.2 |
| 2 | Docs archive and ADR migration | T2.1, T2.2 |
| 3 | Scripts/tests wrapper-first migration | T3.1, T3.2 |
| 4 | Final wrapper/root hygiene cleanup | T4.1 |
| 5 | Acceptance and SPEC archive | T5.1 |

## Tasks

| ID | Task | Priority | Size | Depends | S.U.P.E.R | Acceptance |
|---|---|---|---|---|---|---|
| T1.1 | Finalize SPEC docs, GitHub tracking, and reference graph | P0 | M | none | S/U/R | `docs/analysis`, `docs/plan`, and `docs/progress/MASTER.md` exist; GitHub milestones/issues exist; no destructive cleanup. |
| T1.2 | Prepare external docs archive receiver design | P0 | M | T1.1 | S/E/R | External docs dirty state is handled by isolated worktree/branch plan; target archive layout is documented before migration. |
| T2.1 | Migrate `docs/archive` and `docs/archives` externally with `docs/history.md` | P0 | L | T1.2 | S/U/R | External archive commit receives history; AgentHub has short history index; active docs and verifiers stop depending on in-repo archive trees. |
| T2.2 | Compress `docs/adr` into `docs/decisions.md` | P0 | M | T2.1 | S/P/R | Current decisions summary exists; old ADR bodies are in external archive; active references point to `docs/decisions.md` or specific current owner docs. |
| T3.1 | Reorganize `scripts/` wrapper-first | P0 | L | T2.2 | R/E | Implementations move to `scripts/verify`, `scripts/dev`, `scripts/release`, `scripts/smoke`, `scripts/lib`; old root script paths remain wrappers and tests pass. |
| T3.2 | Reorganize `tests/scripts` to `tests/contract/scripts` | P1 | M | T3.1 | P/R | Release-readiness, verifier tests, and fixtures point to the new contract path; compatibility is documented for one PR cycle. |
| T4.1 | Remove migration wrappers and root one-off evidence | P0 | M | T3.2 | S/R | Reference graph has no old wrapper dependencies; root `css-audit-results.json` is archived or owner-justified; wrappers removed. |
| T5.1 | Run acceptance, close milestones, archive SPEC | P0 | L | T4.1 | P/E/R | Required local gates and CI pass; external archive commit is recorded; active SPEC artifacts are archived. |

## Test Expectations

- Every PR: `git diff --check`, `pwsh ./scripts/verify-doc-ssot.ps1`, `pwsh ./scripts/verify-project-skills.ps1`, `pwsh ./scripts/verify-real-e2e-contract.ps1`, OpenAPI YAML parse when active docs/verifiers change.
- Scripts/tests PRs: CI `validate`, frontend Desktop/Web gates, `go test ./tests/teamrun -count=1`, release-readiness path checks, and script contract tests.
- Archive PRs: `rg "docs/archive|docs/archives|docs/adr|ADR-"` must show only allowed index/history/code-comment references.
- Final acceptance: AgentHub active markdown limited to owner entrypoints, no tracked one-off evidence at root, CI green, external TokenDance docs archive commit exists.
