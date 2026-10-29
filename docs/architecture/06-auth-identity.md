# Auth and Identity

> 子文档 | 主索引：[architecture.md](../architecture.md)
>
> 最后更新：2026-10-29

## 概述

AgentHub 使用 TokenDance Account 作为 OIDC 身份提供者，Hub Server 是该公共 OIDC client 的 relying party。身份由 Account 的 `issuer + subject` 绑定到 Hub-local user；产品授权仍由 Hub 的 membership、resource 和 action 检查决定。

Hub 只消费 Account 公开的 OIDC discovery、authorization、token、UserInfo 和 JWKS endpoint。Hub 不持有 Account 的管理 API、内部服务地址或数据库连接，服务端 endpoint 以 issuer discovery 文档为准。

## OIDC Flow

```text
Desktop / CLI / Mobile
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

上面的 PKCE/token wire 合同继续用于 Desktop/CLI/Mobile。配置浏览器会话后，Web 使用 `POST /client/auth/browser/authorize` 和 `POST /client/auth/browser/callback`：Hub 持有 verifier，HttpOnly flow cookie 绑定发起浏览器；Web 回跳页面只提交 `code/state/iss`。浏览器回跳地址不是 Hub code-exchange 地址，旧的 GET login callback 不属于当前契约。

原 native authorize/callback 在 browser session 启用后要求显式的非 Web 已注册 callback，拒绝 `device_type=web`；Web 旧 refresh chain 也不能通过 native refresh 恢复。新 Web 前端必须清除旧 access/refresh storage，再向 browser/session 验证会话。

## Identity Mapping

`user_identities` 以 `(issuer, subject)` 为唯一身份键。首次登录创建或复用 Hub-local user，邮箱、昵称和头像不会用于自动认领账号。

首登的 user、identity、device 和 refresh token 在同一数据库事务提交。每条 refresh token 额外绑定精确的 `user_identities.id`；轮换时锁定该 identity 行并在同一事务内完成 claim、撤销和替换，另一个 active identity 不能复活已 retired binding 的 refresh chain。

历史 `users.tokendance_sub` 只作为退役 TokenDance ID provider 的审计数据。迁移把已有值写入 `provider=tokendance-id`、`issuer=legacy:tokendance-id`、`status=retired` 的 binding，并撤销对应 refresh token；该 binding 不能匹配真实 Account issuer，也不得被自动认领。

状态为 `retired` 的 binding 拒绝再次登录。确需恢复身份时，必须通过独立的受审迁移流程建立新的 `(issuer, subject)` binding。

## Token Boundaries

- Account access token、ID token 和 client secret 只由 Hub 服务端在 OIDC code exchange 中使用。
- Account token 不能作为 Hub REST bearer，也不能在 WebSocket upgrade 中使用。
- Hub REST 和 WebSocket 接受 Hub 签发的 HS256 native session，或配置后的同源 HttpOnly browser session；两者都不是 Account token。
- Hub access token 的 `sub` 是 Hub user ID，不是 Account subject；`user_id`、`device_id` 和 `device_type` 由 Hub session 写入。
- 浏览器、Desktop renderer 和 agent context 不接收 Account token、Account client secret 或 provider credential。

## 配对 Edge 设备身份

用户会话只用于确认设备归属；独立 Edge 通过 enrollment 获得设备专用 opaque credential，不借用 Desktop access/refresh token，也不持有 Hub JWT 签名密钥。`/cloud/edge/register` 返回的 `aud=agenthub-edge / purpose=edge-api` JWT 仍只用于访问 Edge API，不能用于设备向 Hub 领取任务或提交回调。

1. Edge 用稳定 UUID、设备名称、固定 `runtime_id: openai-sdk` 和本地 allowlist 中的绝对 `workspace_root` 调 `POST /edge/enrollments/start`。Hub 返回 `enrollment_id`、短 `user_code`、只交给 Edge 的高熵 `poll_secret` 和 10 分钟 `expires_at`。匿名 start/exchange 均限流；Hub 只持久化短码、poll secret 与设备 credential 的哈希，原值不进日志或审计 payload。
2. 用户登录 Web，`GET /web/edge-enrollments/{code}` 预览设备名称、UUID、runtime、工作目录、有效期和状态，再以 `POST /web/edge-enrollments/confirm` 提交 `user_code`。确认原子绑定当前 Hub user、精确 identity、auth generation 和当前 OIDC client；cookie 请求须满足既有 Origin/CSRF 合同。浏览器不取得 poll secret 或设备 credential。
3. Edge 调 `POST /edge/enrollments/exchange` 提交 enrollment ID 和 poll secret。待确认返回 202；确认后一次性交换返回 device/target ID、credential、runtime、workspace 和 7 天凭据到期时间。过期、错误 proof 或确认/交换重放拒绝。交换响应丢失不能再次取回原 credential，应重新配对。
4. Edge 将 credential 保存在权限受限的本机运行 secret store；凭据无 refresh grant，到期需要用户重新配对。产品会话响应与配对响应均 `Cache-Control: no-store`。模型 API key 独立通过 scoped secret 配置，只由 Edge adapter 使用。

新 credential 只在 `/edge/device/*` 专用 Authorization bearer middleware 中解析，不能进入产品 session parser；Hub session、Account token 与 Edge API JWT 也不能替代它。权限限本设备 heartbeat、领取已分配 delivery/control、提交本设备 task 回调及控制应用回执。每次操作都复验 owner/device/task/run 归属、expiry、revoked、identity auth generation 与当前 OIDC client，不能仅依赖签发时的授权。

`POST /web/edge-devices/{device_id}/revoke` 由设备 owner 显式撤销。Account 全局退出推进精确 identity generation，或切换 OIDC client，同样使该 identity/client 下的设备凭据失效，后续 heartbeat/poll/callback/control ACK 全部拒绝。当前 Hub browser session 的本地 logout 不推进 identity generation。撤销通道访问权不自动 kill 本机已运行的模型请求；UI 不得把未确认的取消当作执行器已停止。

配对后使用 `cloud_edge` target 和 `pairedDevice` capability，设备类型为 `edge`。runtime 与 workspace 以确认内容为授权上限，并在 Edge 本地再次校验；不得由普通 target 更新或浏览器参数扩权。设备仅发起出站 HTTPS，Web 不直连 Edge。执行、admission 去重和取消回执见 [dispatch.md](../../api/dispatch.md)。

## Client Storage

Desktop 由 Tauri keyring 或当前进程 session 保存 Hub access token，后续请求通过 `getAccessToken()` 注入。

Web 的 browser-session 接口只返回 `user`、RFC3339 `expires_at` 和独立 `csrf_token`。认证 cookie 是随机 opaque token；PostgreSQL `browser_sessions` 只存 SHA-256 digest，绑定精确 user identity、device、logout generation 和绝对过期时间。cookie 为 `__Host-agenthub_session`，`Secure; HttpOnly; SameSite=Lax; Path=/`，无 Domain。默认绝对 TTL 为 12 小时，上限 24 小时，不滑动续期；到期重新经过 Account。

浏览器刷新通过 `GET /client/auth/browser/session` 恢复，不能根据本地 user metadata 猜测登录。cookie-auth unsafe request 必须带精确 Origin 和 `X-Hub-CSRF`；CSRF proof 来自已验证的 session 响应，不能替代认证 cookie。浏览器只调用同源 Hub API/WS；WebSocket 不携带 bearer subprotocol，必须有精确 Origin。原 native Authorization 和 webview bearer subprotocol 合同保留，显式错误 bearer 不回退 cookie。

认证与会话响应 `Cache-Control: no-store`。无效、撤销或过期会话返回 401；数据库/密钥等依赖故障返回 503 `auth_unavailable`，客户端不能把故障宣称为账户退出。CSRF/Origin 校验失败返回 403 `auth_csrf_invalid`。本地 loopback HTTP 仅在显式开发配置下使用非 `__Host-` cookie 名；生产不能关闭 Secure。

Mobile 默认是 fixture/边界验证 lane。真实 Account 登录只在 `EXPO_PUBLIC_AGENTHUB_ACCOUNT_LOGIN_ENABLED=true` 且配置非空 `EXPO_PUBLIC_ACCOUNT_OIDC_ISSUER` 时启用；启用后仍只持有 Hub 发放的 session token，不持有 Account token。

## Production

生产环境必须显式配置 `AGENTHUB_ACCOUNT_OIDC_ISSUER_URL`、`AGENTHUB_ACCOUNT_OIDC_CLIENT_ID`、`AGENTHUB_ACCOUNT_OIDC_CLIENT_SECRET` 和 `AGENTHUB_ACCOUNT_OIDC_REDIRECT_URI`；`AGENTHUB_ACCOUNT_OIDC_ALLOWED_REDIRECT_URIS` 只在存在额外精确 callback 时需要。任一组字段部分配置或核心配置缺失都会使 Hub 启动失败，已退役的旧 provider 环境变量也会在生产启动时被拒绝。

Web cookie lane 额外配置 `AGENTHUB_BROWSER_SESSION_ORIGIN`、`AGENTHUB_BROWSER_SESSION_REDIRECT_URI`、`AGENTHUB_BROWSER_SESSION_POST_LOGOUT_REDIRECT_URI`。登录 callback 必须已在 Account/Hub 精确 allowlist；logout callback 固定为该 Web origin 的 `/client/auth/browser/logout/account/callback`。`AGENTHUB_BROWSER_SESSION_SECURE` 默认 true，`AGENTHUB_BROWSER_SESSION_TTL` 默认 12h。未配置 origin 时不注册 browser-session 路由；Account back-channel 路由随 Account OIDC 注册。

代理必须保留公共 Host、直接路由 `/client/auth/*`，不能把 back-channel 或 logout callback 重定向到 SPA fallback。Account client 必须登记精确 HTTPS `https://<web-origin>/client/auth/oidc/backchannel-logout` 与 post-logout callback；是否生产激活需要独立读回和真实验收。Account 当前支持 create/validate/disable，不提供原地 client metadata 更新；缺少登记时使用替代 client 的受审切换，保留 native callbacks 和 issuer/subject 映射。

真实 Account L3 必须走真实 Account issuer、真实浏览器授权码交换和真实 UserInfo。fixture、mock、stubbed Hub 或只验证配置形状的运行不能冒充 L3；对外证据必须按 `scripts/verify/verify-real-e2e-contract.py` 记录 `evidence_level`、`real_tested` 和实际命令。

## 安全边界

- Hub-local membership/resource/action 是唯一产品授权来源，OIDC 身份不直接授予 Hub 权限。
- discovery 返回的 authorization、token、UserInfo 和 JWKS endpoint 必须与配置 issuer 同源。
- Account ID token 固定使用 RS256、JWKS 校验、issuer/audience/azp/nonce/exp/iat 检查。
- redirect URI 必须精确匹配配置集合；非 loopback 地址必须使用 HTTPS。
- Account token、secret、cookie、原始 callback code 和用户凭据不进入公开日志、测试 evidence 或 agent context。
- Hub refresh 只在 Hub 明确返回 401/403 时清除本地 session；网络错误、429 和 5xx 保留 refresh token，避免把临时故障误判成登出。
- `POST /client/auth/browser/logout` 只撤销当前 Hub browser session；`POST /client/auth/browser/logout/account` 先撤销本地会话，再返回 Account discovery end-session URL，使用 confidential `client_id` 和精确 post-logout URI。Account 的 host-only cookie 完成全局退出，不需要保存或下发 `id_token_hint`。Hub 用短时 HttpOnly cookie 和一次性服务端 state 验证回跳。

## Account 撤销与迁移

`POST /client/auth/oidc/backchannel-logout` 只接收最多 8 KiB form 和唯一 `logout_token`。复用已有有界 JWKS cache，未知 kid 刷新一次；固定 RS256，校验精确 issuer/audience、iat/exp/sub/jti 和标准 backchannel-logout event，拒绝 nonce/sid。JWKS/数据库故障返回可重试 503，非法 proof 返回 400。

事务内按 `(issuer, subject)` 推进 `oidc_subject_epochs.generation`，撤销其 browser sessions 和 refresh chains，记录 `(issuer,jti)` 与 claims digest。相同 JTI/claims 重试幂等；同 JTI 不同 claims 拒绝。未知 subject 也保留 epoch；callback 在同一 identity/epoch 锁序中拒绝早于或等于最近 logout iat 的 ID proof，避免首次登录或旧 callback 复活会话。同秒合法新登录可能需要重试。

新 native JWT 内含 `identity_id/auth_generation/oidc_client_id`；REST、WS upgrade、inbound frame、实际 outbound write 和 heartbeat 都复验持久 generation、过期和当前 Account client。browser session 和 native refresh 也绑定签发时的 `oidc_client_id`；替换 Account client 后，旧 client 或未绑定 client 的会话一律重新登录，不通过 refresh 迁移，避免会话落在新 client 的 logout grant 范围之外。重新登录仍复用同一 `(issuer, subject)` 的 Hub user 与授权。仅 identity claim 缺失、但 refresh 已绑定当前 client 的 native JWT 可以通过 refresh 升级；浏览器旧 bearer 则重新登录。纯 unit fixtures 可注入无 checker 的 middleware，生产 composition root 总是配置 checker。

本实例在撤销提交后立即重验该 identity 的全部 socket，发送 `auth.revoked` payload `{reason:"session_revoked"}` 并关闭；已排队的业务帧在实际写出前再次检查。其他 Hub 实例通过每次读写检查拒绝旧 epoch，空闲连接最迟下一 heartbeat 关闭。依赖故障只关闭 socket，不能发送代表账户撤销的事件。客户端收到撤销事件停止自动重连并清除会话缓存。已经获批准的 Edge task 不因会话变更被隐式 kill；已配对 Edge 的通道 credential 同时受 generation 约束，失效后不能继续领取、回调或确认控制，因此 Hub 必须保留尚未核实的执行状态。

迁移 0079 增加 browser sessions、持久 subject epochs、logout JTI 记录和 refresh 的 client 绑定列。历史 refresh 的 client 为空，不猜测或回填，部署后要求重新登录。回滚仅删除 browser sessions（迫使重登），保留 client 列、epochs/JTI 防止丢失撤销事实；回退到不检查 generation/client 的旧应用代码不是安全兼容降级。每小时有界清理已过期 browser session 和过期 JTI，epoch 不过期。真实 Account logout/client 注册和 packaged Desktop 验收仍需部署 lane 单独取证，代码测试不能替代。

## 公开仓与 Account 内部面

AgentHub 是 confidential OIDC relying party，不是 Account 的代码分发渠道。公开仓可出现 canonical issuer、公开 client ID、标准 endpoint 和 callback 路径；这些信息不构成 client secret，也不能直接换取用户身份。Account 内部服务名、管理 API、数据库、部署路径和 secret 不属于公开契约。

Hub 运行时不 import、clone、启动或读取 Account 源码；它只按 issuer discovery 调用公开 authorization、token、UserInfo 和 JWKS 面，并拒绝落到不同 origin 的 endpoint。公开回调和 CI 都使用精确注册的 redirect/scope；默认 CI 只运行 repo-local fixture，真实 Account lane 仅在显式 operator dispatch 下使用外部合同。

因此，攻击者拿到 AgentHub 源码、公开 client ID 或回调路径，不能获得 Account 管理权限，也不能复用其他 client 的授权码。真正的隔离仍必须由 Account 侧保证：内部路由不公网可达、管理面独立鉴权、client 注册精确 allowlist、secret 只显示一次且只保存哈希。AgentHub 仓库中的文档或 verifier 不是这些控制措施的替代品。

## 相关文档

- [01-hub-server.md](01-hub-server.md) — Hub session 与 REST/WS 路由
- [04-frontend-data-flow.md](04-frontend-data-flow.md) — Desktop/Web/Mobile token 消费方式
- [05-deployment.md](05-deployment.md) — Account OIDC 配置与生产启动边界
