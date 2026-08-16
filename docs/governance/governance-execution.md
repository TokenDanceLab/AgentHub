# AgentHub 治理执行

最后更新：2026-08-16

本文件将 TokenDance 系统治理映射为 AgentHub 执行项。AgentHub 是多 Agent 协作平台；它是 TokenDance ID 的 relying party，拥有 Hub、Edge、Desktop、Web 和 Mobile 客户端。

## 根输入

TokenDance 系统级治理文档位于私有 workspace（standalone clone 不可达，不写入公开 URL）。本仓不复制其内容；身份、授权、飞书、安全、i18n、设计的跨产品边界以 `../AGENTS.md` §4 生态边界 + 下列 in-repo owner 为准：

- 身份与登录：`../architecture/06-auth-identity.md`（OIDC/PKCE、JWT 签发、设备注册）
- 授权：`../AGENTS.md` §4（Hub-local membership/resource/action）
- 安全风险：`security-risk-register.md`（SSOT，队列/状态/发布门禁以 register 为准）
- 飞书：`../AGENTS.md` §4（协作入口，非第二登录系统）
- i18n/公开包装：`../AGENTS.md` §4（zh/en 语义一致）
- 设计：`../architecture/07-design-system-ssot.md` + `../component-acceptance.md`

## AgentHub 队列映射

| 队列 ID | 本地负责区域 | 需检查的本地文件/文档 | 最低完成证据 |
|---|---|---|---|
| TD-P0-HUB-01 | Hub OIDC 登录 | `hub-server/internal/handler/auth.go`、`hub-server/internal/jwtutil/tokendance.go`、`hub-server/internal/service/auth.go` | **代码已落地**：handler/service 覆盖 callback、非法 issuer/audience、`tokendance_sub` 映射、Hub access/refresh session、device proof。**部署证据队列**：发布分支证明、回调/客户端注册、刷新/登出冒烟（对齐 AH-SR-035） |
| TD-P0-CLIENT-01 | Desktop/Web 登录 | `app/desktop/src/`、`app/web/src/`、`app/desktop/src-tauri/` | **代码已落地**：Desktop/Web tab-scoped `sessionStorage`；Web Hub-only 守卫；WS 接受 Hub-issued session、拒绝升级前 TokenDance bearer。**会话姿态**：AH-SR-037 **Accepted**（#438，非 Open）。**部署/客户端证据队列**：登录/登出截图、WS 认证冒烟、部署配置（对齐 AH-SR-036） |
| TD-P0-FEISHU-01 | 飞书集成网关 | `hub-server/internal/`、`api/` | 目标：`/integrations/feishu/events`、`/integrations/feishu/card-actions`、`message_id` 幂等、`card.action.trigger` 3s 响应、无 3xx 重定向。**状态（2026-08-05）**：IM-bridge SPEC 已 merged（2026-07-27 立项）；实施按 GitHub issue 推进 |
| TD-P1-HUB-02 | Hub 授权 | `hub-server/internal/service/`、`hub-server/internal/middleware/` | 对 org/project/thread/run/profile/integration secrets 应用 resource/action 检查。**状态**：代码侧 owner fail-closed / capability 绑定已推进（见 AH-SR-045/046 Mitigated）；完整 membership 矩阵与 live 证据仍排队 |
| TD-P0-DESIGN-01 | 视觉 QA | `app/desktop/screenshots/`、`app/web/screenshots/`、`app/mobile-rn/screenshots/` | Desktop/Web/Mobile 截图基线与 Visual QA 矩阵（gate 89 Ship，已收口）；公开产品站点属于产品发布事项，归发布流程，非本项范围 |
| TD-P0-I18N-01 | i18n 对等 | `app/desktop/src/i18n/locales/`、`app/web/src/i18n/locales/` | Desktop 扁平 `zh.json`/`en.json` 与 Web 命名空间目录对齐；Mobile 缺专用 i18n 文件 |
| TD-P0-SEC-01 | 安全/风险 | `docs/governance/security-risk-register.md` | **SSOT 指针 only**：队列、状态与发布门禁以 register 为准（最后审查 **2026-08-05**）。本文件不复制长表；Critical/High Open\|rotate\|verification-required 阻断公开发布 |

