# AgentHub 功能实现文档

## 1. 当前实现状态

当前阶段是 **P0-P3 全部完成，M3b 6/6 完成，M4 8/8 完成，M5 工程基础收敛完成，M6 生产部署完成，M7 Desktop P0 打磨完成**。全部 3 个 Agent Runtime（Claude Code、OpenCode、Codex）端到端测试通过。

### M3a 已完成：真实 Agent CLI 集成

已跑通的链路：

```text
Desktop UI -> Local Edge -> AgentAdapter (ClaudeCode / Codex / OpenCode) -> WebSocket events -> UI EventLog
```

M1 的 Mock Run 已被真实 CLI adapter 完全取代。Edge 通过统一的 `AgentAdapter` 接口直接调用 Claude Code、Codex 和 OpenCode 的原生协议。

实现术语：

- Agent Runtime：Claude Code、Codex、OpenCode 这类 CLI/SDK adapter。
- Agent Profile：用户选择的业务 Agent，由 Runtime + Model + Configuration + Workspace + Skills/MCP + approval + execution target 组成。
- Agent Configuration：`AGENTS.md`、Agent memory、上下文、聊天记录、工作目录、skills、MCP、模型参数、审批策略。
- Execution Target：local、remote SSH/Tailscale、cloud、Hub relay。Target 是 Run 的显式字段，不从 Runtime 名称推断。

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

### M3b 已完成：多 Agent 协调与工作区隔离

- Orchestrator 协调多 Agent 的 dispatch 和聚合逻辑。
- Clone / Init / Worktree 创建。
- 非默认工作目录隔离。

### M4 已完成：产物审查与变更管理

- Project / Thread / Item 持久化（EventStore 完整落地）。
- Edge lifecycle 进程生命周期与 AgentAdapter 完整集成。
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
| 前端 | Web 工作台、IM 流、Agent Profile 选择、Diff/Preview/Approval 面板、前端状态 | `app/web/`、`app/shared/` | `README.md`、`docs/product-requirements.md`、`docs/system-architecture.md` |
| 后端 | Hub Server、TokenDance ID 登录、Edge-Hub 通信、账号/群聊/同步/中继、Profile/Skill/MCP/审计 | `hub-server/`、`edge-server/`、`api/` | `README.md`、`docs/system-architecture.md`、`api/README.md` |
| 客户端 | Desktop、Edge 本地调度、Agent Runtime adapter、workspace、preview、远控 Target | `app/desktop/`、`edge-server/` | `docs/roadmap.md`、`docs/roadmaps/client.md`、`docs/handoff/STATE.md`、`api/README.md` |

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

## 4. 后续实现切片

后续开发按产品模型拆，不再围绕旧 Runner 抽象新增目录或 API。

| 切片 | 后端/API | Edge/客户端 | 前端 |
|---|---|---|---|
| Agent Runtime registry | 暴露 Runtime 可用性和能力，不保存用户配置 | `AgentAdapter` registry 上报 runtime id、版本、能力、健康状态 | Runtime 只在 Profile 详情中展示，不作为主要 Agent 列表 |
| Agent Profile store | Hub 保存团队/用户 Profile，Edge 缓存本地 Profile | Run start 时解析 Profile 到 `RunProcessContext` | Agent 选择器展示 Profile 名称、模型、Target 和风险标记 |
| Agent Configuration | 保存 `AGENTS.md` 引用、memory、上下文、聊天记录、工作目录、Skill/MCP、模型参数、审批策略 | Context Builder 合并配置并生成本次 Run 上下文 | 设置页拆成 instructions、memory、context、workspace、skills、MCP、model、approval |
| Execution Target | Hub 保存设备、Target 权限和 relay 路由 | Edge 支持 local、remote SSH/Tailscale、cloud、Hub relay 的 Target 描述和审计 | 启动 Run 前显示 Target、设备、目录、在线状态和审批策略 |
| TokenDance ID / 鉴权 | Hub 完成 OIDC code exchange、JWKS 校验、Hub session、device proof | Desktop 存 Hub session，不保存第三方 provider token | 登录页和账号页只面向 TokenDance ID，不直接接 GitHub/Google/飞书 |
| 在线 IM / 多端 | Hub conversation/contact/group/sync 和 WebSocket | Edge 同步本地事件、离线缓冲、cursor 恢复 | Web/Desktop/Mobile 共享 Thread、消息、远程审批 |
| Agent 市场 | Hub profile catalog、安装记录、版本和安全声明 | Edge 校验 Runtime/Skill/MCP 依赖是否满足 | 市场页安装 Profile 模板，不要求填真实 key |
| Skill/MCP 管理 | Hub catalog、OAuth 状态、工具白名单、审计 | Edge 连接本地/远端 MCP，执行 Skill 脚本权限控制 | 设置页管理启用状态、权限、连接健康 |
| 模型配置/映射/cc-switch | Hub 保存模型别名、provider binding、cc-switch 状态引用 | Edge 把别名和推理强度映射成 Runtime CLI 参数 | 模型选择器显示别名、真实模型、可用性和配额风险 |
| 安全审计 | Hub audit log 查询和 retention 策略 | Edge 本地 audit buffer 记录高风险命令、文件写入、审批、远控 | Run 详情和管理后台展示审计线索 |

