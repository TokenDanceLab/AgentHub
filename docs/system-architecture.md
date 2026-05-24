# AgentHub 系统架构文档

## 1. 总体架构

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

## 2. Agent 产品模型

AgentHub 的 UI、API 和文档必须严格区分以下概念，避免把运行时、Agent、配置和执行位置混成一个对象。

| 概念 | 含义 | 例子 | 权威来源 |
|---|---|---|---|
| Agent Runtime | 能启动和解析某类 Agent CLI/SDK 的执行适配器。它回答“用什么运行”。Runtime 是 adapter 能力，不是用户配置好的 Agent。 | Claude Code、Codex、OpenCode | Edge `AgentAdapter` registry |
| Agent Profile | 面向用户选择的 Agent 实例。它回答“谁来做事”。 | `Reviewer on Codex/gpt-5.4-high`、`Builder on Claude Code/sonnet` | Hub CustomAgent 或 Edge local profile |
| Agent Configuration | Agent Profile 的可编辑配置集合。它回答“按什么规则做事”。 | `AGENTS.md`、Agent memory、上下文、聊天记录、工作目录、Skill、MCP、模型参数、审批策略 | Edge Context Builder + Hub profile store |
| Execution Target | 一次 Run 实际运行的位置。它回答“在哪里执行”。 | Local Desktop Edge、Remote Edge over SSH/Tailscale、Cloud Edge、Hub Relay target | Edge registration + Hub routing |
| Run Session | 某次 AgentRun 的运行上下文和生命周期。它回答“这次执行是什么状态”。 | queued/running/streaming/waiting/finished/failed/cancelled | Edge lifecycle + EventStore |

### 2.1 Runtime 不是 Agent

`Claude Code`、`Codex`、`OpenCode` 在 UI 中应标记为 **Agent Runtime**，不能直接称为业务 Agent。Runtime 的基础能力例如流式输出、工具调用、文件修改、多轮对话，是平台接入门槛，不应作为主要产品卖点展示。用户真正要管理的是 Agent Profile：

```text
Agent Profile
  = Agent Runtime
  + Model / Provider
  + Agent Configuration
  + Workspace / worktree
  + Skill catalog
  + MCP tools / tool allowlist
  + approval policy
  + execution target
```

同一个 Runtime 可以被多个 Profile 复用。例如 `Codex` Runtime 可以对应“前端 Builder”“安全 Reviewer”“文档整理 Agent”；它们的模型、上下文、Skill、MCP、审批策略和执行目标可以不同。UI 中展示“Agent”时应展示 Profile 名称，并在详情中显示 Runtime、模型和 Target。

### 2.2 Agent Configuration

Agent 配置至少包含：

- `runtime_id`：`claude-code`、`codex`、`opencode` 等 Runtime。
- `model` / `provider` / `reasoning_effort`：模型、Provider、推理强度和模型参数。
- `model_mapping`：Profile 层的模型别名映射，例如 `opus`、`sonnet`、`haiku` 到真实 provider/model。
- `provider_binding`：本地或团队级 provider 来源，后续可接入 cc-switch 的可用性、配额和故障切换状态。
- `workspace_root` / `worktree_policy`：工作目录和隔离策略。
- `instructions_sources`：`AGENTS.md`、项目规则、用户指令、团队指令。
- `memory_sources`：Agent memory、会话摘要、项目长期记忆。
- `conversation_context`：当前 Thread、被引用聊天记录、Artifact、Diff、Preview 和用户选择的上下文片段。
- `skills`：可用 Skill、自动触发规则、脚本权限。
- `mcp_servers`：可用 MCP Server、工具白名单、OAuth/凭据状态。
- `approval_policy`：文件、命令、网络、电脑操控、远控动作的确认策略。
- `execution_target`：本地、远程 SSH/Tailscale、Cloud、Hub Relay。

### 2.3 Execution Target

执行位置必须显式建模，而不是通过 UI 文案猜测：

