# 协议能力映射：自有契约 / MCP / A2A / AG-UI（宏观 §3 P1）

> 主索引：[architecture.md](../architecture.md)。本文件是 AgentHub 自有 REST/WS 契约与三个外部协议（MCP / A2A / AG-UI）的能力对照、引入红线与评估结论 SSOT。上游基线：`docs/architecture/10-macro-engineering-design.md`（#2065，已合入）§3 协议分层表 + §9 差距路线 P1（本文即其产出）。

## 0. 阅读约定

- **自有契约** = AgentHub Hub Server REST + WS 事件合同（SSOT：`api/openapi.yaml` + `api/events.md`）。
- **外部协议** = MCP、A2A、AG-UI；描述必须给来源链接或仓库内引用，「业界通常」不算证据。
- **引入判定** = 每个外部协议一节判定表；满足全部"引入条件"才允许进入产品代码，否则拒绝或推迟。
- **红线** = 不可让步的死规矩；违反即阻断合入。
- 仓库现状以源码为准；外部规范以官方 spec 页面为准（链接在每节末尾）。

## 1. 自有 REST/WS 契约清单

AgentHub 的产品控制面 SSOT 由两份契约文件承载，所有端（Web/Desktop/Mobile/Edge）只消费这两份契约的派生客户端。

| 契约 | 入口文件 | 职责 | 备注 |
|---|---|---|---|
| REST JSON API | [`api/openapi.yaml`](../../api/openapi.yaml) | Hub + Edge 全量命令/查询端点；端点级状态标签 `x-agenthub-status: implemented/planned`；组件级另有 `contract-draft`（契约已定、实现留白，不挂在任何 operation 上） | Hub success envelope `{"code":"ok","data":...}`（见 [`api/conventions.md`](../../api/conventions.md)） |
| WebSocket typed events | [`api/events.md`](../../api/events.md) | Hub/Edge 实时事件合同；at-least-once 投递、幂等语义、seq_id 语义 | SSOT 三角：`hub-server/internal/ws/frame.go` ↔ `app/shared/src/hubEvents.ts` ↔ OpenAPI `HubWebSocketFrame.type` |
| Edge EventEnvelope | [`api/events.md`](../../api/events.md) §Edge EventEnvelope | Edge stream 单调 seq + 事件 id；断线 cursor 回放 | payload 进 transcript 前脱敏 |
| Hub Frame | [`api/events.md`](../../api/events.md) §Hub Frame | `{type, seq_id?, payload?}` + 31 常量 | `/client/ws` 仅 Hub-issued HS256 token |

**红线**：自有 REST/WS 契约是产品控制面唯一权威；任何外部协议不得替换、覆盖或绕过这两份契约（宏观 §3 红线列）。

## 2. MCP：tool surface 映射与 narrow capability 红线

### 2.1 仓库现状

AgentHub 已有两层 MCP 实现：

| 层 | 源码位置 | 职责 |
|---|---|---|
| MCP config 注入 | [`edge-server/internal/adapters/mcp_config.go`](../../edge-server/internal/adapters/mcp_config.go) | Hub 同步 `MCPServerConfig` → Edge `MCPConfigStore` → Claude Code `--mcp-config` JSON 注入；transport 支持 `stdio` / `sse` / `streamable-http` |
| MCP server endpoint | [`edge-server/internal/mcp/server.go`](../../edge-server/internal/mcp/server.go) | Edge 自身作为 MCP server 暴露 `agenthub_*` 工具；JSON-RPC 2.0 over Streamable HTTP（spec `2025-06-18`）；POST `/mcp` |
| 工具目录 | [`edge-server/internal/mcp/tools_catalog.go`](../../edge-server/internal/mcp/tools_catalog.go) | canonical `agenthub_` 前缀 + deprecated unprefixed aliases；当前 8 个 canonical 工具 |
| ACP↔MCP 桥接 | [`edge-server/internal/adapters/acp/acp_mcp.go`](../../edge-server/internal/adapters/acp/acp_mcp.go) | ACP adapter 进程内复用 MCP tool surface |

### 2.2 MCP tool surface ↔ 自有 REST 映射

下表列出 Edge MCP server 当前暴露的 canonical 工具及其对应的 REST 端点。MCP 工具是 REST 能力的 **narrow projection**，不是平行 API。

