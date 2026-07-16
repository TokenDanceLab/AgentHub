# AH-SR-046 Hub capability issuer (#436)

最后更新：2026-07-16

## Landed
- `hub-server/internal/jwtutil/capability.go` — `IssueCapabilityToken`
- `AgentService.dispatchToEdgeHTTP` attaches `X-AgentHub-Capability-Token` when `AGENTHUB_JWT_SECRET` + device id available
- Unit test round-trip in jwtutil

## Remaining for full close
- purpose enforcement on Edge PostRuns
- richer claims (target/workspace/action)
- E2E Hub→Edge dual-token evidence
- CORS allow-header completeness on Edge if browser-origin Edge calls exist
