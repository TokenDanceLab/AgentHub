# AgentHub API

`api/` 是 AgentHub 的接口契约目录，面向前端、后端、Edge、Hub 和 Agent Runtime adapter 的实现者。

当前主协议是：

```text
REST JSON API          # 命令和查询
WebSocket typed events # 实时状态、日志、消息 delta、审批和产物通知
```

Protobuf、Connect-RPC、JSON-RPC 只作为历史参考，不是当前主线。

## 文件职责

```text
api/
├── README.md          # API 总入口
├── conventions.md     # 命名、分页、错误、权限、版本
├── openapi.yaml       # REST API 路径总表和基础契约
└── events.md          # WebSocket event envelope、源码 owner、事件族和验收边界
```

`openapi.yaml` 只描述 REST API。WebSocket 的 envelope、frame、事件族、源码 owner 和验收边界写在 `events.md`；完整事件常量由 `edge-server/internal/adapters/adapter.go`、`hub-server/internal/ws/frame.go` 和 shared transcript tests 守住。业务解释、权威边界和架构背景写进 `docs/`，不要塞进 OpenAPI。

## 产品术语

接口命名必须区分四个概念。概念定义与取值域的 SSOT 是根 `AGENTS.md` 的「产品术语」，本表只给 API 字段映射，不复制含义（旧副本曾把 Execution Target 的四类具名 target 抄丢，读者只能从字段名反推取值域）：

| 概念 | 示例字段 |
|---|---|
| Agent Runtime | `runtimeId`, `adapterId`, `capabilities` |
| Agent Profile | `profileId`, `agentId`, `customAgentId` |
| Agent Configuration | `model`, `reasoningEffort`, `permissionMode`, `skillIds`, `mcpServerIds` |
| Execution Target | `targetId`, `edgeId`, `workspaceId`, `relayCommandId` |

其中 Agent Runtime 是 adapter，不是用户配置好的业务 Agent（后者是 Agent Profile）。

现有 `agentId` 在部分 P0 接口中仍指 Edge adapter ID；新增接口应优先显式使用 `runtimeId` 或 `profileId`，避免继续扩大歧义。

## 模块边界

| 模块 | 负责内容 | 主要归属 |
|---|---|---|
| IM / Project | Project、Conversation、Thread、Message、Item、Memory | Edge / Hub |
| Execution / Runtime | AgentRun、Approval、Artifact、Preview、Agent Runtime adapter | Edge |
| Profile / Configuration | Agent Profile、模型映射、Skill、MCP、cc-switch provider binding、审批策略 | Hub / Edge |
| Target / Relay | Local Edge、Remote Edge、Cloud Edge、Hub Relay command、设备状态 | Hub / Edge |
| Hub / Sync | Auth、User、Contact、Group、Device、Sync、Cloud、Workspace（元数据与列举，以 `/web/projects*` 暴露；`owner: Runner` 已退役，见 `conventions.md` §OpenAPI Metadata） | Hub |

本地执行链路 `Desktop -> Local Edge -> Agent Runtime adapter -> Agent CLI` 不依赖 Hub。云端 IM、多端同步、远程查看/审批和 Hub relay 才需要 Hub session。

## TokenDance ID 和鉴权边界

最终浏览器/桌面登录由 Hub Server 作为 TokenDance ID relying party 完成 OIDC Authorization Code + PKCE code exchange，验证 ID token 的 issuer/audience/JWKS，映射 `tokendance_sub` 到 Hub user，再签发 Hub access/refresh session。

现有 TokenDance ID RS256/JWKS bearer-token middleware 只是兼容路径：它不能替代 Hub session、Hub refresh token、设备证明或 Edge 权限检查。新增受保护 API 应按 Hub session + device proof + scoped authorization 设计。

## 阶段标记

接口会标注阶段，不代表后期接口现在就要实现。

| 阶段 | 含义 |
|---|---|
| P0 | 本地 Desktop -> Edge -> Agent Runtime adapter 必需 |
| P1 | 多 Agent Thread、本地协作和 Profile 基础 |
| P2 | TokenDance ID -> Hub session、Edge-Hub 同步、Web/Mobile 远程查看和审批 |
| P3 | Hub relay、Cloud Edge、远程执行 |
| P4 | 完整联系人、群聊、团队空间、Skill/MCP/Profile 生态 |

**适用范围**：`x-agenthub-phase` 只标注 `/v1/**` 设计面。reality-face（`/client`、`/web`、`/edge`）由 `x-agenthub-status` 治理、**不带 phase**，`/health`、`/api`、`/cloud` 属 ops/非设计面同样不带 ⇒ 「284 个 operation 里 166 个没有 phase」不是覆盖率缺陷，而是这条适用范围（实测缺失分布：`/web 91`、`/client 64`、`/edge 5`、`/v1 3`、`/health`·`/api`·`/cloud` 各 1）。ADR-030 / #2258。

**已知例外 3 个（待产品定值，本轮不代拍）**：`GET /v1/metrics`、`GET /v1/agent-instances`、`POST /v1/permissions/decide` 属 `/v1/**` 却没有 phase（三者都是 `status: implemented`、原 `owner: Edge`，且都已带其他元数据）。`docs/architecture/` 全文没有给它们定过 P0~P4，同族兄弟端点的 phase 也是 P0/P1/P2/P4 混杂、无法照抄 ⇒ 本轮**只声明规则、不代产品填值**：填一个没有出处的 phase 等于制造下一条「文档与实况分岔」。补齐需要产品/架构 owner 给出取值，跟踪在 #2258。

## 使用规则

1. 新 REST 接口先改 `api/openapi.yaml`。
2. 新 WebSocket 事件先改 `api/events.md`。
3. 通用命名、错误、分页、权限规则先改 `api/conventions.md`。
4. 新增 Profile、Runtime、Skill、MCP、Execution Target 字段时，同步检查 Desktop/Web/Edge/Hub 的类型定义。
5. 新增鉴权行为时，同步 `README.md`、`hub-server/README.md` 和根 workspace 的 identity docs。
6. 如果代码里已有路由但 OpenAPI 未覆盖，在 PR 或交接里明确标注“实现先行，契约待补”，不要让下游误以为接口不存在。
7. Hub OpenAPI 扩展字段必须跟 router middleware 对齐：`x-agenthub-role: admin` 对应 `RequireAdmin()`；`x-agenthub-device-type` 对应 `DeviceTypeCheck(...)`，没有该 middleware 的路由不要标设备类型。

## 验证

```powershell
git diff --check
python -c "import yaml, pathlib; yaml.safe_load(pathlib.Path('api/openapi.yaml').read_text(encoding='utf-8')); print('yaml ok')"
```
