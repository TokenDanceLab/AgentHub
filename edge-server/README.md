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
| `--dev` / `AGENTHUB_DEV` | Dev mode：禁用自动本地 token，所有端点开放（仅本地开发） |
| `--remote-mode` / `AGENTHUB_REMOTE_MODE` | 允许非 loopback bind + 远程 origin（需配 `--local-auth-token` 或 `--hub-jwt-secret`） |
| `--allowed-origin` / `AGENTHUB_ALLOWED_ORIGINS` | remote-mode CORS 允许的 browser origin（可重复；env 用逗号分隔） |
| `--event-log-path` / `AGENTHUB_EVENT_LOG_PATH` | append-only JSON-lines 事件日志路径（崩溃恢复/回放；空=不持久化） |
| `--hub-url` / `AGENTHUB_HUB_URL` + `--hub-token` / `AGENTHUB_HUB_TOKEN` | Edge→Hub 直连回调上报地址 + JWT bearer 鉴权 |
| `--hub-callback-timeout` / `AGENTHUB_HUB_CALLBACK_TIMEOUT` | 单次 Edge→Hub 回调超时（Go duration，默认 30s） |
| `--hub-callback-retry-budget` / `AGENTHUB_HUB_CALLBACK_RETRY_BUDGET` | 回调总 wall-clock 重试预算（Go duration，默认 10s） |
| `--hub-callback-max-attempts` / `AGENTHUB_HUB_CALLBACK_MAX_ATTEMPTS` | 单次回调总尝试数（默认 3） |
| `AGENTHUB_MEMORY_LIMIT_MB` | Soft memory-limit（env-only，默认 512 MiB，0=禁用；防长跑堆膨胀） |
| `--hub-mcp-sync-url` / `AGENTHUB_HUB_MCP_SYNC_URL` + `--hub-mcp-sync-interval` / `AGENTHUB_HUB_MCP_SYNC_INTERVAL` | 周期拉取 Hub MCP server 配置（URL 空=不同步；interval 默认 5m） |

## Auto token and debug endpoint auth behavior

非 dev 模式且未显式配 `--local-auth-token` 与 `--hub-jwt-secret` 时，Edge 启动自动生成随机 `aght_` 本地 token（32 字节），是浏览器与本地 runtime 之间的主防线：无 token 的进程无法调状态变更端点或订阅 `/v1/events`。`--dev`/`AGENTHUB_DEV=1` 关闭此保护（仅本地开发）。

debug 端点（pprof、`/debug/config`、`/debug/state`）由 `debugAuthFunc` 分层鉴权（`server_auth.go`）：(1) Dev 模式 → nil（公开）；(2) 已配 `LocalAuthToken` → Bearer 校验；(3) 已配 `HubJWTSecret` 但无 `LocalAuthToken` → Hub-JWT 校验回退（复用 REST 路由同一 `jwtutil.ValidateHubToken` 信任链，防 operator 只配 HubJWTSecret 时 debug 端点裸奔）；(4) 均未配 → nil（等价 dev 开放）。TokenDance `td_` bearer 不被 debug 端点接受。

## Verification

```powershell
go test ./edge-server/... -short -count=1
python ./scripts/smoke/client-smoke.py --EdgeAddr 127.0.0.1:3228
python ./scripts/smoke/client-smoke.py --EdgeAddr 127.0.0.1:3228 --EdgeAuthToken local-smoke-token
python ./scripts/verify/verify-backend-perf-leak-gates.py --Benchtime 100ms
```

`client-smoke.py` uses the current Edge runtime architecture and no longer builds the deleted standalone `runner/` directory.

Performance/leak claims follow [../docs/reference/backend-performance-gates.md](../docs/reference/backend-performance-gates.md); Edge lifecycle/store/adapters behavior tests and microbenchmarks are not production capacity proof.

## Links

- API contract: [../api/README.md](../api/README.md)
- Event contract: [../api/events.md](../api/events.md)
- Architecture: [../docs/architecture.md](../docs/architecture.md), [../docs/architecture/02-edge-server.md](../docs/architecture/02-edge-server.md), [../docs/architecture/03-runtime-adapters.md](../docs/architecture/03-runtime-adapters.md)
