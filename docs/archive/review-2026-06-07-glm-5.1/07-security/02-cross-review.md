# 07-Security Cross-Review

> Cross-Reviewer: independent verification | Date: 2026-06-07 | Method: source-code audit against security-audit findings

---

## Verification of Critical (RED) Findings

### S-1: GetOIDCCallback Reflected XSS (`oidc.go:111-117`)

**Verdict: ✅ Confirmed**

Source code at `hub-server/internal/handler/oidc.go` lines 94-117:

```go
func (h *OIDCHandler) GetOIDCCallback(c *gin.Context) {
    code := c.Query("code")
    state := c.Query("state")
    // ...
    success := fmt.Sprintf(`...<code>%s</code>...`, code, state)
```

The `code` and `state` values from URL query parameters are directly embedded into HTML via `fmt.Sprintf` `%s` without any HTML escaping. An attacker can craft a URL like:
```
/callback?code=<script>alert(1)</script>&state=anything
```
This will execute arbitrary JavaScript in the victim's browser. The finding is real, severe, and should be fixed immediately.

**Line numbers:** The report says lines 111-117. Actual lines are 112 and 115 (the `fmt.Sprintf` calls in the `if lang == "zh"` and `else` branches). The range 111-117 is close enough -- line 111 is the `if lang == "zh"` check, lines 112/115 are the actual vulnerable `fmt.Sprintf` calls.

### S-2: Authorization code exposed in HTML response (`oidc.go:112,115`)

**Verdict: ✅ Confirmed**

The HTML response on lines 112/115 includes:
- Chinese version: `授权码: <code>%s</code>` (Authorization code)
- English version: `Authorization code: <code>%s</code>`

The full authorization code and state values are displayed in the HTML response. This is a legitimate medium-risk finding -- the code is a one-time credential and should not be shown in plaintext.

---

## Verification of Warning (YELLOW) Findings

### S-3: Edge Server CORS remote mode accepts any origin (`server.go:412-433`)

**Verdict: ✅ Confirmed**

Source code at `edge-server/internal/httpserver/server.go` lines 412-433:

```go
func corsMiddleware(next http.Handler, remoteMode bool) http.Handler {
    // ...
    if !security.IsTrustedOrigin(origin, remoteMode) {
        http.Error(w, "forbidden origin", http.StatusForbidden)
        return
    }
    w.Header().Set("Access-Control-Allow-Origin", origin)
```

And `edge-server/internal/security/origin.go` line 75:
```go
if remoteMode {
    return true  // any http/https origin is allowed
}
```

However, there is **no `Access-Control-Allow-Credentials` header** set in this CORS middleware. The report's concern about "跨域 cookie/credential 泄漏场景" needs qualification:

- `Access-Control-Allow-Credentials` is **not set** in the edge CORS middleware -- the middleware only sets `Allow-Origin`, `Allow-Methods`, and `Allow-Headers`.
- Without `Allow-Credentials: true`, browsers will NOT send cookies or auth headers cross-origin, significantly reducing the risk.
- The `Authorization` header is not a "credential" in the CORS sense (it's explicitly listed in `Allow-Headers`, which means it's opt-in by the JS client, not auto-sent like cookies).

**Revised assessment:** The finding is real but lower risk than described. The lack of `Allow-Credentials` limits the actual attack surface. The concern is valid for `Authorization` header exposure (JS on any origin can make authenticated cross-origin requests if they have the token), but this is mitigated by the auth requirement itself.

### S-4: OIDC token exchange error logs leak sensitive info (`oidc.go:287-293`)

**Verdict: ✅ Confirmed**

Source at `hub-server/internal/service/oidc.go` lines 286-293:

```go
slog.Error("oidc token endpoint returned non-200",
    "status", resp.StatusCode,
    "response_body", string(body),
    "redirect_uri_sent", redirectURI,
)
```

The full response body and redirect URI are logged. If the OIDC provider returns error details that include client_secret verification failures or internal state, this would be captured in logs. The `redirect_uri_sent` field leaks configured redirect URI. Both concerns are valid.

**Line numbers:** Report says 287-293, actual is 287-292. Close enough.

### S-5: ILIKE search wildcard injection (`message.go:138,158`)

**Verdict: ✅ Confirmed**

Source at `hub-server/internal/repository/message.go` lines 138 and 159:

```go
Where("content->>'text' ILIKE ?", "%"+q+"%")  // line 138
args := []interface{}{"user", userID, "%" + q + "%"}  // line 159
```

The search term `q` is used directly in the pattern without escaping `%` and `_` LIKE wildcards. A user searching for `%` would match all records. This is NOT SQL injection (parameterized correctly), but is a LIKE pattern injection allowing DoS or information disclosure.