| MCP tool（canonical） | 对应 REST 端点 | 能力范围 |
|---|---|---|
| `agenthub_list_projects` | `GET /v1/projects` | 项目列表只读 |
| `agenthub_list_threads` | `GET /v1/threads?projectId=` | 指定项目下 thread 列表只读 |
| `agenthub_get_thread` | `GET /v1/threads/{threadId}` | thread 详情 + recentItems + runs |
| `agenthub_start_run` | `POST /v1/runs` | 启动 run（含 workDir allowlist 校验） |
| `agenthub_get_run_status` | `GET /v1/runs/{runId}` | run 状态只读 |
| `agenthub_approve_action` | `POST /v1/approvals/...` | 审批决策写入 |
| `agenthub_cancel_run` | `POST /v1/runs/{runId}:cancel` | 取消 run |
| `agenthub_send_message` | `POST /v1/threads/{threadId}/items` | 发送用户消息 |

Deprecated unprefixed aliases（`list_projects` 等）仅在 discovery 中标记 `[DEPRECATED]`，未来版本移除。

### 2.3 Narrow capability 红线

| 红线 | 说明 | 证据 |
|---|---|---|
| MCP 只做 tool surface | MCP 是 agent ↔ tools/data 的窄能力投影；不当作通用业务协议、不承载控制面路由/授权/审计 | 宏观 §3 MCP 行 |
| 不替换自有契约 | MCP 工具必须可追溯到上表 REST 端点；禁止新增仅 MCP 可达的业务能力 | 宏观 §3 红线列 |
| Config 注入 ≠ 协议采纳 | `mcp_config.go` 的 Hub→Edge 同步仅为 CLI runtime 注入第三方 MCP server；不等于 AgentHub 采纳 MCP 作为内部协议 | [`mcp_config.go:1-14`](../../edge-server/internal/adapters/mcp_config.go) |
| Auth 镜像 Edge local token | MCP endpoint 复用 Edge bearer token；不引入独立 MCP auth 体系 | [`server.go:14-20`](../../edge-server/internal/mcp/server.go) |

### 2.4 引入判定表

| 条件 | 引入 ✅ | 拒绝 ❌ |
|---|---|---|
| 需要让外部 agent/runtime 以标准 tool 协议访问 AgentHub 能力 | ✅ 通过 MCP server endpoint 暴露 narrow projection | ❌ 若需求是控制面路由/授权/多端同步 |
| 需要注入第三方 tool server 给 coding agent | ✅ 通过 `mcp_config` Hub→Edge 同步 + CLI 注入 | ❌ 若第三方 server 要求 AgentHub 让渡 auth/audit |
| 想用 MCP 替代 REST/WS 作为产品控制面 | — | ❌ 红线：不替换自有契约 |
| 想扩展 MCP 工具覆盖新业务能力 | ✅ 先有 REST 端点，再加 MCP narrow projection | ❌ 仅 MCP 可达的新业务能力 |

### 2.5 外部来源

- MCP spec：Streamable HTTP `2025-06-18` <https://modelcontextprotocol.io/specification/2025-06-18>；旧 session-based `2024-11-05`（已废弃）<https://modelcontextprotocol.io/specification/2024-11-05>

## 3. A2A：远程/跨设备协作场景界定

### 3.1 仓库现状

**AgentHub 当前未引入 A2A 协议。** 仓库内 "a2a" 字样仅出现在前端 demo fixture 命名中（[`app/shared/src/demo/workbenchDemoMessages.ts`](../../app/shared/src/demo/workbenchDemoMessages.ts)、[`app/web/src/api/hubClient.test.ts`](../../app/web/src/api/hubClient.test.ts)），用于标识 agent-to-agent 任务队列的演示数据，与 Google A2A 协议无关。

现有 agent-to-agent 协作由 Hub Server 自有契约承载：

| 自有机制 | 源码位置 | 职责 |
|---|---|---|
| Agent Teams | [`hub-server/internal/router/router.go`](../../hub-server/internal/router/router.go)（Agent Teams 路由组） | team CRUD、member 管理、team run/task/event/route-decision/approval |
| Relay commands | [`hub-server/internal/router/router.go`](../../hub-server/internal/router/router.go)（relay command 路由组） | admin relay command create/get/ack（远程 edge 指令下发） |
| Execution Target routing | `hub-server/internal/handler/execution_target.go` | Local/Remote/Cloud/Hub Relay target 健康与路由 |

