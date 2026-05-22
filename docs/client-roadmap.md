# AgentHub 客户端路线图

本文是客户端方向的 M1 执行计划，面向负责 Desktop、Runner、Local Edge 调度的开发者和 Agent。它不是新的长期架构文档；客户端端到端链路跑通后，本文可移动到 `docs/archive/`，长期规则回收进 `docs/implementation-guide.md`。

## 1. 目标

客户端 M1 的目标是打通第一条本地端到端链路：

```text
Tauri Desktop
  -> Local Edge Server
  -> Mock Runner
  -> WebSocket events
  -> Desktop UI 显示状态和输出
```

完成标准：

- Desktop 可以启动或连接 Local Edge。
- `GET /v1/health` 返回正常。
- `GET /v1/runners` 能看到 mock runner 在线。
- `POST /v1/runs` 可以启动一次 mock run。
- UI 能通过 `/v1/events` 看到 `run.started`、`run.output.batch`、`run.finished`。
- 不依赖 Hub Server、真实 Claude Code、真实 Codex 或 OpenCode。

## 2. 接口边界

本阶段不继续大范围扩 API。客户端先按现有契约实现：

| 类型 | 接口或事件 | 用途 |
|---|---|---|
| REST | `GET /v1/health` | Desktop 检查 Local Edge |
| REST | `GET /v1/runners` | UI 查询 Runner 列表 |
| REST | `POST /v1/runs` | 创建 mock AgentRun |
| REST | `POST /v1/runs/{runId}:cancel` | 取消 mock AgentRun |
| WebSocket | `GET /v1/events?cursor=...` | UI 订阅事件 |
| Event | `runner.online` / `runner.offline` | Runner 状态 |
| Event | `run.queued` / `run.started` | Run 生命周期 |
| Event | `run.output.batch` | stdout/stderr 聚合输出 |
| Event | `run.finished` / `run.failed` | Run 结束 |

如果实现时发现字段不够，先在当前任务 PR 中改 `api/openapi.yaml` 或 `api/events.md`，并在 PR 说明里写明影响前端、后端还是客户端。

## 3. Worktree 规则

项目级 worktree 固定使用：

```text
.worktrees/
```

该目录只存本地并行开发副本，不进入 git。创建前确认：

```powershell
git switch master
git pull --ff-only
git check-ignore .worktrees/
```

创建模板：

```powershell
git worktree add .worktrees/client-edge-foundation -b feat/client-edge-foundation
git worktree add .worktrees/client-runner-mock -b feat/client-runner-mock
git worktree add .worktrees/client-desktop-shell -b feat/client-desktop-shell
```

清理模板：

```powershell
git worktree remove .worktrees/client-edge-foundation
git branch -d feat/client-edge-foundation
```

## 4. 交给 DeepSeek 的执行方式

把本文作为 DeepSeek 的主任务说明。DeepSeek 接手后应当：

1. 在每个 worktree 内先读 `AGENTS.md`、本文、`api/README.md`、`api/openapi.yaml`、`api/events.md`。
2. 每个 worktree 只处理自己的写入范围，不跨范围改文件。
3. 可以在单个 worktree 内并行调度子 Agent，例如一个写实现、一个写测试、一个做 review，但最终由该 worktree 的主 Agent 统一检查和提交。
4. 子 Agent 不能修改未分配文件，不能跨 worktree 操作。
5. 每个 worktree 至少运行本任务列出的检查命令。
6. 每个 worktree 完成后 push 分支并开 PR，PR 正文中文为主，列出验证命令。
7. 发现 API 不够时，不要私自发明另一套协议；先改 `api/`，再实现。

推荐给 DeepSeek 的总提示：

```text
你负责 AgentHub 客户端方向的一个 worktree。先读 AGENTS.md 和 docs/client-roadmap.md。严格遵守当前 worktree 的写入范围。可以调度子 Agent 做代码、测试、review，但所有子 Agent 只能在当前 worktree 内工作。完成后运行验证命令，提交中文 commit，push 分支并创建 PR。
```

## 5. 并行任务拆分

### A. Local Edge Foundation

分支：

```text
feat/client-edge-foundation
```

worktree：

```text
.worktrees/client-edge-foundation
```

写入范围：

```text
edge-server/**
api/openapi.yaml
api/events.md
docs/client-roadmap.md
```

目标：

- 建立 Go module 和最小 Edge 进程。
- 提供 `GET /v1/health`。
- 提供 `/v1/events` WebSocket event stream。
- 提供内存 event bus，支持 seq 和 cursor 的基础结构。
- 提供 `GET /v1/runners` 的 mock 数据来源。

建议文件：

