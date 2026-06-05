# AgentHub 架构文档

> 合并自 product-requirements + system-architecture + implementation-guide，去重精简。

## 1. 产品定位

AgentHub 是一个 IM 形态的多 Agent 协作平台。

用户像在飞书/微信里拉群协作一样，把 Reviewer、Builder、Orchestrator 等 Agent Profile 放进同一个项目会话，让它们围绕网页、代码、Diff、Preview 和部署结果协作。Claude Code、Codex、OpenCode 是这些 Profile 可选择的 Agent Runtime，不等同于一个完整业务 Agent。

一句话：

```text
AgentHub = 本地 Agent 工作台 + IM 式多 Agent 协作 + Hub 网络同步与中继
```

当前仓库的最强证据集中在 P0 本地执行主链路：Desktop/Edge 能启动真实 Agent Runtime，并把结构化事件回到 UI。

## 2. 目标用户和场景

| 用户 | 核心需求 |
|---|---|
| 学生/开发者 | 在本地项目里让 Agent 写代码、审查 Diff、启动预览 |
| 小团队 | 像群聊一样组织多个 Agent Profile 协作完成任务 |
| 比赛评审 | 快速看懂产品定位、技术路线、可演示流程和 AI 协作记录 |
| 后续 Agent | 根据文档继续拆任务、补接口、写实现 |

## 3. 核心体验

```text
左侧：Project / Thread
中间：IM 消息流、Agent 进度、审批卡片
右侧：Changed Files / Diff / Preview / Logs / Artifact
底部：输入框，支持 @Agent Profile，详情显示 Runtime / Model / Execution Target
```

用户直接选择和管理的是 Agent Profile。Profile 由 Agent Runtime、模型、Agent Configuration、Workspace、Skill/MCP、审批策略和 Execution Target 组成。

### 当前可演示流

1. 启动 Local Edge
2. 打开 Desktop Web UI
3. UI 显示 Edge 在线状态、Agent 列表、项目列表
4. 用户输入 prompt 并选择 Agent Profile
5. Edge lifecycle 按 Profile 配置启动真实 Agent CLI，实时流式输出
6. UI 通过 WebSocket 接收事件流，显示 Markdown、Tool Call 卡片、Diff 内联

## 4. 产品分层

| 层 | 阶段 | 说明 |
|---|---|---|
| Desktop Command Center | P0 | 本地项目、Thread、AgentRun、worktree、Diff、Approval、Preview |
| IM Collaboration | P1 | 单聊、群聊、@Agent Profile、Orchestrator、多 Agent 审查 |
| Hub Network | P2-P4 | TokenDance ID、账号、好友、群聊、多端同步、Edge 中继、Remote/Cloud Edge |
| Agent Platform | P2-P4 | Agent 市场、Skill/MCP 管理、模型配置、cc-switch provider binding、安全审计 |

P0 必须做到不依赖 Hub 也能在本机完成 Agent 工作台体验。

## 5. 总体架构

AgentHub 采用三层架构：Desktop（React 19 + Tauri 客户端）、Edge Server（执行控制面和本地节点）、Hub Server（云端 IM、账号和中继后端）。

```text
Desktop (React 19 + Tauri) → Edge Server → AgentAdapter → Claude Code / Codex / OpenCode
                                     ⇅
                                Hub Server (Gin + GORM + Redis + PostgreSQL)
```

核心原则：

- Desktop 是一个 Edge Node，不只是客户端。
- 所有能运行 Edge Server 和 Agent CLI adapter 的机器都视为 Edge Node。
- 执行生命周期由 Edge Server 负责，`lifecycle` 管进程，`adapters` 管 CLI 协议。
- Hub 负责账号、IM、多端同步、中继、权限和审计。
- UI 只负责交互，不直接控制 Agent CLI。

## 6. Agent 产品模型

AgentHub 的 UI、API 和文档必须严格区分以下概念：

