# Root layout retain / move guidance

最后更新：2026-07-18
Issue: #1046 (P59)
Status: Accepted (docs-only; no bulk move)

## Decision

Keep the repository root thin and conventional. **Do not** bulk-move root tooling, workspace, or governance files. Optional relocation of **local-dev compose + env example** is a follow-on only if scripts and verify gates are updated in the same change.

## Snapshot (2026-07-18)

Root tracks roughly **17 files + 13 directories** (exact counts drift; use this as inventory class, not a freeze).

| Class | Paths (representative) | Policy |
|---|---|---|
| Governance / entry | `README.md`, `README_EN.md`, `AGENTS.md`, `LICENSE`, `CONTRIBUTING.md`, `CHANGELOG.md` | **Must stay root** |
| Go workspace | `go.work`, `go.work.sum` | **Must stay root** (`go work` expects repo-root workspace) |
| Editor / CI hygiene | `.editorconfig`, `.coderabbit.yaml`, `.dockerignore`, `.gitignore`, `.gitattributes`, `.prettierrc` | **Must stay root** (tooling convention) |
| GitHub | `.github/` | **Must stay root** |
| Product modules | `api/`, `app/`, `hub-server/`, `edge-server/`, `pkg/`, `scripts/`, `tests/`, `docs/`, `deployments/`, … | Stay as top-level module dirs |
| Local-dev compose | `docker-compose.yml`, `.env.example` | **Stay root for now**; optional future move only under conditions below |

## Must stay at repository root

These are **non-negotiable** for this ADR and any follow-on cleanup:

- `README.md` / `README_EN.md`
- `AGENTS.md` (project rules SSOT entry; agents load from root)
- `LICENSE`
- `go.work` (+ `go.work.sum`)
- `.github/`
- `.editorconfig`
- `.coderabbit.yaml`
- `.dockerignore`
- `.gitignore`

**Do not move** `AGENTS.md` or `go.work` under any “tidy root” proposal.

## Optional future move (not this PR)

| Candidate | Suggested target | Allowed only if |
|---|---|---|
| `docker-compose.yml` | `deployments/dev/docker-compose.yml` | Same change updates `scripts/dev/*`, smoke/OIDC/web-deploy readiness asserts that hard-path root `docker-compose.yml`, and docs (`docs/architecture/05-deployment.md`, developer quickstart) |
| `.env.example` (root) | `deployments/dev/.env.example` (or keep root pointer file) | Same change updates `scripts/dev/dev-up.sh` (copies `.env.example` → `.env`), verify scripts that `Assert-Contains ".env.example" …`, and docs that say `cp .env.example .env` |

**Hard references today (why move is not free):**

- `scripts/dev/dev-up.sh` — `cd` repo root; copies root `.env.example`; runs compose from root
- `scripts/release/verify-web-deploy-readiness.py` — asserts content of root `docker-compose.yml`
- `scripts/verify/verify-oidc-readiness.{sh,py}` — asserts root `.env.example` + `docker-compose.yml`
- `scripts/smoke/verify-p0-local-smoke.sh` — asserts root files exist
- `docs/architecture/05-deployment.md` — table lists root `docker-compose.yml` as local-dev asset

Production shape already lives under `deployments/production/`; local-dev compose staying at root is intentional until a coordinated move.

## Non-goals

- No mass root file moves in #1046
- No renaming module directories (`hub-server/`, `edge-server/`, `app/`, …)
- No live host / ops path changes (server STATE remains external SSOT)
- No inventing a second production compose authority

## Follow-on checklist (if compose move is accepted)

1. Create `deployments/dev/` with compose + env example.
2. Update `scripts/dev/dev-up.sh` / `dev-down.sh` compose file path (`-f`).
3. Update all verify/smoke scripts that hard-code root paths.
4. Update `docs/architecture/05-deployment.md` and `docs/developer-quickstart.md`.
5. Prefer a one-line root pointer or keep a thin root `.env.example` stub only if discoverability requires it — do not leave duplicate SSOT values.

## Related

- [docs/architecture/05-deployment.md](../architecture/05-deployment.md) — in-repo deploy assets
- [docs/decisions.md](../decisions.md) — ADR-018 row
- Issue #1046