```text
edge-server/go.mod
edge-server/cmd/agenthub-edge/main.go
edge-server/internal/httpserver/server.go
edge-server/internal/events/bus.go
edge-server/internal/runners/registry.go
edge-server/internal/api/handlers.go
edge-server/internal/api/handlers_test.go
```

验收：

```powershell
cd edge-server
go test ./...
go run ./cmd/agenthub-edge --addr 127.0.0.1:3210
```

另开终端：

```powershell
curl http://127.0.0.1:3210/v1/health
curl http://127.0.0.1:3210/v1/runners
```

PR 完成条件：

- Go 测试通过。
- health 和 runners 返回稳定 JSON。
- WebSocket endpoint 可以连接，即使还没有真实事件。

### B. Mock Runner

分支：

```text
feat/client-runner-mock
```

worktree：

```text
.worktrees/client-runner-mock
```

写入范围：

```text
runner/**
docs/client-roadmap.md
```

目标：

- 建立 Go module 和最小 Runner 进程。
- Runner 支持 mock run：启动后输出固定的 stdout/stderr chunk。
- Runner 有清晰的内部状态：idle / running / stopping / stopped。
- 先不接真实 Claude Code、Codex、OpenCode。

建议文件：

```text
runner/go.mod
runner/cmd/agenthub-runner/main.go
runner/internal/run/mock.go
runner/internal/run/mock_test.go
runner/internal/process/state.go
runner/internal/process/state_test.go
```

验收：

```powershell
cd runner
go test ./...
go run ./cmd/agenthub-runner --mock
```

PR 完成条件：

- mock runner 可以单独运行。
- 测试覆盖状态转换和取消逻辑。
- README 说明如何启动 mock runner。

### C. Desktop Shell

分支：

```text
feat/client-desktop-shell
```

worktree：

```text
.worktrees/client-desktop-shell
```

写入范围：

```text
app/desktop/**
app/shared/**
README.md
docs/client-roadmap.md
```

目标：

- 建立最小 Tauri Desktop 壳。
- Desktop 启动时显示 Local Edge 连接状态。
- 能配置或默认连接 `http://127.0.0.1:3210`。
- 能显示 runners 列表。
- 能订阅 `/v1/events` 并把事件追加到简单日志面板。

建议文件：

```text
app/desktop/package.json
app/desktop/src-tauri/tauri.conf.json
app/desktop/src-tauri/Cargo.toml
app/desktop/src/main.tsx
app/desktop/src/App.tsx
app/desktop/src/api/edgeClient.ts
app/desktop/src/api/eventClient.ts
app/shared/README.md
```

验收：

```powershell
cd app/desktop
pnpm install
pnpm build
pnpm tauri dev
```

PR 完成条件：

- Desktop 壳能启动。
- Local Edge 不在线时显示 offline，不崩溃。
- Local Edge 在线时能显示 health 和 runner 状态。

### D. Integration Smoke

分支：

```text
feat/client-local-smoke
```

这个分支不并行，等 A/B/C 合并到 `master` 后再做。

写入范围：

```text
scripts/**
docs/client-roadmap.md
README.md
```

目标：

- 增加一个本地冒烟流程，串起 Edge、Runner、Desktop。
- 明确 Windows PowerShell 跑法。
- 把可以自动化的检查放进脚本；无法自动化的 UI 检查写清手动步骤。

验收：

```powershell
.\scripts\setup.ps1
.\scripts\client-smoke.ps1
```

## 6. 合并顺序

推荐顺序：

1. `feat/client-edge-foundation`
2. `feat/client-runner-mock`
3. `feat/client-desktop-shell`
4. `feat/client-local-smoke`

前三个可以并行开发，但合并时按上面顺序处理，减少冲突。`client-desktop-shell` 在合并前需要 rebase 最新 `master`，因为它依赖 Edge 的实际返回格式。

## 7. 不做什么

本阶段不做：

- Hub 登录、好友、群聊。
- 真实 Claude Code / Codex / OpenCode 适配。
- worktree diff/apply/discard 完整链路。
- 权限审批完整策略。
- Cloud Edge / Hub relay。
- 大范围 API 重构。

这些不是放弃，而是等本地端到端链路跑通后再进入下一轮。

## 8. Review 清单

每个 PR 至少检查：

- 是否只改了分配范围内的文件。
- 是否没有提交 `.worktrees/`、密钥、本机路径、真实服务器配置。
- 是否先更新了必要的 `api/` 契约。
- 是否有基本测试或 smoke 步骤。
- 是否能被另一个同学按 README/PR 描述复现。
- 是否同步了 `docs/client-roadmap.md` 中对应任务状态或备注。
