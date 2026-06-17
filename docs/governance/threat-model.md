# Threat Model

> Updated: 2026-06-17
> 本页是 AgentHub 的信任边界模型与安全亮点速览，供评审快速理解安全深度。
> 完整逐条风险台账（44+ 条，含代码行号、测试命令、生产部署证据）见 [security-risk-register.md](security-risk-register.md)。

## 信任边界

```text
┌─────────────────────────────────────────────────────────────────┐
│  用户设备（本地信任域）                                          │
│                                                                 │
│  ┌──────────────┐   PKCE/system-browser   ┌──────────────────┐  │
│  │  Desktop     │ ──────────────────────▶ │  TokenDance ID   │  │
│  │  (Tauri)     │ ◀───── Hub session ──── │  (OIDC IdP)      │  │
│  │  OS Secure   │                          └──────────────────┘  │
│  │  Store       │                                 ▲              │
│  └──────┬───────┘                                 │ JWT(RS256)   │
│         │ local WS (loopback-only)                │ iss+aud 校验 │
│         v                                         │              │
│  ┌──────────────┐    workspace allowlist   ┌──────┴───────────┐  │
│  │  Local Edge  │ ◀────────────────────── │  Hub Server      │  │
│  │  (Go)        │    Hub→Edge 路由签名     │  (Go, PG+Redis)  │  │
│  │  ┌────────┐  │                          │  HS256 会话      │  │
│  │  │CLI     │  │                          │  设备路由        │  │
│  │  │sandbox │  │                          │  WS 鉴权         │  │
│  │  └───┬────┘  │                          └──────────────────┘  │
│  └──────┼───────┘                                                 │
│         │ 受控子进程（env 过滤、args 脱敏、stdout 预算）            │
│         v                                                         │
│  ┌──────────────┐                                                 │
│  │ Claude Code  │  ← 无密钥泄露：parent env 过滤 + readiness gate │
│  │ Codex        │                                                 │
│  │ OpenCode     │                                                 │
│  └──────────────┘                                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │  网络边界（loopback-only by default）
                              v
                        外部模型 API（经 TokenDance Gateway）
```

**四道边界**：
1. **身份边界**：TokenDance ID OIDC → Hub 本地会话（双重 JWT，RS256 校验 iss+aud）。
2. **会话边界**：Hub REST/WS 拒绝裸 TokenDance bearer，要求 Hub 签发会话；WS 首帧携带 HS256。
3. **执行边界**：Edge 默认 loopback-only，workspace allowlist 限制可访问路径，子进程 env 过滤 + args 脱敏。
4. **审批边界**：高风险操作走三级审批（YOLO/Auto/Manual）+ SecurityHook 23-check + permission_requested 一次性注册表。

## 安全亮点卡片

以下每条都有代码行号 + 测试 + 生产证据，详见 security-risk-register。

### 🔴 身份与会话（Critical/High）

| ID | 亮点 | 验证 |
|---|---|---|
| AH-SR-028 | JWT 密钥硬编码默认值已移除，改为环境变量 `HUB_JWT_SECRET`，模板用占位符 | 部署轮换旧密钥 |
| AH-SR-001/002 | TokenDance bearer 强制校验 `iss`+`aud`；compat 路径标记 `device_type=tokendance_bearer`，无法授权 `/client/*` `/web/*` `/edge/*` | `jwtutil/tokendance_test.go` |
| AH-SR-029 | Hub REST/WS 拒绝裸 TokenDance bearer，要求 Hub 签发会话 | `auth_test.go` |
| AH-SR-006 | WS 鉴权 Hub-session-only，首帧 HS256，RS256 bearer 被拒 | `ws_test.go` |

### 🟠 边界与隔离（High）

| ID | 亮点 | 验证 |
|---|---|---|
| AH-SR-004 | Edge 拒绝 wildcard/LAN/非 loopback 绑定，未认证时不外暴露 | `origin_test.go` |
| AH-SR-032 | Edge workspace allowlist，未列路径在文件操作前被拒 | `allowlist.go` |
| AH-SR-005 | permission 决策一次性注册表（runId+requestId），拒绝未知/重放 | `permission_registry.go` |
| AH-SR-014 | Edge 可选 local bearer token，`/v1/health` 与 CORS preflight 外全要求 | `server_test.go` |

### 🟡 数据与所有权（High/Medium）

| ID | 亮点 | 验证 |
|---|---|---|
| AH-SR-020 | Edge 回调绑定 user_id+device_id+edge_run_id，错用户/错设备被拒 | `edge_callback_security_test.go` |
| AH-SR-021/022 | 附件/消息 pin 校验 session 归属，跨 session 被拒；复合 FK 已部署 hk2 | `message_pin_security_test.go` |
| AH-SR-023 | Execution Target 的 Get/Ping 校验 owner；dispatch 按 target owner device 路由，不回退 | `agent_test.go` |
| AH-SR-034 | Profile/Skill/MCP/Target CRUD 校验 owner，跨 owner 写读返回 403 | 各 handler test |

### 🟢 部署加固（已部署 hk2）

| ID | 亮点 | 验证 |
|---|---|---|
| AH-SR-030 | CORS 锁定显式 origin，移除 wildcard 反射 | hk2 生产 smoke |
| AH-SR-031 | 限流中间件部署于 auth/token/API，per-IP bucket | `ratelimit.go` |
| AH-SR-016 | 生产环境 loopback/localhost origin 启动即失败 | hk2 smoke |
| AH-SR-017 | admin pprof/metrics 独立 loopback 监听 + Basic Auth，公共路由返回 JSON 404 | 公共 404 验证 |

### 🔵 运行时安全

| ID | 亮点 | 验证 |
|---|---|---|
| AH-SR-047 | 子进程 env 过滤 secret-looking parent 变量（含 `AGENTHUB_*` 敏感名 + Git config 覆盖路径） | `env_sanitizer.go` |
| AH-SR-048 | 子进程启动日志脱敏（redacted 命令名 + arg 计数 + `argsRedacted=true`） | `process_executor_test.go` |
| AH-SR-018 | run stdout 4 MiB/run 预算，结构化事件 1 MiB/event 预算，超限递归截断 | `event_emitter_test.go` |
| AH-SR-027 | 每任务事件数上限 `MaxRunEventsPerTask=4096`，超限回滚 | `agent_run_event_test.go` |

## 与竞品对比

| 维度 | AgentHub | 典型竞品 |
|---|---|---|
| 风险条目数 | 44+ 条 | 8 条 |
| 每条证据 | 代码行号 + 测试命令 + 生产部署状态 | 风险等级 + 理论建议 |
| 部署验证 | hk2 生产 smoke 多条已验证 | 多为理论 |
| 审批执行 | permission_requested 一次性注册表 + 三级模式 | 无权限系统或后端逻辑 |

## 已知的待闭环项（诚实标注）

以下为 Open 状态，已在 security-risk-register 记录后续动作，不构成已声明的安全能力：

- AH-SR-035/036：浏览器完整 OIDC 登录 + Desktop login/logout/reconnect 需生产/staging 端到端证据（代码与测试已覆盖）。
- AH-SR-037/043：Web server-owned session（BFF/HttpOnly）+ Web mock 与生产路径分离，公开发布前需收口。
- AH-SR-045/046/049：远程/云 Edge 的 route/target scoped 授权 + Hub-Edge 持久投递契约（outbox/journal），远程模式发布前设计。
