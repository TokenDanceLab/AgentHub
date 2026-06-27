# Task Breakdown

> Spec-driven run: repo governance, real E2E acceptance, source/architecture alignment.
> Confirmed scope: user continued the active goal after Phase 1; proceed with P0+P1 foundation first, then execute source/test cleanup by task.
> Tracking mode: `GITHUB_STANDARD`.

## Overview

- **Total Phases**: 4
- **Total Tasks**: 14
- **Estimated Total Effort**: XL
- **Strategy**: governance-first, evidence-contract-first, then source/test execution. This avoids hiding UI/backend/client defects behind stale docs or ambiguous "real E2E" wording.

## S.U.P.E.R Design Constraints

- **S (Single Purpose)**: every doc, skill, script, and test must have one owner and one purpose. Do not add another parallel truth source when an existing canonical file can be corrected.
- **U (Unidirectional Flow)**: instructions point from `AGENTS.md` to skills and docs; skills do not override AGENTS; roadmap/architecture consume evidence, not vice versa.
- **P (Ports over Implementation)**: real E2E claims must map to evidence levels and structured manifests, not informal prose.
- **E (Environment-Agnostic)**: Vite renderer, packaged Tauri, local Edge, stubbed Hub, observed local, and approved-real paths must be labeled separately.
- **R (Replaceable Parts)**: scripts and docs should be replaceable without changing source behavior; tests protect behavior or policy contracts, not implementation strings.

## Testing and Governance Constraints

- Feature/code tasks must update relevant tests. Docs-only tasks must run at least `git diff --check`, stale-wording searches, and affected policy verifiers.
- Visual QA must include desktop-like 16:9 viewports for Desktop/Web claims and mobile viewports only when responsive behavior is claimed.
- Stubbed or fixture evidence must say `real_tested=false` and must not be described as real login, real model/API, packaged Desktop, or production deploy.
- Performance/leak acceptance requires targeted benchmark/load/pprof/leak evidence plus a behavior gate for the same path.
- Durable agent behavior changes update `AGENTS.md`, active project skills, or the active `docs/progress/MASTER.md` when they affect the current SPEC. Do not create repo-local memory files unless explicitly selected.

## Phase 1: Governance Baseline

**Goal**: remove stale active rules, obsolete branch/worktree references, old skill exposure, and generated-artifact noise before implementing broader test or source changes.
**Prerequisite**: Phase 1 analysis docs complete.
**S.U.P.E.R Focus**: S, U, R.

| # | Task | Priority | Effort | Depends On | Lane | S.U.P.E.R | Test Expectation | Memory Impact | Acceptance Criteria |
|:--|:--|:--|:--|:--|:--|:--|:--|:--|:--|
| T1.1 | Normalize branch/worktree governance | P0 | M | - | A | S, U, R | Docs-only; run stale branch search and `git status --short --branch; git worktree list` | Update instruction surfaces if branch rules change | `AGENTS.md` and `docs/governance/branch-governance.md` no longer contain active-looking `dev/delicious223`, deleted worktrees, or old feature branches; live-state rule is canonical. |
| T1.2 | Normalize document standards and active/archive rules | P0 | M | - | B | S, U, R | Docs-only; run stale doc-structure search and `git diff --check` | Update `AGENTS.md` if workflow rule changes | `docs/governance/document-standards.md`, `docs/README.md`, and `AGENTS.md` agree: active spec work uses `docs/progress/MASTER.md`; completed spec artifacts go to `docs/archives/`; stale long-lived docs are replaced or deleted, not duplicated. |
| T1.3 | Add useful project-skill whitelist verification | P1 | M | T1.1, T1.2 | C | P, R | Add/adjust a focused verifier or documented command; avoid testing archived skill internals | Update instruction surfaces if verifier becomes required | Active `.agents/skills` exactly matches the AGENTS whitelist; archived `ui-screenshot`, `dev-team`, `dev-team-codex` are not loadable active skills; verifier fails on drift without scanning private state. |
| T1.4 | Clean generated artifact hygiene | P1 | S | - | D | S, E | Run generated-artifact search and `git diff --check` | None unless recurring rule changes | Tracked generated bundle artifact noise such as `app/desktop/stats.html` is removed or justified; ignore/documentation rules prevent reintroducing dist, coverage, node_modules, bundle stats, logs, sqlite/db artifacts. |