## 5. 阶段路线

| 阶段 | 目标 | 写入范围 | API 影响 | 验收 |
|---|---|---|---|---|
| M1 | 基础骨架和 mock 链路（已完成） | `app/desktop/`、`app/shared/`、`edge-server/`、`scripts/client-smoke.ps1` | 保持 `/v1/health`、`/v1/runners`、`/v1/runs`、`/v1/events` 兼容；新 API 使用 runtime/profile 命名 | Go tests、Vitest、Playwright、client smoke |
| M2 | Edge 本地权威数据层（已完成） | `edge-server/`、`api/`、`app/desktop/src-tauri/` | 补 Project/Thread/Run/Item snapshot schema | Edge 重启后 Project/Thread/Run/Item/EventStore 可恢复 |
| M3a | 真实 AgentAdapter 集成（已完成） | `edge-server/internal/adapters/`、`edge-server/internal/runnerctx/` | 补 run start/cancel/error schema 和 event | Claude Code / Codex / OpenCode 三种 adapter 可启动、解析、stdin 取消，32+14 测试通过 |
| M3b | 多 Agent 协调、Orchestrator、Clone/Init/Worktree（已完成，6/6） | `edge-server/`、`api/` | 补 orchestrator dispatch schema | Orchestrator 可拆解任务、分派 sub-agent |
| M4 | Hub Server + Workspace + Diff + Apply/Discard + Preview + 响应式布局 + 环境隔离 + E2E + 权限门控 + Hub auth（已完成，8/8） | `edge-server/`、`hub-server/`、`app/desktop/`、`api/` | 补 artifact、diff、preview、approval schema | 用户能审查并应用或丢弃变更，三大 Agent 各 5/5 E2E 通过 |
| M5 | 工程基础收敛（已完成） | `edge-server/`、`hub-server/`、`app/`、`api/` | 收敛 API，统一错误处理，清理遗留代码 | 全量测试通过，CI 流水线稳定 |
| M6 | 生产部署（已完成） | `edge-server/`、`hub-server/` | 生产配置、监控、日志、部署脚本 | 生产环境稳定运行 |
| M7 | Desktop P0 打磨（已完成） | `app/desktop/` | UI/UX 打磨、性能优化、边界情况 | Desktop 体验达到 P0 交付标准 |
| M8 | Identity + Profile foundation | `hub-server/`、`edge-server/`、`api/`、`app/` | TokenDance ID OIDC、Hub session、runtime/profile/config/target schema | 用户可登录并创建 Profile，Run 可记录 Profile 和 Target |
| M9 | Remote/Cloud Target + relay | `hub-server/`、`edge-server/`、`api/`、`app/` | Edge device、Hub relay、remote SSH/Tailscale/cloud target、remote approval | Web/Desktop 可远程查看、审批并代理 Preview |
| M10 | Agent Platform | `hub-server/`、`edge-server/`、`api/`、`app/` | Agent 市场、Skill/MCP catalog、模型映射、cc-switch provider binding、安全审计 | 团队可安装 Profile 模板并审计 Run/工具/远控行为 |

当前集成分支为 `dev/delicious233`。只有互不相干的大任务，才从 `master` 新切短分支。

> **注意**：早期 M1-M4 阶段表中曾出现独立的 `runner/` 目录。当前进程生命周期和 Runtime 适配已合并到 `edge-server/internal/lifecycle/` 和 `edge-server/internal/adapters/` 中，不再作为独立目录存在。新增接口优先使用 `runtime`、`profile`、`configuration`、`execution_target` 命名。

## 6. Go 服务边界

### Edge Server

负责：

- REST API for UI。
- WebSocket event stream。
- Project / Thread / Item 存储。
- EventStore 和 cursor 恢复。
- Context Builder。
- Approval policy。
- Run lifecycle manager。
- Artifact index。
- Agent Runtime registry。
- Execution Target 权限执行。

不负责：

- 绕过 `lifecycle` / `adapters` 直接让 UI 操作 Agent CLI。
- 绕过 Hub/Target 权限直接读写远程 Cloud workspace。

### Edge lifecycle + AgentAdapter

当前执行功能由 `edge-server/internal/lifecycle/` 和 `edge-server/internal/adapters/` 共同承担：

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
- Profile / Configuration / Execution Target 在本次 Run 中的解析结果。

不负责：

- IM 消息主序列。
- Hub 账号和群聊。

### Hub Server

负责：

- Auth / User。
- TokenDance ID OIDC relying party、Hub session、device proof。
- Contact / Group。
- Agent Profile / Skill / MCP / 模型映射 catalog。
- Edge 注册。
- Edge-Hub sync。
- Hub relay。
- Web/Mobile 远程控制。
- 安全审计。

