# AgentHub Edge Server

最后更新：2026-08-14

Edge Server 是靠近 workspace 和 Agent Runtime 的执行控制节点，可运行在 Desktop 内、本机后台、远程机器或 headless Cloud Edge。旧长版 README 见 [../docs/history.md](../docs/history.md)。

Runtime: Go 1.26.

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

Runtime presets（ACP 为默认 runtime，三个 `*-acp` 适配器默认注册，空 `--*-acp-path` 回退平台原生 `npx`/`opencode`）：

```powershell
go run ./edge-server/cmd/agenthub-edge --addr 127.0.0.1:3210 --runner-profile claude-code   # → claude-acp
go run ./edge-server/cmd/agenthub-edge --addr 127.0.0.1:3210 --runner-profile codex        # → codex-acp
go run ./edge-server/cmd/agenthub-edge --addr 127.0.0.1:3210 --runner-profile opencode     # → opencode-acp
```

`--runner-profile` 选择 executor/runtime 预设（现 cutover 到 ACP）。`--agent-default` 选择 run 未指定 agent 时的默认 adapter ID（`claude-acp`/`codex-acp`/`opencode-acp`/`claude-code`）。SDK 直连适配器（`anthropic-sdk`/`openai-sdk`，独立 HTTP 传输、不 spawn CLI）需 `--anthropic-sdk-path`/`--openai-sdk-path` 显式启用。

## Key Runtime Inputs

| Flag/env | Purpose |
|---|---|
| `--addr` / `AGENTHUB_ADDR` | Listen address, default `127.0.0.1:3210` |
| `--store-backend` / `AGENTHUB_STORE_BACKEND` | `memory`, `file`, or `sqlite` |
| `--store-db` / `AGENTHUB_STORE_DB` | SQLite path when backend is `sqlite` |
| `--store-file` / `AGENTHUB_STORE_FILE` | Legacy JSON file store path |
| `--store-readiness`（无 env） | 打印 store readiness JSON 后退出（当前支持 `--store-backend sqlite`） |
| `--runner-command` / `AGENTHUB_RUNNER_COMMAND` | 本地进程执行器二进制（空=内置 mock executor） |
| `--runner-arg` / `--runner-env`（可重复，无 env） | 传给 `--runner-command` 的参数 / 环境变量 `KEY=VALUE` |
| `--runner-workdir` / `AGENTHUB_RUNNER_WORKDIR` | 工作目录（空=继承 Edge 进程 cwd） |
| `--agent-default` / `AGENTHUB_AGENT_DEFAULT` | Default Runtime adapter ID（`claude-acp`/`codex-acp`/`opencode-acp`/`claude-code`） |
| `--agent-model` / `AGENTHUB_AGENT_MODEL` | 默认 agent 的模型覆盖 |
| `--runtime-manifest` / `AGENTHUB_RUNTIME_MANIFESTS` | fixture-only 自定义 runtime manifest JSON 路径（可重复；env 用路径列表分隔） |
| `--skills-dir` / `AGENTHUB_SKILLS_DIRS` | 含 SKILL.md 子目录的技能目录（可重复；默认 `.agents/skills` 与 `.codex/skills`） |
| `--runner-profile` / `AGENTHUB_RUNNER_PROFILE` | Runtime preset（`agenthub-runner-mock`/`claude-code`/`codex`/`opencode`，均 cutover 到 ACP） |
| `--claude-acp-path` / `AGENTHUB_CLAUDE_ACP_PATH` | claude-agent-acp ACP launcher（空=平台原生 `npx`） |
| `--codex-acp-path` / `AGENTHUB_CODEX_ACP_PATH` | codex-acp ACP launcher（空=平台原生 `npx`） |
| `--opencode-acp-path` / `AGENTHUB_OPENCODE_ACP_PATH` | opencode-acp 二进制路径（空=`opencode`） |
| `--claude-code-path` / `AGENTHUB_CLAUDE_CODE_PATH` | claude 二进制路径（orchestrator inner + legacy 回退） |
| `--anthropic-sdk-path` / `AGENTHUB_ANTHROPIC_SDK_PATH` | 启用 anthropic-sdk 直连适配器（API key 或 `env`） |
| `--openai-sdk-path` / `AGENTHUB_OPENAI_SDK_PATH` | 启用 openai-sdk 直连适配器（API key 或 `env`） |
| `--shutdown-timeout` / `AGENTHUB_EDGE_SHUTDOWN_TIMEOUT` | 优雅停机总预算（默认 `10s`，#2129） |
| `AGENTHUB_EVENT_WORKERS` | 事件总线 worker 数（默认 4） |
| `AGENTHUB_DELIVERY_JOURNAL_DB` | durable delivery journal 开关（默认关） |
| `AGENTHUB_EVIDENCE_GATE_ENABLED` / `AGENTHUB_FAULT_ESCALATION_ENABLED` | 证据门禁（默认开）/ 故障升级开关（详见 05-deployment.md 配置面索引） |
| `--workspace-allowlist` / `AGENTHUB_WORKSPACE_ALLOWLIST` | Allowed workspace roots for `/v1/runs` `workDir` |
| `--local-auth-token` / `AGENTHUB_EDGE_AUTH_TOKEN` | Optional local Edge API token |
| `--hub-jwt-secret` / `AGENTHUB_HUB_JWT_SECRET` | Hub-issued Edge JWT verification secret |
| `--edge-device-id` / `AGENTHUB_EDGE_DEVICE_ID` | Device binding for Hub JWT |
| `--dev` / `AGENTHUB_DEV` | Dev mode：禁用自动本地 token，所有端点开放（仅本地开发） |
| `--remote-mode` / `AGENTHUB_REMOTE_MODE` | 允许非 loopback bind + 远程 origin（需配 `--local-auth-token` 或 `--hub-jwt-secret`） |
| `--tailscale` / `AGENTHUB_TAILSCALE` + `--tailscale-ip` / `AGENTHUB_TAILSCALE_IP` | tailscale 模式（隐含 remote-mode，以 tailscale 身份向 Hub 注册）+ 注册用 tailscale IP |
| `--allowed-origin` / `AGENTHUB_ALLOWED_ORIGINS` | remote-mode CORS 允许的 browser origin（可重复；env 用逗号分隔） |
| `--event-log-path` / `AGENTHUB_EVENT_LOG_PATH` | append-only JSON-lines 事件日志路径（崩溃恢复/回放；空=不持久化） |
| `--event-log-max-size` / `AGENTHUB_EVENT_LOG_MAX_SIZE` | 事件日志截断阈值（字节，0=默认 50 MiB） |
| `--hub-url` / `AGENTHUB_HUB_URL` + `--hub-token` / `AGENTHUB_HUB_TOKEN` | Edge→Hub 直连回调上报地址 + JWT bearer 鉴权 |
| `--hub-refresh-token` / `AGENTHUB_HUB_REFRESH_TOKEN` | Hub 会话 refresh token；设置后过期前经 `/client/auth/refresh` 自动轮换 `--hub-token` |
| `--hub-callback-timeout` / `AGENTHUB_HUB_CALLBACK_TIMEOUT` | 单次 Edge→Hub 回调超时（Go duration，默认 30s） |
| `--hub-callback-retry-budget` / `AGENTHUB_HUB_CALLBACK_RETRY_BUDGET` | 回调总 wall-clock 重试预算（Go duration，默认 10s） |
| `--hub-callback-max-attempts` / `AGENTHUB_HUB_CALLBACK_MAX_ATTEMPTS` | 单次回调总尝试数（默认 3） |
| `AGENTHUB_MEMORY_LIMIT_MB` | Soft memory-limit（env-only，默认 512 MiB，0=禁用；防长跑堆膨胀） |
| `--hub-mcp-sync-url` / `AGENTHUB_HUB_MCP_SYNC_URL` + `--hub-mcp-sync-interval` / `AGENTHUB_HUB_MCP_SYNC_INTERVAL` | 周期拉取 Hub MCP server 配置（URL 空=不同步；interval 默认 5m） |
| `AGENTHUB_LOG_LEVEL`（env-only） | 日志级别 `debug`/`info`/`warn`/`error`（默认 `info`） |
| `AGENTHUB_LOG_FORMAT`（env-only） | 日志格式 `text`/`json`（默认 `text`） |
| `AGENTHUB_DEMO_SEED`（env-only） | 任意非空值注入 demo 种子数据（仅开发演示） |