### Parallel Lanes

| Lane | Tasks | Combined Effort | Merge Risk | Key Files |
|:--|:--|:--|:--|:--|
| A | T1.1 | M | Medium | `AGENTS.md`, `docs/governance/branch-governance.md` |
| B | T1.2 | M | Medium | `docs/governance/document-standards.md`, `docs/README.md`, `AGENTS.md` |
| C | T1.3 | M | Medium | `.agents/skills/`, `scripts/`, `AGENTS.md` |
| D | T1.4 | S | Low | `.gitignore`, generated artifacts, docs governance |

## Phase 2: Real E2E Contract

**Goal**: make "real E2E" a project-level contract across docs, skills, scripts, Playwright, Visual QA, backend/API, performance, and packaged Desktop gates.
**Prerequisite**: Phase 1 active governance baseline.
**S.U.P.E.R Focus**: P, E, R.

| # | Task | Priority | Effort | Depends On | Lane | S.U.P.E.R | Test Expectation | Memory Impact | Acceptance Criteria |
|:--|:--|:--|:--|:--|:--|:--|:--|:--|:--|
| T2.1 | Make evidence-level matrix canonical | P0 | M | T1.2 | A | P, R | Docs-only plus stale "real" wording scan | Update `AGENTS.md`/workflow docs if canonical entry changes | `real-e2e-acceptance` remains the operational SOP; `workflow-standard`, roadmap/architecture references, and release docs use one evidence vocabulary: fixture, Playwright UI, Visual QA, stubbed Hub, observed local, approved-real, backend/API, performance/leak, packaged release. |
| T2.2 | Split data mode, surface, auth, and execution axes | P0 | L | T2.1 | B | S, P, E | Add/update shared contract tests if source changes; docs-only otherwise | Update instruction surfaces if mode rule changes | Demo, Fixture, Local, Login/Hub, Observed, and Approved-Real are documented without overloading `dataMode`; entry preflight and workbench runtime phases have separate backend boundary expectations. |
| T2.3 | Align E2E smoke matrix and manifests | P1 | M | T2.1 | C | P, E | Update script tests or run `verify-e2e-smoke-matrix.ps1`; no fake real paths | None unless verifier contract changes | Smoke matrix emits structured evidence boundaries and cannot imply real login/model/API/package when run as stub/fixture/preflight. |
| T2.4 | Normalize Visual QA acceptance | P1 | M | T2.1 | D | P, E | Run/update Desktop/Web visual chat-flow checks; validate 16:9 desktop and responsive coverage | None | Visual QA scripts and docs clearly separate geometry/screenshot proof from data correctness; no debug/mock/mode metadata appears inside transcript bubbles. |

### Parallel Lanes

| Lane | Tasks | Combined Effort | Merge Risk | Key Files |
|:--|:--|:--|:--|:--|
| A | T2.1 | M | Medium | `.agents/skills/real-e2e-acceptance/SKILL.md`, `docs/governance/workflow-standard.md`, `AGENTS.md` |
| B | T2.2 | L | High | `app/shared`, `app/desktop`, `app/web`, `docs/architecture/04-frontend-data-flow.md` |
| C | T2.3 | M | Medium | `scripts/verify-e2e-smoke-matrix.ps1`, package scripts, CI docs |
| D | T2.4 | M | Medium | `app/desktop/scripts`, `app/web/scripts`, Playwright specs |

## Phase 3: Source And Test Alignment

**Goal**: connect front-end, backend, client, performance/leak, and packaging tests to the real contracts from Phase 2.
**Prerequisite**: Phase 2 evidence contract.
**S.U.P.E.R Focus**: S, U, P, E, R.

