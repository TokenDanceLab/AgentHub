# Real Foundation Hardening - Task Breakdown

## Confirmed Task Definition

Establish a clean, real engineering foundation for Desktop/Web AgentHub chat: shared transcript correctness, optimistic send, linear ordering, card grouping, markdown/table rendering, clean UI without debug/mock pollution, honest data/execution boundaries, and a useful E2E + Visual QA acceptance loop. Mobile remains boundary-only.

## Overview

- **Total Phases**: 5
- **Total Tasks**: 16
- **Estimated Total Effort**: XL
- **Tracking Mode**: GITHUB_STANDARD

## S.U.P.E.R Design Constraints

- **S**: Keep transcript normalization, rendering, E2E stubbing, Visual QA metrics, and evidence packaging as separate responsibilities.
- **U**: Preserve source -> normalizer -> `TranscriptBlock[]` -> ChatView -> DOM. UI must not reach into Hub/Edge internals.
- **P**: New cross-layer behavior needs typed/serializable contracts or manifest fields before implementation.
- **E**: Vite, stubbed Hub, observed local, approved-real, and packaged Desktop are different environments and must not share claims.
- **R**: Prefer shared helpers and fixtures that Desktop/Web can reuse without forking components.

## Testing And Governance Constraints

- Chat workflow changes require shared Vitest plus Desktop/Web Playwright.
- Visual changes require Visual QA metrics and screenshots; screenshots alone are not acceptance.
- Stubbed/fixture/readiness gates must write `real_tested=false`.
- No debug/mode/mock labels may be added to main transcript bubbles/cards.
- No root script wrappers; scripts remain under `scripts/verify/`, `scripts/dev/`, `scripts/release/`, `scripts/smoke/`, or app-local scripts.
- Durable future-agent rules go to `AGENTS.md` only; current progress goes to `docs/progress/MASTER.md`.

## Phase 1: Evidence Contract Foundation

**Goal**: Make the acceptance target machine-honest before changing product behavior.
**Prerequisite**: SPEC analysis accepted.
**S.U.P.E.R Focus**: P, U, E.

| # | Task | Priority | Effort | Depends On | Lane | S.U.P.E.R | Test Expectation | Memory Impact | Acceptance Criteria |
|:--|:--|:--|:--|:--|:--|:--|:--|:--|:--|
| T1.1 | Define chat-flow evidence manifest contract | P0 | M | - | A | P,E | Add/update unit tests for manifest validation | Update memory only if a durable evidence invariant emerges | Manifest records surface, evidence level, data source, auth/execution, `real_tested`, screenshots, metrics, and commands |
| T1.2 | Align Visual QA viewports and report shape | P0 | M | T1.1 | A | P,E,R | Update app visual scripts and verifier tests | None unless command changes become stable rules | Desktop/Web chat Visual QA use 1440x810; stale 1440x920 active references removed or justified |
| T1.3 | Reuse data-mode boundary helper in acceptance gates | P0 | S | T1.1 | B | U,P,R | Shared/unit tests plus affected Playwright assertions | None | E2E request assertions are phase-aware and do not duplicate mode switch logic |
| T1.4 | Document the evidence bundle without rule duplication | P1 | S | T1.1 | B | S,P | Docs-only; run doc SSOT and real-e2e contract verifiers | None | `docs/architecture.md`/`docs/roadmap.md` link to the bundle; rules remain in `AGENTS.md` and skill |

### Parallel Lanes

| Lane | Tasks | Combined Effort | Merge Risk | Key Files |
|:--|:--|:--|:--|:--|
| A | T1.1, T1.2 | L | Medium | `app/*/scripts/*chat-flow*`, `scripts/verify/*`, shared testing files |
| B | T1.3, T1.4 | M | Low | `app/shared/src/testing/`, docs |

## Phase 2: Shared Chat Timeline Hardening

**Goal**: Fix the user-visible chat flow contract at the shared layer first.
**Prerequisite**: Phase 1 manifest/Visual QA contract.
**S.U.P.E.R Focus**: S, U, P, R.

| # | Task | Priority | Effort | Depends On | Lane | S.U.P.E.R | Test Expectation | Memory Impact | Acceptance Criteria |
|:--|:--|:--|:--|:--|:--|:--|:--|:--|:--|
| T2.1 | Add golden mixed-source transcript fixtures | P0 | M | T1.3 | A | U,P,R | Shared Vitest golden tests | None | Hub user message, Edge tool call/result, agent reply, subagent/inspector detail, markdown table order is deterministic |
| T2.2 | Harden optimistic send and auto-follow contract | P0 | M | T2.1 | A | U,R | Shared auto-scroll tests plus Desktop/Web E2E | None | User send appears immediately, never flashes away, and scroll follows submit without stealing scrollback |
| T2.3 | Harden card grouping and rounded-stack rules | P0 | M | T2.1 | B | S,R | Shared render/CSS tests plus Desktop Playwright geometry | None | Consecutive related cards merge visually; inner radii collapse; unrelated cards stay distinct |
| T2.4 | Keep markdown/table rendering and debug filtering clean | P0 | S | T2.1 | B | S,P | Shared render tests plus Web Playwright | None | Markdown tables render; mode/mock/runtime diagnostics do not appear in transcript bubbles |

### Parallel Lanes

| Lane | Tasks | Combined Effort | Merge Risk | Key Files |
|:--|:--|:--|:--|:--|
| A | T2.1, T2.2 | L | Medium | `app/shared/src/transcript/`, `app/shared/src/chatview/`, app E2E |
| B | T2.3, T2.4 | M | Medium | ChatView components/CSS/tests |