| 概念 | 含义 | 权威来源 |
|---|---|---|
| Agent Runtime | 能启动和解析某类 Agent CLI/SDK 的执行适配器，回答"用什么运行" | Edge `AgentAdapter` registry |
| Agent Profile | 面向用户选择的 Agent 实例，回答"谁来做事" | Hub CustomAgent 或 Edge local profile |
| AgentTeam | 由多个 Agent Profile 组成的协作模板，回答"哪些角色一起做事" | Hub team store + policy |
| TeamRun / TeamTask | 一次团队目标执行及其子任务 | Hub TeamEvent / TeamRunState + Edge RunEvent |
| Agent Configuration | Profile 的可编辑配置集合：AGENTS.md、memory、上下文、workdir、Skill、MCP、模型参数、审批策略 | Edge Context Builder + Hub profile store |
| Execution Target | 一次 Run 实际运行的位置：local、remote SSH/Tailscale、cloud、Hub relay | Edge registration + Hub routing |
| Run Session | 某次 AgentRun 的运行上下文和生命周期 | Edge lifecycle + EventStore |

### Runtime 不是 Agent

`Claude Code`、`Codex`、`OpenCode` 在 UI 中应标记为 **Agent Runtime**。Registry 的一个 Runtime 可以被多个 Profile 复用——同一个 `Codex` Runtime 可以对应"前端 Builder""安全 Reviewer""文档整理 Agent"，模型、上下文、Skill、MCP、审批策略和执行目标可以不同。UI 展示 Profile 名称，详情中显示 Runtime、模型和 Target。

### Execution Target

| Target | 说明 | 典型传输 | 安全要求 |
|---|---|---|---|
| Local Edge | 当前 Desktop 同机 Edge 执行 | localhost REST/WS | 本地确认、workspace 限界 |
| Remote Edge | 用户自己的远程机器执行 | SSH、Tailscale、Hub Relay | 设备绑定、远程审批、命令审计 |
| Cloud Edge | 托管 VM/容器执行 | Hub control plane | 租户隔离、资源限额、凭据隔离 |
| Hub Relay Target | Hub 中继到某个可用 Edge | Hub WebSocket / relay | TokenDance ID + Hub device proof |

### TokenDance ID 与鉴权

TokenDance ID 是跨端身份入口；Hub 本地 session 是 AgentHub 的产品会话。现有 TokenDance bearer-token middleware 只是身份兼容路径，不能替代完整 Hub session，也不能满足 `/edge` 的 `desktop` 设备门禁。

### 平台服务位置

| 能力 | 架构位置 |
|---|---|
| TokenDance ID / OIDC | Hub Server auth + TokenDance ID |
| 在线 IM / 多端同步 | Hub Server conversation/contact/group/sync |
| AgentTeam / TeamRun 编排 | Hub team/task/event store + Edge runtime execution |
| Agent 市场 | Hub profile catalog + Web/Desktop UI |
| Skill 管理 | Hub catalog + Edge Context Builder |
| MCP 管理 | Hub registry + Edge MCP connector |
| 模型配置 / 模型映射 | Hub profile store + Edge adapter model config |
| cc-switch 集成 | Provider binding service |
| 远程控制 | Hub relay + Edge device agent |
| 安全审计 | Hub audit log + Edge local audit buffer |

## 7. 当前实现状态

P0 本地执行主链路已落地。全部 3 个 Agent Runtime（Claude Code、OpenCode、Codex）已有 live smoke 证据。

### AgentAdapter 集成

```text
Desktop Web UI
  -> Local Edge Server
  -> AgentAdapter (ClaudeCode / Codex / OpenCode)
  -> NDJSON / JSONL / JSON Parse -> WebSocket events
  -> Desktop EventLog
```

| Adapter | CLI 协议 | 解析方式 |
|---|---|---|
| ClaudeCodeAdapter | `claude -p --output-format stream-json --verbose` | NDJSON 逐行解析，24 种消息类型 |
| CodexAdapter | `codex exec --json` | JSONL 逐行解析，6 种事件类型 |
| OpenCodeAdapter | `opencode run --format json` | JSON 逐行解析，7 种事件类型 |

### Runtime 最小闭环

