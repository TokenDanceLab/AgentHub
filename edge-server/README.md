# AgentHub Edge Server

最后更新：2026-06-27

Edge Server 是靠近 workspace 和 Agent Runtime 的执行控制节点，可运行在 Desktop 内、本机后台、远程机器或 headless Cloud Edge。旧长版 README 见 [../docs/history.md](../docs/history.md)。

Runtime: Go 1.25.

## Boundary

Edge 是本地执行权威；Hub 是账号、云端 IM、多端同步、远程中继和审计权威。本地执行不依赖 Hub 登录。完整职责/Boundary 见 [docs/architecture/02-edge-server.md](../docs/architecture/02-edge-server.md)（SSOT）；早期独立 `runner/` 目录已废弃，执行生命周期在 `internal/lifecycle/`，Runtime 协议适配在 `internal/adapters/`。

## Source Map

| Area | Owner |
|---|---|
| CLI/config | `cmd/agenthub-edge/` |
| REST and `/v1/events` | `internal/api/`, `internal/httpserver/` |
| Event bus/replay | `internal/events/` |
| Store | `internal/store/` |
| Run lifecycle | `internal/lifecycle/` |
| Runtime adapters | `internal/adapters/` |
| Agent registry/queue | `internal/agents/` |
| Run context/metrics | `internal/runnerctx/`, `internal/metrics/` |

## Run Locally

Mock/local health profile:

```powershell
go run ./edge-server/cmd/agenthub-edge --addr 127.0.0.1:3210 --runner-profile agenthub-runner-mock
```

Runtime presets:

```powershell
go run ./edge-server/cmd/agenthub-edge --addr 127.0.0.1:3210 --runner-profile claude-code
go run ./edge-server/cmd/agenthub-edge --addr 127.0.0.1:3210 --runner-profile codex
go run ./edge-server/cmd/agenthub-edge --addr 127.0.0.1:3210 --runner-profile opencode
```

`--runner-profile` selects the executor/runtime command preset. `--agent-default` selects the default adapter ID when a run does not specify an agent; it does not start a CLI by itself.

## Key Runtime Inputs

| Flag/env | Purpose |
|---|---|
| `--addr` / `AGENTHUB_ADDR` | Listen address, default `127.0.0.1:3210` |
| `--store-backend` / `AGENTHUB_STORE_BACKEND` | `memory`, `file`, or `sqlite` |
| `--store-db` / `AGENTHUB_STORE_DB` | SQLite path when backend is `sqlite` |
| `--store-file` / `AGENTHUB_STORE_FILE` | Legacy JSON file store path |
| `--agent-default` / `AGENTHUB_AGENT_DEFAULT` | Default Runtime adapter ID |
| `--runner-profile` / `AGENTHUB_RUNNER_PROFILE` | Runtime preset |
| `--workspace-allowlist` / `AGENTHUB_WORKSPACE_ALLOWLIST` | Allowed workspace roots for `/v1/runs` `workDir` |
| `--local-auth-token` / `AGENTHUB_EDGE_AUTH_TOKEN` | Optional local Edge API token |
| `--hub-jwt-secret` / `AGENTHUB_HUB_JWT_SECRET` | Hub-issued Edge JWT verification secret |
| `--edge-device-id` / `AGENTHUB_EDGE_DEVICE_ID` | Device binding for Hub JWT |

## Verification

```powershell
go test ./edge-server/... -short -count=1
pwsh ./scripts/smoke/client-smoke.ps1 -EdgeAddr 127.0.0.1:3228
pwsh ./scripts/smoke/client-smoke.ps1 -EdgeAddr 127.0.0.1:3228 -EdgeAuthToken local-smoke-token
python ./scripts/verify/verify-backend-perf-leak-gates.py --Benchtime 100ms
```

`client-smoke.ps1` uses the current Edge runtime architecture and no longer builds the deleted standalone `runner/` directory.

Performance/leak claims follow [../docs/reference/backend-performance-gates.md](../docs/reference/backend-performance-gates.md); Edge lifecycle/store/adapters behavior tests and microbenchmarks are not production capacity proof.

## Links

- API contract: [../api/README.md](../api/README.md)
- Event contract: [../api/events.md](../api/events.md)
- Architecture: [../docs/architecture.md](../docs/architecture.md), [../docs/architecture/02-edge-server.md](../docs/architecture/02-edge-server.md), [../docs/architecture/03-runtime-adapters.md](../docs/architecture/03-runtime-adapters.md)
