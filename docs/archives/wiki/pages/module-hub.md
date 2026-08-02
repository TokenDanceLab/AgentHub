---
title: Hub Server — 控制面职责、热点与鉴权边界
summary: >
  Hub Server 是 TokenDance ID relying party、Hub session 签发者、IM 中枢、
  AgentTeam 编排器和 Edge 中继面。本文汇编其核心职责、服务层热点 god file、
  鉴权两层模型（TokenDance 身份 vs Hub session）及当前已知风险。
tags:
  - hub-server
  - auth
  - hotspot
  - god-file
  - session
  - OIDC
  - architecture
sources:
  - docs/architecture.md
  - docs/architecture/01-hub-server.md
  - docs/architecture/06-auth-identity.md
  - docs/decisions.md
  - docs/governance/security-risk-register.md
  - AGENTS.md
updated: 2026-07-16
---

## 职责边界

Hub Server（`hub-server/`）是 AgentHub 的**云端控制面**。它**不启动 Agent Runtime**，执行始终归 [[module-edge]]。

| 领域 | Hub 拥有 | Hub 不拥有 |
|---|---|---|
| 身份 | OIDC code exchange，`tokendance_sub` 到 Hub user 映射 | 第三方 provider OAuth app 或 provider token |
| Session | Hub access/refresh JWT，WebSocket auth，device proof | TokenDance ID token 直接当产品 session |
| 授权 | Hub-local membership/resource/action 检查 | 把身份认证等同授权 |
| IM | Contacts、sessions、messages、attachments、notifications | 本机文件系统 / raw process |
| Agent 路由 | Agent Profile、Execution Target、pending task、relay control | CLI 进程生命周期 |
| 审计 | Audit event 持久化和管理查询 | 生产 secret 或 live infra 状态 |

## 源码结构

| 层 | 路径 | 说明 |
|---|---|---|
| 入口 | `hub-server/cmd/server-hub/main.go` | 进程入口 |
| DI 组装 | `hub-server/internal/app/wiring.go` | 30+ 个 handler/service 的构造函数和依赖注入 |
| Router | `hub-server/internal/router/router.go` | 单体路由注册，按 `AuthMiddleware`/`RequireHubSession` 分组 |
| Handler | `hub-server/internal/handler/` | HTTP 层：auth、contact、session、message、agent、agent_team、oidc、ws 等 |
| Service | `hub-server/internal/service/` | 业务逻辑层 |
| Repository | `hub-server/internal/repository/` | GORM 持久化 |
| Model | `hub-server/internal/model/` | GORM model 定义 |
| Middleware | `hub-server/internal/middleware/` | auth、CORS、rate limit、body limit、metrics 等 |
| WS | `hub-server/internal/ws/` | WebSocket frame 定义和 Manager |
| JWT | `hub-server/internal/jwtutil/` | HS256 签发 + RS256 TokenDance 验证 |
| 配置 | `hub-server/internal/config/`、`hub-server/configs/` | 环境变量驱动 |
| 迁移 | `hub-server/migrations/` | 数据库 schema |

契约入口：REST 见 `api/openapi.yaml`，WS frame 见 `api/events.md`。

## 热点服务文件（god file）

以下文件超过 450 行，承担过多职责，是重构靶点：

| 文件 | 行数 | 凝结的职责 |
|---|---|---|
| `internal/service/message.go` | 860 | 消息发送、seq 分配（Redis/DB fallback）、session touch、消息搜索、附件关联 |
| `internal/service/agent_dispatch.go` | 781 | Hub→Edge HTTP dispatch、dispatch payload 构造、callbacks、relay、edge device 选择 |
| `internal/service/session.go` | 728 | 会话 CRUD、成员管理、pin、last_read、typing、conversation list |
| `internal/service/agent_run_event.go` | 694 | run event 解析、持久化、chat message 投影、event→message 映射 |
| `internal/service/delivery_outbox.go` | 599 | outbox journal、ACK、retry、dead-letter（[[flow-control-event]] 的 Hub 侧实现） |
| `internal/service/execution_target.go` | 516 | 执行目标管理、target health、device 绑定 |
| `internal/service/oidc.go` | 461 | PKCE flow、code exchange、token 签发、session 创建 |
| `internal/model/agent_team.go` | 627 | AgentTeam/AgentTeamMember/TeamRun/TeamRunMember 全部 model + 关联方法 |
| `internal/handler/agent_team.go` | 577 | team CRUD handler、member、run、compete |
| `internal/handler/agent.go` | 464 | agent dispatch、control、event 处理 |
| `internal/handler/message.go` | 455 | message send、search、pin、reaction handler |

