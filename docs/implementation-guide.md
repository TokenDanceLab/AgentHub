# AgentHub 功能实现文档

## 1. 当前实现目标

当前阶段是 **客户端 M1 收口**。

已经跑通的链路：

```text
Desktop UI -> Local Edge -> Mock Run -> WebSocket events -> UI EventLog
```

这证明了 REST JSON API、WebSocket typed events、Local Edge、Desktop UI 和 mock run 的本地通信链路成立。

完整 P0 还没有闭环：

- Project / Thread / Item 持久化。
- Edge 调 Runner，而不是 Edge 内部 mock flow。
- 真实 Claude Code / Codex / OpenCode adapter。
- workspace / worktree 隔离。
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
| 客户端 | Desktop、Runner、Edge 本地调度、Agent CLI、workspace、preview | `app/desktop/`、`runner/`、`edge-server/` | `docs/client-roadmap.md`、`docs/client-handoff.md`、`api/README.md` |

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
2. 进入 M2/M3/M4 实现的 P0 endpoint 必须补齐：
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
| M3 | 真实 Runner adapter | `runner/`、`edge-server/`、`api/`、`app/shared/` | 补 run start/cancel/error schema 和 event | 能启动一个真实 Agent CLI，取消后无孤儿进程 |
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

负责：

- Agent CLI 子进程。
- workspace / worktree。
- stdout/stderr。
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

当前 `edge-server/internal/events/bus.go` 是内存 bus，只能支撑 M1。M2 需要把 EventStore 落到 Edge 本地存储。

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
| Edge | Go `testing`，覆盖 handler、event bus、runner registry |
| Runner | Go `testing`，覆盖 mock run 和状态机 |
| Desktop | Vitest，覆盖 API client、错误处理、hooks、event client |
| Desktop e2e | Playwright，覆盖在线/离线状态、RunnerList、EventLog、Mock Run |
| 全链路 | `scripts/client-smoke.ps1`，覆盖 Edge/Runner/Desktop build 和核心接口 |

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

cd ..\runner
go test ./...

cd ..\app\desktop
pnpm test
pnpm build
pnpm test:e2e

cd ..\..
.\scripts\client-smoke.ps1
```