### 3.2 ACP 已并入 A2A 的事实

宏观 §3 明确：**ACP 已并入 A2A，不要继续投 ACP**。仓库内 ACP adapter family（[`edge-server/internal/adapters/codex/codex_acp.go`](../../edge-server/internal/adapters/codex/codex_acp.go)、[`edge-server/internal/adapters/acp/`](../../edge-server/internal/adapters/acp/)）属于 **Edge ↔ coding agent runtime 进程契约**（宏观 §3 ACP 行），是 Edge data plane 的 runtime adapter，不是 agent-to-agent 协作协议。当未来评估 A2A 引入时，ACP adapter 应视为 Edge data plane 既有资产，不与 A2A 冲突。

### 3.3 场景界定

| 场景 | 适用协议 | 理由 |
|---|---|---|
| 同 Hub 内多 agent 协作（team run/task queue/route decision） | 自有 Agent Teams REST | 已有完整实现；A2A 不提供增量价值 |
| Local Edge ↔ coding agent runtime 进程通信 | ACP adapter（Edge data plane） | 进程级 stdio 契约；不属于 A2A 范畴 |
| 跨 Hub / 跨组织 / 跨厂商 agent 互操作 | A2A（待引入） | A2A 设计目标；自有契约无法跨越信任域 |
| 远程设备间 agent 委托执行 | A2A 或 Relay（视信任模型） | 同信任域走 Relay；跨信任域走 A2A |

### 3.4 引入判定表

| 条件 | 引入 ✅ | 拒绝 ❌ |
|---|---|---|
| 需要跨 Hub / 跨组织 / 跨厂商 agent 互操作 | ✅ 引入 A2A 作为跨信任域 agent-to-agent 协议 | ❌ 若需求限于单 Hub 内协作 |
| 需要标准化 agent card / task lifecycle 跨域发现 | ✅ A2A Agent Card + Task 对象 | ❌ 若 Agent Teams + Relay 已满足 |
| 想用 A2A 替换 Hub REST/WS 或 Agent Teams | — | ❌ 红线：不替换自有 Hub/Edge 契约 |
| 想继续投资 ACP 作为 agent-to-agent 协议 | — | ❌ 宏观 §3：ACP 已并入 A2A，不再单独投入 |
| 需要在 Edge data plane 内做 runtime 进程通信 | ❌ 这是 ACP adapter 的职责 | ✅ ACP adapter 继续保留为 Edge data plane |

### 3.5 与自有 dispatch 契约的边界

| 维度 | 自有 dispatch（Agent Teams / Relay） | A2A（待引入） |
|---|---|---|
| 信任域 | 单 Hub 内；Hub JWT + membership | 跨信任域；A2A Agent Card + 外部身份 |
| 路由 | Hub router → Execution Target | A2A client → remote Agent Card endpoint |
| 状态机 | Hub service 层 deterministic | A2A Task lifecycle（submitted → working → completed/failed） |
| 审计 | Hub audit log + event store | A2A 侧审计独立；Hub 仅记录出站调用 |
| 审批 | Hub approval broker（timeout 默认拒绝） | A2A 无内置审批；需在 Hub 侧包装 |

### 3.6 外部来源

- A2A v1.0 spec <https://google.github.io/A2A/>；GitHub <https://github.com/google/A2A>

## 4. AG-UI：capability mapping 兼容评估

### 4.1 仓库现状

**AgentHub 当前未引入 AG-UI 协议。** 仓库内无任何 AG-UI 相关代码、配置或文档引用（`grep -rn 'ag-ui\|AG-UI\|agui'` 零结果）。

现有 agent ↔ user UI 实时通信由自有 WebSocket event contract 承载（[`api/events.md`](../../api/events.md)），包括：

- Hub WS frame：31 种 type（`frame.go` ↔ `hubEvents.ts` ↔ OpenAPI）
- Edge EventEnvelope：run lifecycle + tool call + output batch + transcript normalization
- Transcript normalizer：[`app/shared/src/transcript/`](../../app/shared/src/transcript/)

### 4.2 Capability mapping 兼容评估

下表将 AG-UI 核心概念映射到 AgentHub 自有契约，评估兼容性。

