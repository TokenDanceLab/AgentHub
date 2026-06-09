# 后端审计交接清单 — 致后端负责人

> 来源：AgentHub 全项目只读审计（2026-06-07）
> 你当前分支：`feat/backend-edge-hub`
> 完整审计报告：`docs/review-2026-06-07-glm-5.1/`

以下 6 个问题涉及的文件**你正在改**，请在提交时一并处理。标注了优先级、具体位置和修法建议。

---

## 🔴 P0：必须修

### 1. OIDC 回调反射型 XSS

**文件**：`hub-server/internal/handler/oidc.go:111-117`
**问题**：`GetOIDCCallback` 用 `fmt.Sprintf` 把 URL 参数 `code` 和 `state` 直接嵌入 HTML，未做 HTML 转义。攻击者可构造恶意 URL 执行任意 JS。

**修法**：
```go
// 之前
fmt.Sprintf(`...<p>Authorization Code: <code>%s</code></p>...`, code, state)
// 之后
html.EscapeString(code), html.EscapeString(state)
```
或者更好的做法：成功页面只显示"登录成功"，不显示 code。

### 2. /debug/config 明文密码

**文件**：`hub-server/internal/app/app.go`（`hubConfigDumper` 函数附近）
**问题**：`/debug/config` 端点返回完整配置 JSON，包含 `db_password`、`redis_password`、`jwt_secret`、`local_auth_token` 等。虽然有 Basic Auth，但仍然是凭据泄露面。

**修法**：在 config 序列化时对包含 `password`/`secret`/`token` 的字段做 mask：
```go
// 示例：将敏感值替换为 "***"
func maskSensitive(key string, value string) string {
    lower := strings.ToLower(key)
    if strings.Contains(lower, "password") || strings.Contains(lower, "secret") || strings.Contains(lower, "token") {
        return "***"
    }
    return value
}
```

---

## 🟡 P1：应该修

### 3. OIDC auth code 明文显示

**文件**：同 `oidc.go:112,115`
**问题**：成功页面把 authorization code 明文显示给用户。code 是一次性凭证，不应暴露。
**修法**：成功页面只显示"OIDC 认证成功，请返回应用"，不显示 code 和 state。

### 4. WebSocket typing frame 缺权限验证

**文件**：`hub-server/internal/handler/ws.go:161-201`（`messageLoop` 中）
**问题**：typing frame 的 `session_id` 未做成员权限验证。理论上非会话成员可以发送 typing 通知。
**修法**：在处理 typing 事件前，验证发送者是 session 成员（和 message 发送使用相同的成员检查逻辑）。

### 5. DI 参数爆炸（你已在处理）

**文件**：`hub-server/internal/router/router.go`（26 参数）→ 你新增的 `app_handlers.go`/`app_services.go` 已在拆分
**说明**：这个问题你已经在解决了。确保新结构中每个 handler 只接收自己需要的依赖即可。

### 6. App.Run() 初始化过长（你已在处理）

**文件**：`hub-server/internal/app/app.go`（180+ 行 `Run()` 方法）→ 你新增的 `subscribers.go` 已在拆分
**说明**：同上，你已经在做。确保 bus subscriber 注册和 lifecycle 管理集中到 subscribers.go。

---

## 附：交叉审核确认状态

以上所有发现已经过独立交叉审核验证：
- ✅ 文件路径和行号准确
- ✅ 问题真实存在（非误报）
- ✅ 修法建议可行

**注意**：`hub-server/internal/repository/` 层和 `hub-server/internal/service/oidc.go` 的问题**不在你的修改范围内**，已由另一个分支处理。
