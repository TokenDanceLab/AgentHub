# Chat UIUX Data Mode E2E Risk Assessment

## S.U.P.E.R Architecture Health Summary

| Principle | Status | Key Findings | Transformation Priority |
|---|---|---|---|
| S - Single Purpose | 🟡 | dataMode still carries several product semantics; current E2E no longer mixes entry and runtime | Medium |
| U - Unidirectional Flow | 🟢 | Hub/Edge/runtime data normalizes into shared transcript before rendering | Maintain |
| P - Ports over Implementation | 🟢 | `e2eDataModeContract` now carries explicit phase boundaries | Maintain |
| E - Environment-Agnostic | 🟡 | Ports are configurable; real/stubbed environments need clearer manifests | Medium |
| R - Replaceable Parts | 🟡 | Web Hub stub and Desktop Vite E2E can be replaced, but packaged Tauri remains separate | Medium |

Overall health: the critical phase-boundary and naming risks are mitigated; packaged Tauri and true approved-real gates remain separate work.

## S.U.P.E.R Violation Hotspots

1. `app/shared/src/demo/dataMode.ts`: still intentionally keeps product mode compatibility; avoid adding more execution/auth semantics here.
2. `app/desktop/src/platform/useDesktopWorkbenchModel.ts`: explicit mock/fixture isolation must stay protected by focused tests.
3. Web stubbed Hub replay: useful as a replay/boundary test, but must keep `stubbed-hub-session` and `real_tested=false`.
4. Packaged Desktop: Vite renderer E2E does not cover sidecar, sqlite, icon, installer, signing, or native window behavior.

## Risk Matrix

| Risk | Impact | Likelihood | Severity | Mitigation |
|---|---|---|---|---|
| Loosening mock contract to allow Local Edge | Demo mode becomes dishonest | Medium | High | Phase-aware contract; mock runtime remains strict |
| Over-testing route stubs | Slower dev with little protection | Medium | Medium | Keep E2E focused on visible behavior and boundaries |
| Calling stubbed Hub replay “real” | Product status becomes misleading | Medium | High | Manifest and names must say `stubbed-hub-session`, `real_tested=false` |
| Regressing user message stability | Visible chat UX breaks | Medium | High | Keep Playwright submitted-message stability test |
| Treating Vite E2E as packaged Desktop proof | Sidecar/icon/package issues remain hidden | Medium | Medium | Record packaged Tauri as separate gate |

## Closed Blocking Evidence

Initial Desktop Playwright failures were caused by `/v1/health` from entry preflight being validated as mock runtime Local Edge traffic. The current phase-aware contract separates entry preflight from workbench runtime.

## Testing Risks

- Playwright route interception can hide bugs if tests only assert route calls. Each E2E must also assert visible transcript behavior.
- Shared unit tests are valuable for pure ordering/normalization/data-mode logic, but should not mirror implementation switch statements.
- Semi-automated screenshot evidence must supplement automated assertions; it is not a substitute.

## Governance Risks

- `docs/progress/MASTER.md` is the active progress SSOT for this scoped LOCAL_ONLY run; do not duplicate phase status in AGENTS/CLAUDE/roadmap.
- This work uses `LOCAL_ONLY` progress tracking; GitHub Issues are not being synchronized for this scoped cleanup.
- Memory updates are not performed unless the user explicitly asks.

## Compatibility Concerns

- `1440x810` is task-specific primary viewport by user instruction; cross-repo visual QA default `1440x900` remains a broader design baseline.
- Packaged Desktop behavior, sidecar bundling, Edge/sqlite packaging, and app icon verification are not covered by Vite renderer E2E.