### S-6: WebSocket typing frame lacks session validation (`ws.go:75-158`)

**Verdict: ✅ Confirmed**

Source at `hub-server/internal/handler/ws.go` lines 136-153:

```go
case ws.TypeTyping:
    sessionID := ""
    if m, ok := frame.Payload.(map[string]interface{}); ok {
        if sid, ok := m["session_id"].(string); ok {
            sessionID = sid
        }
    }
    // ... no UUID validation or membership check ...
    if sessionID != "" {
        h.onTyping(conn.UserID, sessionID)
    }
```

The `sessionID` is extracted as a string but never validated as a UUID, and no membership check is performed at this layer. A malicious client could send typing indicators for any session_id. The report notes that `onTyping` callback may have its own checks, but the `messageLoop` function (line 163+) likely has the same pattern.

### S-7: AGENTHUB_* env vars bypass sensitive key check in env_sanitizer (`env_sanitizer.go:103`)

**Verdict: ✅ Confirmed**

Source at `edge-server/internal/lifecycle/env_sanitizer.go`:

```go
func isWhitelistedEnvKey(key string) bool {
    upperKey := strings.ToUpper(key)
    if strings.HasPrefix(upperKey, "AGENTHUB_") {  // line 103
        return true  // ALWAYS returns true for AGENTHUB_*
    }
    // ...
}

func sanitizeParentEnv(extraEnv []string) []string {
    // ...
    if isWhitelistedEnvKey(key) {   // line 234 -- checked FIRST
        env = append(env, kv)
    } else if IsSensitiveEnvKey(key) {  // line 236 -- never reached for AGENTHUB_*
```

The control flow is clear: `isWhitelistedEnvKey` is called first, and since `AGENTHUB_*` prefix always returns true, the `IsSensitiveEnvKey` check is short-circuited. Variables like `AGENTHUB_JWT_SECRET`, `AGENTHUB_DB_PASSWORD` would be passed to child agent processes.

**However**, examining the actual hub-server environment variable naming convention, the sensitive variables are named:
- `AGENTHUB_JWT_SECRET` -- matches `_SECRET` suffix
- `AGENTHUB_DB_PASSWORD` -- matches `_PASSWORD` suffix

Both would pass through to agent child processes. This is a genuine security concern.

### S-8: Edge Server GET endpoints exempt from auth (`server.go:488-493`)

**Verdict: ✅ Confirmed**

Source at `edge-server/internal/httpserver/server.go` lines 488-493:

```go
func isLocalAuthExempt(r *http.Request) bool {
    if isWebSocketUpgrade(r) {
        return false
    }
    return r.Method == http.MethodGet || r.Method == http.MethodHead || r.Method == http.MethodOptions
}
```

All GET/HEAD/OPTIONS requests are auth-exempt. The comment on lines 479-487 explicitly acknowledges this design choice, noting that GET endpoints expose metadata but cannot mutate state. WebSocket upgrades are correctly excluded.

The risk is real but low in local mode (only accessible from loopback). In remote mode, it becomes more significant.

---

## Summary Table

| # | Finding | Level | Verdict | Notes |
|---|---------|-------|---------|-------|
| S-1 | OIDC callback reflected XSS | 🔴 | ✅ Confirmed | Real XSS, fix immediately |
| S-2 | Auth code in HTML response | 🟡 | ✅ Confirmed | Real information disclosure |
| S-3 | Edge CORS remote mode permissive | 🟡 | ✅ Confirmed | Risk lower than stated (no Allow-Credentials) |
| S-4 | OIDC error log leaks response body | 🟡 | ✅ Confirmed | Full response body logged |
| S-5 | ILIKE wildcard injection in search | 🟡 | ✅ Confirmed | Not SQL injection, but LIKE pattern abuse |
| S-6 | WS typing lacks session validation | 🟡 | ✅ Confirmed | No UUID check, no membership check |
| S-7 | AGENTHUB_* env bypasses sensitive filter | 🟡 | ✅ Confirmed | Control flow confirmed, JWT_SECRET/DB_PASSWORD leak |
| S-8 | Edge GET endpoints auth-exempt | 🟡 | ✅ Confirmed | Intentional design, risk is context-dependent |

**Overall assessment:** All findings are confirmed as real. The one Critical (XSS) is genuine and high-priority. The YELLOW findings are all valid with one qualification: the CORS finding (S-3) has lower practical risk than described because `Allow-Credentials` is not set in the edge CORS middleware. The env sanitizer finding (S-7) is particularly important and well-identified.
