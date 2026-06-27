# AgentHub 安全风险登记表

最后审查：2026-06-27

本文件只记录当前安全风险队列、发布门禁和验证入口。2026-06-27 前的完整历史登记表见 [../history.md](../history.md)。

## 发布门禁

- `Critical` / `High` 且状态为 `Open`、`rotate required`、`deploy verification required`、`client verification required` 或 `runtime/log verification required` 的风险，默认阻断公开发布。
- `Accepted` 必须记录 owner、日期、原因、补偿控制和复查触发条件。
- 真实生产 endpoint、host、日志、备份、secret、token、callback code 和 session 证据只放私有运维文档；本仓库只写无密结论和证据指针。
- 跨仓库身份、授权或 Gateway 边界变化必须同步 TokenDance workspace 级文档。

## 当前 P0 / High 风险

| ID | Severity | Status | Risk | Closing condition |
|---|---|---|---|---|
| AH-SR-028 | Critical | Mitigated in repo; rotate required | Hub JWT secret 曾有硬编码默认值；代码已改为环境变量，但旧环境可能需要轮换。 | 轮换所有部署实例 secret，并验证旧 secret 不再可用。 |
| AH-SR-035 | High | Mitigated in repo; deploy verification required | Hub OIDC callback、JWKS 和 Hub session 代码/测试已存在，但缺少浏览器完成真实授权码流证据。 | 完成 staging/production OIDC browser login，确认 Hub session 和 `/client/auth/me`，私有记录无密证据。 |
| AH-SR-036 | High | Mitigated in repo; deploy/client verification required | Desktop system-browser PKCE、Hub session、WS auth、logout/reconnect 有代码，但缺少真实 Desktop 登录闭环证据。 | Desktop 对 live Hub 完成 login/logout/reconnect，私有记录无密证据。 |
| AH-SR-037 | High | Open | Web 仍用 `sessionStorage` 保存 Hub session；缺少 BFF/HttpOnly cookie 或 accepted alternative。 | 实现 server-owned session，或形成 accepted risk 并写补偿控制。 |
| AH-SR-045 | High | Open | Remote Edge read API 认证后缺少 route/target/workspace/user-action 级授权。 | 增加远程 read API scoped authorization 和代表性 negative tests。 |
| AH-SR-046 | High | Open | Edge run-start 仍缺少绑定 Hub user、Edge device、target、project/workspace 和 action 的 per-run capability。 | 增加 route-scoped run-start token/capability 和 wrong-target/project/action/stale negative tests。 |
| AH-SR-048 | High | Mitigated in repo; runtime/log verification required | Edge 启动日志已脱敏，但真实 adapter debug 日志仍需验证不泄露 prompt、MCP、config、image path 或 session。 | 用真实 adapter smoke 审查 runtime/debug logs，私有记录无密证据。 |
| AH-SR-049 | High | Open | Hub-Edge delivery 缺少 durable end-to-end delivery contract；callback、control、offline replay 可能分歧。 | 设计并实现 Edge outbox/journal、event sequence、idempotent ack、replay/cursor、reconciliation。 |

## High Deploy/Client Verification Queue

这些项已有代码缓解，但仍需要部署、客户端或远程模式证据：

| ID | 主题 | 需要的证据 |
|---|---|---|
| AH-SR-001 | TokenDance bearer issuer/audience | 所有启用兼容路径环境配置 AgentHub client audience，并验证 wrong-audience 拒绝。 |
| AH-SR-002 | TokenDance bearer 不等于 Hub session | Desktop/Web 使用 Hub-issued session；TokenDance bearer 不能直接授权 `/client/*`、`/web/*`、`/edge/*`。 |
| AH-SR-003 | 登录 device ID 一致性 | 登录、logout、refresh、多设备注册真实流程通过。 |
| AH-SR-004 / AH-SR-005 / AH-SR-023 | Remote Edge/approval/target-bound design | 非 loopback remote mode 之前补齐认证、target health、allowlist sync 和审批证明。 |
| AH-SR-020 | Edge callback 绑定 user/device/run | 真实 Desktop reconnect + callback 链路通过。 |
| AH-SR-021 | Attachment sharing | Hub/Desktop file-message flow 通过，并决定 forwarded file reference 策略。 |
| AH-SR-029 | Hub session boundary | TokenDance bearer 被 Hub REST/WS 拒绝；Hub-issued session 被接受。 |
| AH-SR-032 | Edge workspace allowlist | 部署配置只允许预期 project roots，不能空 allowlist 或 `/`。 |
| AH-SR-042 | Mobile device proof | Mobile 暂不深挖；发布前再做 Android/iOS development build 证据。 |

## Medium / Product Boundary Queue

| ID | 状态 | 风险 | 下一步 |
|---|---|---|---|
| AH-SR-043 | Open | Web preview/mock surfaces 仍可能和生产 UI 路径共享，容易误报 fake execution 或 fake private-chat success。 | 预览模式显式 gate，生产 mutation 走 Hub `/web/agent-tasks` 或 TeamRun API。 |
| AH-SR-044 | Open | Runner compatibility health 仍进入 Desktop/Web settings/workbench，和 Runtime adapter + Execution Target 模型不一致。 | 用 Runtime inventory + Execution Target health 替代 runner-centric UI 假设。 |
| AH-SR-013 | Local-only | 本机未跟踪 `.env` 可能包含 secret-looking 值。 | 保持 `.env` ignored；不要 zip/paste/force-add；必要时本机轮换。 |

## Dependency Watch

| 包 | 严重度 | 状态 |
|---|---:|---|
| `github.com/jackc/pgx/v5` v5.9.2 | critical / low | 等待上游修复或安全替代路径 |
| `github.com/google/uuid` v1.6.0 | medium | 等待上游修复 |
| `glib` (Rust/Tauri) | medium | 等待 Tauri 上游依赖更新 |

## 验证入口

```powershell
pwsh ./scripts/verify-ci-gates.ps1
pwsh ./scripts/verify-release-gate.ps1
python -c "import yaml, pathlib; yaml.safe_load(pathlib.Path('api/openapi.yaml').read_text(encoding='utf-8')); print('yaml ok')"
git diff --check
```

按 touched surface 追加：

```powershell
cd hub-server; go test ./... -short -count=1
cd ../edge-server; go test ./... -short -count=1
cd ../app/desktop; corepack pnpm test; corepack pnpm typecheck
cd ../web; corepack.cmd pnpm typecheck; corepack.cmd pnpm exec vite build
```

## 维护规则

- 新风险进入本文件；历史证据、长命令输出和日期型审计进入 [../history.md](../history.md) 指向的外部归档或私有运维文档。
- 修复落地时只在表格中写当前状态和关闭条件，避免追加长篇日志。
- 变成架构决策的风险链接 [../decisions.md](../decisions.md) 或架构章节。
- 处于 `Open` 的 High 风险必须在 roadmap、issue 或 PR 中有 owner 和下一步。