Hub Server 已完整实现：三层架构（Handler → Service → Repository），15 个数据库迁移，技术栈 Gin + GORM + Redis + PostgreSQL。

## 7. WebSocket 输出规则

Agent Runtime 输出不要逐行直接刷 UI。

建议：

```text
50ms 或 8KB 聚合一次 -> run.output.batch
```

每个事件带：

```text
version / id / seq / type / scope / sentAt / payload
```

断线重连用 `cursor` 恢复；无法恢复时，客户端重新拉 REST snapshot。

当前 `edge-server/internal/events/bus.go` 是内存 bus（支持 seq、短历史 replay、WebSocket fanout）。`edge-server/internal/store/file_store.go` 提供 JSON 快照持久化。EventStore 已完整落地。

## 8. 开发规范

- 三个长期 issue 是前端、后端、客户端。
- PR 尽量小，能让一个同学一次看完。
- commit 标题使用 `type(scope): 中文摘要`。
- 每条实现线至少每天 push 一次工作分支，避免进度只留在本机。
- 分支继续开发前先 `git fetch origin` 并同步最新 `master` 或当前集成分支。
- Agent 生成的代码由对应开发者负责审查、测试和解释。
- 首次克隆后运行 `.\scripts\setup.ps1` 启用本地 hooks；需要参考仓库时运行 `.\scripts\setup.ps1 -Reference core`。
- 并行开发使用 `.worktrees/`，具体规则见 `AGENTS.md`。
- 客户端后续以 `docs/roadmap.md`、`docs/roadmaps/client.md` 和 `docs/handoff/STATE.md` 为当前入口；`docs/client-roadmap.md` 仅保留为客户端方向轻量索引，`docs/client-handoff.md` 是历史快照，不作为默认接手指南。

PR 说明按影响选择填写：

- 摘要；
- 有关联 issue 时链接；
- 代码或接口变更写验证命令和结果；
- 影响 API 时说明改了哪些 endpoint/event；
- 影响架构或分工时说明同步了哪些文档；
- 涉及日志、截图、配置或脚本时确认没有密钥、本机路径、真实服务器隐私。

## 9. 测试框架现状

当前已经有：

| 方向 | 已有测试 |
|---|---|
| Edge | Go `testing`，覆盖 API handler、event bus、file store、adapter 解析（NDJSON/JSONL/JSON）、控制协议、process executor、mock executor、runtime registry、security origin |
| Desktop | Vitest + React Testing Library，551/560 通过 (38 test files)，覆盖 17 个组件、API client、错误处理、hooks、event client |
| Desktop e2e | Playwright，覆盖在线/离线状态、Runtime/Agent 列表、EventLog、Agent 端到端执行 |
| 全链路 | `scripts/client-smoke.ps1`，覆盖 Edge build、`app/shared` 依赖、Desktop web build、核心 REST 接口和 WebSocket run 事件流 |
| Adapter 集成 | Go `testing`，覆盖 Claude Code、OpenCode、Codex 三种 adapter 端到端执行、工具调用、取消、stdin 控制、命令行参数 |

必须继续覆盖的高风险点：

- 权限和审批分支。
- 文件路径和 workspace 边界。
- Agent Runtime 命令执行和取消。
- WebSocket event 序号、重连和重复事件。
- Edge-Hub 同步的断线恢复。
- Profile / Configuration / Execution Target 解析和审计。

## 10. 安全边界

- 不提交 `.env`、token、cookie、私钥、真实服务器地址、生产数据库 dump。
- 示例配置只用 `.env.example` 和占位符。
- issue、PR、日志、截图里也不能出现真实密钥或服务器隐私。
- Agent 执行命令前要确认不会上传文件、打印密钥或访问生产数据。
- Agent Runtime 默认只能在授权 workspace 或 worktree 内执行。
- Local Edge 可通过 `--local-auth-token` / `AGENTHUB_EDGE_AUTH_TOKEN` 开启本地 token。开启后，除 `/v1/health` 和 CORS preflight 外的 Edge REST API 需要 `Authorization: Bearer <token>` 或 `X-AgentHub-Edge-Token`；浏览器 WebSocket 使用 `/v1/events?access_token=<token>`。默认空 token 只用于本地开发兼容，不代表 Remote/Cloud Edge 鉴权。
- Remote/Cloud/Hub relay Target 必须经过 Hub session、device proof、Target 权限和审计。
- Agent 市场、Skill/MCP、模型映射和 cc-switch provider binding 只能保存公开元数据或引用，不保存真实 provider key。

## 11. 当前验收命令

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
.\scripts\client-smoke.ps1 -EdgeAddr 127.0.0.1:3228
.\scripts\client-smoke.ps1 -EdgeAddr 127.0.0.1:3228 -EdgeAuthToken local-smoke-token
```
