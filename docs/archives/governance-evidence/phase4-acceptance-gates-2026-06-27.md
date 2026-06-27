# Phase 4 Acceptance Gates - 2026-06-27

Scope: #335 / T4.1 focused acceptance gate bundle for the repo governance real-E2E closure SPEC.

Branch: `chore/phase4-acceptance-335`

## Result

Status: pass with one honest blocker.

The focused acceptance bundle has no failed gates. The only blocker is the approved-real login readiness row, which is expected because no approved live TokenDance ID account/callback/Hub metadata was supplied for this run.

## Evidence Table

| Gate | Evidence level | Result | Artifact / key output |
|---|---|---|---|
| `corepack pnpm --dir app/desktop run test:e2e:smoke` | `playwright-ui` | PASS | 6/6 passed. Entry Gate is asserted before mode selection; Workspace assertions enter Demo mode first. |
| `pwsh ./scripts/client-smoke.ps1 -EdgeAddr 127.0.0.1:4563 -EdgeAuthToken local-smoke-token -SkipGoTests -SkipCancel` | `observed-local` | PASS | 21 passed / 0 failed. Edge build, health, runners, POST run, and WS mock events passed. |
| `pwsh ./scripts/verify-e2e-smoke-matrix.ps1 -RepoRoot . -CommandTimeoutSec 300` | mixed matrix | PASS_WITH_BLOCKER | `.tmp/e2e-smoke-matrix/run-77004/e2e-smoke-matrix.json`; 5 passed rows, 1 blocked-with-evidence row, 0 failed. |
| `corepack pnpm --dir app/desktop run test:visual:chat-flow` | `visual-qa` | PASS | 1440x810 check passed: no horizontal overflow, scroll gap 0, user messages stable, merged card stack, transcript has no mode/debug text. Screenshot: ignored local artifact under `app/desktop/.tmp/`. |
| `corepack pnpm --dir app/web run test:visual:chat-flow` | `visual-qa` + `stubbed-hub` | PASS | 1440x810 check passed with `real_tested=false`: table rendered, no horizontal overflow, scroll gap 0, inspector-only text stayed out of transcript. Screenshot: ignored local artifact under `app/web/.tmp/`. |
| `pwsh ./scripts/verify-doc-ssot.ps1` | contract/static | PASS | `doc SSOT ok` |
| `pwsh ./scripts/verify-project-skills.ps1` | contract/static | PASS | `project skill whitelist ok` |
| `pwsh ./scripts/verify-real-e2e-contract.ps1` | contract/static | PASS | `real E2E contract ok` |
| `python -c "import yaml, pathlib; yaml.safe_load(pathlib.Path('api/openapi.yaml').read_text(encoding='utf-8')); print('yaml ok')"` | API syntax | PASS | `yaml ok` |
| `pwsh ./scripts/verify-backend-perf-leak-gates.ps1 -Benchtime 100ms` | backend-api + performance-leak smoke | PASS | Hub/Edge focused behavior tests and microbenchmarks passed; script states pprof/leak and production capacity are not proven. |
| `pwsh ./scripts/verify-p0-remote-control-fixture.ps1` | fixture-unit | PASS | 8 passed / 0 failed / 0 warned / 0 skipped; FixtureRehearsal only. |
| `go test ./tests/teamrun -run '^TestTeamRunSmoke$' -count=1` from `hub-server/` | backend-api | PASS | `ok github.com/agenthub/hub-server/tests/teamrun` |
| `corepack pnpm --dir app/desktop run typecheck:tests` | static/typecheck | PASS | Test TypeScript typecheck passed. |
| `corepack pnpm --dir app/desktop run typecheck` | static/typecheck | PASS | App TypeScript typecheck passed. |
| `git diff --check` | static | PASS | No whitespace errors; Git emitted existing CRLF conversion warnings only. |

## Fixes Made During Gate Execution

- Desktop smoke was stale after the Desktop Entry Gate was introduced. The smoke now verifies Entry Gate buttons first, then enters Demo mode before asserting Workspace, composer, nav, and sidebar behavior.
- `scripts/client-smoke.ps1` ran `pnpm install --frozen-lockfile` from subpackages, which can abort in non-TTY worktrees. It now installs once from the `app/` workspace root with Corepack and builds Desktop through the workspace-aware command.

## Boundaries

- `real_tested=false` for this acceptance packet.
- No real TokenDance ID browser login was executed.
- No real CLI/model/API spend path was executed.
- No production deploy, release upload, signing, or updater publication was executed.
- Desktop renderer Playwright and Visual QA prove Vite renderer behavior, not packaged Tauri runtime behavior.
- Tauri package dry smoke proves static readiness policy only; installer execution, signing, and updater metadata publication remain separate approved gates.
- Localhost service smoke recorded partial local readiness; it is not cloud production or real-login evidence.
