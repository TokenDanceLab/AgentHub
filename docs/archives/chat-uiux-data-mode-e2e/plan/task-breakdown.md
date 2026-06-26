# Chat UIUX Data Mode E2E Task Breakdown

## Overview

- Total phases: 6
- Total tasks: 15
- Estimated effort: L
- Tracking mode: `LOCAL_ONLY`
- SPEC: `docs/plan/chat-uiux-data-mode-e2e-spec.md`

## S.U.P.E.R Design Constraints

- S: keep data-mode contract, request classification, chat rendering, and platform adapters separate.
- U: platform data flows into shared `TranscriptBlock`, then into shared `ChatViewTranscript`.
- P: E2E scenario/request phase contract is the port between Playwright and shared validation.
- E: test ports/origins/viewport are explicit and environment-safe.
- R: Vite renderer E2E, Web Hub stub, and future packaged Tauri gates remain replaceable.

## Testing And Governance Constraints

- Feature/UI behavior changes must add or update Vitest or Playwright coverage.
- Tests must protect visible behavior, data-mode boundary, or pure transcript contract.
- Stubbed tests must never claim real login, real CLI, real model/API, deploy, signing, or release evidence.
- `docs/progress/MASTER.md` must be updated after each phase.

## Phase 1: SPEC And Evidence Baseline

Goal: SPEC-first planning and current-state correction.

| # | Task | Priority | Effort | Depends On | Lane | S.U.P.E.R | Test Expectation | Memory Impact | Acceptance Criteria |
|---|---|---:|---|---|---|---|---|---|
| 1.1 | Write evidence-backed SPEC v0.2 | P0 | S | none | A | S, P | Docs validation only | none | SPEC marks assumptions confirmed/revised/rejected |
| 1.2 | Create focused analysis docs | P0 | S | none | A | S, P | Docs validation only | none | `docs/analysis/*` exists and is scoped to this work |
| 1.3 | Correct progress SSOT | P0 | S | 1.1 | A | E | Docs validation only | none | MASTER no longer claims current clean verification |

## Phase 2: Phase-Aware Data Mode Contract

Goal: fix the current Desktop Playwright failure without weakening mock runtime isolation.

| # | Task | Priority | Effort | Depends On | Lane | S.U.P.E.R | Test Expectation | Memory Impact | Acceptance Criteria |
|---|---|---:|---|---|---|---|---|---|
| 2.1 | Add phase support to E2E data-mode contract | P0 | M | Phase 1 | A | S, P, R | Update contract Vitest | none | mock runtime rejects Hub/Edge; Desktop entry preflight allows health only |
| 2.2 | Update Desktop request logging to mark/reset runtime phase | P0 | M | 2.1 | A | U, E | Desktop Playwright | none | `chat-flow-ui.spec.ts` no longer fails on entry health request |
| 2.3 | Keep explicit mock/fixture Desktop model isolated | P0 | S | 2.1 | A | U, E | Desktop model/health Vitest | none | explicit mock/fixture do not call Edge health or Edge queries in runtime |

## Phase 3: Chat Flow UIUX Contract

Goal: protect visible chat behavior and shared rendering.

| # | Task | Priority | Effort | Depends On | Lane | S.U.P.E.R | Test Expectation | Memory Impact | Acceptance Criteria |
|---|---|---:|---|---|---|---|---|---|
| 3.1 | Verify Desktop optimistic message stability and auto-follow | P0 | S | 2.2 | A | U, R | Desktop Playwright | none | submitted message never disappears; duplicate messages render twice; scroll gap <= 4px |
| 3.2 | Verify Desktop layout/card stack geometry | P0 | S | 2.2 | A | S, R | Desktop Playwright | none | 1440x810 and narrow overflow <= 1px; approval/preview stack merged |
| 3.3 | Verify Web Hub replay ordering and markdown/table | P0 | M | 2.1 | B | U, P | Web Playwright | none | Hub messages and runtime events render in order; markdown table exists |
| 3.4 | Verify subagent/route details stay out of chat body | P0 | S | 3.3 | B | S, R | Web Playwright | none | subagent/route report visible in inspector evidence, not main transcript |

## Phase 4: Naming And Manifest Honesty

Goal: reduce mode confusion and keep demo UI clean.

| # | Task | Priority | Effort | Depends On | Lane | S.U.P.E.R | Test Expectation | Memory Impact | Acceptance Criteria |
|---|---|---:|---|---|---|---|---|---|
| 4.1 | Clean misleading comments/names around auto Local Edge fallback | P1 | S | 2.3 | A | S | Existing tests | none | comments do not describe explicit mock as Edge fallback |
| 4.2 | Keep stubbed Hub replay manifests honest | P1 | S | 3.3 | B | P, E | Manifest/unit tests | none | manifest reports `stubbed-hub-session` and `real_tested=false` |
| 4.3 | Record packaged Desktop gap | P1 | S | none | C | E | Docs validation only | none | SPEC/progress state Vite E2E is not package/icon/sidecar proof |

## Phase 5: Acceptance

Goal: produce verifiable evidence.

| # | Task | Priority | Effort | Depends On | Lane | S.U.P.E.R | Test Expectation | Memory Impact | Acceptance Criteria |
|---|---|---:|---|---|---|---|---|---|
| 5.1 | Run focused Vitest and Playwright gates | P0 | M | Phases 2-4 | A | P, E | Required | none | all listed SPEC commands pass or gaps are documented |
| 5.2 | Run semi-auto 1440x810 visual pass | P0 | M | 5.1 | A | R, E | Screenshot + metrics | none | Desktop/Web screenshots and metrics saved under `.tmp/` |
| 5.3 | Run typecheck/build/diff checks and update MASTER | P0 | M | 5.1 | A | E | Required | none | Desktop/Web typecheck/build and `git diff --check` pass |

## Phase 6: Framework Hardening

Goal: turn the proven E2E and semi-auto checks into durable project commands.

| # | Task | Priority | Effort | Depends On | Lane | S.U.P.E.R | Test Expectation | Memory Impact | Acceptance Criteria |
|---|---|---:|---|---|---|---|---|---|
| 6.1 | Promote manual chat-flow checks from `.tmp` into versioned Desktop/Web scripts | P0 | M | Phase 5 | A | S, E, R | Run via package scripts | none | Scripts can start/attach to Vite, block live backends, capture 1440x810 screenshots, and report metrics |
| 6.2 | Add focused package scripts for chat-flow E2E and visual verification | P0 | S | 6.1 | A | S, P | Run package scripts | none | Desktop/Web have `test:e2e:chat-flow` and `test:visual:chat-flow`; Web stubbed-hub includes chat-flow contract |
| 6.3 | Update progress/docs with durable framework commands | P0 | S | 6.2 | A | E | `git diff --check` | none | MASTER records package commands and current known limits without claiming packaged Tauri or approved-real evidence |

## Parallel Lanes

| Lane | Tasks | Merge Risk | Key Files |
|---|---|---|---|
| A | Contract, Desktop E2E, Desktop model, acceptance, framework hardening | Medium | `app/shared/src/testing`, `app/desktop/src`, `app/desktop/scripts`, `package.json` files |
| B | Web E2E and manifest honesty | Medium | `app/web/src/__e2e__`, `app/web/src/platform` |
| C | Docs gap recording | Low | `docs/plan`, `docs/progress` |

Because current worktree already has overlapping edits, execution should be mostly sequential in this session even where the logical lanes are independent.