## 本地分发规则

1. 每个登录、OIDC、会话、飞书、授权或多客户端问题应引用相关根队列 ID。
2. Hub 签发的 session 是产品本地权威；TokenDance ID 仅证明身份。
3. Desktop 是 Tauri 项目；Mobile 是 Expo/React Native 项目。它们共享相同的 Hub 认证边界但为独立的代码库。
4. Edge Server 仅本地运行；它连接 Hub 以进行任务分发和 SSO 身份认证。
5. Web 客户端仅连接 Hub（无本地 Edge loopback）；无直接第三方 provider 登录。
6. 生产部署和运维证据保留在 server workspace；不得将主机/路径/密钥复制到本仓库。

## Login fixture topology gate

P0 remote-control fixture 只验证拓扑合同和离线证据形状：`Web -> Hub -> Desktop/Edge -> Local Edge -> CLI/SDK adapter`。

- Web 侧只用 Hub-issued session 和 Hub execution-target inventory fixture，不直连 Local Edge。
- Desktop receives Hub dispatch -> Local Edge starts CLI adapter 是真实远控链路的后续验收，不属于登录 fixture slice。
- future real TokenDanceID/OIDC login remains approval-gated；未获审批时，脚本不得打开真实浏览器登录、访问 TokenDance ID、启动真实 CLI/model 或部署。

## Package and real-readiness gates

D2b. Release dry build topology 是 topology/preflight only（拓扑/预检）验证；它检查版本、workflow、sidecar 名称、ignore 策略和 artifact 合同，不运行发布流程。

- full Tauri build / `pnpm tauri build` 是单独 opt-in 范围；Windows unsigned NSIS/portable 是未来显式启用的 artifact scope。
- Windows sidecar 名称固定为 `agenthub-edge-x86_64-pc-windows-msvc.exe`；updater metadata 必须成对记录 `latest.json` 和 `.sig`。
- macOS arm64 unsigned 边界只记录 `agenthub-edge-aarch64-apple-darwin`、`AgentHub.app` 和 `AgentHub_${version}_aarch64.dmg` 的未来包形状。
- `notarytool` notarization、codesign、stapling、GitHub Release、release asset upload 和 updater 生产 metadata publication 都是 later approval slice（后续审批范围）。
- dry artifacts 只允许作为 workflow artifact 上传；不发布到 release channel。
- Packaged Desktop OIDC readiness 是 proposal-only gate；Packaged real login dry readiness 只读仓库，不访问 Hub/TokenDance ID、不打开浏览器、不读取 secrets。
- unknown runtime fallback is forbidden; agentId must resolve through adapter registry without fallback.
- Edge CLI real-readiness is proposal-only unless explicitly approved: No real CLI/model run, operator approval, runtime path/env ownership, budget/redaction policy, artifact root, and evidence mode must be recorded before RealTested or Submission.

## 同步清单

- 当队列 ID 从未开始变为部分完成或已完成时，更新本文件。

- 当部署版本和 commit hash 变更时，更新 server workspace 的 AgentHub 运维状态文档；本仓库只保留无密证据指针。
- 当新增发现、缓解措施或部署验证时，更新 `docs/governance/security-risk-register.md`。
- 当 Hub session 或 token 规则变更时，更新 `../architecture/06-auth-identity.md`、`../AGENTS.md` §4 边界摘要与 `security-risk-register.md` 相关风险行；TokenDance ID workspace 侧系统级文档由管理员在私有 workspace 同步，不在本仓维护。
- 当 API 契约变更时，更新 `api/openapi.yaml` 和 `api/events.md`。
