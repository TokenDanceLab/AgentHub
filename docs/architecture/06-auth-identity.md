# Auth and Identity

> 子文档 | 主索引：[architecture.md](../architecture.md)
>
> 最后更新：2026-10-23

## 概述

AgentHub 使用 TokenDance Account 作为 OIDC 身份提供者，Hub Server 是该公共 OIDC client 的 relying party。身份由 Account 的 `issuer + subject` 绑定到 Hub-local user；产品授权仍由 Hub 的 membership、resource 和 action 检查决定。

Hub 只消费 Account 公开的 OIDC discovery、authorization、token、UserInfo 和 JWKS endpoint。Hub 不持有 Account 的管理 API、内部服务地址或数据库连接，服务端 endpoint 以 issuer discovery 文档为准。

## OIDC Flow

```text
Desktop / Web / Mobile
  -> 生成 PKCE verifier + challenge
  -> POST /client/auth/oidc/authorize
  -> Hub 创建 state + nonce，返回 Account authorization URL
  -> 浏览器完成 Account 登录与授权
  -> Account 回跳客户端 callback，携带 code + state + iss
  -> 客户端 POST /client/auth/oidc/callback
  -> Hub 校验 PKCE、state、nonce 和 RFC 9207 iss
  -> Hub 在服务端与 Account 交换 authorization code
  -> Hub 通过 Account JWKS 校验 RS256 ID token
  -> Hub 调用 Account UserInfo，并要求 sub 与 ID token 一致
  -> Hub 映射 (issuer, subject) 到 Hub user
  -> Hub 签发自己的 access/refresh session
```

Hub 只注册 `POST /client/auth/oidc/authorize` 和 `POST /client/auth/oidc/callback`。浏览器回跳地址不是 Hub code-exchange 地址，旧的 GET callback 不属于当前契约。

## Identity Mapping

`user_identities` 以 `(issuer, subject)` 为唯一身份键。首次登录创建或复用 Hub-local user，邮箱、昵称和头像不会用于自动认领账号。

首登的 user、identity、device 和 refresh token 在同一数据库事务提交。每条 refresh token 额外绑定精确的 `user_identities.id`；轮换时锁定该 identity 行并在同一事务内完成 claim、撤销和替换，另一个 active identity 不能复活已 retired binding 的 refresh chain。

历史 `users.tokendance_sub` 只作为退役 TokenDance ID provider 的审计数据。迁移把已有值写入 `provider=tokendance-id`、`issuer=legacy:tokendance-id`、`status=retired` 的 binding，并撤销对应 refresh token；该 binding 不能匹配真实 Account issuer，也不得被自动认领。

状态为 `retired` 的 binding 拒绝再次登录。确需恢复身份时，必须通过独立的受审迁移流程建立新的 `(issuer, subject)` binding。

## Token Boundaries

- Account access token、ID token 和 client secret 只由 Hub 服务端在 OIDC code exchange 中使用。
- Account token 不能作为 Hub REST bearer，也不能在 WebSocket upgrade 中使用。
- Hub REST 和 WebSocket 只接受 Hub 签发的 HS256 session token。
- Hub access token 的 `sub` 是 Hub user ID，不是 Account subject；`user_id`、`device_id` 和 `device_type` 由 Hub session 写入。
- 浏览器、Desktop renderer 和 agent context 不接收 Account token、Account client secret 或 provider credential。

## Client Storage

Desktop 由 Tauri keyring 或当前进程 session 保存 Hub access token，后续请求通过 `getAccessToken()` 注入。

Web 当前把 Hub access/refresh token 保存在 tab-scoped `sessionStorage`，并使用内存 fallback；这不是 HttpOnly cookie session，也不是 BFF-owned server session。公开 Web 发布若需要此类安全属性，必须另行实现，不能把当前存储描述成 cookie 会话。

Mobile 默认是 fixture/边界验证 lane。真实 Account 登录只在 `EXPO_PUBLIC_AGENTHUB_ACCOUNT_LOGIN_ENABLED=true` 且配置非空 `EXPO_PUBLIC_ACCOUNT_OIDC_ISSUER` 时启用；启用后仍只持有 Hub 发放的 session token，不持有 Account token。

## Production

生产环境必须显式配置 `AGENTHUB_ACCOUNT_OIDC_ISSUER_URL`、`AGENTHUB_ACCOUNT_OIDC_CLIENT_ID`、`AGENTHUB_ACCOUNT_OIDC_CLIENT_SECRET` 和 `AGENTHUB_ACCOUNT_OIDC_REDIRECT_URI`；`AGENTHUB_ACCOUNT_OIDC_ALLOWED_REDIRECT_URIS` 只在存在额外精确 callback 时需要。任一组字段部分配置或核心配置缺失都会使 Hub 启动失败，已退役的旧 provider 环境变量也会在生产启动时被拒绝。

真实 Account L3 必须走真实 Account issuer、真实浏览器授权码交换和真实 UserInfo。fixture、mock、stubbed Hub 或只验证配置形状的运行不能冒充 L3；对外证据必须按 `scripts/verify/verify-real-e2e-contract.py` 记录 `evidence_level`、`real_tested` 和实际命令。

## 安全边界

- Hub-local membership/resource/action 是唯一产品授权来源，OIDC 身份不直接授予 Hub 权限。
- discovery 返回的 authorization、token、UserInfo 和 JWKS endpoint 必须与配置 issuer 同源。
- Account ID token 固定使用 RS256、JWKS 校验、issuer/audience/azp/nonce/exp/iat 检查。
- redirect URI 必须精确匹配配置集合；非 loopback 地址必须使用 HTTPS。
- Account token、secret、cookie、原始 callback code 和用户凭据不进入公开日志、测试 evidence 或 agent context。
- Hub refresh 只在 Hub 明确返回 401/403 时清除本地 session；网络错误、429 和 5xx 保留 refresh token，避免把临时故障误判成登出。
- 当前 Hub logout 只撤销 Hub-local session，不调用 Account RP-initiated logout。Hub 不持久化或下发 Account ID token，因此 Account 浏览器 SSO session 会保留；需要全局登出的部署必须另做受审的 `id_token_hint` 保管和 logout 设计。

## 公开仓与 Account 内部面

AgentHub 是 confidential OIDC relying party，不是 Account 的代码分发渠道。公开仓可出现 canonical issuer、公开 client ID、标准 endpoint 和 callback 路径；这些信息不构成 client secret，也不能直接换取用户身份。Account 内部服务名、管理 API、数据库、部署路径和 secret 不属于公开契约。

Hub 运行时不 import、clone、启动或读取 Account 源码；它只按 issuer discovery 调用公开 authorization、token、UserInfo 和 JWKS 面，并拒绝落到不同 origin 的 endpoint。公开回调和 CI 都使用精确注册的 redirect/scope；默认 CI 只运行 repo-local fixture，真实 Account lane 仅在显式 operator dispatch 下使用外部合同。

因此，攻击者拿到 AgentHub 源码、公开 client ID 或回调路径，不能获得 Account 管理权限，也不能复用其他 client 的授权码。真正的隔离仍必须由 Account 侧保证：内部路由不公网可达、管理面独立鉴权、client 注册精确 allowlist、secret 只显示一次且只保存哈希。AgentHub 仓库中的文档或 verifier 不是这些控制措施的替代品。

## 相关文档

- [01-hub-server.md](01-hub-server.md) — Hub session 与 REST/WS 路由
- [04-frontend-data-flow.md](04-frontend-data-flow.md) — Desktop/Web/Mobile token 消费方式
- [05-deployment.md](05-deployment.md) — Account OIDC 配置与生产启动边界
