# AgentHub 客户端路线图

本文是客户端方向的开发路线图，面向负责 **Desktop、Runner、Local Edge 调度** 的开发者和 Agent。

## 当前分支结构 (2026-05-24)

```
dev/delicious233          ← 主 dev: P0-P3 全部完成，M4 8/8 已交付
feat/trump-webui          ← Web 前端（Trump）
```

合并方向：`feat/* → dev/delicious233 → master`

详细分支管理见 `AGENTS.md` 和 `docs/roadmap.md`。

## 1. 当前状态

P0-P3 已全部完成，M3b 6/6 完成，M4 8/8 已完成。全链路已跑通：

```text
Desktop UI -> Local Edge -> Real Runner -> Agent CLI (Claude Code / OpenCode / Codex) -> WebSocket events -> UI
```

| 项 | 状态 |
|---|---|
| P0: Claude Code 适配 + 事件管道 | ✅ 27/27 |
| P1: UI 交互体验升级 | ✅ 4/4 |
| P2: 打磨（StatusBar、骨架屏、错误处理、主题） | ✅ 4/4 |
| P3: 性能 + 权限 + E2E | ✅ 3/3 |
| M3b: 多 Agent 协调 6 项 | ✅ 6/6 |
| M4: Hub Server + E2E + 权限门控 + Hub auth + Web 前端 | ✅ 8/8 |
| E2E: Claude Code 5/5, OpenCode 5/5, Codex 5/5 | ✅ |
| 测试: Go 10/10, 前端 191 tests | ✅ |

## 2. 接口边界

| 类型 | 接口或事件 | 用途 |
|---|---|---|
| REST | `GET /v1/health` | Desktop 检查 Local Edge |
| REST | `GET /v1/runners` | UI 查询 Runner 列表 |
| REST | `POST /v1/runs` | 创建 AgentRun |
| REST | `POST /v1/runs/{runId}:cancel` | 取消 AgentRun |
| REST | `POST /v1/permissions/decide` | 权限门控决定 |
| WebSocket | `GET /v1/events?cursor=...` | UI 订阅事件 |

接口不够时按顺序处理：

1. 先改 `api/openapi.yaml` 或 `api/events.md`。
2. 再改 Go 服务和 TypeScript 调用。
3. PR 说明写清影响：前端、后端、客户端。

## 3. 当前分支开发规则

当前在 `dev/delicious233` 上继续开发。只有出现互不相干的大任务，才新切 `feat/*` 分支。

本分支允许修改：

```text
app/desktop/**
app/shared/**
app/web/**
edge-server/**
runner/**
hub-server/**
scripts/**
docs/**
api/**
```

敏感规则：

- 不提交 `.worktrees/`。
- 不提交本机绝对路径、账号、密钥、服务器地址、真实 Agent token。
- 不提交真实项目 workspace 内容。

## 4. 下一步任务

当前 M4 已全部完成，下一步推进：

- [ ] Web 前端集成：`feat/trump-webui` → `dev/delicious233` 合并
- [ ] 继续推进 `docs/roadmaps/client.md` 中的 Phase 0-2 任务

## 5. 验证命令

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

## 6. 交给子 Agent 的方式

子 Agent 接手客户端任务时，主 Agent 必须给出任务卡：

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
docs/roadmap.md
docs/system-architecture.md
api/README.md
api/openapi.yaml
api/events.md
```

子 Agent 规则：

- 一个子 Agent 只做一个清晰任务。
- 子 Agent 不跨越允许修改范围。