`internal/app/wiring.go` 和 `internal/router/router.go` 虽不长，但作为 DI 中枢和路由单体，职责集中度也偏高 —— 新增 handler/service 需同时修改两者。

## 鉴权两层模型

Hub 鉴权区分**身份证明**和**产品会话**，这是 `AGENTS.md` 和 [[architecture-seams]] 的核心安全边界：

```text
TokenDance ID RS256 JWT  →  身份证明（"我是谁"）
Hub-issued HS256 JWT     →  产品会话（"我能操作 Hub 资源"）
```

### 中间件链

| 中间件 | 作用 | 应用于 |
|---|---|---|
| `AuthMiddleware` | 解析任意 Bearer token（先试 RS256 TokenDance，fallback HS256 Hub），注入 `auth_source` | `/client/*` 受保护路由 |
| `RequireHubSession()` | 拒绝 `auth_source != "hub_local"`，即拒绝 TokenDance bearer 直接操作产品 API | `/client/auth/me`、`/client/contacts`、`/client/sessions`、`/client/messages`、`/client/agent-tasks` 等 |
| `WSAuthMiddleware` | **只接受** Hub-issued HS256 session；TokenDance bearer 不能在 WS 升级时通过 | `/client/ws` |
| `RequireAdmin()` | `AGENTHUB_ADMIN_USERS` 逗号分隔白名单；空列表 = fail-closed | `/admin/*`、审计查询 |
| `RequireLocalAuth()` | `RequireHubSession()` 的别名，兼容历史调用点 | 旧路由 |

### Auth 路由分组（`router.go`）

```text
/health                       → 无鉴权
/api/public                   → 无鉴权
/client/auth/oidc/authorize   → 仅 rate limit，无鉴权（登录入口）
/client/auth/oidc/callback    → 仅 rate limit，无鉴权
/client/auth/refresh          → 仅 rate limit（用 refresh token）
/client/ws                    → WSAuthMiddleware（只接受 Hub session）
/client/auth/me               → AuthMiddleware + RequireHubSession
/client/contacts/*            → AuthMiddleware + RequireHubSession
/client/sessions/*            → AuthMiddleware + RequireHubSession
/client/messages/*            → AuthMiddleware + RequireHubSession
/client/agent-tasks/*         → AuthMiddleware + RequireHubSession
/client/edge/*                → AuthMiddleware + per-route 鉴权
/web/*                        → AuthMiddleware + RequireHubSession
/admin/*                      → AuthMiddleware + RequireAdmin
```

### 关键决策

- [[decisions]] ADR-017：Hub/Edge 授权区分**身份令牌**和 **per-run capability token**。真实安全边界以当前 JWT/capability 实现和 [[risks-open]] 为准。
- `AGENTS.md` 明确：TokenDance ID 只证明身份；Hub Server 用 Hub-local membership/resource/action 决定权限。

## 已知安全风险

见 [[risks-open]] 完整登记表。以下是 Hub 相关 P0/High：

| ID | 严重度 | 状态 | 摘要 |
|---|---|---|---|
| AH-SR-028 | Critical | Mitigated; rotate required | Hub JWT secret 曾有硬编码默认值，需轮换所有部署实例 |
| AH-SR-035 | High | Deploy verification required | OIDC callback 缺少浏览器完成真实授权码流证据 |
| AH-SR-036 | High | Deploy/client verification required | Desktop PKCE 缺少真实 login/logout/reconnect 闭环证据 |
| AH-SR-037 | High | Open | Web 用 `sessionStorage` 存 session，缺少 BFF/HttpOnly cookie |
| AH-SR-049 | High | Open | Hub-Edge delivery 缺少 durable end-to-end contract |

## 部署与运维

- 固定端口：`8080`
- 数据库：PostgreSQL（GORM）
- 缓存/seq：Redis
- 反向代理：nginx（loopback trusted proxy）
- 部署边界：[[architecture-seams]] → `docs/architecture/05-deployment.md`
- 性能门禁：`docs/reference/backend-performance-gates.md`

## 相关页面

- [[overview]] — 项目总览
- [[module-edge]] — Edge Server 执行面
- [[module-frontend]] — 前端消费 Hub API
- [[architecture-seams]] — 模块边界与契约
- [[flow-control-event]] — 事件流与控制线
- [[risks-open]] — 完整安全风险登记表
- [[cleanup-playbook]] — 重构策略
