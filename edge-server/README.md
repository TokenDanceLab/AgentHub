# AgentHub Edge Server

最后更新：2026-10-29

Edge Server 是靠近 workspace 和 Agent Runtime 的执行控制节点，可运行在 Desktop 内、本机后台、远程机器或 headless Cloud Edge。

Runtime: Go 1.27.3.

## Boundary

Edge 是本地执行权威；Hub 是账号、云端 IM、多端同步、远程中继和审计权威。本地执行不依赖 Hub 登录。完整职责/Boundary 见 [docs/architecture/02-edge-server.md](../docs/architecture/02-edge-server.md)（SSOT）；执行生命周期在 `internal/lifecycle/`，Runtime 协议适配在 `internal/adapters/`。

## Source Map

| Area | Owner |
|---|---|
| CLI/config | `cmd/agenthub-edge/` |
| User-confirmed outbound device connection | `internal/device/` |
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

## Paired text execution

独立 Edge 可通过 `--enroll` 向 HTTPS Hub 发起配对，展示短码；用户在已登录 Hub 中确认设备名、`openai-sdk` runtime 和 workspace 后，Edge 将专用 opaque credential 原子保存到新的私有文件。此流程不使用 Account token 作为设备或模型凭据。完整设备端点、7 天凭据和撤销语义以 [身份设计](../docs/architecture/06-auth-identity.md)、[dispatch 契约](../api/dispatch.md) 为准。

配对需要 `--hub-url`、`--enrollment-name`、`--enrollment-workspace`、`--workspace-allowlist`、绝对 `--device-credential-file`。启动已配对执行时使用同一 credential file/allowlist，并配置 `--store-backend sqlite`、绝对 `--store-db`、`--device-journal-db`、`--event-log-path`。运行目录和凭据目录由操作者选择，不能放入 Git；credential 文件不得已有或被覆盖。过期/撤销后需重新配对，旧任务不会因此自动重新执行。

重新配对同一设备时，传入原 UUID 的 `--edge-device-id` 并将新凭据保存到新的私有文件路径；确认后保留原 target。省略此参数会登记新设备并占用新的云设备配额。重配对需要在前次凭据签发或撤销后重新显式确认，不能通过重放旧确认续期。

模型凭据仅由操作者通过专用 `OPENAI_API_KEY` 注入，兼容 endpoint 可由本地 `OPENAI_BASE_URL` 配置；不得复用 Account 登录 token、传入浏览器或包含在远程任务参数中。配对本身不要求模型 key。已配对模式仅注册文本 `openai-sdk`，Hub 历史消息是多轮上下文来源；不启用工具、CLI/runtime/profile 覆写、MCP 同步、技能/cc-switch 发现、工作区快照、项目验收脚本或自动 fault-retry。HTTP API 保持有鉴权的 loopback，浏览器仍只连 Hub。

出站 long poll 复用 Hub delivery/task identity。SQLite admission journal 跨重启防重复；只有明确的执行前拒绝可释放 intent，结果不明时停止接收并要求人工核对。取消先落持久 tombstone，再核实原 executor 终态；模型连接确实结束前不发 `applied`，原 run 丢失不等于已停止。

## Local auth

非 dev 模式且未显式配置 `--local-auth-token` 与 `--hub-jwt-secret` 时，Edge 启动会生成随机 `aght_` 本地 token；除 `/v1/health` 和 CORS preflight 外所有端点都要求 Edge 凭据，包括 `/v1/agents`、`/v1/runs`、`/v1/projects` 等只读 GET 和 WebSocket `/v1/events`。凭据可用 `Authorization: Bearer` 或 `X-AgentHub-Edge-Token`；`/v1/events` 升级还支持通过 `Sec-WebSocket-Protocol` 携带。`--dev` / `AGENTHUB_DEV=1` 仅用于本地开发。debug 端点复用同一鉴权链，未配置任何凭据时 fail-closed。实现见 `internal/httpserver/server_middleware.go`（`localAuthMiddleware`、`isLocalAuthExempt`）；token 提取与 debug 鉴权见 `internal/httpserver/server_auth.go`。

## Verification

```powershell
go test ./edge-server/... -short            # 复用 Go test cache
go test ./edge-server/... -short -count=1   # 需要干净结果时
go test ./edge-server/internal/device ./edge-server/internal/httpserver -run 'Test(Worker|Enrolled|Enrollment|Client|Workspace|Journal)' -count=1
python ./scripts/smoke/client-smoke.py --EdgeAddr 127.0.0.1:3228 --EdgeAuthToken local-smoke-token
python ./scripts/verify/verify-backend-perf-leak-gates.py --Benchtime 100ms
```

Performance/leak claims follow [../docs/architecture/05-deployment.md](../docs/architecture/05-deployment.md) §Backend performance and leak evidence (gates enforced by `scripts/verify/verify-backend-perf-leak-gates.py`); Edge lifecycle/store/adapters behavior tests and microbenchmarks are not production capacity proof.

## Links

- API contract: [../api/README.md](../api/README.md)
- Event contract: [../api/events.md](../api/events.md)
- Architecture: [../docs/architecture.md](../docs/architecture.md), [../docs/architecture/02-edge-server.md](../docs/architecture/02-edge-server.md), [../docs/architecture/03-runtime-adapters.md](../docs/architecture/03-runtime-adapters.md)
