# PROGRESS — #1564 出站 HTTP 收口二阶段（feat/outbound-phase2）

更新：2026-08-03

## 完成范围

### 1. Edge→Hub callback client 收口（✅ 完成）

- `edge-server/internal/hub/callback.go`：
  - `CallbackConfig`（timeout/maxAttempts/retryBaseDelay/retryBudget/maxResponseBodyBytes）+ `DefaultCallbackConfig()`，composition root 组装
  - `http.Client` 不再在 hub 包内构造：新增 `edge-server/internal/edgehttp`（sanctioned policy 原语：超时 + 拒重定向 + 默认 TLS），composition root（`httpserver/server.go`）构造后注入 `NewCallbackClient(hubURL, authToken, client, cfg)`
  - 重试合同：只重试已证明幂等的 action（ack/done/fail；stream 因无 client_msg_id 不重试）；总 wall-clock budget（默认 10s，caller deadline 更短时取其值）；Retry-After 解析并受预算约束（超预算即停）；429+Retry-After 重试、其余 4xx/3xx/超限终态；统一分类常量（ok/app_rejected/client_error/rate_limited/server_error/redirect_error/body_too_large/network/timeout）
  - 响应体 fail-closed 上限（默认 64 KiB，超限不重试、内容不进日志）
  - 幂等键（URL taskID + body run_id）跨重试字节级稳定（测试证明）
  - journal/reconciliation 领域语义保留
- CLI：`--hub-callback-timeout` / `--hub-callback-retry-budget` / `--hub-callback-max-attempts`（env `AGENTHUB_HUB_CALLBACK_*`）
- 测试：`edge-server/internal/hub/callback_policy_test.go` 新增 11 个策略测试（budget 耗尽、Retry-After 超预算停止/遵守、stream 不重试、429±Retry-After、body limit fail-closed、幂等载荷稳定、redirect 拒绝、caller deadline 及时取消、connection reuse）

### 2. External identity client（OIDC token exchange + JWKS）收口（✅ 完成）

- 新增 `hub-server/internal/outboundhttp`（sanctioned policy 原语：`NewClient(timeout)` 拒重定向 + `ReadLimited` fail-closed）
- `hub-server/internal/service/oidc/oidc.go`：token exchange 用 service-owned client（composition root 构造，redirect 拒绝——client_secret 在 form body）；响应体 `ReadLimited` 上限，超限 fail-closed 且 body 不进日志；`&http.Client{Timeout:10s}` 裸构造移除
- `hub-server/internal/jwtutil/tokendance.go`：`NewTokenDanceVerifier(jwksURI, VerifierConfig{HTTPClient, CacheTTL, MaxBodyBytes})`——URI/client/cache/refresh policy 全部显式注入（#1551 实例化对齐，无 package global）；fetch 不再每次新建 client；JWKS 响应体 fail-closed 上限
- `config.TokenDanceIDConfig` 新增 `HTTPTimeout`/`MaxResponseBodyBytes`（env `AGENTHUB_TOKENDANCE_ID_HTTP_TIMEOUT` / `..._MAX_RESPONSE_BODY_BYTES`，viper 默认 10s/64KiB，LogValue 已包含）
- composition root：`app.tdVerifier()` 与 `oidc.NewService` 均经 `outboundhttp.NewClient` 构造
- 测试：jwtutil `tokendance_policy_test.go`（body limit、redirect 拒绝、secret 不泄漏、注入 client 使用）、oidc `oidc_policy_test.go`（redirect 拒绝、body limit、client 复用）

### 3. Outbound inventory 与 policy matrix（✅ 完成）

- 新文档 `docs/architecture/08-outbound-http.md`：policy 合同表 + 9 个调用点 inventory（trust boundary/配置 owner/重试/egress/body limit/metrics/状态）+ 未迁移项清单
- 未迁移项已开 issue：**#1592**（Edge SDK 适配器）、**#1593**（HubMCPSyncer）、**#1594**（dispatch client 移到 composition root）、**#1595**（统一 correlation/metrics 合同），均带 owner 与 review date
- 索引同步：`docs/architecture/README.md`、`docs/architecture.md` Module Owners、`AGENTS.md` 规则→机器验证映射表、`hub-server/.env.example`

### 4. 机器门禁升级（✅ 完成）

- `scripts/verify/verify-outbound-client-hygiene.ps1`：扫描范围扩展为 service/jwtutil/edge-server-hub 三 scope；新增检查：body limit（`io.ReadAll` 无 `io.LimitReader`）、隐式 client（`http.Get/Post/Head`）、无预算 retry 循环、allowlist 格式（必须 `path|#issue|reason`）与 stale 条目（allowlist 只缩）
- allowlist 从 2 条缩到 1 条（OIDC 条目移除，仅剩 dispatch #1594 遗留）
- 自测 `scripts/verify/tests/verify-outbound-client-hygiene.Tests.ps1`：7 个正/负 fixture，含任务书要求的 4 个负向证明（裸 client / service env / 匿名 allowlist / 无 body limit）+ 无预算 retry + 带 issue 的 allowlist 正例

## 验证输出（worktree 内全部通过）

```
edge-server: go build ./... ✅ | go vet ./... ✅ | go test ./... -short -count=1 ✅
hub-server:  go build ./... ✅ | go vet ./... ✅ | go test ./... -short -count=1 ✅
verifier:    pwsh verify-outbound-client-hygiene.ps1 ✅ (1 pass)
self-tests:  pwsh verify-outbound-client-hygiene.Tests.ps1 ✅ (7 cases PASSED)
```

详细输出见提交/PR。

## 未迁移项（inventory）

| Issue | 项 | Owner | Review date |
|---|---|---|---|
| #1592 | Edge SDK 适配器（openai/anthropic）client 收口 | outbound HTTP 后端 owner | 2026-09-03 |
| #1593 | HubMCPSyncer client 收口 | 同上 | 2026-09-03 |
| #1594 | Hub→Edge dispatch client 移到 composition root（verifier allowlist 归零） | 同上 | 2026-09-03 |
| #1595 | 统一出站 correlation/metrics 合同 | 同上 | 2026-09-17 |

## 阻塞点

- 无。中途发现 `httptest` server handler 无限阻塞导致测试挂起（测试自身问题，已修复）；旧构造签名波及的测试文件已全部机械更新。
