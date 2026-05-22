# AgentHub Runner

Runner 是 Agent CLI 进程的执行节点。

Runtime: Go.

## 快速开始

### 构建

```powershell
cd runner
go build ./cmd/agenthub-runner
```

### 运行 Mock 模式

```powershell
go run ./cmd/agenthub-runner --mock
```

### 可用参数

| 参数 | 默认值 | 说明 |
|---|---|---|
| `--mock` | `false` | 启用 mock 模式，模拟一次 agent 执行 |
| `--addr` | `127.0.0.1:3211` | Runner HTTP 监听地址（mock 模式下暂不使用） |

### Mock 模式预期输出

```text
INFO starting agent runner in mock mode addr=127.0.0.1:3211
INFO mock run started id=mock-run-1
Installing dependencies...
Building project...
Running tests...
All tests passed!
INFO mock run finished id=mock-run-1
INFO mock run completed successfully
```

输出之间有约 80ms 间隔，模拟真实 agent 执行过程。

### 运行测试

```powershell
go test ./...
```

## 职责

- 启动、监控和停止 Claude Code / Codex / OpenCode 进程。
- 管理 run workspace 和 git worktree。
- 捕获 stdout/stderr 日志。
- 生成 diff、file、preview、log artifacts。
- 启动本地 preview server。
- 执行 Edge 下发的路径保护和命令审批结果。

## 不负责什么

- IM 消息、Conversation、好友或群聊。
- 长期 Memory 权威。
- 全局权限或用户账号。
- 远程路由决策。
- 直接作为 Web/Mobile 的公开 API。

## 协议面

- Edge -> Runner：local REST API，处理 `run.start`、`run.cancel`、artifact read requests。
- Runner -> Edge：typed event stream，发送 `run.started`、`run.output`、`artifact.created`、`run.finished`。

## 依赖

- `api/` 契约：Runner 相关 request/response 和 event payload。
- `docs/system-architecture.md`：Hub-Edge-Runner 架构和职责边界。
- `docs/implementation-guide.md`：当前实现顺序和三部分分工。
- Agent CLI 原生协议、NDJSON 或局部 bridge 可以在 Runner 内部 package 实现，不作为 AgentHub 公共协议。
