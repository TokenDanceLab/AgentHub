# AgentHub Edge Server

Edge Server 是靠近项目、workspace 和 Agent Runtime 的执行控制节点。它可以运行在 Desktop 内、本机后台、远程机器上，或作为 headless Cloud Edge 运行。

Runtime: Go 1.25.

## 架构定位

```text
Desktop/Web UI
  -> Edge REST / WebSocket
  -> lifecycle executor
  -> Agent Runtime adapter
  -> Claude Code / Codex / OpenCode
```

Edge 是本地执行权威；Hub 是账号、云端 IM、多端同步、远程中继和审计权威。本地执行不依赖 Hub 登录。

## 术语边界

| 概念 | Edge 中的含义 |
|---|---|
| Agent Runtime | `internal/adapters/` 中的 Codex/OpenCode/Claude Code/Orchestrator 适配器，负责命令构造、协议解析、取消和能力声明 |
| Agent Profile | Runtime + Model/Provider + Agent Configuration + Execution Target 的用户可管理实体；Hub 持久化后 Edge 负责本地解析和执行 |
| Agent Configuration | `AGENTS.md`、memory、聊天记录、上下文、工作目录、Skill、MCP、模型参数、审批策略等执行输入 |
| Execution Target | Local Edge、Remote Edge over SSH/Tailscale、Cloud Edge、Hub Relay target；Edge 只执行分配到自己的 target |

早期独立 `runner/` 目录已经废弃。当前执行生命周期在 `internal/lifecycle/`，Runtime 协议适配在 `internal/adapters/`。`internal/runners/` 只保留旧 UI 兼容 registry，不是新的执行架构中心。

## 职责

- 本地或 Edge authority 的 Project、Conversation、Thread、Run 和 Item。
- Project registry、workspace roots、worktree policy 和 `.agenthub/` 上下文构造。
- Run 生命周期管理：排队、启动、取消、状态更新、terminal run 清理。
- Agent Runtime adapter 注册与调度：Claude Code、Codex、OpenCode、Orchestrator。
- Agent Configuration 到 Runtime CLI 参数的映射：模型、推理强度、会话恢复、权限模式等。
- Skill、MCP、cc-switch provider binding 的本地解析和运行时注入边界。
- Artifact 元数据索引、Diff/Preview/Approval 事件输出。
- Desktop UI 的本地 REST API / WebSocket。
- 与 Hub 的 sync、relay、heartbeat 和远程命令 client。
- 本地数据、workspace、命令执行和 Agent CLI 的权限边界。

## 不负责什么

- 全局账号系统和 TokenDance ID code exchange。
- 全局好友、群聊和云端 IM 主序列。
- Hub-owned Agent Profile catalog 的长期权威存储。
- `authority=hub` 时的云端会话权威。
- 直接保存第三方 provider token、真实模型 API key 或服务器密钥。

## 协议面

- UI <-> Edge：REST JSON API + WebSocket events，处理本地 IM、本地 artifact、本地 run control。
- Edge <-> Agent Runtime：`internal/lifecycle/` 启动/取消子进程，`internal/adapters/` 解析 CLI 原生输出并转换为 typed events。
- Edge <-> Hub：REST sync API + reverse WebSocket relay，处理 sync events、heartbeat、远程命令和 target routing。

## 运行

默认 mock executor / 本地 health：

```powershell
cd edge-server
go run ./cmd/agenthub-edge --addr 127.0.0.1:3210
```

指定默认 Runtime adapter：

```powershell
go run ./cmd/agenthub-edge --addr 127.0.0.1:3210 --agent-default claude-code
```

使用 Runtime preset：

```powershell
go run ./cmd/agenthub-edge --runner-profile claude-code
go run ./cmd/agenthub-edge --runner-profile codex
go run ./cmd/agenthub-edge --runner-profile opencode
```

常用配置：

