# AgentHub 客户端路线图

> 2026-05-25 更新：本文保留为客户端方向轻量索引。当前事实源是 `docs/roadmap.md`、`docs/roadmaps/client.md` 和 `docs/handoff/STATE.md`。早期独立 `runner/` 组件已废弃；执行生命周期在 `edge-server/internal/lifecycle/`，Agent Runtime 适配在 `edge-server/internal/adapters/`。

本文面向负责 **Desktop、Local Edge 调度、Agent Runtime adapter、Execution Target 体验** 的开发者和 Agent。

## 1. 当前入口

| 需求 | 先读 |
|---|---|
| 当前进展、并行工作、阻塞 | `docs/handoff/STATE.md` |
| 全局路线和验收 | `docs/roadmap.md` |
| 客户端详细阶段任务 | `docs/roadmaps/client.md` |
| 架构边界和术语 | `docs/system-architecture.md` |
| 实现顺序和目录边界 | `docs/implementation-guide.md` |
| REST / WebSocket 契约 | `api/README.md`、`api/openapi.yaml`、`api/events.md` |

合并方向：`feat/* -> dev/delicious233 -> master`。详细分支管理见 `AGENTS.md` 和 `docs/branch-governance.md`。

## 2. 当前状态

P0-P3、M3b、M4-M7 已完成。当前本地执行链路是：

```text
Desktop UI -> Local Edge -> Edge lifecycle -> Agent Runtime adapter
  -> Agent CLI (Claude Code / OpenCode / Codex)
  -> Edge EventStore / WebSocket events -> UI
```

用户直接选择和管理的是 Agent Profile 与 Execution Target。Claude Code、Codex、OpenCode 是 Agent Runtime，不是完整业务 Agent。旧文档中的 Runner 应理解为 Edge lifecycle + AgentAdapter 的兼容命名。

## 3. 接口边界

| 类型 | 接口或事件 | 当前语义 |
|---|---|---|
| REST | `GET /v1/health` | Desktop 检查 Local Edge、store、Runtime/Target readiness |
| REST | `GET /v1/runners` | 历史兼容接口；当前用于 Runtime availability / Target health 摘要 |
| REST | `GET /v1/agents` | 本地 Agent Runtime adapter 列表 |
| REST | `POST /v1/runs` | 创建 AgentRun |
| REST | `POST /v1/runs/{runId}:cancel` | 取消 AgentRun |
| REST | `POST /v1/permissions/decide` | 权限门控决定 |
| WebSocket | `GET /v1/events?cursor=...` | UI 订阅 typed events 和 replay |
| WebSocket | `runner.online` / `runner.offline` | 历史兼容事件名；当前表示本地 Runtime/Target 可用性变化 |

新增接口或 schema 时优先使用 `runtime`、`profile`、`configuration`、`execution_target` / `target` 命名；不要扩大旧 Runner 抽象。

接口不够时按顺序处理：

1. 先改 `api/openapi.yaml` 或 `api/events.md`。
2. 再改 Go 服务和 TypeScript 调用。
3. 同步 `docs/system-architecture.md` 或 `docs/implementation-guide.md` 的边界说明。
4. PR 说明写清影响：前端、后端、客户端。

## 4. 客户端写入范围

常规客户端任务通常只允许修改：

```text
app/desktop/**
app/shared/**
edge-server/**
api/**
docs/**
```

只有明确涉及 Web UI 或 Hub dispatch bridge 时才碰：

```text
app/web/**
hub-server/**
```

禁止把旧 `runner/**` 当作当前写入范围；根目录已经没有独立 Runner 服务。不要提交 `.worktrees/`、本机绝对路径、账号、密钥、服务器地址、真实 Agent token 或真实项目 workspace 内容。

## 5. 下一步任务

当前任务以 `docs/roadmap.md` 和 `docs/roadmaps/client.md` 为准。高优先级方向：

- [ ] 把 Desktop Settings 中 IM 群聊、MCP、模型映射、cc-switch、远控/审计继续接到真实 Hub/Edge/API 或本机配置源。
- [ ] 补 runStore / TanStack Query active run 列表同步链，减少只靠 optimistic run 的状态差异。
- [ ] 决定 `/v1/runners`、`runner.*` 是否长期作为 deprecated compatibility，并规划 Runtime/Target 命名迁移。
- [ ] Web UI 移植继续保持 `.worktrees/webui-desktop-port` 独立，合并前处理落后主分支和产品入口确认。

## 6. 验证命令

文档或 API 变更：

```powershell
git diff --check
python -c "import yaml, pathlib; yaml.safe_load(pathlib.Path('api/openapi.yaml').read_text(encoding='utf-8')); print('yaml ok')"
```

Edge 或客户端执行链路变更：

```powershell
cd edge-server
go test ./... -short -count=1

cd ..\app\desktop
pnpm test
pnpm build
pnpm test:e2e
```

Desktop UI 小改可按影响面运行定向 Vitest / Playwright，并在 PR 或 handoff 中写清未跑全量的原因。`scripts/client-smoke.ps1` 仍含历史检查；修复前不要把它作为唯一验收依据。

## 7. 交给子 Agent 的方式

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
docs/handoff/STATE.md
docs/roadmap.md
docs/roadmaps/client.md
docs/system-architecture.md
docs/implementation-guide.md
api/README.md
api/openapi.yaml
api/events.md
```

子 Agent 规则：

- 一个子 Agent 只做一个清晰任务。
- 子 Agent 不跨越允许修改范围。
- 子 Agent 发现旧 Runner 术语时先判断它是兼容 API 命名、历史文档，还是需要迁移的当前产品文案。
