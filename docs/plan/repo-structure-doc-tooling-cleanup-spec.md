# Repo Structure Doc Tooling Cleanup SPEC

> Initial plan written before source/doc inventory. This file must be validated against current repository references before any destructive cleanup.

## Objective

Converge AgentHub back to a current product source repository: active docs stay short and canonical; historical longform, old ADR bodies, one-off evidence, and stale SPEC artifacts move to the cross-repository archive under `D:\Code\TokenDance\docs`; scripts and tests are reorganized only through a reference-safe migration.

## Non-Negotiable Order

1. Do not batch delete directories before the reference graph is known.
2. Keep `dev/delicious233` as the baseline and work only from isolated worktrees.
3. Treat `D:\Code\TokenDance\docs` as a separate Git repository; inspect and isolate its dirty state before moving archive material.
4. Keep old script paths as wrappers for one migration PR cycle, then delete wrappers only after no references remain.
5. Do not reintroduce a giant active rule document. Stable project rules live in `AGENTS.md`; current SPEC progress lives in `docs/progress/MASTER.md`; overall roadmap lives in `docs/roadmap.md`.

## Target Shape

Active AgentHub `docs/` should converge toward:

```text
docs/
├── README.md
├── roadmap.md
├── architecture.md
├── decisions.md
├── history.md
├── architecture/
├── governance/
└── reference/
```

Migration targets:

- Move AgentHub history trees to the TokenDance docs external archive and keep only a short source-repo index.
- Replace in-repo archive trees with a short `docs/history.md` index.
- Compress old ADR bodies into `docs/decisions.md`; move old ADR full text to the external archive.
- Reshape `scripts/` into `scripts/verify/`, `scripts/dev/`, `scripts/release/`, `scripts/smoke/`, and `scripts/lib/` with temporary forwarding entrypoints first.
- Reshape `tests/` into `tests/fixtures/`, `tests/contract/`, and `tests/integration/`.
- Classify `css-audit-results.json` as either active owner artifact or historical evidence.

## Proposed Phases

| Phase | Goal | Destructive? |
|---|---|---|
| 1 | Inventory and migration design | No |
| 2 | External archive boundary and link plan | No |
| 3 | Docs archive/ADR migration with short indices | Yes, after links/verifiers are updated |
| 4 | Scripts/tests staged restructure with wrappers | Yes, wrapper-first |
| 5 | Wrapper removal and final hygiene | Yes, after reference graph is clean |
| 6 | Acceptance, E2E/contract verification, archive SPEC | No |

## Required Acceptance

- `git diff --check`
- `pwsh ./scripts/verify/verify-doc-ssot.ps1`
- `pwsh ./scripts/verify/verify-project-skills.ps1`
- `pwsh ./scripts/verify/verify-real-e2e-contract.ps1`
- For scripts/tests reshape: CI `validate`, Web/Desktop frontend gates, `go test ./tests/teamrun -count=1`, release-readiness path checks.
- For archive migration: reference scan with only allowed current-index references remaining.
- Final: AgentHub active markdown is limited to current owner entrypoints; no tracked one-off evidence remains at root; CI is green; `D:\Code\TokenDance\docs` receives the corresponding archive commit.

## Information To Collect Before Finalizing

- Current AgentHub root/docs/scripts/tests inventory and tracked root artifacts.
- Reference graph for history trees, ADRs, script paths, and `tests/` paths.
- Current verifier and CI references to script/test/doc paths.
- Current state of `D:\Code\TokenDance\docs` and whether a clean receiver branch/worktree is required.
- Current GitHub tracking mode, milestone/issue plan, and project-scope availability.

## Initial Risk Register

| Risk | Mitigation |
|---|---|
| Breaking CI by moving scripts | Move implementation first, keep wrappers, update references in small PRs. |
| Breaking docs links by moving archive material | Generate reference graph and update links before deleting in-repo archive trees. |
| Polluting external docs repo | Inspect `D:\Code\TokenDance\docs` status first; use an isolated branch/worktree or stop if it cannot be isolated. |
| Losing audit trace | Move history to external archive and leave `docs/history.md` with durable pointers. |
| Creating another docs giant | Keep active docs as indices and owner summaries only. |
