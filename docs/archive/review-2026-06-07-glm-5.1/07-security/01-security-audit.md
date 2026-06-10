# 安全与配置审计报告

> 审计日期: 2026-06-07 | 审计范围: AgentHub 全栈 | 严格只读

---

## 1. 认证与授权

### 1.1 JWT 实现质量

- **文件**: `hub-server/internal/jwtutil/jwt.go`
- **评级**: 🟢 良好
- **说明**:
  - 使用 `golang-jwt/jwt/v5`（v5.3.1），是当前维护版本
  - `ParseToken` 通过 `jwt.WithValidMethods([]string{"HS256"})` 限制签名算法，防止算法混淆攻击
  - Refresh token 使用 `crypto/rand` 生成 32 字节随机值，哈希存储
  - 宽松的 issuer/audience 检查有注释说明是为了向后兼容旧 token
- **建议**: issuer/audience 的宽松检查应该在下一个大版本中收紧为强制检查

### 1.2 TokenDance ID RS256 JWT 验证

- **文件**: `hub-server/internal/jwtutil/tokendance.go`
- **评级**: 🟢 良好
- **说明**:
  - 正确实现了 JWKS 缓存（1 小时 TTL），包含双重检查锁定
  - 两遍验证：先提取 `kid`，再完整验证签名/issuer/audience
  - 限制了签名方法为 RSA：`if _, ok := t.Method.(*jwt.SigningMethodRSA); !ok`
  - kid 不匹配时自动刷新缓存并重试
  - JWKS URI 必须显式配置或从 issuer URL 派生

### 1.3 OIDC 授权码 + PKCE 流程

- **文件**: `hub-server/internal/service/oidc.go`
- **评级**: 🟢 良好
- **说明**:
  - 正确实现了 PKCE（强制 S256，拒绝明文）
  - State 使用 `crypto/rand` 生成 32 字节随机值
  - 使用 Redis `GetDel` 原子消费 state，防止重放攻击
  - 验证 device_type/device_id 与授权阶段一致
  - 验证 redirect_uri 一致性
  - 回环地址 redirect 仅限 desktop/cli 设备类型
  - Token exchange 的 client_secret 通过配置注入，未硬编码
- **建议**: 无

### 1.4 GetOIDCCallback 反射型 XSS

- **文件**: `hub-server/internal/handler/oidc.go:111-117`
- **评级**: 🔴 高风险
- **说明**: `GetOIDCCallback` 将 URL 查询参数 `code` 和 `state` 通过 `fmt.Sprintf` 的 `%s` 直接嵌入 HTML，未进行 HTML 转义。攻击者可以构造包含 `<script>` 标签的恶意 URL，当用户点击后将在浏览器中执行任意 JavaScript。
- **建议**: 使用 `html.EscapeString()` 对 `code` 和 `state` 进行转义后再嵌入 HTML，或改用模板引擎自动转义。同时考虑不在 HTML 中显示完整的 authorization code（安全敏感信息），只显示成功/失败状态。

### 1.5 授权码暴露在 HTML 响应中

- **文件**: `hub-server/internal/handler/oidc.go:112,115`
- **评级**: 🟡 中风险
- **说明**: 成功回调页面将完整的 `code`（authorization code）显示在 HTML 中。虽然浏览器关闭后无法持久访问，但该页面可能被浏览器缓存、截图或被恶意浏览器扩展读取。authorization code 是一次性凭证，应尽可能减少其暴露面。
- **建议**: 仅显示登录成功/失败状态，不显示 authorization code 明文。如需调试，可在 debug 模式下才显示。

### 1.6 WebSocket 认证

- **文件**: `hub-server/internal/middleware/auth.go:46-76`, `hub-server/internal/handler/ws.go`
- **评级**: 🟢 良好
- **说明**:
  - WebSocket 升级请求通过 `WSAuthMiddleware` 验证 JWT
  - 支持 Header 和 query parameter 两种 token 传递方式（浏览器 WebSocket 无法设自定义 Header）
  - 已认证的升级跳过 in-protocol auth frame（`user_id` 已在 context 中）
  - 未认证连接必须在 5 秒内发送 auth frame，否则超时断开
  - WebSocket 仅接受 Hub-issued HS256 JWT，拒绝 TokenDance ID bearer token