```text
UI
  -> POST /v1/runs 或 Hub /web/agent-tasks
  -> Edge 校验 project/thread/profile/target/workspace
  -> Run(status=queued) + RunEvent(run.created)
  -> ProcessExecutor -> AgentAdapter.BuildCommand()
  -> Claude Code / Codex / OpenCode 原生结构化输出
  -> AgentAdapter.ParseStream()
  -> RunEvent(seq++) append-only
  -> Edge WebSocket cursor replay
  -> UI 渲染 Transcript / Tool timeline / Diff / Approval / Usage
```

Adapter 必须把原生事件归一到稳定事件族：`text_delta`、`thinking`、`tool_call`、`tool_result`、`file_change`、`permission_requested`、`result`、`usage`。前端只依赖 AgentHub 事件，不直接理解某个 CLI 的私有 JSON。

测试覆盖：adapter 包 32 个单元测试 + 14 个集成测试。

### Hub 参与调度时的链路

```text
Web workspace
  -> Hub session/message
  -> POST /web/agent-tasks
  -> Hub WS agent.dispatch
  -> Desktop Hub task bridge
  -> Local Edge POST /v1/runs
  -> Edge run.output.batch / run.agent.text_delta
  -> Desktop POST /edge/agent-tasks/{id}/stream|done|fail
  -> Hub message/agent task events
  -> Web workspace transcript
```

### 八个部署场景现状

| 场景 | 状态 |
|---|---|
| 1. Desktop 本地离线 | 已实现 |
| 2. Desktop 本地在线 | 基本实现（缺部署态 login/logout/reconnect 截图） |
| 3. Desktop 直连远程 Desktop | 未实现 |
| 4. Desktop 中继到远程 Desktop | 未实现 |
| 5. Desktop 直连云 | 未实现 |
| 6. Desktop 中继到云 | 未实现 |
| 7. Web 中继到 Desktop | 最小闭环 |
| 8. Web 中继到云 | 未实现 |

## 8. 组件职责

| 组件 | 目录 | 职责 |
|---|---|---|
| Web / Desktop UI | `app/` | IM 工作台、Agent Profile 选择、Thread、Diff、Preview、Approval |
| Hub Server | `hub-server/` | 中心 IM、TokenDance ID relying party、账号、群聊、多端同步、安全审计 |
| Edge Server | `edge-server/` | 本地项目、Thread、Context Builder、执行生命周期、Agent Runtime adapter、Artifact 索引 |
| API Contract | `api/` | REST API 和 WebSocket event 契约 |

> 早期曾存在独立的 `runner/` 组件。当前进程生命周期已合并到 `edge-server/internal/lifecycle/`，Runtime 适配层位于 `edge-server/internal/adapters/`。`edge-server/internal/runners/` 保留为内部兼容包。

## 9. 通信方式

主协议：REST JSON API + WebSocket typed events。

| 通信 | 方式 |
|---|---|
| UI -> Edge | REST JSON |
| Edge -> UI | WebSocket typed events |
| Edge lifecycle -> AgentAdapter | Go interface + process context |
| AgentAdapter -> Edge | typed events |
| Edge/Desktop bridge -> Hub | REST callbacks + Hub WebSocket dispatch |
| Web/Mobile -> Hub | REST JSON + WebSocket |
| Hub -> TokenDance ID | OIDC Authorization Code + PKCE / JWKS |
| Edge -> MCP / Skill runtime | local process / HTTP / stdio |

安全边界：WebSocket 只投递事件；UI 不能绕过 Edge 直接访问 Agent CLI；Agent CLI 进程不默认读取用户全盘。

## 10. 三条数据线

**控制线**：`UI -> Edge -> AgentAdapter -> Agent CLI`（或经 Hub 中继）

**事件线**：`Agent CLI -> Edge EventStore -> Edge WebSocket Bus -> UI`（或经 Desktop bridge -> Hub -> Web/Mobile）

**同步线**：`Edge EventStore -> Hub Sync -> other devices`

## 11. EventStore 和恢复语义

1. Edge 先把事件持久化到 EventStore，再投递到 WebSocket。
2. `seq` 是单个 Edge EventStore 内的单调递增序号。
3. UI 断线重连带上 `cursor`，Edge replay `seq > cursor` 的事件。
4. cursor 过期时 UI 拉 REST snapshot 重建状态。
5. Edge 重启后 Project、Thread、Run、Item、Artifact 可从本地 store 恢复。

