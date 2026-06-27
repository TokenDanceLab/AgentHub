# Risk Assessment

## Plan Revisions After Inventory

| Original Plan Point | Revision |
|---|---|
| Move archives directly to `D:\Code\TokenDance\docs` | Do not write to the dirty main checkout directly. Use receiver worktree `D:\Code\TokenDance\.worktrees\tokendance-docs-agenthub-archive` on branch `docs/agenthub-archive-receiver`. |
| Delete history trees and ADR after migration | Only after links, verifiers, and `docs/history.md` / `docs/decisions.md` are in place. |
| Move scripts into subdirectories | Completed wrapper-first in T3.1, then migrated active callers to categorized paths in T4.1 before deleting wrappers. |
| Move legacy script contract tests | Completed in T3.2; release-readiness workflow path filters and script contract tests point to `tests/contract/scripts`. |
| Root artifact cleanup | `css-audit-results.json` was archived to TokenDanceLab/docs#3 and removed from AgentHub source root. |

## Primary Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Broken CI path references after script moves | High | Verifiers, workflows, docs, scripts, and contract tests now call categorized paths directly; CI validate is the merge gate. |
| Broken Desktop readiness path | High | Desktop/shared readiness constants and tests now point directly to `scripts/verify/verify-edge-cli-real-readiness.ps1`. |
| External docs repo dirty state absorbs unrelated changes | High | Use isolated docs worktree/branch and commit only AgentHub archive additions. |
| Archive migration breaks historical links | Medium | Keep `docs/history.md` with stable external path and update active docs to point to it. |
| ADR compression loses current decisions | Medium | `docs/decisions.md` keeps ID, status, current conclusion, owner, and validity; old bodies are archived externally. |
| Verifier drift | Medium | Update `verify-doc-ssot`, `verify-ci-gates`, project-skill verifier, and release-readiness path checks in the same PRs as path changes. |

## Evidence Boundaries

This cleanup proves repository organization, documentation ownership, wrapper path compatibility, and CI/path contract health. It does not prove real login, real model/API spend, packaged Desktop sidecars/icons/installers, signing, release upload, or production deployment.