| Target | 说明 | 典型传输 | 安全要求 |
|---|---|---|---|
| Local Edge | 当前 Desktop 同机 Edge 执行 | localhost REST/WS | 本地确认、workspace 限界 |
| Remote Edge | 用户自己的远程机器执行 | SSH、Tailscale、Hub Relay | 设备绑定、远程审批、命令审计 |
| Cloud Edge | 托管 VM/容器执行 | Hub control plane + internal network | 租户隔离、资源限额、凭据隔离 |
| Hub Relay Target | Hub 中继到某个可用 Edge | Hub WebSocket / relay | TokenDance ID + Hub device proof |

UI 中的“运行位置”必须显示 Target、设备、工作目录、在线状态和审批策略。远程执行不能让 UI 直接访问 Agent Runtime 进程；必须经过 Edge 或 Hub Relay。

### 2.4 TokenDance ID、鉴权和安全审计

TokenDance ID 是跨端身份入口；Hub 本地 session 是 AgentHub 的产品会话。最终浏览器/桌面登录应由 Hub Server 完成 TokenDance ID OIDC code exchange、验证 issuer/audience、映射 `tokendance_sub` 到 Hub user，再签发 Hub access/refresh session。现有 TokenDance bearer-token middleware 只是兼容路径，不能替代完整 Hub session。

安全审计必须覆盖：

- Agent Profile 变更、Runtime 切换、模型映射变更。
- MCP Server、Skill、cc-switch Provider、远程执行目标的新增/修改。
- 每次 Run 的 execution target、workspace、审批决策、工具调用和文件写入。
- 远程控制、SSH/Tailscale/Cloud 执行和电脑操控类高风险动作。

### 2.5 平台服务位置

AgentHub 后续平台能力按下表放置，避免散落到前端本地状态或某个 Runtime adapter 内：

| 能力 | 架构位置 | 说明 |
|---|---|---|
| TokenDance ID / OIDC | Hub Server auth + TokenDance ID | TokenDance ID 统一第三方登录和账号主体；Hub 只保存 AgentHub 会话、设备和授权关系。 |
| 在线 IM / 多端同步 | Hub Server conversation/contact/group/sync | Hub 是云端消息主序列和多端同步中心；Edge 保留本地执行权威。 |
| Agent 市场 | Hub Server profile catalog + Web/Desktop UI | 市场发布和安装 Agent Profile 模板；模板引用 Runtime、模型映射、Skill/MCP 需求和安全声明，不打包真实密钥。 |
| Skill 管理 | Hub catalog + Edge Context Builder | Hub 管理团队可见性、版本和审计；Edge 负责本机解析、脚本权限和运行时注入。 |
| MCP 管理 | Hub registry + Edge MCP connector | Hub 存 server 元数据、OAuth 状态和策略；Edge 连接本地或远端 MCP server 并执行工具白名单。 |
| 模型配置 / 模型映射 | Hub profile store + Edge adapter model config | Hub 保存用户和团队偏好；Edge 把别名、推理强度和 provider/model 映射成 Runtime CLI 参数。 |
| cc-switch 集成 | Provider binding service | cc-switch 只作为 provider 可用性、路由和配额来源；AgentHub Profile 引用其 provider binding，不在文档或 Profile 中存真实 key。 |
| 远程控制 | Hub relay + Edge device agent | Web/Mobile/另一个 Desktop 通过 Hub 对目标 Edge 发起远控、审批和预览代理。 |
| 账号鉴权 | Hub session + device proof + scoped tokens | 每个请求先验证 Hub session，再验证设备、Target 和 Workspace 权限。 |
| 安全审计 | Hub audit log + Edge local audit buffer | Edge 先本地记录高风险执行和审批，联网后同步 Hub；Hub 提供团队审计查询。 |

## 3. 当前已完成拓扑

P0-P3 已全部完成，M4 8/8 已交付。真实 Agent CLI 集成通过统一 AgentAdapter 接口对接三种 CLI：

```text
Desktop Web UI
  -> Local Edge Server
  -> AgentAdapter (ClaudeCode / Codex / OpenCode)
  -> NDJSON / JSONL / JSON Parse -> WebSocket events
  -> Desktop EventLog
```

Edge 通过 AgentAdapter 接口直接调用各 CLI 的原生协议：