## Auto token and debug endpoint auth behavior

非 dev 模式且未显式配 `--local-auth-token` 与 `--hub-jwt-secret` 时，Edge 启动自动生成随机 `aght_` 本地 token（32 字节），是浏览器与本地 runtime 之间的主防线：无 token 的进程无法调状态变更端点或订阅 `/v1/events`。`--dev`/`AGENTHUB_DEV=1` 关闭此保护（仅本地开发）。

debug 端点（pprof、`/debug/config`、`/debug/state`）由 `debugAuthFunc` 分层鉴权（`server_auth.go`）：(1) Dev 模式 → nil（公开）；(2) 已配 `LocalAuthToken` → Bearer 校验；(3) 已配 `HubJWTSecret` 但无 `LocalAuthToken` → Hub-JWT 校验回退（复用 REST 路由同一 `jwtutil.ValidateHubToken` 信任链，防 operator 只配 HubJWTSecret 时 debug 端点裸奔）；(4) 均未配 → deny-all（fail-closed，401）。该分支在正常 `Run()` 流程中不可达：非 dev 且未显式配 token 时，启动会先自动生成本地 token，使 (2) 成立。TokenDance `td_` bearer 不被 debug 端点接受。

## Verification

```powershell
go test ./edge-server/... -short -count=1
python ./scripts/smoke/client-smoke.py --EdgeAddr 127.0.0.1:3228
python ./scripts/smoke/client-smoke.py --EdgeAddr 127.0.0.1:3228 --EdgeAuthToken local-smoke-token
python ./scripts/verify/verify-backend-perf-leak-gates.py --Benchtime 100ms
```

`client-smoke.py` uses the current Edge runtime architecture and no longer builds the deleted standalone `runner/` directory.

Performance/leak claims follow [../docs/archives/reference/backend-performance-gates.md](../docs/archives/reference/backend-performance-gates.md) (archived; gates enforced by scripts/verify/verify-backend-perf-leak-gates.py); Edge lifecycle/store/adapters behavior tests and microbenchmarks are not production capacity proof.

## Links

- API contract: [../api/README.md](../api/README.md)
- Event contract: [../api/events.md](../api/events.md)
- Architecture: [../docs/architecture.md](../docs/architecture.md), [../docs/architecture/02-edge-server.md](../docs/architecture/02-edge-server.md), [../docs/architecture/03-runtime-adapters.md](../docs/architecture/03-runtime-adapters.md)