| 场景 | 恢复方式 |
|---|---|
| WebSocket 断线 | UI 用最后 `seq` 作为 cursor 重连 |
| cursor 过期 | UI 拉 REST snapshot |
| Edge 重启 | 从本地 store 恢复 snapshot |
| Agent CLI 崩溃 | Run 标为 failed，记录 error Item |

## 12. 权威模型

| 权威 | 含义 |
|---|---|
| Conversation Authority | 谁负责消息主序列 |
| Execution Authority | 谁负责实际执行 AgentRun |
| Artifact Authority | 谁负责产物索引、读取和应用 |
| Memory Authority | 谁负责项目规则、摘要和上下文 |

数据权威表：

| 数据 | 写入方 | 存储位置 |
|---|---|---|
| Project / Thread / Run / Item | Edge | Edge 本地 store |
| Artifact | Agent CLI 生成，Edge 索引 | workspace + Edge artifact index |
| Approval | Edge 生成，UI 决策 | Edge 本地 store |
| Agent Profile | Hub profile store / Edge local profile | Hub DB + Edge cache |
| Skill / MCP registry | Hub catalog | Hub DB + Edge cache |
| Audit log | Edge local audit buffer + Hub audit store | Edge store + Hub DB |

## 13. 数据模型主线

```text
Project -> Conversation -> Thread -> Turn / AgentRun -> Item -> Artifact / Approval / Preview
```

## 14. 部署阶段

| 阶段 | 拓扑 | 状态 |
|---|---|---|
| M1 | Desktop UI -> Local Edge -> Mock Run -> WebSocket events | 已完成 |
| M2 | Edge 本地持久化，EventStore 恢复 | 已完成 |
| M3a | 真实 AgentAdapter 集成：ClaudeCode / Codex / OpenCode CLI | 已完成 |
| M3b | 多 Agent 协调、Orchestrator、sub-agent spawn | 已完成 |
| M4 | Hub Server、响应式布局、环境隔离、E2E、权限门控、Hub auth | 已完成 |
| M5 | 工程基础收敛 | 已完成 |
| M6 | 生产部署 | 已完成 |
| M7 | Desktop P0 打磨 | 已完成 |
| P0 | Desktop UI -> Local Edge -> AgentAdapter -> Agent CLI (完整闭环) | 已完成 |
| P1 | Local Edge + 多 Agent Thread / AgentTeam | 部分完成 |
| P2 | Edge <-> Hub 同步，TokenDance ID 登录，Web/Mobile 查看和审批 | 进行中 |
| P3 | Hub Relay，远程控制和预览代理 | 规划中（Q3） |
| P4 | 完整团队 IM、Agent 市场 | 规划中 |

## 15. 三人分工

| 部分 | 主要目录 | 主要目标 |
|---|---|---|
| 前端 | `app/web/`、`app/shared/` | Web 工作台、IM 流、Agent Profile 选择、Diff/Preview/Approval 面板 |
| 后端 | `hub-server/`、`edge-server/`、`api/` | Hub Server、TokenDance ID 登录、Edge-Hub 通信、账号/群聊/同步/中继 |
| 客户端 | `app/desktop/`、`edge-server/` | Desktop、Edge 本地调度、Agent Runtime adapter、workspace、preview |

## 16. Go 服务边界

### Edge Server

负责：REST API for UI、WebSocket event stream、Project/Thread/Item 存储、EventStore 和 cursor 恢复、Context Builder、Approval policy、Run lifecycle manager、Artifact index、Agent Runtime registry、Execution Target 权限执行。

不负责：绕过 lifecycle/adapters 直接让 UI 操作 Agent CLI；绕过 Hub/Target 权限直接读写远程 Cloud workspace。

### Hub Server

负责：Auth/User、TokenDance ID OIDC relying party、Hub session、device proof、Contact/Group、Agent Profile/Skill/MCP/模型映射 catalog、AgentTeam/TeamRun/TeamTask/TeamEvent/TeamRunState、Edge 注册、Edge-Hub sync、Hub relay、安全审计。