- **建议**: query parameter 中的 `access_token` 可能被服务器日志、代理日志记录。建议在文档中说明此风险，并优先使用 Header 方式。

### 1.7 认证端点速率限制

- **文件**: `hub-server/internal/router/router.go:63-69`
- **评级**: 🟢 良好
- **说明**: OIDC authorize、callback、refresh 端点均配置了基于 IP 的滑动窗口速率限制（5 次/分钟）。
- **建议**: 无

### 1.8 管理员权限控制

- **文件**: `hub-server/internal/middleware/auth.go:149-194`
- **评级**: 🟢 良好
- **说明**:
  - `RequireAdmin` 从 `AGENTHUB_ADMIN_USERS` 环境变量读取管理员 ID 列表
  - 空列表时 fail-closed（拒绝所有请求），而非 fail-open
  - 权限决策通过 `AuditPermissionFn` 审计
  - 仅在 Hub session 上生效（RequireHubSession 之后）
- **建议**: 管理员列表使用 `sync.Once` 缓存，运行时无法更新。考虑支持热加载或定期刷新。

### 1.9 未认证端点审查

- **文件**: `hub-server/internal/router/router.go`
- **评级**: 🟢 良好
- **说明**:
  - 仅以下端点不需要认证：`/health`、`/api/public/stats`、`/client/auth/refresh`、OIDC authorize/callback
  - 所有业务端点均受 `AuthMiddleware` + `RequireHubSession` 保护
  - Edge 端点额外要求 `DeviceTypeCheck("desktop")`
  - Web 端点额外要求 `DeviceTypeCheck("web")`
- **建议**: 无

---

## 2. CORS 配置

### 2.1 Hub Server CORS

- **文件**: `hub-server/internal/middleware/cors.go`
- **评级**: 🟢 良好
- **说明**:
  - 默认 origins 基于环境区分：生产仅 `https://hub.vectorcontrol.tech`，开发包含 localhost
  - `validateCORSOriginsForEnvironment` 在生产环境下拒绝 loopback origins
  - 支持 `AGENTHUB_CORS_ORIGINS` 环境变量覆盖
  - `AllowCredentials: true` 配合显式 origin 白名单（非 `*`），符合规范
  - MaxAge 12 小时，合理
- **建议**: 无

### 2.2 Edge Server CORS

- **文件**: `edge-server/internal/httpserver/server.go:412-433`
- **评级**: 🟡 中风险
- **说明**:
  - 本地模式下仅允许 loopback origin（正确）
  - 远程模式下允许任何 http/https origin（`remoteMode: true` 时 `IsTrustedOrigin` 返回 true）
  - 远程模式依赖 auth middleware 保护，但 CORS 层的宽松 origin 可能导致跨域 cookie/credential 泄漏场景
- **建议**: 远程模式下应使用显式 origin 白名单而非接受任何 origin，或在远程模式下设置 `Access-Control-Allow-Credentials: false`

---

## 3. 密钥与敏感信息

### 3.1 .env 文件保护

- **文件**: `.gitignore:86-91,128-129`
- **评级**: 🟢 良好
- **说明**:
  - `.env`、`.env.local`、`.env.*` 均在 .gitignore 中
  - `!.env.example` 和 `!.env.production.example` 例外
  - `hub-server/deployments/.env.production` 和 `.env` 单独列出
- **建议**: 无

### 3.2 .env.example 中的弱默认值

- **文件**: `hub-server/.env.example:2-3`, `.env.example:17,29`
- **评级**: 🟢 良好
- **说明**:
  - JWT secret 使用 `dev-secret-change-in-production-*`，长度 >32 字符
  - DB password 使用 `dev_password`
  - `Config.Validate()` 拒绝已知弱 secret 列表（空字符串、常见密码等）
  - 最小长度 16 字符强制执行
- **建议**: 无

### 3.3 JWT Secret 启动验证

