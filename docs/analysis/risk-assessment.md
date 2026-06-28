# Real Foundation Hardening - Risk Assessment

## S.U.P.E.R Architecture Health Summary

| Principle | Status | Key Findings | Transformation Priority |
|:--|:--|:--|:--|
| **S** Single Purpose | 🟡 | Shared renderer and visual scripts mix several concerns; tests can be clearer without splitting everything immediately. | High |
| **U** Unidirectional Flow | 🟡 | Intended flow is documented and mostly implemented, but Desktop/Web adapters and E2E stubs can still blur source/runtime boundaries. | High |
| **P** Ports over Implementation | 🟡 | `TranscriptBlock` and data-mode contracts are strong ports; Visual QA and acceptance manifests are still informal. | High |
| **E** Environment-Agnostic | 🟡 | Vite tests are local and stable; packaged Desktop, real login, CLI/model/API paths require separate environment-specific gates. | Medium |
| **R** Replaceable Parts | 🟡 | Shared UI reuse is real, but replacing Hub/Edge sources or Visual QA harness still has medium ripple cost. | Medium |

**Overall Health**: 0/5 fully healthy at SPEC scope, but all principles are partially supported. This is refactoring-needed, not a rewrite.

### S.U.P.E.R Violation Hotspots

| Hotspot | Severity | Why It Matters |
|:--|:--|:--|
| Visual QA evidence split | High | Automated Playwright, manual visual scripts, and Web visual QA do not yet produce one honest acceptance bundle. |
| Chat flow source/event merge | High | User sends, Hub messages, Edge runtime events, tool results, subagent reports, and inspector-only details must remain one linear product timeline. |
| Evidence wording | High | Stubbed Hub, Vite renderer, readiness, approved-real, and packaged Desktop can be accidentally overclaimed. |
| Web visual viewport drift | Medium | T1.2 keeps `app/web/scripts/visual-qa.mjs` aligned with the `1440x810` architecture contract and guards against stale active script references. |
| Backend/frontend contract drift | Medium | Hub/Edge event shapes can change without immediately breaking a shared transcript golden fixture. |

## Risk Matrix

| Risk | Impact | Likelihood | Severity | Mitigation |
|:--|:--|:--|:--|:--|
| Main chat stream shows mock/debug/mode state | User-facing UI becomes noisy and misleading | Medium | High | Shared normalizer/render tests plus Playwright assertions that transcript excludes debug labels |
| User message flashes or disappears during send/refetch | Core chat workflow feels broken | Medium | High | Optimistic send contract in shared unit + Desktop/Web E2E with mutation probe |
| Tool calls/results/subagent reports render out of order | Users cannot trust agent activity | Medium | High | Golden event fixture tests and Web/Desktop E2E ordering assertions |
| Visual QA produces screenshots but not behavioral proof | False confidence | Medium | High | Require DOM metrics and behavior assertions next to screenshots |
| Stubbed Hub evidence is reported as real | Governance and release risk | Medium | High | Manifest must include `real_tested=false` and evidence level |
| Web direct-calls Local Edge | Security/product boundary violation | Low/Medium | High | Reuse `e2eDataModeContract` in Web tests |
| Desktop Vite E2E is treated as packaged Desktop proof | Release readiness overclaim | Medium | High | Separate packaged-release issue/gate; no packaged claim in chat-flow tasks |
| Adding broad snapshot tests slows work without protection | Developer speed loss | Medium | Medium | Prefer targeted behavior/contract/geometry tests |

## High-Severity Risks

### Evidence Overclaim

The project has many evidence levels. The most damaging failure is not a red test; it is a green stubbed test reported as real login, real model execution, or packaged Desktop behavior. Every task in this SPEC must label evidence level and `real_tested` honestly.

### Timeline Integrity

The user experience depends on an IM-like linear transcript. Any split between Hub messages, Edge runtime events, optimistic sends, tool cards, subagent reports, and inspector-only details can cause disappearing messages, wrong order, duplicated cards, or noisy internal state.

### Visual QA Drift

Visual QA must be half automated and half agent-inspected. Scripts should fail on measurable layout problems, and screenshots should be available for human/agent review. A screenshot alone is not acceptance.

## Technical Debt

- ChatView grouping and rendering are implemented in a few central files, so behavioral changes can have wide visual impact.
- Visual QA scripts contain their own local stubs and reporting shape; useful but not yet a project-level evidence bundle.
- Some broader Web visual QA scenes still include mobile-heavy coverage. Mobile is out of scope for detailed work in this SPEC.
- Backend service directories are very large; this SPEC should avoid broad backend rewrites and only fix contract mismatches.

## Testing Risks

- Playwright tests can become slow or flaky if they start real services unnecessarily.
- Tests that mirror implementation switches in `dataMode` would add little protection; E2E should assert observed requests and visible behavior.
- Manual Visual QA scripts must not be treated as "manual only"; they need machine-failing metrics plus screenshot artifacts.
- Packaged Desktop cannot be inferred from Vite renderer tests.

## Project Governance Risks

- Current rules correctly centralize in `AGENTS.md`; adding duplicate rules to roadmap/MASTER would recreate the prior doc mess.
- Native memory is available, but this SPEC must not create a repo-local fallback memory file without explicit selection.
- GitHub Projects are unavailable with current token scope, so this run must use `GITHUB_STANDARD`.

## Compatibility Concerns

- `dataMode` remains a compatibility field and must not be repurposed as the full truth source.
- Existing scripts/verify layout must remain under `scripts/verify/`; no root wrapper scripts.
- Current Desktop/Web app scripts should continue to work while any shared harness is introduced.
- Mobile contract notes can be updated if needed, but no native/mobile UI rewrite belongs in this SPEC.