技术栈：三层架构（Handler -> Service -> Repository），78+ 组数据库迁移，Gin + GORM + Redis + PostgreSQL。

## 17. WebSocket 输出规则

```text
50ms 或 8KB 聚合一次 -> run.output.batch
```

每个事件带：`version / id / seq / type / scope / sentAt / payload`。断线重连用 `cursor` 恢复；无法恢复时拉 REST snapshot。

## 18. 开发规范

- PR 尽量小，commit 标题使用 `type(scope): 中文摘要`
- 每条实现线至少每天 push 一次工作分支
- Agent 生成的代码由对应开发者负责审查、测试和解释
- 首次克隆后运行 `.\scripts\setup.ps1` 启用本地 hooks
- 并行开发使用 `.worktrees/`

## 19. 测试框架

| 方向 | 已有测试 |
|---|---|
| Edge | Go `testing`：API handler、event bus、file store、adapter 解析、控制协议、process executor、security origin |
| Desktop | Vitest + React Testing Library、Playwright e2e |
| 全链路 | `scripts/client-smoke.ps1` |
| Adapter 集成 | Go `testing`：Claude Code、OpenCode、Codex 三种 adapter 端到端 |

必须继续覆盖的高风险点：权限和审批分支、文件路径和 workspace 边界、Agent Runtime 命令执行和取消、WebSocket event 序号和重连、Edge-Hub 同步断线恢复。

## 20. 安全边界

- 不提交 `.env`、token、cookie、私钥、真实服务器地址
- 示例配置只用 `.env.example` 和占位符
- Agent Runtime 默认只能在授权 workspace 或 worktree 内执行
- Local Edge 可通过 `--local-auth-token` / `AGENTHUB_EDGE_AUTH_TOKEN` 开启本地 token
- Remote/Cloud/Hub relay Target 必须经过 Hub session、device proof、Target 权限和审计

## 21. 非目标

- P0 不做完整好友系统
- P0 不依赖 Hub 同步、中继或团队账号
- P0 不做移动端原生执行
- P0 不做完整 SaaS 多租户
- P0 不做 Agent 市场和团队级 Skill/MCP 分发
- AgentHub 不绑定单一 Agent 生态

## 22. 当前路线图摘要

> 摘要自 `docs/tutorials/roadmap.md`（最后更新 2026-06-02），详细进展见该文件。

**当前状态**：P0 全部完成。Desktop 1166/1166 tests、Edge 17/17 Go packages、Hub 17/17 Go packages、i18n 1560 zh/en keys。集成分支 `dev/delicious233`。

**近期完成（2026-06-01 Sprint）**：
- E2E 测试 27/27 全部通过
- Claude Code adapter NDJSON 事件补齐、Codex adapter 能力标记补齐、OpenCode adapter --thinking 修复 + Diff 引擎 Go 移植
- Edge Server --remote-mode 8 执行场景全部打通
- OIDC 全链路验证脚本 + 8 处配置修复
- Agent 决策循环（DecisionLoop）14 tests
- WS 自动重连（指数退避+jitter）
- Draining 状态全栈、RAF 流式渲染、三级审批
- ErrorBoundary chunk recovery、虚拟滚动、6-theme engine

**P1 进行中**：AgentTeam / TeamRun / TeamTask / TeamEvent（Hub 后端已落地，双真实 Runtime Profile 群组 E2E 待完成）

**P2 进行中**：Identity + Edge-Hub Sync（Hub OIDC code exchange 已落地，部署态 login/logout/reconnect 证据待补）

## 23. 当前验收命令

```powershell
git status --short --branch
git diff --check
python -c "import yaml, pathlib; yaml.safe_load(pathlib.Path('api/openapi.yaml').read_text(encoding='utf-8')); print('yaml ok')"

cd edge-server && go test ./... -short -count=1
cd ..\app\desktop && pnpm test && pnpm build && pnpm test:e2e
cd ..\.. && .\scripts\client-smoke.ps1 -EdgeAddr 127.0.0.1:3228
```
