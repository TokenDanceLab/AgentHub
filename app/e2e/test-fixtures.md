---
name: workspace-root
description: AgentHub frontend monorepo workspace root — pnpm workspace, shared configs, e2e
metadata:
  type: project
---

# AgentHub Frontend Monorepo

## Quick start

```bash
pnpm install          # install all workspace deps
pnpm test             # run unit tests across all packages
pnpm test:coverage    # unit tests with coverage report
pnpm test:e2e         # Playwright end-to-end tests
```

## Workspace packages

| Package | Description |
|---------|-------------|
| `@agenthub/shared` | Shared types, API clients, React components |
| `@agenthub/desktop` | Tauri desktop app |
| `@agenthub/web` | Vite web app |

## Running tests per package

```bash
pnpm --filter @agenthub/shared test
pnpm --filter @agenthub/desktop test
pnpm --filter @agenthub/web test
```

## E2E tests

E2E tests live in `e2e/` and use Playwright. They target the web app.

```bash
pnpm test:e2e                # headless, all browsers
pnpm test:e2e -- --ui        # Playwright UI mode
pnpm test:e2e -- --project=chromium  # single browser
```

## Coverage thresholds

| Package | Threshold |
|---------|-----------|
| shared | 60% |
| web | 30% |
| desktop | not enforced yet |