| Adapter | CLI 协议 | 解析方式 |
|---|---|---|
| ClaudeCodeAdapter | `claude -p --output-format stream-json --verbose` | NDJSON 逐行解析，24 种消息类型 |
| CodexAdapter | `codex exec --json` | JSONL 逐行解析，6 种事件类型 |
| OpenCodeAdapter | `opencode run --format json` | JSON 逐行解析，7 种事件类型 |

### 关键实现细节

**Claude Code adapter**：
- stdin 双向控制协议：支持 `can_use_tool`（权限审批）、`interrupt`（取消）、`set_model`、`set_permission_mode`、`stop_task` 控制消息
- 会话管理：`--resume <sessionId>` 指定会话、`--continue` 继续最近会话、`--fork-session` 分叉会话
- 模型选择：`--model` + `--reasoning-effort` + `--max-thinking-tokens` + `--fast`
- 14 种新增 BusEvent 常量：`compact_boundary`、`api_retry`、`task_started`/`task_progress`/`task_notification`、`session_state_changed`、`hook_started`/`hook_progress`/`hook_response`、`tool_use_summary`、`auth_status`、`rate_limit`、`status_change`

**Codex adapter**：
- `exec --json` 模式，结构化 JSONL 解析
- 推理强度映射：low→minimal、medium→low、high→high、max→xhigh
- 权限模式映射到沙箱级别：plan→read-only、bypassPermissions→danger-full-access

**OpenCode adapter**：
- `run --format json` 结构化 JSON 事件解析
- 支持 provider/model 格式（`-m anthropic/claude-sonnet-4-6`）
- 会话管理：`--session`、`--continue`、`--fork`
- `--agent` 模式选择（build、plan 等）
- `--thinking` + `--variant` 推理控制

**共享基础设施**：
- `model_config.go`：跨 adapter 的模型别名映射（Claude: opus/sonnet/haiku；Codex: gpt-5 变体；OpenCode: provider/model 格式）和推理强度映射
- `runnerctx.RunProcessContext`：API handler → lifecycle executor → agent adapter 之间共享的运行上下文
- adapter-aware 取消：通过 stdin 发送 `interrupt` 控制消息，各 adapter 可中断运行中的进程

### 测试覆盖

adapter 包包含 32 个单元测试（覆盖 24 种 NDJSON 消息类型解析、控制协议、边界情况）和 14 个集成测试（覆盖 Claude Code 和 OpenCode 的端到端执行、工具调用、取消、stdin 控制、命令行参数构建）。

当前本地拓扑（P0-P3 已全部完成）：

```text
Desktop App
  ├─ Desktop UI
  ├─ Local Edge Server
  │   ├─ lifecycle executor
  │   └─ AgentAdapter registry
  └─ Agent CLI
       ├─ Claude Code
       ├─ Codex
       └─ OpenCode
```

当前架构边界：

- Hub Server 已完整实现（三层架构，17 migrations，Gin + GORM + Redis + PostgreSQL），但本地执行不依赖 Hub。
- Web/Mobile 可通过 Hub 远程查看和审批。
- Desktop UI 默认只连接本机 Local Edge。
- Edge 才能启动 Agent CLI 进程，UI 不直接启动 Agent CLI。
- Agent CLI 只能在授权 workspace 或 worktree 内执行。

## 4. 组件职责

| 组件 | 目录 | 职责 |
|---|---|---|
| Web / Desktop UI | `app/` | IM 工作台、Agent Profile 选择、Thread、Diff、Preview、Approval、远程控制入口 |
| Hub Server | `hub-server/` | 中心 IM、TokenDance ID relying party、账号、群聊、多端同步、Agent/Profile/Skill/MCP catalog、Edge 中继、安全审计 |
| Edge Server | `edge-server/` | 本地项目、Thread、Context Builder、执行生命周期、Agent Runtime adapter、Artifact 索引、Target 权限执行 |
| API Contract | `api/` | REST API 和 WebSocket event 契约 |

> **注意**：早期曾存在独立的 `runner/` 组件。当前进程生命周期管理已合并到 `edge-server/internal/lifecycle/`，Agent Runtime 适配层位于 `edge-server/internal/adapters/`，不再作为独立组件。旧文档里的 Runner 应理解为 Edge lifecycle + AgentAdapter，不要再新增 root-level `runner/`。

