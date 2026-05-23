# AgentHub 功能实现文档

## 1. 当前实现状态

当前阶段是 **M3a 完成，向 M3b 推进**。

### M3a 已完成：真实 Agent CLI 集成

已跑通的链路：

```text
Desktop UI -> Local Edge -> AgentAdapter (ClaudeCode / Codex / OpenCode) -> WebSocket events -> UI EventLog
```

M1 的 Mock Run 已被真实 CLI adapter 完全取代。Edge 通过统一的 `AgentAdapter` 接口直接调用 Claude Code、Codex 和 OpenCode 的原生协议。

三种 adapter 实现特点：

| Adapter | 文件 | 协议 | 解析器 |
|---|---|---|---|
| `ClaudeCodeAdapter` | `claude_code.go` | NDJSON stream-json（24 种消息类型） | `NDJSONStreamParser` |
| `CodexAdapter` | `codex.go` | JSONL exec --json（6 种事件类型） | inline scanner |
| `OpenCodeAdapter` | `opencode.go` | JSON run --format json（7 种事件类型） | inline scanner |
| `OrchestratorAdapter` | `orchestrator.go` | 同 Claude Code + orchestrator system prompt | 同 NDJSONStreamParser |

**Claude Code adapter 具体能力**：
- stdin 双向控制协议：`can_use_tool`（权限审批）、`interrupt`（适配器感知取消）、`set_model`、`set_permission_mode`、`stop_task`
- 多轮会话：`--resume <sessionId>`、`--continue`、`--fork-session`
- 模型选择：`--model`、`--reasoning-effort`、`--max-thinking-tokens`、`--fast`、`--include-partial-messages`
- 14 种新增系统事件类型（`compact_boundary`、`api_retry`、`task_started/progress/notification`、`session_state_changed`、`hook_started/progress/response`、`tool_use_summary`、`auth_status`、`rate_limit`、`status_change`）

**共享层**：
- `model_config.go`：模型别名映射（Claude: opus/sonnet/haiku；Codex: gpt-5 变体；OpenCode: provider/model 格式）+ 推理强度映射
- `runnerctx.RunProcessContext`：跨 API handler → executor → adapter 的共享运行上下文
- `control_protocol.go`：stdin 控制消息的编码/解码和 `DefaultPermissionHandler`

**测试覆盖**：adapter 包 32 个单元测试 + 14 个集成测试，覆盖消息解析、控制协议、端到端执行、工具调用、取消、命令行构建。

### 待 M3b 完成

- Orchestrator 协调多 Agent 的 dispatch 和聚合逻辑。
- Clone / Init / Worktree 创建。
- 非默认工作目录隔离。

完整 P0 还没有闭环：

- Project / Thread / Item 持久化（M2 阶段已部分完成 file_store）。
- Runner 进程生命周期通过 ProcessExecutor 管理（已完成），但需要与 AgentAdapter 完整集成。
- Diff / Artifact / Apply / Discard。
- Approval 和 Preview。

主线协议：

```text
REST JSON API + WebSocket typed events
```

接口契约位置：

```text
api/
├── README.md
├── conventions.md
├── openapi.yaml
└── events.md
```

## 2. 三人分工

后续按 **前端、后端、客户端** 三个部分并行推进。API 契约是共享边界，不单独拆一堆文档分支。

| 部分 | 主要目标 | 主要目录 | 默认先读 |
|---|---|---|---|
| 前端 | Web 工作台、IM 流、Diff/Preview/Approval 面板、前端状态 | `app/web/`、`app/shared/` | `README.md`、`docs/product-requirements.md`、`docs/system-architecture.md` |
| 后端 | Hub Server、Edge-Hub 通信、账号/群聊/同步/中继 | `hub-server/`、`edge-server/`、`api/` | `README.md`、`docs/system-architecture.md`、`api/README.md` |
| 客户端 | Desktop、Runner、Edge 本地调度、Agent CLI、workspace、preview | `app/desktop/`、`edge-server/` | `docs/client-roadmap.md`、`docs/client-handoff.md`、`api/README.md` |

