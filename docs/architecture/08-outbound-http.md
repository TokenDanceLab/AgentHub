# Outbound HTTP：policy contract 与 inventory

> 主索引：[architecture.md](../architecture.md)。本文件是 AgentHub 出站 HTTP 的
> policy 合同与调用点 inventory SSOT。

## 1. Policy 合同

所有生产出站 client 必须满足以下统一合同；**在 composition root 构造**，
服务/领域层不得读 `os.Getenv`、不得构造裸 `http.Client`（机器门禁：
`scripts/verify/verify-outbound-client-hygiene.py`，allowlist 只能缩小且条目必须带 issue）。

| 维度 | 合同 | 违反后果 |
|---|---|---|
| timeout | 每 client 显式注入（默认：Account discovery/token/UserInfo/JWKS 10s，Edge callback 30s，dispatch 10s） | verifier 扫描裸 client |
| retry | 只重试已证明幂等的请求；总 wall-clock budget（callback 默认 10s）；Retry-After 超预算即停；4xx（429+Retry-After 除外）不重试 | verifier 扫描无预算 retry 循环 |
| redirect | 一律拒重定向（`http.ErrUseLastResponse`）：callback/token exchange 的凭据与 payload 不得重放到其他 origin | 测试 `*RedirectNotFollowed` |
| TLS | 默认校验，任何位置禁止 `InsecureSkipVerify` | 评审红线 |
| body limit | 非流式外部响应 fail-closed 上限（默认 64 KiB；discovery/token/UserInfo/JWKS/callback 相同）。流式响应按协议逐块消费，不设整包上限，由每块上限、总预算和 ctx 取消共同约束 | verifier 扫描 `io.ReadAll(` 无 `io.LimitReader` |
| egress | 用户可指定地址的 dial 走 `egress` 包（默认拒绝）；运营商固定地址（Hub URL/Account issuer）由配置注入，不适用 egress allowlist | 评审 + egress 测试 |
| metrics/correlation | 统一合同：`outbound_requests_total` / `outbound_request_duration_seconds`（provider/purpose/category/status）；出站请求携带 `X-Request-ID`（`reqlog.SetRequestIDHeader`），日志同用 `request_id` | 评审 + 契约测试 |

sanctioned client 构造点（policy 原语包，不在 verifier 扫描范围）：

- Hub：`hub-server/internal/outboundhttp`（`NewClient(timeout)`、`ReadLimited`）
- Edge：`edge-server/internal/edgehttp`（`NewClient(timeout)`）
- 用户地址 dial：`hub-server/internal/egress`（默认拒绝 + DNS-rebinding 防御）

### 1.1 统一 outbound metrics/correlation 合同

可复用实现：`pkg/outboundmetrics`（`NewRecorder(reg)` 返回 nil-safe `*Recorder`）。
每个 server 在 composition root 构造一个 recorder 挂到自己的 registry（Hub：
`metrics.OutboundMetrics`，默认 registry；Edge：`metrics.EdgeMetrics.Outbound`，
隔离 registry）。指标名与 label 是稳定合同，重命名需同步本文件：

| 指标 | label 维度 | 取值约定 |
|---|---|---|
| `outbound_requests_total` | provider / purpose / category / status | provider∈{edge, hub, account_oidc, model_provider}；purpose∈{dispatch, callback, discovery, token_exchange, userinfo, jwks_fetch, mcp_sync}；category∈{success, failure}；status=细粒度结果（ok、unreachable、non_success、body_too_large、decode_fail、insecure_cleartext、subject_mismatch、issuer_mismatch、endpoint_policy、callback 的 app_rejected/client_error/rate_limited/server_error/redirect_error/timeout_error 等） |
| `outbound_request_duration_seconds` | 同上 | 同 label 维度，成功/失败都计时 |

correlation：出站请求通过 `reqlog.SetRequestIDHeader(ctx, header)` 携带调用方
`request_id`（`X-Request-ID`），接收方中间件（Hub `AccessLogGin`/Edge
`AccessLog`）沿用同一 header 回填日志；无 request_id 的 ctx（如后台 JWKS 缓存
刷新）不强制生成。已落地调用点：dispatch、callback（per-attempt）、Account
discovery、token exchange、UserInfo 与 JWKS fetch。

## 2. Inventory（production 调用点）

扫描范围（verifier 默认）：`hub-server/internal/service/**`、`hub-server/internal/jwtutil/**`、`edge-server/internal/hub/**`。