## 5. 通信方式

当前主协议是：

```text
REST JSON API + WebSocket typed events
```

| 通信 | 方式 | 用途 |
|---|---|---|
| UI -> Edge | REST JSON | 查询项目、创建 Thread、启动 Run、审批 |
| Edge -> UI | WebSocket typed events | 消息增量、run output、artifact、preview、审批请求 |
| Edge lifecycle -> AgentAdapter | Go interface + process context | 启动执行、取消执行、读取产物、解析 CLI 输出 |
| AgentAdapter -> Edge | typed events | 日志、状态、Diff、Artifact、Preview |
| Edge -> Hub | REST sync + reverse WebSocket | 同步、注册、中继、远程控制 |
| Web/Mobile -> Hub | REST JSON + WebSocket | 云端会话、远程查看、远程审批 |
| Hub -> TokenDance ID | OIDC Authorization Code + PKCE / JWKS | 登录、token 验证、账号映射 |
| Edge -> MCP / Skill runtime | local process / HTTP / stdio | 工具发现、工具执行、脚本权限控制 |

Protobuf、Connect-RPC、JSON-RPC 不是当前主线；只作为未来可选或局部 bridge 方案。

安全边界：

- WebSocket 只投递事件，不承载普通查询或命令。
- UI 不能绕过 Edge 直接访问 Agent CLI。
- Agent CLI 进程不默认读取用户全盘、本机密钥、浏览器数据或系统配置。
- 日志和事件不应包含 token、cookie、私钥、真实服务器隐私。
- 远程控制和电脑操控事件必须带 Target、Profile、审批来源和审计 ID。

## 6. 三条数据线

### 控制线

负责命令、调度、状态和审批：

```text
UI -> Edge -> AgentAdapter -> Agent CLI
UI -> Hub -> Edge -> AgentAdapter -> Agent CLI
```

### 事件线

负责实时输出和状态变化：

```text
Agent CLI -> Edge EventStore -> Edge WebSocket Bus -> UI
Edge EventStore -> Hub Sync -> Web/Mobile
```

`edge-server/internal/events/bus.go` 是内存投递组件，负责 seq、短历史 replay 和 WebSocket fanout。EventStore 已完整落地到 Edge 本地存储。

### 同步线

负责 Edge 和 Hub 的事件同步：

```text
Edge EventStore -> Hub Sync -> other devices
```

本地 EventStore 语义已完整实现。Hub Server 也已完整实现（三层架构，17 migrations，Gin + GORM + Redis + PostgreSQL），提供账号、IM、多端同步和中继能力。

## 7. EventStore 和恢复语义

EventStore 语义（已完整实现）：

1. Edge 先把事件持久化到 EventStore，再投递到 WebSocket。
2. `seq` 是单个 Edge EventStore 内的单调递增序号。
3. UI 断线重连时带上 `cursor`，Edge replay `seq > cursor` 的事件。
4. 如果 cursor 太旧、历史被清理或 Edge 无法 replay，UI 拉 REST snapshot 重建状态。
5. Edge 重启后，Project、Thread、Run、Item、Artifact 的关键状态必须能从本地 store 恢复。

最小恢复路径：

| 场景 | 恢复方式 |
|---|---|
| WebSocket 断线 | UI 用最后的 `seq` 作为 cursor 重连 |
| cursor 过期 | UI 拉 Project/Thread/Run/Item REST snapshot |
| Edge 重启 | Edge 从本地 store 恢复 snapshot，再继续分配 seq |
| Agent CLI 崩溃 | Edge 将 Run 标为 failed，并记录 error Item |
| 慢订阅者丢事件 | WebSocket Bus 可丢短实时事件，UI 通过 snapshot 校正 |

## 8. 权威模型

系统必须区分多类权威：

| 权威 | 含义 |
|---|---|
| Conversation Authority | 谁负责消息主序列 |
| Execution Authority | 谁负责实际执行 AgentRun |
| Artifact Authority | 谁负责产物索引、读取和应用 |
| Memory Authority | 谁负责项目规则、摘要和上下文 |

示例：

