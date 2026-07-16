---
title: Open High Risks -- AH-SR-037/045/046/049/028/035/036
summary: >
  当前仍 Open 或已 Mitigated 但缺少闭环证据的 High 风险总览。
  覆盖 sessionStorage、Remote Edge 授权粒度、capability 半成品、
  Hub-Edge delivery contract、JWT secret 轮换、OIDC browser 证据、
  Desktop 登录证据。每个条目附代码证据指针和关闭条件。
tags: [security, risk, open-high, sr-037, sr-045, sr-046, sr-049, sr-028, sr-035, sr-036]
sources:
  - docs/governance/security-risk-register.md
  - docs/architecture/06-auth-identity.md
  - docs/decisions.md
  - docs/analysis/_raw_lane_results.json
updated: 2026-07-16
---

# Open High Risks

本页汇总当前仍阻断公开发布的 Open/Partial High 风险，以及已 Mitigated 但缺少部署证据的 High 项。每条附代码证据指针，不重复 [[security-risk-register]] 完整表格。发布门禁见 [[overview#发布门禁]]。

---

## Open: 代码未闭合

### AH-SR-037 -- Web sessionStorage 存 Hub session（Open）

**风险**：Web 端将 Hub access/refresh token 写入 `sessionStorage`，XSS 可读，缺少 BFF/HttpOnly cookie 或 accepted alternative。

**代码证据**：

| 位置 | 事实 |
|---|---|
| `app/web/src/api/hubTokenStorage.ts` | `getStoredToken`/`setStoredToken` 仅使用 `sessionStorage`，无 HttpOnly 路径 |
| `app/web/src/api/hubAuth.ts:95-139` | OIDC pending state 也落在 `sessionStorage`（`OIDC_PENDING_KEY`） |
| `app/web/src/api/hubTokenStorage.test.ts` | 测试明确断言 `sessionStorage`，token 不落 `localStorage`，但不验证 HttpOnly |

**关闭条件**：实现 server-owned session（BFF/HttpOnly cookie），或形成 accepted risk 并写补偿控制（CSP、短 TTL、refresh 轮换）。

---

### AH-SR-045 -- Remote Edge read API 授权不足（Open）

**风险**：Remote Edge 模式下，read API 通过 `localAuthMiddleware` 认证，但授权只做到 project owner 过滤，缺少 route/target/workspace/user-action 级 scoped authorization。

**代码证据**：

| 位置 | 事实 |
|---|---|
| `edge-server/internal/api/handlers.go` | `isProjectOwnedBy` / `isRunOwnedBy` 在 `userID==''` 或 `OwnerID==''` 时返回 `true` |
| `edge-server/internal/api/handlers.go` | `filterProjectsByOwner` 只在 `hubUserFromRequest` 有值时过滤；local auth 下不执行 |
| `edge-server/internal/httpserver/server.go` | `localAuthMiddleware` 仅校验身份 JWT `purpose=edge-api` 或 local bearer；不做 resource-level scope |

**关闭条件**：增加远程 read API scoped authorization（至少 project + target + action），并补 wrong-user/project 负例测试。

---

### AH-SR-046 -- Run-start capability 半成品：Edge 验但 Hub 不发（Partial mitigated in repo）

**风险**：`PostRuns` 在配置 `HubJWTSecret` 后校验 `X-AgentHub-Capability-Token`，但 Hub 端无签发代码（`IssueCapability`/`SignCapability` 在整个仓库不存在），且 claims 缺少 workspace/target/action，`purpose` 字段未在调用点强制校验。

**代码证据**：

| 位置 | 事实 |
|---|---|
| `edge-server/internal/api/handlers.go:1208-1210` | 必需 `X-AgentHub-Capability-Token` header，缺失返回 403 |
| `edge-server/internal/jwtutil/capability.go` | `CapabilityClaims={user_id,device_id,project_id,purpose}` 缺 `workspace/target/action` |
| `edge-server/internal/jwtutil/capability_test.go` | 仅测 `ValidateCapabilityToken`，无 wrong-target/action/stale 负例 |
| `edge-server/internal/httpserver/server.go` | CORS `allow-headers` 未列出 `X-AgentHub-Capability-Token` |
| `hub-server/internal/` | `rg -r 'IssueCapability\|SignCapability\|CapabilityToken' hub-server/internal/` 无命中 |

**关闭条件**：Hub 实现 capability 签发，dispatch 带上 per-run capability token，补 wrong-device/project/user/stale/expired negative tests。

---

### AH-SR-049 -- Hub-Edge 缺少 durable end-to-end delivery contract（Partial mitigated in repo）

**风险**：Hub 端 dispatch 通过 outbox 记录，但 `RecordDelivery` 失败仅 `slog.Error` + `continue without tracking`；Edge 端 callback 是 fire-and-forget + in-memory 3x 重试，失败只记日志；两端均无端到端 idempotent ack、journal/sequence、replay/cursor、reconciliation 闭环。

**代码证据**：

| 位置 | 事实 |
|---|---|
| `hub-server/internal/service/agent_dispatch.go:442-446` | `RecordDelivery` 失败后 `slog.Error` + `continue`，不阻塞 dispatch，也不入死信 |
| `hub-server/internal/service/delivery_outbox.go` | outbox model + schema（migration 0052/0053）完整，但 `deliveryOutboxRecord` 是 service-local struct，不在 model package |
| `hub-server/internal/app/` | `StartDeliveryRetryLoop` 存在于 `delivery_outbox.go` 但 **未在 app/wiring.go 或任何 background goroutine 中启动** -- retry loop 有代码但运行时永不执行 |
| `edge-server/internal/hub/callback.go:1-13` | "fire-and-forget with retry... failures are logged but never block" |
| `edge-server/internal/lifecycle/process_executor.go` | `fireHubAck`/`Stream`/`Done`/`Fail` 都是 async goroutine + `callbackSem`，失败不重试、不落地 journal |
| `docs/decisions.md` ADR-016 | 明确要求 "delivery outbox / ACK / retry / dead-letter"，当前实现未达到 |

**关闭条件**：Edge 增加 outbox/journal + sequence + idempotent ack；Hub 回放 cursor/reconciliation；端到端 contract test 覆盖离线/重放/重连路径。

---

## Mitigated in Repo: 代码已缓解，缺闭环证据

### AH-SR-028 -- Hub JWT secret 曾是硬编码默认值（Mitigated; rotate required）

**代码证据**：

| 位置 | 事实 |
|---|---|
| `hub-server/internal/config/config.go:560-581` | `Validate()` 包含 `knownHardcodedSecrets` 列表，匹配即拒绝，除非环境变量覆盖 |
| `hub-server/internal/config/config_test.go:123-138` | `TestJWTSecretHardcodedDefaultRejected` 验证硬编码默认值被拒绝 |
| `hub-server/internal/config/config_test.go:720-754` | `#101` 标注：拒绝所有已知硬编码 secret；env override 可放行 |

**当前状态**：代码已加固，但生产环境 JWT secret 轮换证据仍是关闭条件。见 [[ops-hk3]] 当前 STATE。

---

### AH-SR-035 -- Hub OIDC callback/JWKS 缺浏览器真实授权码流证据（Mitigated; deploy verification required）

**代码证据**：

| 位置 | 事实 |
|---|---|
| `hub-server/internal/handler/oidc.go` | `PostOIDCCallback`（POST，code+PKCE exchange）/ `GetOIDCCallback`（GET，redirect landing） |
| `hub-server/internal/service/oidc.go` | PKCE state 存 Redis，code→token exchange 完整 |
| `hub-server/internal/router/router.go:83-84` | `/client/auth/oidc/callback` GET+POST 已路由 |
| `hub-server/tests/oidc/oidc_smoke_test.go` | 端到端 smoke test 通过本地 mock IDP |

**缺失**：无真实浏览器（staging/production）完成完整 OIDC login -- 从 TokenDance ID 授权页到 Hub session 落地、`/client/auth/me` 验证的 approved-real 证据。

---

### AH-SR-036 -- Desktop system-browser PKCE 缺真实登录闭环证据（Mitigated; deploy/client verification required）

**代码证据**：

| 位置 | 事实 |
|---|---|
| `app/desktop/src-tauri/src/oidc_server.rs` | Rust loopback HTTP server 捕获 OIDC callback，emit `oidc-callback` event |
| `app/desktop/src/api/hubAuth.ts` | PKCE code_verifier/challenge 生成 + Tauri/Vite 双模式 code exchange |
| `app/desktop/src-tauri/src/secure_store.rs` | OS-native keyring（Windows/macOS/Linux）存储 token |
| `app/desktop/src-tauri/src/lib.rs:74-75` | `start_oidc_callback_server` / `stop_oidc_callback_server` Tauri command |
| `app/desktop/src-tauri/Cargo.toml` | `keyring-core` + 三个平台 native store 依赖 |

**BUT**：i18n 文案 `zh.json:1853-1854` 明确标注：

> "Desktop 当前会保存 PKCE 状态并打开授权 URL；自动回调捕获和 code exchange 仍待接入。"
> "OIDC 授权页可带 PKCE 状态打开，但回调捕获和 Hub token exchange 仍在接入中。"

**缺失**：Desktop 对 live Hub 完成 login/logout/reconnect 闭环的 approved-real 证据。

---

## 风险间依赖关系

```text
AH-SR-028 (JWT secret 轮换)
  └─ 阻断 AH-SR-035/036（登录需要可信 Hub JWT）

AH-SR-046 (capability 签发)
  └─ 阻塞 AH-SR-045（remote read 也需要 capability scope 模型）

AH-SR-049 (durable delivery)
  └─ 是 remote Edge / hub_relay 模式的前置条件
  └─ 也是 ADR-016 的合规要求
```

## 相关页面

- [[security-risk-register]] -- 完整风险登记表与发布门禁
- [[architecture-seams]] -- 架构边界与非协商约束
- [[ops-hk3]] -- 生产环境当前状态与验证命令
- [[cleanup-playbook]] -- 清理策略与优先级
- [[flow-control-event]] -- Hub-Edge 事件流与控制线