| # | 调用点 | 信任边界 / 配置 owner | 重试语义 | egress | body 上限 | metrics | 状态 |
|---|---|---|---|---|---|---|---|
| 1 | Hub→Edge dispatch（`service/dispatchsvc/agent_dispatch_ports.go` + `service/dispatchsvc/agent_dispatch_edge_http.go`） | 运营商配置 Edge URL/token（`config.Edge`，composition root 注入）；信任边界=本地 Edge 设备 | 无重试（outbox 负责投递重试，领域语义在 delivery journal） | 拒绝非 loopback 明文；固定地址不适用 egress allowlist | 64 KiB（`EdgeHTTPResponseBodyLimit`） | `AgentDispatchEdgeHTTPFailures` + 统一合同 | 已实现 |
| 2 | Edge→Hub callback（`edge-server/internal/hub/callback.go`） | 运营商配置 Hub URL/token（`AGENTHUB_HUB_URL/HUB_TOKEN` + callback policy flags）；信任边界=Hub 服务器 | 有预算重试（10s 默认）；ack/done/fail 幂等重试；legacy `TaskStream` 不重试；typed `TaskStreamEvent` 在相同 budget 下重试（稳定 `client_msg_id`，Hub 按 key 去重）；429+Retry-After 重试；4xx/3xx/超限终态 | 固定地址；redirect 拒绝 | 64 KiB fail-closed | 统一合同（per-attempt）；journal 记录 attempts | 已实现 |
| 3 | Account OIDC discovery（`service/oidc/oidc.go`） | 运营商配置公开 issuer（`account_oidc.issuer_url`）；信任边界=TokenDance Account | 无重试；5 分钟 metadata cache | 固定 issuer origin；拒绝 redirect | 64 KiB fail-closed | 统一合同 | 已实现 |
| 4 | Account token exchange（`service/oidc/oidc.go`） | discovery token endpoint + confidential client credentials；信任边界=TokenDance Account | 无重试（一次性授权码交换） | 固定 issuer origin；拒绝 redirect；client secret 使用 HTTP Basic | 64 KiB fail-closed | 统一合同；不记录 token/code/secret | 已实现 |
| 5 | Account UserInfo（`service/oidc/oidc.go`） | discovery UserInfo endpoint；Account access token 仅由 Hub 服务端持有 | 无重试 | 固定 issuer origin；拒绝 redirect | 64 KiB fail-closed | 统一合同；要求 UserInfo `sub` 与 ID token 一致 | 已实现 |
| 6 | Account JWKS fetch（`jwtutil/account_oidc.go`） | discovery JWKS URI；信任边界=TokenDance Account | 无重试；5 分钟 cache，未知 kid 时刷新 | 固定 issuer origin；拒绝 redirect | 64 KiB fail-closed | 统一合同 | 已实现 |
| 7 | Hub execution-target ping（`service/executiontarget/execution_target_ping.go` → `egress` 包） | 用户提供地址；egress allowlist 是唯一放行路径 | 无重试（探测语义） | ✅ 默认拒绝 + DNS-rebinding 防御 | 64 KiB（`io.LimitReader`） | 无 | 已实现 |
| 8 | Edge HubMCPSyncer（`adapters/mcp_config.go`） | 运营商配置 Hub MCP sync URL/token；信任边界=Hub 服务器 | 无重试（周期同步） | 固定地址；redirect 拒绝（`edgehttp` 注入） | 64 KiB fail-closed | 统一合同 | 已实现 |
| 9 | Edge OpenAI SDK 适配器（`adapters/sdk/openai_sdk_request.go`） | 用户配置 API key/baseURL；信任边界=模型 provider | 有界重试（attempts + jitter，ctx 可取消；无显式总 budget） | 固定地址 | 流式响应未设上限 | `BusEventAPIRetry` 事件 | 已实现 |
| 10 | Edge Anthropic SDK 适配器（`adapters/sdk/anthropic_sdk_request.go`） | 同上 | 同上 | 固定地址 | 流式响应未设上限 | `BusEventAPIRetry` 事件 | 已实现 |
| 11 | 统一 outbound metrics/correlation 合同 | — | — | — | — | `outbound_requests_total` / `outbound_request_duration_seconds`（见 1.1） | ✅ 已落地：dispatch / callback / Account OIDC |


### 2.1 代理场景 SSRF 检查语义

`egress` 包的 `http.Transport` 使用 `http.ProxyFromEnvironment`，当进程配置了
`HTTP_PROXY` / `HTTPS_PROXY` 环境变量时，出站请求经代理转发。此时 egress 的
SSRF 地址分类（`isRestricted`）**作用于代理服务器地址而非最终目标地址**：
Go 标准库在 transport 层先连接代理，再由代理连接目标；`dialContext` 看到的
`addr` 参数是代理地址。因此：

- 代理地址本身必须通过 egress 策略（不在 restricted 类别中，或在 allowlist 内）；
- 最终目标地址的 SSRF 检查由代理服务器承担，egress 不再二次校验；
- 运营商应确保代理地址可信，且代理自身有适当的出站过滤策略。

当前 `egress` 仅用于 `executiontarget.pingEdgeServer`（用户提供的 Edge 地址
健康探测），不用于 Account OIDC/JWKS/dispatch 等运营商固定地址路径。

## 3. 机器门禁

`scripts/verify/verify-outbound-client-hygiene.py`（CI: checks.yml → validate）：

- 扫描范围：service / jwtutil / edge-server hub 三个 scope（production `.go`）
- FAIL 条件：`os.Getenv`、裸 `&http.Client{`（allowlist 外）、`io.ReadAll` 无 `io.LimitReader`、
  `http.Get/Post/Head` 隐式 client、HTTP 文件中的无预算 retry 循环、匿名/过期 allowlist 条目
