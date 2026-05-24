# AgentHub Edge Server

Edge Server 是靠近项目和 Agent CLI 的本地控制节点。

它可以运行在 Desktop 内、本地/远程机器上，或作为 headless Cloud Edge 运行。

Runtime: Go 1.25.

## 职责

- 本地或 Edge authority 的 Conversation。
- Project registry 和 workspace roots。
- `.agenthub/` 项目记忆和上下文构造。
- Run 生命周期管理、进程启动、取消和权限门控。
- Agent CLI adapter 注册与调度：Claude Code、Codex、OpenCode、Orchestrator。
- Artifact 元数据索引。
- Desktop UI 的本地 REST API / WebSocket。
- 连接 Hub 的 sync、relay 和远程命令 client。
- 本地数据和 Agent CLI 执行的权限边界。

## 不负责什么

- 全局账号系统。
- 全局好友和群聊关系。
- `authority=hub` 时的云端会话权威。
- 长期团队 IM 主序列；Hub Server 负责云端主序列、联系人、群聊和多端同步。

## 协议面

- UI <-> Edge：REST JSON API + WebSocket events，处理本地 IM、本地 artifact、本地 run control。
- Edge <-> Hub：REST sync API + reverse WebSocket relay，处理 sync events、heartbeat、远程命令。
- Edge <-> Agent CLI：由 `internal/lifecycle/` 启动子进程，由 `internal/adapters/` 解析 CLI 原生输出并转换为 typed events。

## 当前结构

```
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

## 依赖

- `api/` 契约：REST endpoint、WebSocket event、错误格式。
- `docs/system-architecture.md`：Desktop-Edge-Hub 架构、执行生命周期和职责边界。
- `docs/implementation-guide.md`：当前实现顺序和三部分分工。
- Go package 按实际代码需要创建，不提前铺空目录。
