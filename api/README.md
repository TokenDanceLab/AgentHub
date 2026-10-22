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
├── dispatch.md        # Hub→Edge dispatch、admission、execution intent、callback ownership
└── events.md          # WebSocket event envelope、源码 owner、事件族和验收边界
```

`openapi.yaml` 描述 REST API 与 Hub WebSocket 的 frame/envelope schema。跨 Hub→Edge 的 dispatch、admission、execution intent 与 callback ownership 语义见 `dispatch.md`。WebSocket 的 envelope、frame、事件族、源码 owner 和验收边界写在 `events.md`；完整事件常量由 `edge-server/internal/orchestration/contracts.go`（经 `edge-server/internal/adapters/contract_aliases.go` 别名导出）、`edge-server/internal/adapters/surfacing.go`、`hub-server/internal/ws/frame.go` 和 shared transcript tests 守住；逐条清单以 `events.md` 为 owner。业务解释、权威边界和架构背景写进 `docs/`，不要塞进 OpenAPI。

## 产品术语

接口命名必须区分四个概念。定义见 `docs/architecture.md` §产品模型；本表只给 API 字段映射：

| 概念 | 示例字段 |
|---|---|
| Agent Runtime | `runtimeId`, `adapterId`, `capabilities` |
| Agent Profile | `profileId`, `agentId`, `customAgentId` |
| Agent Configuration | `model`, `reasoningEffort`, `permissionMode`, `skillIds`, `mcpServerIds` |
| Execution Target | `targetId`, `edgeId`, `workspaceId`, `relayCommandId` |

其中 Agent Runtime 是 adapter，不是用户配置好的业务 Agent（后者是 Agent Profile）。

现有 `agentId` 在部分早期接口中仍指 Edge adapter ID；新增接口应优先显式使用 `runtimeId` 或 `profileId`，避免继续扩大歧义。

## 模块边界

| 模块 | 负责内容 | 主要归属 |
|---|---|---|
| IM / Project | Project、Conversation、Thread、Message、Item、Memory | Edge / Hub |
| Execution / Runtime | AgentRun、Approval、Artifact、Preview、Agent Runtime adapter | Edge |
| Profile / Configuration | Agent Profile、模型映射、Skill、MCP、cc-switch provider binding、审批策略 | Hub / Edge |
| Target / Relay | Local Edge、Remote Edge、Cloud Edge、Hub Relay command、设备状态 | Hub / Edge |
| Hub / Sync | Auth、User、Contact、Group、Device、Sync、Cloud、Workspace（元数据与列举，以 `/web/projects*` 暴露；`owner: Runner` 已退役，见 `conventions.md` §OpenAPI Metadata） | Hub |

本地执行链路 `Desktop -> Local Edge -> Agent Runtime adapter -> Agent CLI` 不依赖 Hub。云端 IM、多端同步、远程查看/审批和 Hub relay 才需要 Hub session。

## TokenDance Account OIDC 和鉴权边界

浏览器和桌面登录只使用公开的 TokenDance Account OIDC 合同。Hub Server 作为 relying party 完成 Authorization Code + PKCE：通过公开 discovery 获取端点，服务端交换 authorization code，验证 ID token 的签名、issuer、audience、nonce 和时效，再确认 UserInfo 的 `sub` 与 ID token 一致，最后按精确 `(issuer, subject)` 映射到 Hub user，并签发 Hub-local access/refresh session。

`POST /client/auth/oidc/authorize` 返回 Hub 生成的一次性 state、固定配置的 Account issuer 和公开 authorization URL；提供 `redirect_uri` 时必须精确命中 Hub 配置的 Account client callback allowlist。浏览器回调页面和 UI 属于该 callback 地址，不属于 Hub REST 合同。

`POST /client/auth/oidc/callback` 必须提交 Account 返回的 `code`、`state` 和 RFC 9207 `iss`，以及原 PKCE verifier 和授权事务绑定的 device 信息。Hub 只返回自己的 HS256 access token 和 refresh token。TokenDance Account ID token、access token、refresh token 只用于公开 OIDC 登录/身份证明，**不是 Hub bearer token**；Hub REST 和 WebSocket 只接受 Hub-issued HS256 product-session access token。

本目录只描述公开登录与 Hub session 边界，不暴露 Account 管理 API、内部服务端点、数据库 schema 或内部路由。Account token 不能替代 Hub refresh token、设备证明或 Edge 权限检查。

OIDC 错误码与 HTTP 状态：

| HTTP | `error.code` |
|---|---|
| 400 | `bad_request`, `oidc_invalid_state`, `oidc_issuer_invalid`, `oidc_code_exchange_failed`, `oidc_id_token_invalid` |
| 403 | `oidc_identity_retired` |
| 502 | `oidc_sub_not_found`, `oidc_userinfo_invalid` |
| 500 | `internal_error` |

## 使用规则

1. 新 REST 接口先改 `api/openapi.yaml`。
2. 新 WebSocket 事件先改源码 owner，再同步 `api/events.md`。
3. 通用命名、错误、分页、权限规则先改 `api/conventions.md`。
4. 新增 Profile、Runtime、Skill、MCP、Execution Target 字段时，同步检查 Desktop/Web/Edge/Hub 的类型定义。
5. 新增鉴权行为时，同步 `README.md`、`hub-server/README.md` 和相关身份文档。
6. 如果代码里已有路由但 OpenAPI 未覆盖，在 PR 描述中明确标注“实现先行，契约待补”，不要让下游误以为接口不存在。
7. Hub OpenAPI 扩展字段必须跟 router middleware 对齐：`x-agenthub-role: admin` 对应 `RequireAdmin()`；`x-agenthub-device-type` 对应 `DeviceTypeCheck(...)`，没有该 middleware 的路由不要标设备类型。

## 验证

```powershell
git diff --check
python -c "import yaml, pathlib; yaml.safe_load(pathlib.Path('api/openapi.yaml').read_text(encoding='utf-8')); print('yaml ok')"
```
