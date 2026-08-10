# AH-SR-046 Hub capability issuer (#436 / #461)

最后更新：2026-07-17

## Landed
- `hub-server/internal/jwtutil/capability.go` — `IssueCapabilityToken` + `CapabilityIssueOptions` (action/target/thread)
- `AgentService.dispatchToEdgeHTTP` / `issueRunStartCapability` attaches `X-AgentHub-Capability-Token` when `AGENTHUB_JWT_SECRET` + device id available
- Edge `PostRuns` dual-token gate: purpose=`run-start` forced; optional action/thread_id/target_id bindings
- Unit + fixture round-trips (no production network, no live secrets):
  - Hub: `hub-server/internal/jwtutil/capability_test.go` — issue shape, bindings, Edge-shaped validate accept/reject
  - Edge jwtutil: `edge-server/internal/jwtutil/capability_test.go` — Hub-shaped issue → `ValidateCapabilityToken` accept/reject
  - Edge PostRuns: `edge-server/internal/api/handlers_test.go` — dual-token suite + Hub-issue shape accept/reject for action/target/thread

## Evidence commands (local / CI short)

```bash
cd hub-server && go test ./internal/jwtutil -run 'Capability' -count=1
cd ../edge-server && go test ./internal/jwtutil -run 'Capability' -count=1
cd ../edge-server && go test ./internal/api -run 'DualToken' -count=1
```

## Residual (optional, not release-blocking)
- Live/staging Hub→Edge issue/validate against a non-prod shared secret still optional; in-repo fixture evidence above closes the code-path residual for #461
- CORS allow-header completeness on Edge if browser-origin Edge calls exist