| 参数 / 环境变量 | 说明 |
|---|---|
| `--addr` / `AGENTHUB_ADDR` | 监听地址，默认 `127.0.0.1:3210` |
| `--store-file` / `AGENTHUB_STORE_FILE` | JSON file store 快照路径；为空使用内存 store |
| `--agent-default` / `AGENTHUB_AGENT_DEFAULT` | 默认 Runtime adapter ID：`claude-code`、`codex`、`opencode` |
| `--runner-profile` / `AGENTHUB_RUNNER_PROFILE` | 兼容旧名称的 Runtime preset：`agenthub-runner-mock`、`claude-code`、`codex`、`opencode` |
| `--local-auth-token` / `AGENTHUB_EDGE_AUTH_TOKEN` | 可选本地 Edge token；为空保持本地开发兼容，非空时除 `/v1/health` 和 CORS preflight 外的 Edge API 都需要 token |
| `--claude-code-path` / `AGENTHUB_CLAUDE_CODE_PATH` | Claude Code CLI 路径，默认 `claude` |
| `--codex-path` / `AGENTHUB_CODEX_PATH` | Codex CLI 路径，默认 `codex` |
| `--opencode-path` / `AGENTHUB_OPENCODE_PATH` | OpenCode CLI 路径，默认 `opencode` |
| `--agent-model` / `AGENTHUB_AGENT_MODEL` | 默认 Runtime 的模型覆盖 |

本地 Edge token 启用后，REST 请求使用 `Authorization: Bearer <token>` 或 `X-AgentHub-Edge-Token: <token>`。浏览器 WebSocket 无法设置自定义 header，所以 `/v1/events` 使用 `?access_token=<token>`。这只覆盖本地回环 Edge 的进程调用边界；Remote/Cloud/Hub relay Target 仍需要 Hub session、device proof、Target 权限和审计。

## 当前结构

```text
edge-server/
├── cmd/agenthub-edge/        # CLI 入口：配置、本地 store、adapter registry
├── internal/api/             # /v1 REST + /v1/events WebSocket handlers
├── internal/httpserver/      # HTTP server、CORS、metrics wiring
├── internal/events/          # seq、短历史 replay、WebSocket fanout bus
├── internal/store/           # 内存/file store：Project、Thread、Run、Item
├── internal/lifecycle/       # ProcessExecutor、MockExecutor、取消、结果聚合
├── internal/adapters/        # Claude Code / Codex / OpenCode / Orchestrator adapters
├── internal/agents/          # 运行时 Agent 实例 registry 与队列
├── internal/runnerctx/       # run context、预算、session metrics
├── internal/runners/         # 兼容旧 UI 的 runner registry
├── internal/security/        # trusted local origin 检查
└── internal/metrics/         # Prometheus metrics
```

## 验证

```powershell
cd edge-server
go test ./... -short -count=1
```

本地 API smoke：

```powershell
Invoke-RestMethod http://127.0.0.1:3210/v1/health
Invoke-RestMethod http://127.0.0.1:3210/v1/agents
```

全链路本地 smoke：

```powershell
# 使用默认 3210 端口；如果已有 Edge 进程，换一个隔离端口
..\scripts\client-smoke.ps1 -EdgeAddr 127.0.0.1:3228

# 验证可选本地 Edge token，覆盖 REST bearer 和 WebSocket access_token
..\scripts\client-smoke.ps1 -EdgeAddr 127.0.0.1:3228 -EdgeAuthToken local-smoke-token
```

`client-smoke.ps1` 当前使用 Edge 内置 `agenthub-runner-mock` 兼容 profile，不再构建早期已删除的独立 `runner/` 目录。

## 依赖

- `api/` 契约：REST endpoint、WebSocket event、错误格式。
- `docs/architecture/system-architecture.md`：Desktop-Edge-Hub 架构、Agent 产品模型、执行生命周期和职责边界。
- `docs/architecture/implementation-guide.md`：当前实现顺序、Adapter 细节和验收命令。
- Go package 按实际代码需要创建，不提前铺空目录。
