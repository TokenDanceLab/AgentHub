# Image name SSOT decision

最后更新：2026-07-16  
Issue: #426 (T1.3)

## Decision

**Canonical Hub image repository name:** `ghcr.io/tokendancelab/agenthub-hub-server`

| Asset | Role |
|---|---|
| `deployments/production/docker-compose.yml` | In-repo production shape — uses `agenthub-hub-server` |
| `.github/workflows/cd-hub-server.yml` | Real image build/push authority — `agenthub-hub-server` |
| `.github/workflows/cd-production.yml` | **Documentation / dry-run style deploy narrative**; IMAGE_NAME must not invent a second product image (`agenthub-hub`) |

**Container name** may remain `agenthub-hub` (runtime name ≠ image repository name).

## Non-goals

- Does not perform live production deploy
- Does not rotate secrets
- Does not resurrect `hub-server/deployments/docker-compose.prod.yml` as live topology

## Follow-ups

- Operators follow server STATE for hk3 compose path
- Any new CD automation must pull `agenthub-hub-server`, not `agenthub-hub`
