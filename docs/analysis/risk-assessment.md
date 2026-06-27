# Risk Assessment

## Plan Revisions After Inventory

| Original Plan Point | Revision |
|---|---|
| Move archives directly to `D:\Code\TokenDance\docs` | Do not write to the dirty main checkout directly. Use an isolated docs repo worktree/branch, or stage only new archive files with explicit status checks. |
| Delete `docs/archive`, `docs/archives`, `docs/adr` after migration | Only after links, verifiers, and `docs/history.md` / `docs/decisions.md` are in place. |
| Move scripts into subdirectories | Must be wrapper-first. CI, docs, tests, Desktop readinessScript, and package scripts reference root script paths. |
| Move `tests/scripts` | Must update release-readiness workflow path filters and script contract tests. |
| Root artifact cleanup | `css-audit-results.json` should move to historical evidence unless a current owner is discovered. |

## Primary Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Broken CI path references after script moves | High | First PR moves implementations and keeps root wrappers; second PR deletes wrappers after reference scan passes. |
| Broken Desktop readiness path | High | Preserve `scripts/verify-edge-cli-real-readiness.ps1` wrapper until Desktop source/tests are intentionally updated. |
| External docs repo dirty state absorbs unrelated changes | High | Use isolated docs worktree/branch and commit only AgentHub archive additions. |
| Archive migration breaks historical links | Medium | Keep `docs/history.md` with stable external path and update active docs to point to it. |
| ADR compression loses current decisions | Medium | `docs/decisions.md` keeps ID, status, current conclusion, owner, and validity; old bodies are archived externally. |
| Verifier drift | Medium | Update `verify-doc-ssot`, `verify-ci-gates`, project-skill verifier, and release-readiness path checks in the same PRs as path changes. |

## Evidence Boundaries

This cleanup proves repository organization, documentation ownership, wrapper path compatibility, and CI/path contract health. It does not prove real login, real model/API spend, packaged Desktop sidecars/icons/installers, signing, release upload, or production deployment.