| # | Task | Priority | Effort | Depends On | Lane | S.U.P.E.R | Test Expectation | Memory Impact | Acceptance Criteria |
|:--|:--|:--|:--|:--|:--|:--|:--|:--|:--|
| T3.1 | Harden chat transcript behavior tests | P0 | L | T2.2, T2.4 | A | S, P, R | Shared unit/contract + Desktop/Web Playwright + Visual QA | None unless transcript invariant becomes agent rule | User messages render immediately without disappearing; agent cards group correctly; markdown/table render; chronological ordering and auto-follow are covered by meaningful tests. |
| T3.2 | Align frontend architecture docs to shared implementation | P1 | M | T3.1 | A | S, U, R | Docs and source-reference scan; no broad snapshots | None | `docs/architecture.md` and `docs/architecture/04-frontend-data-flow.md` describe current shared workbench/chat/data-mode reality without stale ChatView phase banners. |
| T3.3 | Classify backend/API performance and leak gates | P0 | L | T2.1 | B | P, E | Run focused Go tests/benchmarks or document exact blockers; no broad fake load claims | Update instruction surfaces if new gate is required | Hub/Edge performance/leak acceptance has a concrete command matrix for EventBus/outbox/scheduler/Redis TTL, Edge lifecycle/store/adapters, and API handlers. |
| T3.4 | Check Desktop packaged evidence boundary | P1 | M | T2.1 | C | P, E | Run package readiness/dry gates only if claiming package behavior; otherwise mark not tested | None | Desktop icon/sidecar/sqlite/WebView/installer claims are either proven by Tauri package gates or explicitly out of scope. |
| T3.5 | Align Web/Mobile/client test lanes | P1 | M | T2.1 | D | U, E, R | Run focused Web and Mobile verification commands or record blockers | None | Web no-Local-Edge, Mobile RN-safe shared contracts, and client QA commands are mapped to claims without duplicating mock-only tests. |

### Parallel Lanes

| Lane | Tasks | Combined Effort | Merge Risk | Key Files |
|:--|:--|:--|:--|:--|
| A | T3.1, T3.2 | L+M | High | `app/shared`, `app/desktop`, `app/web`, architecture docs |
| B | T3.3 | L | Medium | `hub-server`, `edge-server`, `scripts`, CI docs |
| C | T3.4 | M | Medium | `app/desktop/src-tauri`, package scripts, release readiness docs |
| D | T3.5 | M | Medium | `app/web`, `app/mobile-rn`, shared contracts |

## Phase 4: Acceptance And Merge Readiness

**Goal**: verify the combined work, record evidence boundaries, and prepare the branch for architecture/workflow review and merge back to `dev/delicious233`.
**Prerequisite**: Phase 3 tasks complete or explicitly deferred with evidence.
**S.U.P.E.R Focus**: P, E, R.

| # | Task | Priority | Effort | Depends On | Lane | S.U.P.E.R | Test Expectation | Memory Impact | Acceptance Criteria |
|:--|:--|:--|:--|:--|:--|:--|:--|:--|:--|
| T4.1 | Run focused acceptance gate bundle | P0 | L | T3.1, T3.3, T3.4, T3.5 | A | P, E | Run selected docs/API/frontend/backend/visual/package/perf gates based on touched surfaces | None | Evidence table lists commands, pass/fail, artifact paths, and explicit not-tested boundaries. |
| T4.2 | Cross-review and architecture approval packet | P0 | M | T4.1 | B | R | Review diff scope, stale wording, source/docs alignment, and test value | None | Review packet shows no duplicate truth sources, no stale active skills, no debug transcript pollution, no false real-E2E claims. |
| T4.3 | Merge-readiness and archive preparation | P1 | M | T4.2 | C | R | `git diff --check`, status, issue/milestone/progress sync | Update native memory only if durable rules changed and user explicitly requests | `docs/progress/MASTER.md`, GitHub issues, milestones, and archive plan are current; branch is ready for PR/merge decision. |

### Parallel Lanes

| Lane | Tasks | Combined Effort | Merge Risk | Key Files |
|:--|:--|:--|:--|:--|
| A | T4.1 | L | Medium | test outputs, scripts, docs |
| B | T4.2 | M | Low | review docs/progress |
| C | T4.3 | M | Low | `docs/progress/MASTER.md`, `docs/archives/README.md` |
