---
name: pre-push
description: Use when AgentHub changes are committed or nearly ready to push, especially before updating a PR branch or claiming CI-ready status.
---

# Pre-Push

Prefer focused gates while iterating, then run the gates that match the touched surfaces before push. Do not use fixed test-count expectations as acceptance evidence.

## Always

```powershell
git diff --check
bash scripts/verify/check-secrets.sh --range HEAD^..HEAD
python scripts/verify/verify-project-skills.py
python scripts/verify/verify-doc-ssot.py
python scripts/verify/verify-ci-gates.py
bash ./scripts/verify/verify-ci-gates.sh
```

Use `bash scripts/verify/check-secrets.sh --staged` before commit when changes are still staged.

## Surface Gates

| Touched surface | Minimum local gate |
|---|---|
| `edge-server/` | `cd edge-server && go test ./... -short -count=1` |
| `hub-server/` | `cd hub-server && go test ./... -short -count=1` |
| `api/` | parse `api/openapi.yaml` |
| Desktop UI | `corepack.cmd pnpm --dir app/desktop typecheck` + relevant Vitest/Playwright/Visual QA |
| Web UI | `corepack.cmd pnpm --dir app/web typecheck` + relevant Vitest/Playwright/Visual QA |
| Shared frontend | focused `app/shared` tests plus affected consumers |
| Mobile RN | `corepack.cmd pnpm --dir app/mobile-rn verify` unless Mobile is explicitly out of scope |
| Real E2E/package/login/perf/leak | `.agents/skills/real-e2e-acceptance/SKILL.md`; backend perf/leak also runs `scripts/verify/verify-backend-perf-leak-gates.py` |

## Reporting

Before push or PR update, state what passed, what was not run, and which evidence level each gate proves. Do not merge with required checks failing unless the workflow owner explicitly changes policy.