## Phase 3: Desktop/Web Boundary And Backend Truth

**Goal**: Keep product mode, data source, auth, and execution truth separate across Desktop/Web.
**Prerequisite**: Phase 2 shared timeline stable.
**S.U.P.E.R Focus**: U, P, E.

| # | Task | Priority | Effort | Depends On | Lane | S.U.P.E.R | Test Expectation | Memory Impact | Acceptance Criteria |
|:--|:--|:--|:--|:--|:--|:--|:--|:--|:--|
| T3.1 | Web Hub-only guarded-flow check | P0 | M | T2.2 | A | U,E | Web Playwright + data-mode contract | None | Web never direct-calls Local Edge and does not silently fall back to mock after Hub guard |
| T3.2 | Desktop entry-preflight vs workbench-runtime split | P0 | M | T1.3 | B | U,E | Desktop Playwright request-phase assertions | None | Desktop may probe Local Edge health on entry, but Demo workbench performs no Hub/Edge runtime requests |
| T3.3 | Observed/approved-real manifest boundary | P1 | M | T1.1 | C | P,E | Verifier tests and manifest fixture tests | Update `AGENTS.md` only if an agent-facing rule changes | Stubbed and readiness manifests cannot claim real login, CLI/model/API, packaged Desktop, or release |

### Parallel Lanes

| Lane | Tasks | Combined Effort | Merge Risk | Key Files |
|:--|:--|:--|:--|:--|
| A | T3.1 | M | Low | `app/web/src/__e2e__/`, Web adapter |
| B | T3.2 | M | Low | `app/desktop/src/__e2e__/`, Desktop adapter |
| C | T3.3 | M | Medium | `scripts/verify/`, tests/contracts |

## Phase 4: Real E2E And Visual QA Closure

**Goal**: Turn tests into a repeatable acceptance loop for agents and CI.
**Prerequisite**: Phase 3 boundaries stable.
**S.U.P.E.R Focus**: S, P, E, R.

| # | Task | Priority | Effort | Depends On | Lane | S.U.P.E.R | Test Expectation | Memory Impact | Acceptance Criteria |
|:--|:--|:--|:--|:--|:--|:--|:--|:--|:--|
| T4.1 | Add focused chat acceptance gate | P0 | M | T2.2,T2.3,T3.1,T3.2 | A | S,P,R | Script/verifier tests plus actual Desktop/Web commands | None | One command/report lists shared unit, Desktop/Web Playwright, Visual QA, and evidence boundaries |
| T4.2 | Add semi-automated Visual QA artifact loop | P0 | M | T1.2,T4.1 | B | P,E | Visual QA script output validation | None | Agent can inspect screenshot + JSON metrics; pass/fail is machine readable |
| T4.3 | Keep packaged Desktop claim separate | P1 | S | T4.1 | C | E,P | Verifier/docs checks | None | Acceptance output says Vite renderer is not packaged Desktop; packaged-release remains a separate gate |

### Parallel Lanes

| Lane | Tasks | Combined Effort | Merge Risk | Key Files |
|:--|:--|:--|:--|:--|
| A | T4.1 | M | Medium | `scripts/verify/`, package scripts |
| B | T4.2 | M | Medium | visual scripts, artifacts |
| C | T4.3 | S | Low | docs/verifiers |

## Phase 5: Acceptance, Merge, Archive

**Goal**: Prove the foundation and merge without leaving active SPEC clutter.
**Prerequisite**: Phases 1-4 complete.
**S.U.P.E.R Focus**: P, E.

| # | Task | Priority | Effort | Depends On | Lane | S.U.P.E.R | Test Expectation | Memory Impact | Acceptance Criteria |
|:--|:--|:--|:--|:--|:--|:--|:--|:--|:--|
| T5.1 | Run final acceptance matrix | P0 | L | T4.1,T4.2,T4.3 | A | P,E | Full targeted gates with evidence summary | Record durable gotchas in native memory if discovered | All required commands pass or failures are explicitly scoped and fixed |
| T5.2 | Merge readiness and archive SPEC | P0 | M | T5.1 | A | S,P | Doc SSOT, real-e2e contract, project skills, diff check | None | PRs merged to `dev/delicious233`, promoted to `master` if approved, SPEC artifacts archived via `docs/history.md` external archive |

### Parallel Lanes

| Lane | Tasks | Combined Effort | Merge Risk | Key Files |
|:--|:--|:--|:--|:--|
| A | T5.1, T5.2 | L | Medium | all touched surfaces |

## Required Acceptance Commands

Minimum per implementation PR:

```powershell
git diff --check
pwsh ./scripts/verify/verify-doc-ssot.ps1
pwsh ./scripts/verify/verify-project-skills.ps1
pwsh ./scripts/verify/verify-real-e2e-contract.ps1
```

When chat/UI behavior changes:

```powershell
corepack pnpm --dir app/shared test
corepack pnpm --dir app/desktop test:e2e:chat-flow
corepack pnpm --dir app/desktop test:visual:chat-flow
corepack.cmd pnpm --dir app/web test:e2e:chat-flow
corepack.cmd pnpm --dir app/web test:visual:chat-flow
```

When Web Hub boundary changes:

```powershell
corepack.cmd pnpm --dir app/web test:e2e:stubbed-hub
pwsh ./scripts/verify/verify-web-hub-boundary.ps1
```

When Hub/Edge code changes:

```powershell
cd edge-server; go test ./... -short -count=1
cd ../hub-server; go test ./... -short -count=1
```

Approved-real, packaged Desktop, signing, release upload, and production deploy are excluded unless explicitly approved in a task.