需要论证细节时，再精确读取 1-3 篇 `docs/reference/**`。不要一开始扫描全部 reference。

## 3. API Foundation 规则

- REST API 负责命令和查询。
- WebSocket typed events 负责实时状态流。
- `api/openapi.yaml` 汇总 REST endpoint。
- `api/events.md` 汇总事件信封和事件表。
- `api/conventions.md` 规定 ID、错误、分页、权限、阶段。
- 不创建 `api/events.schema.json`，事件契约先用 `api/events.md` 维护，避免过早加重。

接口更新规则：

1. P1-P4 endpoint 可以作为规划占位保留。
2. 进入 M2/M3a/M3b/M4 实现的 P0 endpoint 必须补齐：
   - request body；
   - response schema；
   - error code；
   - owner；
   - phase；
   - 会触发的 event。
3. 协议改动先改 `api/openapi.yaml` 或 `api/events.md`，再改 Go 服务和 TypeScript 调用。
4. `app/shared` 的 TypeScript 类型必须跟已实现的 P0 schema 对齐。

## 4. 阶段路线

| 阶段 | 目标 | 写入范围 | API 影响 | 验收 |
|---|---|---|---|---|
| M1 | 收口当前 mock 链路 | `app/desktop/`、`app/shared/`、`edge-server/`、`runner/`、`scripts/client-smoke.ps1` | 保持 `/v1/health`、`/v1/runners`、`/v1/runs`、`/v1/events` 稳定 | Go tests、Vitest、Playwright、client smoke |
| M2 | Edge 本地权威数据层，Desktop 启动编排作为辅助能力 | `edge-server/`、`api/`、`app/desktop/src-tauri/` | 补 Project/Thread/Run/Item snapshot schema | Edge 重启后 Project/Thread/Run/Item/EventStore 可恢复 |
| M3a | 真实 AgentAdapter 集成（已完成） | `edge-server/internal/adapters/`、`edge-server/internal/runnerctx/` | 补 run start/cancel/error schema 和 event | Claude Code / Codex / OpenCode 三种 adapter 可启动、解析、stdin 取消，32+14 测试通过 |
| M3b | 多 Agent 协调、Orchestrator、Clone/Init/Worktree | `edge-server/`、`runner/`、`api/` | 补 orchestrator dispatch schema | Orchestrator 可拆解任务、分派 sub-agent |
| M4 | Project / Worktree / Diff / Apply / Discard / Preview | `edge-server/`、`runner/`、`app/desktop/`、`api/` | 补 artifact、diff、preview、approval schema | 用户能审查并应用或丢弃变更 |

客户端集成期继续在 `feat/client-dev` 上收口。只有互不相干的大任务，才从 `master` 或 `feat/client-dev` 新切短分支。

## 5. Go 服务边界

### Edge Server

负责：

- REST API for UI。
- WebSocket event stream。
- Project / Thread / Item 存储。
- EventStore 和 cursor 恢复。
- Context Builder。
- Approval policy。
- Runner Manager。
- Artifact index。

不负责：

- 直接执行 Agent CLI。
- 直接读写远程 Cloud workspace。

### Runner

当前 Runner 功能已整合到 `edge-server/internal/lifecycle/` 和 `edge-server/internal/adapters/` 中：

- `ProcessExecutor`（`lifecycle/process_executor.go`）：Agent CLI 子进程的启动、等待、取消，workspace/workdir 隔离，环境变量注入，stdio 管道管理。
- `AgentAdapter`（`adapters/adapter.go`）：各 CLI 的命令构建和输出解析，与进程生命周期解耦。
- `runnerctx.RunProcessContext`：跨层共享的运行上下文。

负责：

- Agent CLI 子进程。
- workspace / worktree。
- stdout/stderr/stdin。
- Diff。
- Preview。
- 文件路径保护。

不负责：

- IM 消息主序列。
- Hub 账号和群聊。

### Hub Server

负责：

