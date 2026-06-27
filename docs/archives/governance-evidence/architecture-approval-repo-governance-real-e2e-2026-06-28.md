# Architecture Approval - Repo Governance Real E2E Closure

Scope: #336 / T4.2 cross-review and architecture approval packet.

Date: 2026-06-28

Branch: `docs/336-architecture-approval`

## Decision

Status: approved for Phase 4 merge-readiness.

The current SPEC can proceed to #337 archive and merge-readiness preparation. No Critical or High blockers were found in the current active rule surface, project skills, real-E2E wording, or chat-flow evidence boundaries.

## Review Matrix

| Dimension | Result | Evidence |
|---|---|---|
| Structure | PASS | Root rule surface is only `AGENTS.md`; no root `CLAUDE.md` exists. `.agents/skills/` contains only the seven allowlisted active skills. |
| Docs | PASS | `pwsh ./scripts/verify-doc-ssot.ps1` -> `doc SSOT ok`. `AGENTS.md`, `docs/progress/MASTER.md`, `docs/roadmap.md`, and `docs/architecture.md` have distinct owner roles. |
| Project skills | PASS | `pwsh ./scripts/verify-project-skills.ps1` -> `project skill whitelist ok`. Archived `ui-screenshot`, `dev-team`, and `dev-team-codex` remain under `docs/archives/project-skills/` only. |
| Real E2E contract | PASS | `pwsh ./scripts/verify-real-e2e-contract.ps1` -> `real E2E contract ok`. #335 evidence records `real_tested=false` and an approved-real login readiness blocker instead of claiming real login. |
| Chat transcript cleanliness | PASS | Desktop/Web Visual QA in #335 reported `transcriptHasModeDebug=false`; Playwright specs assert mode/debug labels are not inside the transcript log. |
| Test value | PASS | #335 kept behavior-bearing gates: Desktop smoke, Web stubbed Hub Playwright, Desktop/Web Visual QA, Edge client smoke, backend perf/leak gate, P0 fixture gate, TeamRun smoke, typecheck, docs/API contract checks. |
| Packaging boundary | PASS | Tauri dry gate remains static packaged-release evidence only; installer execution, signing, updater publication, and release upload remain out of scope unless separately approved. |

## Cross-Review Findings

| Severity | Dimension | Finding | Resolution |
|---|---|---|---|
| Medium | Docs structure | `docs/archive/`, `docs/archives/`, and `docs/adr/` remain large active-tree directories. | Not a Phase 4 blocker. The user-approved next SPEC is `repo-structure-doc-tooling-cleanup`, which will migrate archives and compress ADRs after this SPEC closes. |
| Low | GitHub workflow | Issues targeting `dev/delicious233` do not auto-close when PRs merge because it is not the repository default branch. | #335 was closed manually after #357 merged. Keep this in #337 merge-readiness notes. |

No Critical or High findings.

## Evidence Commands

| Command | Result |
|---|---|
| `pwsh ./scripts/verify-doc-ssot.ps1` | PASS |
| `pwsh ./scripts/verify-project-skills.ps1` | PASS |
| `pwsh ./scripts/verify-real-e2e-contract.ps1` | PASS |
| `gh pr checks 357 -R TokenDanceLab/AgentHub --watch --interval 10` | PASS; all PR checks completed successfully after the evidence-file EOF fix. |
| `rg -n "Desktop/Web UI freeze\|UI freeze\|ui-screenshot\|dev-team-codex\|dev-team\|CLAUDE\\.md" ...` | PASS; hits are limited to AGENTS negative ownership text and verifier guardrails. |
| `rg -n "mock \\(auto fallback\\)\|demo\\+edge\|Hub replay:\|Data:\|Local Vite\|只读预览" ...` | PASS with reviewed hits; labels live in status/inspector/test assertions, and chat-flow tests assert absence from transcript logs. |

## Approval Boundaries

- This approval does not claim real TokenDance ID login, real CLI/model/API spend, production deploy, installer execution, signing, updater publication, or release upload.
- This approval does not start the repo-structure cleanup. It only confirms the current governance/real-E2E SPEC can move to #337.
- Mobile remains out of deep UI/native scope for this SPEC; existing checks only preserve the lane boundary.
