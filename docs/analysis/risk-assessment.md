# Risk Assessment

> Phase 1 risk baseline for `docs/repo-governance-real-e2e`, captured 2026-06-27.

## S.U.P.E.R Architecture Health Summary

| Principle | Status | Key Findings | Transformation Priority |
|:--|:--|:--|:--|
| **S** Single Purpose | 🔴 | `hub-server` and `docs/roadmap.md` carry too many responsibilities; shared frontend also mixes UI, contracts, mock/demo, and preview utilities. | High |
| **U** Unidirectional Flow | 🟡 | Intended flow is documented, but data modes/auth/execution/entry preflight are still easily conflated. Workflow scripts also read docs/workflows as policy sources. | High |
| **P** Ports over Implementation | 🟡 | API/event/adapter ports exist. Missing project-level evidence-level contract across Playwright, Visual QA, stubbed Hub, observed local, approved-real, and packaged Desktop. | High |
| **E** Environment-Agnostic | 🟡 | Most config is injectable, but Desktop/package evidence depends on Windows/Tauri/WebView/sidecar. Docs contain stale branch/date/runtime claims that drift by environment. | Medium |
| **R** Replaceable Parts | 🔴 | Hub subdomains and docs truth sources are expensive to replace. Duplicated active facts cause cascading doc updates. | High |

**Overall Health**: 0/5 principles fully healthy — Technical Debt Alert.

### S.U.P.E.R Violation Hotspots

1. `docs/roadmap.md`: roadmap, current state, architecture, release gates, verification matrix, backlog, and appendix all in one active file of roughly 119 KB and more than 2,000 lines.
2. `docs/governance/`: now narrowed to long-lived owner docs, but dated governance evidence must stay archived so it cannot be mistaken for active policy.
3. Project skills: active skills are allowlisted, but their wording must keep matching the current CI/runtime entrypoints.
4. `docs/governance/document-standards.md`: says phase plans go directly in `docs/`, conflicting with current spec-driven archive/progress rules.
5. `app/desktop/stats.html`: tracked generated bundle analysis contains node_modules paths and pollutes source search.
6. `hub-server`: largest module and current roadmap P0/P1 findings target goroutines, EventBus blocking, Redis TTL, scheduler cancellation, token/session risks, and pprof boundaries.

## Risk Matrix

| Risk | Impact | Likelihood | Severity | Mitigation |
|:--|:--|:--|:--|:--|
| Stale branch/worktree governance leads agents to use deleted branches or wrong base | Wrong merges, wasted work, regressions | High | High | Replace active branch table with live-state rule and current baseline; remove stale `dev/delicious223` commands. |
| Roadmap and architecture docs duplicate active truth and old phase status | Conflicting decisions, stale acceptance claims | High | High | Split current state, architecture, roadmap, and verification evidence into smaller canonical sections; archive/delete stale plan docs. |
| Real E2E claims are not consistently mapped to evidence levels | False confidence in UI/package/login/runtime readiness | High | High | Promote `.agents/skills/real-e2e-acceptance/` to the canonical matrix and sync scripts/docs/workflows to it. |
| Demo/local/login/observed/approved-real axes stay overloaded | Mock or preflight traffic appears in chat flow, tests misclassify mode boundaries | Medium | High | Define mode matrix and phase-aware network boundary tests in shared contracts and docs. |
| Chat transcript UI can regress without full behavior + visual coverage | User messages disappear/reorder, cards clutter, markdown/table fail | Medium | High | Keep targeted Playwright + Visual QA + shared normalizer tests; reject mock-self tests. |
| Packaged Desktop evidence is conflated with Vite renderer evidence | Sidecar/icon/sqlite/WebView package bugs escape | Medium | High | Require Tauri package/readiness gate only when package claim is made; label renderer-only evidence accurately. |
| Existing CI scripts include policy-mirror checks that can become judge-and-jury | Slow or brittle CI without added protection | Medium | Medium | Keep high-signal gates; retire or narrow tests that only duplicate implementation strings. |
| Performance/leak gates are fragmented | Resource regressions pass functional tests | Medium | Medium | Classify benchmarks/load/pprof/leak checks by claim and touched module. |
| `app/desktop/stats.html` tracked generated artifact pollutes repo search | Review noise and accidental large diffs | High | Medium | Remove/ignore generated bundle analysis artifacts if not intentionally published. |
| Mobile version drift | Release docs or CI may claim unified version incorrectly | Medium | Medium | Confirm version policy before release-gate claims. |

## High-Severity Risks

### Branch and Workflow Drift

