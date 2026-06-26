# Chat UIUX Data Mode E2E Architecture Approval

Date: 2026-06-27

Branch: `fix/chat-flow-uiux-contract`
Base: `dev/delicious233` at `cf7b4c7f738905b840ca8420dea5803f6ca10a68`

## Scope

- Shared transcript ordering, grouping, markdown/table rendering, tool/result pairing, user message stability, and auto-follow behavior.
- Desktop/Web data-mode boundary between entry preflight, demo/fixture workbench, local Edge workbench, stubbed Hub replay, observed local paths, and approved-real claims.
- Desktop/Web Playwright and Visual QA gates for chat flow geometry and transcript cleanliness.
- Spec-driven artifacts archived under `docs/archives/chat-uiux-data-mode-e2e/`.
- Project skill governance: archived stale `ui-screenshot`, `dev-team`, and `dev-team-codex`; added `real-e2e-acceptance` as the active merge/release E2E acceptance skill.

## Architecture Decision

Approved for merge to `dev/delicious233`.

The branch keeps chat rendering owned by shared frontend code and uses platform adapters only for data source/runtime differences. The data-mode contract is phase-aware, so Desktop entry Local Edge health checks are not counted as demo workbench runtime traffic, while demo/fixture workbench still forbids hidden Hub/Edge fallback.

Stubbed Hub replay remains explicitly stubbed. It can validate Web UI, Hub-shaped responses, ordering, inspector separation, and data boundary behavior, but it is not real TokenDance ID login, real Hub availability, real CLI/model/API execution, or spend evidence.

## Workflow Gates

| Gate | Evidence |
|---|---|
| Execute | Code/docs/skill changes are in this branch only; root active `docs/progress/MASTER.md` is absent; completed SPEC materials are archived. |
| Self-Test | Focused Vitest: data-mode contract 5/5, Desktop health/workbench 11/11, Web workbench 25/25, shared workbench 53/53. |
| Gate | Desktop Playwright chat-flow 4/4; Web Playwright chat-flow 1/1; Web stubbed Hub replay 7/7; Desktop/Web Visual QA passed at 1440x810. |
| Cross-Review | Local Claude CLI read-only review returned no blocking findings; Codex verified residual risks: no root `docs/progress`, no active stale skill references, active skill directory matches whitelist. |
| VERIFY | Desktop typecheck passed; Web typecheck passed; Desktop build passed with existing Vite chunk/dynamic-import warnings; Web build passed with existing chunk-size warning; `git diff --check` passed with LF-to-CRLF warnings only; zh/en locale JSON parse passed. |

## Real E2E Boundary

Verified:

- Automated Playwright coverage for Desktop/Web visible chat flow and Web stubbed Hub boundary.
- Semi-automated Visual QA for Desktop/Web 1440x810 chat flow screenshots and geometry probes.
- Unit/contract coverage for transcript normalization, workbench model state, phase-aware data-mode boundaries, and shared workbench rendering.
- Main chat transcript remains clean: Visual QA reported `transcriptHasModeDebug=false`; Web visual evidence kept inspector-only report out of the transcript.
- Stubbed replay keeps `real_tested=false`.

Not claimed:

- Packaged Tauri sidecar, sqlite bundling, app icon, installer, signing, updater, or native WebView behavior.
- Real TokenDance ID login.
- Real Hub production availability.
- Real CLI/model/API execution or spend.
- Production deploy or release upload.

## Skill Governance

Active project skill registry is now:

- `.agents/skills/dev-loop/`
- `.agents/skills/test-coverage/`
- `.agents/skills/pre-push/`
- `.agents/skills/integration-test/`
- `.agents/skills/adapter-dev/`
- `.agents/skills/env-sandbox/`
- `.agents/skills/real-e2e-acceptance/`

Archived skill copies are under `docs/archives/project-skills/`. They are read-only historical reference and must not be loaded as active workflow entrypoints.

## Merge Recommendation

Merge this branch locally to `dev/delicious233` after staging the active skill whitelist, archived skill copies, approval document, and existing Chat UIUX changes. Do not delete the feature branch until the merged result has passed at least `git diff --check`, active stale-reference search, and Web/Desktop typecheck on `dev/delicious233`.