- **文件**: `hub-server/internal/config/config.go:425-449`
- **评级**: 🟢 良好
- **说明**:
  - 维护已知弱 secret 黑名单（11 个条目）
  - 同时检查 config 文件值和 env var 值
  - 最小长度 16 字符
  - 在开发环境也强制执行（无环境区分）
- **建议**: 考虑将最小长度提升到 32 字符以匹配 HMAC-SHA256 密钥推荐长度

### 3.4 Config 日志脱敏

- **文件**: `hub-server/internal/config/config.go:46-55,84-93,109-118,127-133,274-283`
- **评级**: 🟢 良好
- **说明**:
  - `DBConfig.LogValue()`、`RedisConfig.LogValue()`、`JWTConfig.LogValue()`、`TokenDanceIDConfig.LogValue()`、`S3Config.LogValue()` 均实现 `slog.LogValuer`，将密码/密钥脱敏为 `[REDACTED]`
  - 确保配置对象被结构化日志记录时不会泄漏敏感信息
- **建议**: 无

### 3.5 Debug 端点配置脱敏

- **文件**: `pkg/debug/debug.go:108-131`
- **评级**: 🟢 良好
- **说明**: `/debug/config` 端点通过 `SanitizeConfig` 自动将匹配 `password|secret|token|key|credential` 等模式的键值替换为 `[REDACTED]`。Hub 和 Edge 的配置转储器中的敏感键名（`db_password`、`jwt_secret`、`local_auth_token` 等）均匹配这些模式。
- **建议**: 无

### 3.6 Admin Server 认证保护

- **文件**: `hub-server/internal/app/app.go:602-649`
- **评级**: 🟢 良好
- **说明**:
  - Admin server 需要 `AGENTHUB_PPROF_USER` 和 `AGENTHUB_PPROF_PASS` 都设置才启动
  - 使用 HTTP Basic Auth 保护 pprof、metrics、config、state 端点
  - 默认监听 `127.0.0.1:6060`（仅本机可访问）
- **建议**: 无

### 3.7 Desktop 安全存储

- **文件**: `app/desktop/src-tauri/src/secure_store.rs`
- **评级**: 🟢 良好
- **说明**:
  - 使用平台原生 keyring（Windows Credential Manager / macOS Keychain / Linux keyutils）
  - Refresh token 和 access token 分别存储
  - Token 为空时拒绝写入
  - 通过 Tauri command 暴露，受 Tauri 权限系统保护
- **建议**: 无

### 3.8 OIDC Token Exchange 日志泄漏

- **文件**: `hub-server/internal/service/oidc.go:287-293`
- **评级**: 🟡 中风险
- **说明**: Token exchange 失败时，slog.Error 记录了完整的 `response_body`。Token endpoint 在错误响应中可能包含 `client_secret` 验证失败的详细信息或内部调试信息。同时 `redirect_uri_sent` 泄漏了配置的 redirect URI。
- **建议**: 仅记录 HTTP 状态码和截断的响应体（前 200 字符），或对错误响应体进行脱敏处理。

---

## 4. SQL 注入防护

### 4.1 Repository 层查询安全

- **文件**: `hub-server/internal/repository/` (全部)
- **评级**: 🟢 良好
- **说明**:
  - 所有查询使用 GORM 的参数化绑定（`db.Where("id = ?", id)`）
  - `AllocateSeqID` 的 raw SQL 使用参数化（`WHERE id = ?`）
  - `SearchAllMessages` 手动拼接 SQL 但所有变量通过 `args` 参数化传递
  - `PinMessageAtomic` 的 `FOR UPDATE` 使用参数化
  - 未发现任何字符串拼接 SQL 的情况
- **建议**: 无

### 4.2 搜索功能的 ILIKE 模式

- **文件**: `hub-server/internal/repository/message.go:138,158`
- **评级**: 🟡 中风险
- **说明**: `SearchMessages` 和 `SearchAllMessages` 使用 `ILIKE ?` 配合 `"%"+q+"%"` 构造搜索模式。虽然参数化防止了 SQL 注入，但未对搜索词中的 LIKE 通配符（`%`、`_`）进行转义，用户可以通过输入 `%` 来匹配所有记录（DoS/信息泄漏）。
- **建议**: 对搜索词 `q` 中的 `%` 和 `_` 进行转义后再包裹 `%`。例如 `strings.NewReplacer("%", "\\%", "_", "\\_").Replace(q)`。

