# EdgeServerAgent 交接文档

## 接手前必读

1. `AGENTS.md` — 项目规则和开发约束
2. `docs/system-architecture.md` — Hub-Edge-Runner 三层架构
3. `docs/implementation-guide.md` — 实施路线（M1→M2→M3→M4）
4. `docs/roadmaps/client.md` — 客户端路线图和任务状态
5. `api/openapi.yaml` — REST API 契约
6. `api/events.md` — WebSocket 事件契约
7. `api/conventions.md` — API 命名、分页、错误格式约定
8. `~/.claude/plans/structured-imagining-pinwheel.md` — 完整架构方案

## 仓库和分支

```
仓库: github.com/TokenDanceLab/AgentHub
当前分支: feat/edge-adapters (worktree: .worktrees/feat-edge-adapters)
基线分支: dev/delicious233 (dbd4583)
```

```powershell
cd D:\Code\AgentHub
git worktree add .worktrees/feat-edge-adapters -b feat/edge-adapters
# 或如果已存在：
cd D:\Code\AgentHub\.worktrees\feat-edge-adapters
```

## 全局架构

```
Desktop (Tauri/React) ──REST/WS──> Edge Server (Go, :3210)
                                       │
                    ┌──────────────────┼──────────────────┐
                    ▼                  ▼                  ▼
              claude -p          codex exec         opencode run
              --output-format    "prompt"           "prompt"
              stream-json
```

Edge Server 是本地核心引擎，负责：
- REST API（Project/Thread/Run/Item CRUD）
- WebSocket 事件推送（cursor 恢复、增量重放）
- AgentAdapter 层（统一接口，屏蔽 CLI 协议差异）
- 文件持久化（JSON snapshot）

**关键设计原则**：AgentAdapter 不管理自己的子进程。`BuildCommand` 提供给 `ProcessExecutor`，后者保留进程生命周期控制（start/wait/cancel via context）。`ParseStream` 只负责协议解析。

## 已完成工作（commit dbd4583）

### 新增 `edge-server/internal/adapters/` (7 文件, ~600 行)

| 文件 | 内容 | 状态 |
|------|------|------|
| `adapter.go` | `AgentAdapter` 接口、`AgentEvent` 类型、`EventEmitter`、`RunProcessContext`、`AgentCapabilities` | ✅ 完成 |
| `registry.go` | `AdapterRegistry` — Register/Get/List/Resolve/SetDefault | ✅ 完成 |
| `claude_code.go` | `ClaudeCodeAdapter` — `claude -p --output-format stream-json --verbose` | ✅ 完成 |
| `parser_ndjson.go` | NDJSON 流解析器 — 解析 Claude Code 的 8 种消息类型 (system.init/assistant/stream_event/user/result/tool_progress) | ✅ 完成 |
| `codex.go` | `CodexAdapter` — `codex exec "prompt"` 批量模式 (P0) | ✅ Phase 1 |
| `opencode.go` | `OpenCodeAdapter` — `opencode run "prompt"` 批量模式 (P0) | ✅ Phase 1 |
| `orchestrator.go` | `OrchestratorAdapter` — ClaudeCode + 编排 system prompt | ✅ 基础 |

### 新增 8 个 AgentHub 事件类型 (`api/events.md`)

```
run.agent.text_delta   — 流式文本增量
run.agent.text_block   — 完整文本块
run.agent.thinking     — 思考/推理内容（UI 折叠显示）
run.agent.tool_call    — 工具调用请求
run.agent.tool_result  — 工具执行结果
run.agent.file_change  — 文件变更+diff
run.agent.session_init — 会话初始化（模型、工具列表）
run.agent.result       — 执行结束（成功/失败、token 用量）
```

### 修改现有文件

| 文件 | 变更 |
|------|------|
| `lifecycle/process_executor.go` | 增加 `adapter` 字段；`run()` 中 adapter 非 nil 时分流到 `publishStructuredOutput`；新增 `busEventEmitter` |
| `lifecycle/process_profile.go` | `RunProcessContext` 扩展 4 字段；`runPlaceholderValue` 新增 `{{run.prompt}}`/`{{agent.id}}`/`{{agent.model}}`/`{{run.workdir}}` |
| `cmd/agenthub-edge/main.go` | 7 个新 CLI flag：`--agent-default`/`--claude-code-path`/`--codex-path`/`--opencode-path`/`--agent-model`/`--runner-profile claude-code|codex|opencode`；`buildAdapterRegistry()` |
| `httpserver/server.go` | `Config` 增加 `AdapterRegistry`/`AgentDefault`；`newHandlerFromConfig` 注入 adapter |
| `api/handlers.go` | `Handler` 增加 `AdapterRegistry` 字段 |
| `api/events.md` | 新增 8 个 agent 事件类型 |
| `api/openapi.yaml` | 新增 `GET /v1/agents` 端点；`StartRunRequest` 扩展 `prompt`/`agentId`/`model` 字段 |

### 删除

| 目录 | 说明 |
|------|------|
| `runner/` | 8 个 Go 源文件全部删除。Mock 模式由 Edge 内置 `MockExecutor` 承担 |

### 保留兼容

- `--runner-profile agenthub-runner-mock` 仍然可用，映射到 MockExecutor
- ProcessExecutor 不带 adapter 时回退到原始 stdout 捕获（向后兼容）

