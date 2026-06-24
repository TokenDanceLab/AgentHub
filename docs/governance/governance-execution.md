# AgentHub 治理执行

最后更新：2026-06-17

本文件将 TokenDance 系统治理映射为 AgentHub 执行项。AgentHub 是多 Agent 协作平台；它是 TokenDance ID 的 relying party，拥有 Hub、Edge、Desktop、Web 和 Mobile 客户端。

## 根输入

- `../../../docs/ecosystem/ecosystem-execution-queue.md`（TokenDance ID workspace）
- `../../../docs/identity/identity-auth.md`（TokenDance ID workspace）
- `../../../docs/identity/authorization-model.md`（TokenDance ID workspace）
- `../../../docs/identity/feishu-integration.md`（TokenDance ID workspace）
- `../../../docs/security/security-risk.md`（TokenDance ID workspace）
- `../../../docs/identity/i18n-packaging.md`（TokenDance ID workspace）
- `../../../docs/design/design-system.md`（TokenDance ID workspace）
- `../../../docs/design/visual-qa-matrix.md`（TokenDance ID workspace）

## AgentHub 队列映射

| 队列 ID | 本地负责区域 | 需检查的本地文件/文档 | 最低完成证据 |
|---|---|---|---|
| TD-P0-HUB-01 | Hub OIDC 登录 | `hub-server/internal/handler/auth.go`、`hub-server/internal/jwtutil/tokendance.go`、`hub-server/internal/service/auth.go` | 仓库级 handler/service 测试覆盖 callback、非法 issuer/audience、`tokendance_sub` 映射、Hub access/refresh session、UUID device proof 测试完成；关闭前需提供发布分支证明、部署回调/客户端注册证明、刷新/登出冒烟测试 |
| TD-P0-CLIENT-01 | Desktop/Web 登录 | `app/desktop/src/`、`app/web/src/`、`app/desktop/src-tauri/` | Desktop/Web token/用户元数据限制在 tab 作用域的 `sessionStorage` 内；Web 生产代码守卫为 Hub-only；WS 路由测试接受 Hub 签发的 token 并拒绝升级前的 TokenDance bearer；剩余：登录/登出截图、发布分支 WS 认证冒烟测试、部署配置、Web server-owned session 姿态 |
| TD-P0-FEISHU-01 | 飞书集成网关 | `hub-server/internal/`、`api/` | `/integrations/feishu/events`、`/integrations/feishu/card-actions`、`message_id` 幂等性、`card.action.trigger` 3s 响应、无 3xx 重定向 — **尚未开始** |
| TD-P1-HUB-02 | Hub 授权 | `hub-server/internal/service/`、`hub-server/internal/middleware/` | 对 org/project/thread/run/profile/integration secrets 应用 resource/action 检查 — 等待 TD-P0-HUB-01 部署 |
| TD-P0-DESIGN-01 | 视觉 QA | `app/desktop/screenshots/`、`app/web/screenshots/`、`app/mobile-rn/screenshots/` | Desktop 14 张截图（缺少审批/错误/diff）、Web 70+ 张截图（最完整）、Mobile RN 截图 QA 在 5177；公开产品站点待定 |
| TD-P0-I18N-01 | i18n 对等 | `app/desktop/src/i18n/locales/`、`app/web/src/i18n/locales/` | Desktop 扁平 `zh.json`/`en.json` 和 Web 命名空间 JSON 目录结构匹配；Mobile 缺少专用 i18n 文件 |
| TD-P0-SEC-01 | 安全/风险 | `docs/governance/security-risk-register.md` | 登记表创建于 2026-06-01；严重/高危发现需提供生产部署证据 |

## 本地分发规则

1. 每个登录、OIDC、会话、飞书、授权或多客户端问题应引用相关根队列 ID。
2. Hub 签发的 session 是产品本地权威；TokenDance ID 仅证明身份。
3. Desktop 是 Tauri 项目；Mobile 是 Expo/React Native 项目。它们共享相同的 Hub 认证边界但为独立的代码库。
4. Edge Server 仅本地运行；它连接 Hub 以进行任务分发和 SSO 身份认证。
5. Web 客户端仅连接 Hub（无本地 Edge loopback）；无直接第三方 provider 登录。
6. 生产部署和运维证据保留在 server workspace；不得将主机/路径/密钥复制到本仓库。

## 同步清单

- 当队列 ID 从未开始变为部分完成或已完成时，更新本文件。
- 当主要功能或批次完成时，更新 `docs/roadmap.md`。
- 当部署版本和 commit hash 变更时，更新根目录 `STATE.md`。
- 当新增发现、缓解措施或部署验证时，更新 `docs/governance/security-risk-register.md`。
- 当 Hub session 或 token 规则变更时，更新根 `docs/identity/identity-auth.md` / `docs/identity/authorization-model.md`。
- 当 API 契约变更时，更新 `api/openapi.yaml` 和 `api/events.md`。
