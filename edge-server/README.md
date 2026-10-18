# AgentHub Edge Server

最后更新：2026-10-19

Edge Server 是靠近 workspace 和 Agent Runtime 的执行控制节点，可运行在 Desktop 内、本机后台、远程机器或 headless Cloud Edge。

Runtime: Go 1.26.

## Boundary

Edge 是本地执行权威；Hub 是账号、云端 IM、多端同步、远程中继和审计权威。本地执行不依赖 Hub 登录。完整职责/Boundary 见 [docs/architecture/02-edge-server.md](../docs/architecture/02-edge-server.md)（SSOT）；执行生命周期在 `internal/lifecycle/`，Runtime 协议适配在 `internal/adapters/`。

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

Runtime presets（ACP 为默认 runtime，三个 `*-acp` 适配器默认注册，空 `--*-acp-path` 回退平台原生 `npx`/`opencode`）：

```powershell
go run ./edge-server/cmd/agenthub-edge --addr 127.0.0.1:3210 --runner-profile claude-code   # → claude-acp
go run ./edge-server/cmd/agenthub-edge --addr 127.0.0.1:3210 --runner-profile codex        # → codex-acp
go run ./edge-server/cmd/agenthub-edge --addr 127.0.0.1:3210 --runner-profile opencode     # → opencode-acp
```

`--runner-profile` 选择 executor/runtime 预设（现 cutover 到 ACP）。`--agent-default` 选择 run 未指定 agent 时的默认 adapter ID（`claude-acp`/`codex-acp`/`opencode-acp`/`claude-code`）。SDK 直连适配器（`anthropic-sdk`/`openai-sdk`，独立 HTTP 传输、不 spawn CLI）需 `--anthropic-sdk-path`/`--openai-sdk-path` 显式启用。

## Runtime flags

Run `go run ./edge-server/cmd/agenthub-edge --help` from the repository root for the current flag set. Flag defaults live in `edge-server/cmd/agenthub-edge/config.go`; env-only defaults are owned by the package that reads them (for example `AGENTHUB_EVENT_WORKERS` in `internal/events/bus.go`).

## Local auth

非 dev 模式且未显式配置 `--local-auth-token` 与 `--hub-jwt-secret` 时，Edge 启动会生成随机 `aght_` 本地 token；除 `/v1/health` 和 CORS preflight 外所有端点都要求 Edge 凭据，包括 `/v1/agents`、`/v1/runs`、`/v1/projects` 等只读 GET 和 WebSocket `/v1/events`。凭据可用 `Authorization: Bearer` 或 `X-AgentHub-Edge-Token`；`/v1/events` 升级还支持通过 `Sec-WebSocket-Protocol` 携带。`--dev` / `AGENTHUB_DEV=1` 仅用于本地开发。debug 端点复用同一鉴权链，未配置任何凭据时 fail-closed。实现见 `internal/httpserver/server_middleware.go`（`localAuthMiddleware`、`isLocalAuthExempt`）；token 提取与 debug 鉴权见 `internal/httpserver/server_auth.go`。

## Verification

```powershell
go test ./edge-server/... -short            # 复用 Go test cache
go test ./edge-server/... -short -count=1   # 需要干净结果时
python ./scripts/smoke/client-smoke.py --EdgeAddr 127.0.0.1:3228 --EdgeAuthToken local-smoke-token
python ./scripts/verify/verify-backend-perf-leak-gates.py --Benchtime 100ms
```

Performance/leak claims follow [../docs/architecture/05-deployment.md](../docs/architecture/05-deployment.md) §Backend performance and leak evidence (gates enforced by `scripts/verify/verify-backend-perf-leak-gates.py`); Edge lifecycle/store/adapters behavior tests and microbenchmarks are not production capacity proof.

## Links

- API contract: [../api/README.md](../api/README.md)
- Event contract: [../api/events.md](../api/events.md)
- Architecture: [../docs/architecture.md](../docs/architecture.md), [../docs/architecture/02-edge-server.md](../docs/architecture/02-edge-server.md), [../docs/architecture/03-runtime-adapters.md](../docs/architecture/03-runtime-adapters.md)