```text
本地 Thread：Conversation Authority = Edge，Execution Authority = AgentAdapter / Agent CLI
Web 远控本机：Conversation Authority = Hub，Execution Authority = Desktop Edge / AgentAdapter
云端执行：Conversation Authority = Hub，Execution Authority = Cloud Edge / AgentAdapter
```

### 数据权威表

| 数据 | 写入方 | 存储位置 | 同步关系 |
|---|---|---|---|
| Project | Edge | Edge 本地 store | Hub 可同步元数据 |
| Conversation | Edge | Edge 本地 store | Hub 可成为云端主序列 |
| Thread | Edge | Edge 本地 store | Hub 同步摘要和状态 |
| Turn / AgentRun | Edge | Edge 本地 store | Hub 同步状态镜像 |
| Item | Edge | Edge EventStore / item store | Hub 同步消息和摘要 |
| Artifact | Agent CLI 生成，Edge 索引 | workspace + Edge artifact index | Hub 同步 metadata，可按需缓存内容 |
| Approval | Edge 生成，UI 决策 | Edge 本地 store | Hub 可远程审批 |
| Preview | Agent CLI 启动，Edge 路由 | Edge preview registry | Hub 可代理远程访问 |
| Memory | Edge Context Builder | `.agenthub/` + Edge 本地 store | Hub 可同步团队 memory |
| Agent Runtime | Edge adapter registry | Edge process | Hub 可同步 runtime availability |
| Agent Profile | Hub profile store / Edge local profile | Hub DB + Edge cache | Hub 下发团队模板，Edge 可离线使用缓存 |
| Skill / MCP registry | Hub catalog | Hub DB + Edge cache | Edge 按 Profile 策略启用和审计 |
| Model mapping / provider binding | Hub profile store + Edge model config | Hub DB + Edge config | cc-switch 状态可作为 provider binding 输入 |
| Audit log | Edge local audit buffer + Hub audit store | Edge store + Hub DB | 离线先本地，联网后同步 |

## 9. 数据模型主线

```text
Project
  -> Conversation
    -> Thread
      -> Turn / AgentRun
        -> Item
          -> Artifact / Approval / Preview
```

解释：

- Conversation 是 IM 外壳。
- Thread 是任务分支。
- Turn / AgentRun 是一次执行。
- Item 是过程事件或消息。
- Artifact 是可审查产物，例如 Diff、文件、预览地址。

REST snapshot 至少应能按 Project、Thread、Run、Item、Artifact 重建 UI 状态。WebSocket event 负责增量，REST snapshot 负责校正和恢复。

## 10. 部署阶段

| 阶段 | 拓扑 | 状态 |
|---|---|:--:|
| M1 | Desktop UI -> Local Edge -> Mock Run -> WebSocket events | ✅ |
| M2 | Edge 本地持久化，EventStore 恢复，Desktop 启动编排 | ✅ |
| M3a | 真实 AgentAdapter 集成：ClaudeCode / Codex / OpenCode CLI | ✅ |
| M3b | 多 Agent 协调、Orchestrator、sub-agent spawn | ✅ |
| M4 | Hub Server、响应式布局、环境隔离、E2E、权限门控、Hub auth | ✅ |
| P0 | Desktop UI -> Local Edge -> AgentAdapter -> Agent CLI (完整闭环) | ✅ |
| P1 | Local Edge + 多 Agent Thread | 已完成 |
| P2 | Edge <-> Hub 同步，TokenDance ID 登录，Web/Mobile 查看和审批 | 规划中（Q3） |
| P3 | Hub Relay -> Local/Remote/Cloud Edge -> AgentAdapter，远程控制和预览代理 | 规划中（Q3） |
| P4 | 完整团队 IM、Agent 市场、Skill/MCP 管理、模型配置和安全审计 | 规划中 |

## 11. 文档分层

主文档只保留三份：

- `docs/product-requirements.md`
- `docs/system-architecture.md`
- `docs/implementation-guide.md`

深度材料保留在：

- `docs/reference/`
- `docs/archive/`

`docs/research/` 若保留，只作为旧研究草稿或未整理材料，不作为常规阅读入口。新增实现前，先看主文档；需要细节时再查 `docs/reference/`，历史方案再查 `docs/archive/`。