- Auth / User。
- Contact / Group。
- Edge 注册。
- Edge-Hub sync。
- Hub relay。
- Web/Mobile 远程控制。

P0 不要求 Hub 完整实现。

## 6. WebSocket 输出规则

Runner 输出不要逐行直接刷 UI。

建议：

```text
50ms 或 8KB 聚合一次 -> run.output.batch
```

每个事件带：

```text
version / id / seq / type / scope / sentAt / payload
```

断线重连用 `cursor` 恢复；无法恢复时，客户端重新拉 REST snapshot。

当前 `edge-server/internal/events/bus.go` 是内存 bus（支持 seq、短历史 replay、WebSocket fanout）。`edge-server/internal/store/file_store.go` 提供 JSON 快照持久化（M4 需扩展到 EventStore 完整落地）。

## 7. 开发规范

- 三个长期 issue 是前端、后端、客户端。
- PR 尽量小，能让一个同学一次看完。
- commit 标题使用 `type(scope): 中文摘要`。
- 每条实现线至少每天 push 一次工作分支，避免进度只留在本机。
- 分支继续开发前先 `git fetch origin` 并同步最新 `master` 或当前集成分支。
- Agent 生成的代码由对应开发者负责审查、测试和解释。
- 首次克隆后运行 `.\scripts\setup.ps1` 启用本地 hooks；需要参考仓库时运行 `.\scripts\setup.ps1 -Reference core`。
- 并行开发使用 `.worktrees/`，具体规则见 `AGENTS.md`。
- 客户端后续继续按 `docs/client-roadmap.md` 和 `docs/client-handoff.md` 推进；M2 的核心验收是 Edge 本地数据可恢复，Desktop 启动编排不能替代这个目标。

PR 说明按影响选择填写：

- 摘要；
- 有关联 issue 时链接；
- 代码或接口变更写验证命令和结果；
- 影响 API 时说明改了哪些 endpoint/event；
- 影响架构或分工时说明同步了哪些文档；
- 涉及日志、截图、配置或脚本时确认没有密钥、本机路径、真实服务器隐私。

## 8. 测试框架现状

当前已经有：

| 方向 | 已有测试 |
|---|---|
| Edge | Go `testing`，覆盖 API handler、event bus、file store、adapter 解析（NDJSON/JSONL/JSON）、控制协议、process executor、mock executor、runner registry、security origin |
| Desktop | Vitest，覆盖 API client、错误处理、hooks、event client |
| Desktop e2e | Playwright，覆盖在线/离线状态、RunnerList、EventLog、Mock Run |
| 全链路 | `scripts/client-smoke.ps1`，覆盖 Edge/Desktop build 和核心接口 |
| Adapter 集成 | Go `testing`，覆盖 Claude Code 和 OpenCode 端到端执行、工具调用、取消、stdin 控制、命令行参数 |

必须继续覆盖的高风险点：

- 权限和审批分支。
- 文件路径和 workspace 边界。
- Runner 命令执行和取消。
- WebSocket event 序号、重连和重复事件。
- Edge-Hub 同步的断线恢复。

## 9. 安全边界

- 不提交 `.env`、token、cookie、私钥、真实服务器地址、生产数据库 dump。
- 示例配置只用 `.env.example` 和占位符。
- issue、PR、日志、截图里也不能出现真实密钥或服务器隐私。
- Agent 执行命令前要确认不会上传文件、打印密钥或访问生产数据。
- Runner 默认只能在授权 workspace 或 worktree 内执行。

## 10. 当前验收命令

提交或 PR 前先确认分支和工作区：

```powershell
git status --short --branch
git diff --check
```

API / 文档变更至少运行：

```powershell
python -c "import yaml, pathlib; yaml.safe_load(pathlib.Path('api/openapi.yaml').read_text(encoding='utf-8')); print('yaml ok')"
```

客户端 M1 代码变更运行：

```powershell
cd edge-server
go test ./...

cd ..\app\desktop
pnpm test
pnpm build
pnpm test:e2e

cd ..\..
.\scripts\client-smoke.ps1
```