---

## 5. 输入验证

### 5.1 Handler 层输入校验

- **文件**: `hub-server/internal/handler/validation.go`
- **评级**: 🟢 良好
- **说明**:
  - `normalizeUUID` 使用 `uuid.Parse` 验证和规范化 UUID
  - OIDC handler 验证 `device_type`（白名单：desktop/web/cli）
  - 所有 JSON 请求使用 `binding:"required"` 标签
  - redirect URI 验证：必须是绝对 http(s) URL，无 fragment，匹配白名单
- **建议**: 无

### 5.2 请求体大小限制

- **文件**: `hub-server/internal/middleware/body_limit.go`, `hub-server/internal/config/constants.go:48`
- **评级**: 🟢 良好
- **说明**: 全局请求体限制 10MB（`DefaultRequestBodyLimit`），文件上传限制 10MB（可配置）。使用 `http.MaxBytesReader` 在读取层面限制。
- **建议**: 无

### 5.3 文件上传安全

- **文件**: `hub-server/internal/handler/attachment.go`
- **评级**: 🟢 良好
- **说明**:
  - 客户端声明的 hash 与实际文件 hash 比对（SHA-256），防止数据篡改
  - 使用 `http.DetectContentType` 从文件内容嗅探 MIME 类型，不信任客户端声明
  - 下载时设置 `X-Content-Type-Options: nosniff`
  - 文件名通过 `sanitizeAttachmentFilename` 清洗（去除路径遍历、控制字符）
  - `Content-Disposition: attachment` 阻止浏览器内联渲染
  - hash 格式通过 `IsValidAttachmentHash` 验证
- **建议**: 无

### 5.4 WebSocket 消息校验

- **文件**: `hub-server/internal/handler/ws.go:75-158`
- **评级**: 🟡 中风险
- **说明**:
  - 未认证连接的首帧必须是 auth frame，5 秒超时
  - 已认证后，未知 frame type 仅记录 debug 日志并跳过（`continue`）
  - typing frame 的 `session_id` 提取为字符串，未验证是否为合法 UUID 或用户是否有权限访问该 session
  - 恶意 WebSocket 客户端可以发送大量 typing frame 对任意 session_id
- **建议**: 对 typing frame 的 session_id 进行格式验证和成员权限检查（`onTyping` 回调中已有成员检查，但 `messageLoop` 中没有）

---

## 6. 依赖安全

### 6.1 Hub Server 依赖

- **文件**: `hub-server/go.mod`
- **评级**: 🟢 良好
- **说明**:
  - Go 1.25.0（当前最新）
  - `golang-jwt/jwt/v5` v5.3.1（最新）
  - `gin-gonic/gin` v1.12.0（较新）
  - `redis/go-redis/v9` v9.19.0（较新）
  - `coder/websocket` v1.8.14（较新，替代已归档的 `nhooyr.io/websocket`）
  - `gorm.io/gorm` v1.31.1（较新）
  - 所有核心依赖版本均为 2024-2025 年发布，无已知高危漏洞
- **建议**: 定期运行 `govulncheck ./...` 检查漏洞

### 6.2 Edge Server 依赖

- **文件**: `edge-server/go.mod`
- **评级**: 🟢 良好
- **说明**:
  - 依赖较少，`gorilla/websocket` v1.5.3（注意 hub-server 使用 `coder/websocket`，两个库并存）
  - `golang-jwt/jwt/v5` v5.3.1
- **建议**: 考虑统一 WebSocket 库（hub 用 `coder/websocket`，edge 用 `gorilla/websocket`），减少维护负担

---

## 7. 配置管理

### 7.1 .env.example 完整性

- **文件**: `.env.example`, `hub-server/.env.example`
- **评级**: 🟢 良好
- **说明**:
  - 所有配置项均有注释说明用途
  - 敏感配置项标注"不要提交"
  - 提供生成强 secret 的示例命令（`openssl rand -hex 32`）
  - 包含 Docker Compose 和裸机两种部署场景的配置
  - AgentTeam guardrails 有完整配置项和默认值说明
