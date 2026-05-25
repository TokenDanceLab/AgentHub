# API Deprecations & Naming Migration

Last updated: 2026-05-25

## Runner → Runtime / Target Naming Migration

Early versions used "Runner" to refer to both Agent Runtime adapters and execution targets. The current product model distinguishes these concepts:

| Concept | Meaning |
|---------|---------|
| Agent Runtime | CLI/SDK adapter that can launch and parse agent output |
| Agent Profile | User-managed agent entity (Runtime + Model + Config + Target) |
| Execution Target | Where a run actually executes (local/remote/cloud/relay) |

### Deprecated Names

| Deprecated | Current Equivalent | Migration Status |
|-----------|-------------------|:--:|
| `/v1/runners` | Runtime availability / Target health summary | Keep (Edge compatibility) |
| `runner.online` | Runtime availability change event | Keep (Edge compatibility) |
| `runner.offline` | Runtime unavailable event | Keep (Edge compatibility) |
| `runner_offline` error code | Target/runtime unavailable | Keep (Edge compatibility) |
| `runnerId` parameter | `runtimeId` or `targetId` | Prefer new names in new code |
| `Cloud Runner` | Cloud Edge / hosted Execution Target | Migrate in docs & UI |

### New Names (Preferred)

| New Name | API Location | Status |
|---------|-------------|:--:|
| Agent Runtime | `GET /v1/agents` (Edge) | Implemented |
| Agent Profile | `GET/POST /web/agent-profiles` (Hub) | Implemented |
| Execution Target | `GET/POST /web/execution-targets` (Hub) | Implemented |
| Device | `GET /web/devices` (Hub) | Implemented |

### Migration Plan

- **Q3 2026**: Add `GET /v1/runtimes` as preferred endpoint on Edge
- **Q3 2026**: Publish `runtime.online` / `runtime.offline` alongside existing `runner.*` events
- **Q4 2026**: Deprecate `/v1/runners` in API docs (keep endpoint for backward compat)
- **2027**: Remove `runner.*` naming (TBD)

### Hub WebSocket vs Edge EventEnvelope

| Feature | Edge | Hub |
|---------|------|-----|
| Connection | `GET /v1/events` | `GET /client/ws` |
| Envelope | `{version, id, seq, type, scope, traceId, sentAt, payload}` | `{type, seq_id, payload}` |
| Auth | None (local only) | Bearer JWT first frame |
| Event naming | `dot.notation.lowercase` | `dot.notation.lowercase` |
