# Outbound HTTP：policy contract 与 inventory（#1540/#1549/#1564）

> 主索引：[architecture.md](../architecture.md)。本文件是 AgentHub 出站 HTTP 的
> policy 合同与调用点 inventory SSOT（#1564 二阶段产物）。

## 1. Policy 合同（#1564）

所有生产出站 client 必须满足以下统一合同；**在 composition root 构造**，
服务/领域层不得读 `os.Getenv`、不得构造裸 `http.Client`（机器门禁：
`scripts/verify/verify-outbound-client-hygiene.py`，allowlist 只能缩小且条目必须带 issue）。

| 维度 | 合同 | 违反后果 |
|---|---|---|
| timeout | 每 client 显式注入（默认：Hub OIDC/JWKS 10s，Edge callback 30s，dispatch 10s） | verifier 扫描裸 client |
| retry | 只重试已证明幂等的请求；总 wall-clock budget（callback 默认 10s）；Retry-After 超预算即停；4xx（429+Retry-After 除外）不重试 | verifier 扫描无预算 retry 循环 |
| redirect | 一律拒重定向（`http.ErrUseLastResponse`）：callback/token exchange 的凭据与 payload 不得重放到其他 origin | 测试 `*RedirectNotFollowed` |
| TLS | 默认校验，任何位置禁止 `InsecureSkipVerify` | 评审红线 |
| body limit | 外部响应一律 fail-closed 上限（默认 64 KiB；token/JWKS/callback 相同） | verifier 扫描 `io.ReadAll(` 无 `io.LimitReader` |
| egress | 用户可指定地址的 dial 走 `egress` 包（#1540 默认拒绝）；运营商固定地址（Hub URL/issuer/JWKS）由配置注入，不适用 egress allowlist | 评审 + egress 测试 |
| metrics/correlation | 统一合同（#1595）：`outbound_requests_total` / `outbound_request_duration_seconds`（provider/purpose/category/status）；出站请求携带 `X-Request-ID`（`reqlog.SetRequestIDHeader`），日志同用 `request_id` | 评审 + 契约测试 |

sanctioned client 构造点（policy 原语包，不在 verifier 扫描范围）：

- Hub：`hub-server/internal/outboundhttp`（`NewClient(timeout)`、`ReadLimited`）
- Edge：`edge-server/internal/edgehttp`（`NewClient(timeout)`）
- 用户地址 dial：`hub-server/internal/egress`（#1540，默认拒绝 + DNS-rebinding 防御）

### 1.1 统一 outbound metrics/correlation 合同（#1595）

可复用实现：`pkg/outboundmetrics`（`NewRecorder(reg)` 返回 nil-safe `*Recorder`）。
每个 server 在 composition root 构造一个 recorder 挂到自己的 registry（Hub：
`metrics.OutboundMetrics`，默认 registry；Edge：`metrics.EdgeMetrics.Outbound`，
隔离 registry）。指标名与 label 是稳定合同，重命名需同步本文件与 dashboard：

| 指标 | label 维度 | 取值约定 |
|---|---|---|
| `outbound_requests_total` | provider / purpose / category / status | provider∈{edge, hub, tokendance_id, model_provider}；purpose∈{dispatch, callback, token_exchange, jwks_fetch, mcp_sync}；category∈{success, failure}；status=细粒度结果（ok、unreachable、non_success、body_too_large、decode_fail、insecure_cleartext、callback 的 app_rejected/client_error/rate_limited/server_error/redirect_error/timeout_error 等） |
| `outbound_request_duration_seconds` | 同上 | 同 label 维度，成功/失败都计时 |

correlation：出站请求通过 `reqlog.SetRequestIDHeader(ctx, header)` 携带调用方
`request_id`（`X-Request-ID`），接收方中间件（Hub `AccessLogGin`/Edge
`AccessLog`）沿用同一 header 回填日志；无 request_id 的 ctx（如后台 JWKS 缓存
刷新）不强制生成。已落地调用点：dispatch、callback（per-attempt）、OIDC token
exchange、JWKS fetch（#1595 验收）。

## 2. Inventory（production 调用点）

扫描范围（verifier 默认）：`hub-server/internal/service/**`、`hub-server/internal/jwtutil/**`、`edge-server/internal/hub/**`。