- **建议**: 无

### 7.2 默认配置安全性

- **文件**: `hub-server/internal/config/config.go`, `hub-server/internal/config/constants.go`
- **评级**: 🟢 良好
- **说明**:
  - JWT secret 必须显式设置，弱默认值被拒绝
  - Admin server 需要显式设置用户名/密码
  - OIDC 配置是可选的，未配置时不启用
  - 默认 DB SSLMode 为 `disable`（开发友好，生产需显式覆盖）
  - 所有超时、限制、缓冲区大小均有合理默认值
- **建议**: 默认 `db.sslmode` 改为 `require`（生产安全），开发时显式设为 `disable`

### 7.3 Edge Server 自动生成认证 Token

- **文件**: `edge-server/internal/httpserver/server.go:98-112`
- **评级**: 🟢 良好
- **说明**:
  - 非 dev 模式下自动生成 32 字节随机 local auth token
  - 前缀 `aght_` 便于识别
  - 日志中仅显示 token 前缀
  - 支持 Hub JWT 或本地 token 双重认证
  - 使用 `constantTimeCompare` 防止时序攻击
- **建议**: 无

---

## 8. 环境变量安全

### 8.1 Edge Server 环境变量白名单

- **文件**: `edge-server/internal/lifecycle/env_sanitizer.go`
- **评级**: 🟡 中风险
- **说明**: `isWhitelistedEnvKey` 对 `AGENTHUB_*` 前缀的环境变量全部放行（第 103 行）。这意味着像 `AGENTHUB_JWT_SECRET`、`AGENTHUB_DB_PASSWORD`、`AGENTHUB_TOKENDANCE_ID_CLIENT_SECRET` 等敏感变量会被传递给 agent 子进程（如 Claude Code、OpenCode）。虽然 `IsSensitiveEnvKey` 检查了后缀模式（`_SECRET`、`_PASSWORD`、`_TOKEN` 等），但 `isWhitelistedEnvKey` 的 `AGENTHUB_` 前缀检查优先返回 true，敏感变量检查被短路。
- **建议**: 对 `AGENTHUB_*` 变量也执行 `IsSensitiveEnvKey` 检查。将第 103 行改为：先检查 `AGENTHUB_` 前缀，再排除匹配敏感模式的变量。

---

## 9. 附加发现

### 9.1 Edge Server GET 端点无认证

- **文件**: `edge-server/internal/httpserver/server.go:488-493`
- **评级**: 🟡 中风险
- **说明**: `isLocalAuthExempt` 对所有 GET/HEAD/OPTIONS 请求免认证（WebSocket upgrade 除外）。这意味着未认证的本地进程可以读取所有项目、线程、运行记录等元数据。虽然本地模式通常认为可信，但浏览器中的恶意页面可以利用这一点（如果同源限制被绕过）。
- **建议**: 考虑对敏感 GET 端点也要求认证，或至少对包含运行输出/日志的端点要求认证。

### 9.2 Admin 用户列表无法热更新

- **文件**: `hub-server/internal/middleware/auth.go:197-217`
- **评级**: 🟢 低影响
- **说明**: 管理员用户列表通过 `sync.Once` 缓存，运行时无法更新。添加/移除管理员需要重启服务。
- **建议**: 改用定期刷新（如每 5 分钟）或基于信号的刷新机制。

---

## 审计总结

| 级别 | 数量 | 关键发现 |
|------|------|----------|
| 🔴 高 | 1 | GetOIDCCallback 反射型 XSS（code/state 未转义） |
| 🟡 中 | 6 | authorization code 明文显示、OIDC 错误日志泄漏敏感信息、搜索 LIKE 通配符注入、WS typing 缺少 session 验证、Edge CORS 远程模式宽松、AGENTHUB_* 敏感环境变量泄漏到子进程 |
| 🟢 良好 | 14 | JWT/OIDC 实现、PKCE、SQL 参数化、文件上传安全、CORS（Hub）、配置脱敏、admin 保护等 |

**最高优先修复**: GetOIDCCallback XSS（`oidc.go:111-117`）— 立即修复。