## 剩余任务

### 高优先级

1. **`GET /v1/agents` 端点实现** — `handlers.go` 中新增 handler，从 `AdapterRegistry.List()` 返回可用 agent 列表

2. **`POST /v1/runs` 扩展** — 接收请求中的 `agentId`/`prompt`/`model` 字段：
   - 用 `AdapterRegistry.Resolve(agentId)` 查找 adapter
   - 调用 `adapter.BuildCommand(ctx)` 获取 command/args/env/workDir
   - 传给 ProcessExecutor 启动，而非用硬编码的 RunnerProfile
   - 当前 handler 还是用旧的 RunnerProfile 方式创建 run，需要改为 adapter-aware

3. **Adapter 集成测试** — 用真实 `claude -p "say hello"` 验证完整链路：
   ```powershell
   .\agenthub-edge --agent-default claude-code --claude-code-path "~/.local/bin/claude.exe" --store-file .\test_store.json
   ```
   然后 `curl -X POST http://127.0.0.1:3210/v1/runs -H "Content-Type: application/json" -d '{"prompt":"say hello"}'`

4. **Real Claude Code 端到端验证** — 用 WebSocket 订阅事件流，确认收到 `run.agent.*` 结构化事件

### 中优先级

5. **CodexAdapter Phase 2** — 从 `codex exec` 升级到 `codex app-server --listen stdio://`（JSON-RPC 全双工流式）
   - 需要实现 `parser_jsonrpc.go` — JSON-RPC 2.0 协议解析
   - 支持 `item/*/delta` 实时通知

6. **OpenCodeAdapter Phase 2** — 从 `opencode run` 升级到 `opencode serve --port N`（REST + SSE 流式）

7. **OrchestratorAdapter 完善** — 实现 sub-agent spawn 拦截逻辑：
   - Edge 监听 orchestrator 的 tool call
   - 匹配 spawn_subagent 模式
   - 创建子 Run 并分派到对应 AgentAdapter
   - 聚合结果回主 Thread

8. **`POST /v1/runs/{id}:cancel` 打通** — 取消时通过 adapter 发送中断信号（Claude Code: stdin 写 control_request interrupt）

### 低优先级

9. SQLite 持久化替代 JSON 文件
10. Runner registry 废弃，迁移到 AdapterRegistry
11. `client-smoke.ps1` 更新（去掉 `agenthub-runner` 依赖）

## 关键接口速查

### AgentAdapter
```go
type AgentAdapter interface {
    Metadata()     AdapterMetadata
    Capabilities() AgentCapabilities
    BuildCommand(ctx RunProcessContext) (cmdPath, args, env, workDir string)
    ParseStream(ctx, stdout, stdin, emitter, run) error
}
```

### EventEmitter
```go
type EventEmitter interface {
    Emit(eventType string, scope map[string]any, payload any)
}
```

### Bus 事件类型常量
```go
adapters.BusEventTextDelta   = "run.agent.text_delta"
adapters.BusEventTextBlock   = "run.agent.text_block"
adapters.BusEventThinking    = "run.agent.thinking"
adapters.BusEventToolCall    = "run.agent.tool_call"
adapters.BusEventToolResult  = "run.agent.tool_result"
adapters.BusEventFileChange  = "run.agent.file_change"
adapters.BusEventSessionInit = "run.agent.session_init"
adapters.BusEventResult      = "run.agent.result"
```

### 新增占位符
```
{{run.id}}        — Run.ID          (已有)
{{run.projectId}} — Run.ProjectID   (已有)
{{run.threadId}}  — Run.ThreadID    (已有)
{{run.prompt}}    — 用户消息内容     (新增)
{{agent.id}}      — Agent 标识      (新增)
{{agent.model}}   — 模型覆盖        (新增)
{{run.workdir}}   — 工作目录        (新增)
```

## 构建和测试

```powershell
cd D:\Code\AgentHub\.worktrees\feat-edge-adapters\edge-server

# 编译
go build ./...

# 测试
go test ./... -count=1

# 启动 (mock 模式，验证不回归)
go run ./cmd/agenthub-edge --store-file .\test_store.json

# 启动 (Claude Code 模式)
go run ./cmd/agenthub-edge --agent-default claude-code --claude-code-path "~/.local/bin/claude.exe"

# 验证
git diff --check
python -c "import yaml, pathlib; yaml.safe_load(pathlib.Path('api/openapi.yaml').read_text(encoding='utf-8')); print('yaml ok')"
```

## 本机 CLI 路径

| CLI | 路径 | 版本 |
|-----|------|------|
| claude | `~/.local/bin/claude.exe` | 2.1.143 |
| codex | `~/AppData/Roaming/npm/codex.ps1` | 已安装 |
| opencode | `~/AppData/Roaming/npm/opencode.ps1` | 1.15.3 |

## 隐私红线

- 禁止提交 `.env`、API key、token、cookie、私钥
- 禁止提交真实服务器 IP、内网地址、数据库连接串
- 禁止在代码中写死本机绝对路径
- 禁止提交 `.worktrees/`、`.agenthub/memory/`、`.claude/`、`.codex/`

## Commit 规范

```
type(scope): 中文摘要

type: init|feat|fix|docs|refactor|chore|test|perf|ci|revert
scope: client|edge|api|docs|desktop
```
