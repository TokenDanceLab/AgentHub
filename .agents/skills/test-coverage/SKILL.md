---
name: test-coverage
description: Use when AgentHub changes need unit test, coverage, benchmark, or CI coverage-threshold evidence, or when the user asks to check tests or coverage.
---

# Test Coverage

Use current CI gates as the coverage truth. Do not record fixed test counts in this skill; counts drift as suites change.

## Current CI Coverage Gates

| Surface | Command | Blocking threshold |
|---|---|---|
| Edge overall | `cd edge-server && go test ./... -count=1 -short -coverprofile=coverage.out -covermode=atomic` | informational only |
| Edge packages | `go tool cover -func=coverage.out` | security 70%, lifecycle 60%, adapters 55% |
| Hub overall | `cd hub-server && go test ./... -count=1 -short -coverprofile=coverage.out -covermode=atomic` | overall 40% |
| Desktop | `corepack.cmd pnpm --dir app/desktop test:ci` | pass/fail |
| Web | `corepack.cmd pnpm --dir app/web test -- --run` | pass/fail |
| Mobile | `corepack.cmd pnpm --dir app/mobile-rn verify` | pass/fail; Visual QA is separate |

## Focused Checks

- Frontend shared contracts: `corepack.cmd pnpm --dir app/shared test -- <path-or-pattern>`
- Desktop chat flow: `corepack.cmd pnpm --dir app/desktop test:e2e:chat-flow`
- Web stubbed Hub: `corepack.cmd pnpm --dir app/web test:e2e:stubbed-hub`
- Edge runtime smoke: `pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/smoke/edge-runtime-smoke.ps1`
- Backend performance/leak: `python ./scripts/verify/verify-backend-perf-leak-gates.py --Benchtime 100ms`; use `.github/workflows/checks.yml` only as CI coverage context.

## Reporting

Report the command, status, important failure line, and evidence boundary. If a gate is fixture, stubbed, readiness-only, or observed-local, say so and do not call it real execution.
