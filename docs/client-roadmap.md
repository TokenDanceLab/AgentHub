# AgentHub 客户端路线图

本文是客户端方向的开发路线图，面向负责 **Desktop、Runner、Local Edge 调度** 的开发者和 Agent。

当前客户端工作固定在集成分支：

```text
feat/client-dev
```

本分支用于持续集成客户端链路，不再回到早期的 A/B/C 三条实验分支上开发。`docs/client-handoff.md` 是给接手 Agent、DeepSeek 和 UI 同学看的客户端操作手册，当前阶段保留在 `docs/`，不要误当成对外产品文档。

## 1. 当前判断

客户端 M1 的主链路已经成立：

```text
Tauri Desktop
  -> Local Edge Server
  -> Mock Runner
  -> WebSocket events
  -> Desktop UI
```

当前状态：

| 项 | 状态 |
|---|---|
| Local Edge Foundation | 已合入 `feat/client-dev` |
| Mock Runner | 已合入 `feat/client-dev` |
| Desktop Shell | 已合入 `feat/client-dev` |
| Shared TS types | 已合入 `feat/client-dev` |
| i18n 基础设施 | 已合入 `feat/client-dev` |
| 本地 smoke 脚本 | 已合入 `feat/client-dev` |
| Playwright e2e / a11y | 已合入 `feat/client-dev` |
| 图标和视觉稿 | 交给前端 UI 同学处理，不作为客户端工程收口门槛 |
| PR #26 | Ready for review，指向 `master`，CI `validate` 已通过 |

结论：

- `feat/client-dev` 是客户端继续开发的正确分支。
- 当前不应再开新的客户端集成分支。
- 客户端 M1 的工程收口已提交并推送。
- 后续开发应从 M2 开始，优先做 Edge 本地数据层和 EventStore；Desktop 启动编排可作为并行辅助任务。

## 2. 接口边界

客户端先按现有契约推进，不另起协议：

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

接口不够时按顺序处理：

1. 先改 `api/openapi.yaml` 或 `api/events.md`。
2. 再改 Go 服务和 TypeScript 调用。
3. PR 说明写清影响：前端、后端、客户端。

## 3. 当前分支开发规则

客户端集成期默认在 `feat/client-dev` 上继续开发。只有出现互不相干的大任务，才从 `master` 或 `feat/client-dev` 新切短分支。

本分支允许修改：

```text
app/desktop/**
app/shared/**
edge-server/**
runner/**
scripts/client-smoke.ps1
docs/client-roadmap.md
docs/client-handoff.md
api/openapi.yaml
api/events.md
```

敏感规则：

- 不提交 `.worktrees/`。
- 不提交本机绝对路径、账号、密钥、服务器地址、真实 Agent token。
- 不提交真实项目 workspace 内容。
- 不把 `docs/client-handoff.md` 写成长期制度；它只记录当前客户端接手方式。

## 4. M1 收口：客户端可验证版本

目标：把 `feat/client-dev` 收成一个可以被同学拉下来继续开发的稳定版本。

### M1.1 已完成范围

当前已完成：

- Desktop e2e 测试：`app/desktop/e2e/**`
- Playwright 配置：`app/desktop/playwright.config.ts`
- a11y 语义增强：`StatusBar`、`RunnerList`、`EventLog`
- `docs/client-handoff.md` 更新
- `scripts/client-smoke.ps1` 支持自启动并清理 Edge
- PR #26 正文已同步 M1 范围、验证命令和后续建议

保留边界：

- 图标、配色、布局精修交给前端 UI 方向；客户端分支只保证结构清晰、可测试、可替换。
- 真实 Agent CLI、Project/Thread 持久化、Diff/Approval/Preview 不属于 M1。

M1 验证命令：