Live state shows only one worktree at `docs/repo-governance-real-e2e`, based on `b2b5bf16`, while `docs/governance/branch-governance.md` still lists old active worktrees and branches. `AGENTS.md` also still mentions syncing `dev/delicious223` in two command/rule lines even though the current baseline is `dev/delicious233`.

Mitigation should be a small, direct governance cleanup: remove active-looking stale branch rows, make live `git status`/`git worktree list` the operational truth, and keep historical details in archives.

### Real E2E Evidence Ambiguity

The new `real-e2e-acceptance` skill correctly states evidence levels, but active docs and workflows still scatter the same concepts. This creates a risk of saying "real E2E passed" when only one layer passed:

- Playwright renderer proves browser interaction, not Tauri packaging.
- Visual QA proves geometry/screenshot state, not backend correctness.
- Stubbed Hub proves contract shape, not real login/model/API.
- Observed local proves a real local read/no-spend path, not cloud production.
- Approved-real needs explicit approval and cannot silently fall back to mock.

Mitigation should align docs/scripts/package scripts around one matrix and require manifest wording such as `real_tested=false` for stubs.

### Chat Flow Regression Surface

The recent UI bugs cluster around transcript ordering, optimistic user messages, auto-scroll, card grouping, markdown/table rendering, and status/noise leakage. These are not reliably catchable by manual screenshots alone. The current test direction is valid if it remains focused:

- Unit/contract tests for transcript normalization and ordering.
- Playwright for send/reply ordering, immediate optimistic user message, auto-follow, card grouping, markdown/table rendering.
- Visual QA for 16:9 desktop viewports and mobile-responsive non-overlap.
- Manual/agent-assisted review for real interaction feel and screenshot inspection.

Avoid adding tests that only verify mock data or duplicate switch statements.

### Documentation Source Sprawl

`docs/roadmap.md` still mixes long-term direction with historical verification claims, release checklists, and implementation backlog. `docs/architecture.md` still has older ChatView hardening context while newer Chat UIUX work has been archived. This makes future agents read too much and still get stale facts.

Mitigation should reduce active docs, not add another governance layer.

## Technical Debt

- `hub-server` size and domain breadth make it the top backend complexity hotspot.
- `app/shared` is the right shared UI home, but its responsibilities are broad enough that data-mode/transcript/workbench contracts need stricter boundaries.
- `scripts` contains useful gates, but several policy checks inspect string patterns in workflow files; these should stay narrow and not become broad governance logic.
- `docs/archive/` and `docs/archives/` both exist. Their purposes are now documented, but the split is easy to misunderstand.
- Old one-off plans, dated audits, release notes, and longform reference research must stay under `docs/archive/`; active `docs/plan/` and `docs/progress/` are reserved for the current spec-driven run only.
- Archived project skills are correctly moved out of `.agents/skills`, but future scans should enforce that active skill names match the AGENTS whitelist.

## Testing Risks

- UI workflow tests must run against deterministic but production-shaped data, not mock internals.
- Visual QA must use desktop-like 16:9 viewports for Desktop/Web claims, plus mobile viewports when responsiveness is claimed.
- Desktop package claims require Tauri package readiness/dry or installer smoke gates; Vite tests are insufficient.
- Real login/model/API execution requires explicit approved-real approval and evidence; CI should not run it implicitly.
- Performance/leak gates should be tied to affected code paths: Hub EventBus/outbox/scheduler/Redis TTL, Edge lifecycle/store/adapters, frontend query cache/polling/scroll rendering.

## Project Governance Risks

- `docs/progress/MASTER.md` does not exist, so this is a fresh run; future sessions must read it first after Phase 4 creates it.
- `GITHUB_STANDARD` is available, but Project board integration is not available without `read:project`.
- Native memory exists outside the repo. Do not create repo-local memory files unless explicitly selected.
- The active skill surface is clean today, but stale global/project skills can reappear if AGENTS whitelist is not enforced.
- User requested not to keep overlong, duplicate, or conflicting rules; the plan should prefer replacing stale text over appending exceptions.

## Compatibility Concerns

- Removing or archiving docs must not break README navigation.
- Cleaning generated artifacts must respect whether `app/desktop/stats.html` is intentionally published. Current evidence suggests it is a build analysis artifact because it embeds `node_modules` bundle paths.
- Tightening Web no-Local-Edge boundaries must preserve allowed Desktop entry preflight behavior and Local Mode.
- Data-mode cleanup must preserve Demo, Fixture, Local, Login/Hub, Observed, and Approved-Real as separate axes instead of collapsing them into one flag.
- Any release-readiness claim must preserve signing/notarization/updater/release-upload as explicit external approval gates.