| # | 调用点 | 信任边界 / 配置 owner | 重试语义 | egress | body 上限 | metrics | 状态 |
|---|---|---|---|---|---|---|---|
| 1 | Hub→Edge dispatch（`service/dispatchsvc/agent_dispatch_ports.go` + `service/dispatchsvc/agent_dispatch_edge_http.go`，2026-08-13 #74a2328 迁入 `dispatchsvc` 子包） | 运营商配置 Edge URL/token（`config.Edge`，composition root 注入）；信任边界=本地 Edge 设备 | 无重试（outbox 负责投递重试，领域语义在 delivery journal） | AH-SR-053 拒绝非 loopback 明文；固定地址不适用 egress allowlist | 64 KiB（`EdgeHTTPResponseBodyLimit`） | `AgentDispatchEdgeHTTPFailures` + 统一合同（#1595） | ✅ 已收口（#1549 + #1594 client 移到 composition root + #1595 指标） |
| 2 | Edge→Hub callback（`edge-server/internal/hub/callback.go`） | 运营商配置 Hub URL/token（`AGENTHUB_HUB_URL/HUB_TOKEN` + callback policy flags）；信任边界=Hub 服务器 | 有预算重试（10s 默认）；只重试 ack/done/fail（幂等）；stream 不重试；429+Retry-After 重试；4xx/3xx/超限终态 | 固定地址；redirect 拒绝 | 64 KiB fail-closed | 统一合同（#1595，per-attempt）；journal 记录 attempts | ✅ 已收口（#1564 + #1595 指标） |
| 3 | Hub OIDC token exchange（`service/oidc/oidc.go`） | 运营商配置 TokenDance ID issuer/client secret（`tokendance_id.*`）；信任边界=TokenDance ID | 无重试（一次性授权码交换，重试不安全） | 固定地址；redirect 拒绝（client_secret 在 form body） | 64 KiB fail-closed | 日志含 request_id + body_sha256；统一合同（#1595） | ✅ 已收口（#1564 + #1595 指标） |
| 4 | Hub JWKS fetch（`jwtutil/tokendance.go` 实例化 verifier，#1551） | 运营商配置 JWKS URI；信任边界=TokenDance ID | 无重试；cache TTL 1h 注入 | 固定地址；redirect 拒绝 | 64 KiB fail-closed | 统一合同（#1595） | ✅ 已收口（#1564 + #1595 指标） |
| 5 | Hub execution-target ping（`service/executiontarget/execution_target_ping.go` → `egress` 包，#1540） | 用户提供地址；egress allowlist 是唯一放行路径 | 无重试（探测语义） | ✅ 默认拒绝 + DNS-rebinding 防御 | 64 KiB（`io.LimitReader`） | 无 | ✅ 已收口 |
| 6 | Edge HubMCPSyncer（`adapters/mcp_config.go`） | 运营商配置 Hub MCP sync URL/token；信任边界=Hub 服务器 | 无重试（周期同步） | 固定地址；redirect 拒绝（`edgehttp` 注入） | 64 KiB fail-closed | 统一合同（#1595） | ✅ 已收口（#1593） |
| 7 | Edge OpenAI SDK 适配器（`adapters/sdk/openai_sdk_request.go`） | 用户配置 API key/baseURL；信任边界=模型 provider | 有界重试（attempts + jitter，ctx 可取消；无显式总 budget） | 固定地址 | 流式响应未限 ⚠️ | `BusEventAPIRetry` 事件 | ✅ 已收口（#1592） |
| 8 | Edge Anthropic SDK 适配器（`adapters/sdk/anthropic_sdk_request.go`） | 同上 | 同上 | 固定地址 | 流式响应未限 ⚠️ | `BusEventAPIRetry` 事件 | ✅ 已收口（#1592） |
| 9 | 统一 outbound metrics/correlation 合同 | — | — | — | — | `outbound_requests_total` / `outbound_request_duration_seconds`（见 1.1） | ✅ 已落地（#1595）：dispatch / callback / OIDC / JWKS |


### 2.1 代理场景 SSRF 检查语义（#2064 item ④）

`egress` 包的 `http.Transport` 使用 `http.ProxyFromEnvironment`，当进程配置了
`HTTP_PROXY` / `HTTPS_PROXY` 环境变量时，出站请求经代理转发。此时 egress 的
SSRF 地址分类（`isRestricted`）**作用于代理服务器地址而非最终目标地址**：
Go 标准库在 transport 层先连接代理，再由代理连接目标；`dialContext` 看到的
`addr` 参数是代理地址。因此：

- 代理地址本身必须通过 egress 策略（不在 restricted 类别中，或在 allowlist 内）；
- 最终目标地址的 SSRF 检查由代理服务器承担，egress 不再二次校验；
- 运营商应确保代理地址可信，且代理自身有适当的出站过滤策略。

当前 `egress` 仅用于 `executiontarget.pingEdgeServer`（用户提供的 Edge 地址
健康探测），不用于 OIDC/JWKS/dispatch 等运营商固定地址路径。

## 3. 未迁移项清单

| Issue | 项 | Owner | Review date |
|---|---|---|---|
| ~~#1593~~ ✅ | HubMCPSyncer client 收口：composition root 注入、redirect 拒绝、响应体上限 | outbound HTTP 后端 owner（#1564 完成人） | 2026-09-03 |
| ~~#1594~~ ✅ | Hub→Edge dispatch client 移到 composition root，verifier allowlist 归零 | 同上 | 2026-09-03 |
| ~~#1595~~ ✅ | 统一出站 correlation/metrics 合同落地（pkg/outboundmetrics + dispatch/callback/OIDC/JWKS） | 同上 | 2026-09-17 |

## 4. 机器门禁（#1549 → #1564）

`scripts/verify/verify-outbound-client-hygiene.py`（CI: checks.yml → validate）：

- 扫描范围：service / jwtutil / edge-server hub 三个 scope（production `.go`）
- FAIL 条件：`os.Getenv`、裸 `&http.Client{`（allowlist 外）、`io.ReadAll` 无 `io.LimitReader`、
  `http.Get/Post/Head` 隐式 client、HTTP 文件中的无预算 retry 循环、匿名/过期 allowlist 条目
- 自测：`scripts/verify/tests/verify-outbound-client-hygiene.Tests.py`（7 个正/负 fixture，
  含裸 client、service env 读取、匿名 allowlist、无 body limit、无预算 retry 五个负向证明）