```powershell
git diff --check

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

如果本机没有 Playwright Chromium：

```powershell
cd app\desktop
pnpm exec playwright install chromium
```

### M1.2 PR 状态

当前 PR：

- PR #26：`feat(client): 客户端 M1 集成分支 (Edge + Runner + Desktop)`。
- 状态：Ready for review。
- 合并前只需确认 `git status --short --branch` 干净、`gh pr checks 26` 通过，并由负责同学完成最终 review。

## 5. M2：Desktop 启动编排

目标：让 Desktop 不只是“连接已启动的 Edge”，而是逐步具备本地应用该有的启动体验。

优先级：

1. Desktop 检测 Edge 是否在线。
2. Edge 不在线时给出明确状态和启动入口。
3. Tauri 侧能启动 Local Edge 进程。
4. Edge 启动失败时展示错误，不让 UI 卡死。
5. Desktop 关闭时按策略处理 Edge：跟随退出或保持后台运行。

建议拆分：

| 任务 | 写入范围 |
|---|---|
| Desktop sidecar spike | `app/desktop/src-tauri/**`、`app/desktop/src/**` |
| Edge process lifecycle | `app/desktop/src-tauri/**`、`edge-server/**` |
| UI 状态面板 | `app/desktop/src/**` |

M2 不要求一次解决自动更新、安装包、系统托盘。

## 6. M3：真实 Runner 入口

目标：从 Mock Runner 走向真实 Agent CLI 适配，但先只接一个。

优先级：

1. Runner 增加 adapter 接口。
2. 先接 Codex CLI 或 Claude Code 二选一。
3. stdout/stderr 继续转换成 `run.output.batch`。
4. 进程退出码映射成 `run.finished` 或 `run.failed`。
5. 取消 run 能停止子进程。

建议写入范围：

```text
runner/**
edge-server/**
api/openapi.yaml
api/events.md
app/shared/**
app/desktop/src/**
```

验收重点：

- Agent CLI 不存在时有清晰错误。
- 不把用户本机 token、配置路径、历史命令写进日志。
- 取消任务不会留下孤儿进程。

## 7. M4：Project / Worktree / Diff

目标：开始接近 AgentHub 的真实产品形态。

优先级：

1. Project 列表和打开本地项目。
2. 每个 run 创建独立工作区或 worktree。
3. 检测 changed files。
4. 生成 diff。
5. Desktop 展示 changed files 和 diff。
6. Apply / Discard 先走最小闭环。

接口需要提前补充：

```text
GET /v1/projects
POST /v1/projects
GET /v1/threads
POST /v1/threads
GET /v1/runs/{runId}/artifacts
GET /v1/artifacts/{artifactId}
POST /v1/artifacts/{artifactId}:apply
POST /v1/artifacts/{artifactId}:discard
```

这部分必须先改 `api/`，再实现 UI 和 Go 服务。

## 8. 交给 DeepSeek / 子 Agent 的方式

DeepSeek 或其他 Agent 接手客户端任务时，主 Agent 必须给出任务卡：

```text
目标：
分支：
允许修改：
必须阅读：
不能修改：
验证命令：
提交要求：
```

默认必须阅读：

```text
AGENTS.md
docs/client-roadmap.md
docs/client-handoff.md
api/README.md
api/openapi.yaml
api/events.md
```

子 Agent 规则：

- 一个子 Agent 只做一个清晰任务。
- 子 Agent 不跨越允许修改范围。
- 子 Agent 不直接合并分支。
- 主 Agent 负责最终 review、测试、提交和 PR 说明。

## 9. Review 清单

每次提交前至少检查：

- 是否仍在正确分支。
- 是否没有提交 `.worktrees/`、密钥、本机路径、真实服务器配置。
- 是否先更新了必要的 `api/` 契约。
- 是否运行了对应测试。
- 是否同步了 `docs/client-handoff.md` 或本路线图中的状态。
- 是否能让另一个同学按文档复现。

## 10. 当前下一步

当前最应该做：

1. 保持 PR #26 可 review：不要把 UI 视觉稿、真实 Agent adapter 或 Hub 能力混进 M1。
2. 合并前再跑一次 `gh pr checks 26` 和必要的本地 smoke。
3. 合并后从 `master` 或 `feat/client-dev` 新切短分支进入 M2。
4. M2 优先实现 Edge 本地数据层：Project/Thread/Run/Item store、EventStore、cursor 恢复和 REST snapshot。
5. Desktop 启动编排可并行推进，但不能替代 M2 的数据可恢复验收。