| AG-UI 概念 | AgentHub 对应 | 兼容度 | 差距 |
|---|---|---|---|
| Agent event stream | Hub WS typed events + Edge EventEnvelope | ✅ 功能等价 | 事件命名/schema 不同；需 adapter 翻译 |
| Tool call / result | `run.agent.tool_call` / `run.agent.tool_result` events | ✅ 已支持 | payload schema 差异需 mapping |
| Message delta / streaming | `message.new` + transcript normalizer | ✅ 已支持 | AG-UI 增量格式需转换层 |
| State snapshot | REST snapshot endpoints + `system.gap` fallback | ⚠️ 部分 | AG-UI state sync 语义更丰富 |
| Run lifecycle | `run.started` / `run.finished` / `run.error` | ✅ 已支持 | — |
| Approval / human-in-the-loop | Hub approval broker + WS approval events | ✅ 已支持 | AG-UI 无内置审批；AgentHub 更强 |
| Multi-modal content | attachments + artifact system | ⚠️ 部分 | AG-UI content block 类型需对齐 |

### 4.3 不替换 WS event contract 的红线

| 红线 | 说明 | 证据 |
|---|---|---|
| AG-UI 只做 capability mapping | 仅评估兼容性与差距；不作为产品运行时协议 | 宏观 §3 AG-UI 行 |
| 不替换现有 WS event contract | Hub/Edge WS 事件是唯一实时面权威；AG-UI 不得成为第二事件系统 | 宏观 §3 红线列 |
| 不并行引入 | 不与 MCP/A2A 同时作为内部协议引入 | 宏观 §10 Anti-goals |
| Adapter-only 引入路径 | 若未来需对接 AG-UI 生态客户端，仅在 Edge 或 Hub 边界加翻译 adapter；内部仍用自有事件 | 推论自宏观 §3 |

### 4.4 引入判定表

| 条件 | 引入 ✅ | 拒绝 ❌ |
|---|---|---|
| 需要对接 AG-UI 生态第三方客户端/UI | ✅ 在 Edge/Hub 边界加 AG-UI ↔ 自有事件翻译 adapter | ❌ 若需求可用自有 WS 事件满足 |
| 想用 AG-UI 替换 Hub/Edge WS 事件 | — | ❌ 红线：不替换现有 WS event contract |
| 评估 AG-UI 概念对自有契约的覆盖度 | ✅ 本文件 §4.2 即为评估产出 | ❌ 若评估结论是"全面替换" |
| 需要 AG-UI 独有的 capability（自有契约缺失） | ✅ 先在自有契约补齐；再评估 AG-UI adapter | ❌ 直接引入 AG-UI 绕过自有契约演进 |

### 4.5 外部来源

- AG-UI spec：<https://docs.ag-ui.com/>
- AG-UI GitHub：<https://github.com/ag-ui-protocol/ag-ui>

## 5. 跨协议总览与 Anti-goals 重申

### 5.1 协议角色矩阵

| 协议 | 角色 | 仓库现状 | 引入状态 |
|---|---|---|---|
| 自有 REST/WS | Hub/Edge 产品控制面 SSOT | ✅ 完整实现 | 常驻 |
| MCP | agent ↔ tools/data narrow projection | ✅ config 注入 + Edge MCP server | 已限定使用 |
| A2A | agent ↔ agent 跨信任域协作 | ❌ 未引入（demo fixture 命名无关） | 按需引入 |
| AG-UI | agent ↔ user UI capability mapping | ❌ 未引入（零代码痕迹） | 仅评估 |
| ACP | Edge ↔ coding agent runtime 进程契约 | ✅ adapter family | Edge data plane only |

### 5.2 Anti-goals 重申（宏观 §10）

- **不并行引入 MCP + A2A + AG-UI 三套内部协议。**
- 不让 LLM 当控制面/supervisor；路由、授权、审批、重试必须 deterministic。
- 不让 Web/Mobile 直连 Local Edge。

### 5.3 变更规则

- 本文件是协议能力映射 SSOT；新增外部协议或变更引入判定须更新本文件。
- 协议实现的源码 owner 在各模块 README；本文件只记录能力对照与红线。
- 与本文件冲突时以本文件为准；若宏观基线更新，先更新 `docs/architecture/10-macro-engineering-design.md`（#2065，已合入） 再同步本文件。
