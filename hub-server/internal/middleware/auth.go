package middleware

import (
	"context"
	"github.com/agenthub/pkg/reqlog"
	"log/slog"
	"os"
	"strings"

	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/jwtutil"
	"github.com/agenthub/hub-server/internal/metrics"
	"github.com/gin-gonic/gin"
)

// AccessTokenBlacklistChecker is the subset of cache used to reject revoked
// access JWTs by jti after logout (#888). Optional: when nil, blacklist checks
// are skipped (unit tests without Redis).
type AccessTokenBlacklistChecker interface {
	IsAccessTokenBlacklisted(ctx context.Context, jti string) (bool, error)
}

// AuthDependencies carries the security dependencies of AuthMiddleware.
// Instance-owned (#1551): the composition root constructs these once per App
// instead of mutating package-level callbacks/globals, so multiple Apps in
// one process (parallel tests, in-process servers) stay isolated.
//
//   - BlacklistChecker: nil skips jti blacklist checks.
//   - PermissionAudit: nil makes permission decisions un-audited (no-op).
//
// Fail-open/fail-closed semantics live in the implementations: the Redis
// checker itself fails open on Redis errors (documented policy).
type AuthDependencies struct {
	Sessions         SessionChecker
	BlacklistChecker AccessTokenBlacklistChecker
	PermissionAudit  func(ctx context.Context, userID string, decision string, allowed bool, details map[string]interface{}, clientIP string)
}

// AuthMiddleware is an instance-based Gin auth middleware (#1551). It owns
// no package-level mutable state; construct via NewAuthMiddleware in the
// composition root.
type AuthMiddleware struct {
	cfg  *config.Config
	deps AuthDependencies
	// adminUsers is the AGENTHUB_ADMIN_USERS snapshot taken at construction
	// (#1551); RequireAdmin consults the instance, not a package global.
	adminUsers []string
}

// NewAuthMiddleware constructs an AuthMiddleware with its security
// dependencies.
func NewAuthMiddleware(cfg *config.Config, deps AuthDependencies) *AuthMiddleware {
	return &AuthMiddleware{cfg: cfg, deps: deps, adminUsers: parseAdminUsers()}
}

// AuthMiddleware returns a Gin middleware that validates JWT bearer tokens and
// classifies the auth source.
// Hub-issued HS256 product tokens and configured same-origin browser cookies
// are accepted. Account ID/access tokens are provider credentials used by the
// OIDC service and must never be accepted as Hub REST or WebSocket bearer tokens.
//
// User identity (user_id, device_type, device_id) is injected into the Gin context.
// Product APIs must add RequireHubSession after this middleware.
// Handler returns the Gin middleware that validates JWT bearer tokens and
// classifies the auth source.
func (m *AuthMiddleware) Handler() gin.HandlerFunc {
	return func(c *gin.Context) {
		header := c.GetHeader("Authorization")
		if header == "" {
			if m.browserSession(c, false) {
				c.Next()
			}
			return
		}
		if !strings.HasPrefix(header, "Bearer ") {
			fail(c, errcode.AuthInvalidToken)
			c.Abort()
			return
		}
		tokenStr := strings.TrimPrefix(header, "Bearer ")
		m.validateToken(c, tokenStr)
	}
}

// WSBearerSubprotocol is the fixed WebSocket subprotocol negotiated for
// browser clients that carry a Hub JWT in Sec-WebSocket-Protocol.
//
// Convention (preferred browser path):
//
//	Sec-WebSocket-Protocol: agenthub.bearer.v1, <hub-jwt>
//
// The client requests both the fixed marker and the raw Hub JWT. Middleware
// extracts the JWT from the upgrade request header. The Accept layer should
// negotiate only the fixed marker (never the JWT) so the token is not echoed
// back in the response.
//
// Alternate single-token form (also accepted):
//
//	Sec-WebSocket-Protocol: access_token.<hub-jwt>
//
// Auth source priority for WS upgrades:
//  1. Authorization: Bearer <jwt> (native clients that can set headers)
//  2. Sec-WebSocket-Protocol token carriage (preferred browser path)
//
// Query access_token is intentionally not accepted: it leaks into proxy logs,
// browser history, and Referer headers. External/legacy clients must migrate
// to Bearer or Sec-WebSocket-Protocol.
// #nosec G101 -- constant WS subprotocol marker, not a credential
const WSBearerSubprotocol = "agenthub.bearer.v1"

// AuthMiddleware.WSHandler() returns a Gin middleware that validates JWT tokens for
// WebSocket upgrade requests.
//
// Token resolution order:
//  1. Authorization Bearer header (native clients)
//  2. Sec-WebSocket-Protocol subprotocol token (preferred browser carriage)
//
// Query "access_token" is rejected (fail closed) to prevent log/referrer leaks.
//
// After ParseToken it applies the same hub-session purpose/device gate as
// RequireHubSession so non-product tokens cannot upgrade WebSocket.
// WSHandler returns the WebSocket auth middleware (browser subprotocol JWT).
func (m *AuthMiddleware) WSHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		if header := c.GetHeader("Authorization"); header != "" && !strings.HasPrefix(header, "Bearer ") {
			fail(c, errcode.AuthInvalidToken)
			c.Abort()
			return
		}
		tokenStr := extractWSToken(c)
		if tokenStr == "" && c.GetHeader("Authorization") == "" && len(c.Request.Header.Values("Sec-WebSocket-Protocol")) == 0 && m.cfg.BrowserSession.Enabled() {
			if m.browserSession(c, true) && m.enforceHubSession(c) {
				c.Next()
			}
			return
		}
		if tokenStr == "" {
			// Audit the failed upgrade and count it in WSAuthFailures.
			m.auditPermission(c, "", "auth_validate", false, map[string]interface{}{
				"reason": "missing_token",
				"path":   c.FullPath(),
			}, c.ClientIP())
			if metrics.WSAuthFailures != nil {
				metrics.WSAuthFailures.WithLabelValues("missing_token").Inc()
			}
			fail(c, errcode.AuthInvalidToken)
			c.Abort()
			return
		}

		// WebSocket sessions must be Hub-issued sessions. Account tokens must
		// never bypass the Hub session/device handshake.
		claims, err := jwtutil.ParseToken(tokenStr, m.cfg.JWT.Secret)
		if err != nil {
			// Audit the failed upgrade and count it in WSAuthFailures.
			m.auditPermission(c, "", "auth_validate", false, map[string]interface{}{
				"reason": "invalid_token",
				"path":   c.FullPath(),
			}, c.ClientIP())
			if metrics.WSAuthFailures != nil {
				metrics.WSAuthFailures.WithLabelValues("invalid_token").Inc()
			}
			fail(c, errcode.AuthInvalidToken)
			c.Abort()
			return
		}
		if !m.acceptSessionClaims(c, claims) {
			return
		}
		setHubLocalClaims(c, claims)
		if !m.enforceHubSession(c) {
			return
		}
		c.Next()
	}
}

// extractWSToken resolves the Hub JWT for a WebSocket upgrade request.
// See AuthMiddleware.WSHandler() for the full priority list and protocol convention.
// Query access_token is intentionally ignored.
func extractWSToken(c *gin.Context) string {
	header := c.GetHeader("Authorization")
	if header != "" && strings.HasPrefix(header, "Bearer ") {
		return strings.TrimPrefix(header, "Bearer ")
	}
	return tokenFromWSSubprotocols(c.Request.Header.Values("Sec-WebSocket-Protocol"))
}

// tokenFromWSSubprotocols extracts a Hub JWT from Sec-WebSocket-Protocol values.
//
// Accepted forms:
//   - "agenthub.bearer.v1, <jwt>" (preferred; marker is ignored)
//   - "access_token.<jwt>" (single-token alternate)
//
// Multiple header values and comma-separated lists are both handled.
func tokenFromWSSubprotocols(values []string) string {
	var protos []string
	for _, v := range values {
		for _, part := range strings.Split(v, ",") {
			part = strings.TrimSpace(part)
			if part != "" {
				protos = append(protos, part)
			}
		}
	}
	if len(protos) == 0 {
		return ""
	}

	// Prefer explicit access_token.<jwt> form when present.
	for _, p := range protos {
		if strings.HasPrefix(p, "access_token.") {
			tok := strings.TrimPrefix(p, "access_token.")
			if tok != "" {
				return tok
			}
		}
	}

	// Preferred two-token form: fixed marker + raw JWT.
	// Return the first non-marker protocol token (the JWT).
	for _, p := range protos {
		if p == WSBearerSubprotocol || p == "agenthub" {
			continue
		}
		return p
	}
	return ""
}

// validateToken is a shared helper that validates a JWT token string and sets
// Gin context values. Used by AuthMiddleware.
func (m *AuthMiddleware) validateToken(c *gin.Context, tokenStr string) {
	// Product APIs accept only the Hub-issued HS256 session.
	claims, err := jwtutil.ParseToken(tokenStr, m.cfg.JWT.Secret)
	if err != nil {
		m.auditPermission(c, "", "auth_validate", false, map[string]interface{}{
			"reason": "invalid_token",
			"path":   c.FullPath(),
		}, c.ClientIP())
		if metrics.JWTVerificationFailures != nil {
			metrics.JWTVerificationFailures.WithLabelValues("invalid_token").Inc()
		}
		fail(c, errcode.AuthInvalidToken)
		c.Abort()
		return
	}
	if !m.acceptSessionClaims(c, claims) {
		return
	}
	setHubLocalClaims(c, claims)
	c.Next()
}

// setHubLocalClaims injects Hub product-session identity into the Gin context.
// Purpose is recorded so enforceHubSession can re-check the product gate.
// access_jti is set when the access token carries a jti (#888).
func setHubLocalClaims(c *gin.Context, claims *jwtutil.Claims) {
	c.Set("user_id", claims.UserID)
	c.Set("device_type", claims.DeviceType)
	c.Set("device_id", claims.DeviceID)
	c.Set("purpose", claims.Purpose)
	c.Set("access_jti", claims.ID)
	c.Set("auth_source", "hub_local")
}

// enforceHubSession applies the post-parse Hub product-session policy shared by
// RequireHubSession and AuthMiddleware.WSHandler(). It rejects:
//   - non-hub_local auth_source
//   - non-empty purpose (edge-api / run-start / capability class)
//   - edge device_type (defense in depth)
//
// On rejection it audits, fails closed with 403, and aborts the request.
// Returns true when the session is allowed to proceed.
func (m *AuthMiddleware) enforceHubSession(c *gin.Context) bool {
	authSource := c.GetString("auth_source")
	deviceType := c.GetString("device_type")
	purpose := c.GetString("purpose")

	reason := ""
	switch {
	case authSource != "hub_local":
		reason = "auth_source"
	case purpose != "":
		reason = "purpose"
	case deviceType == "edge":
		reason = "device_type"
	}
	if reason == "" {
		return true
	}

	m.auditPermission(c, c.GetString("user_id"), "hub_session_required", false, map[string]interface{}{
		"auth_source": authSource,
		"device_type": deviceType,
		"purpose":     purpose,
		"reason":      reason,
		"path":        c.FullPath(),
	}, c.ClientIP())
	if metrics.JWTVerificationFailures != nil {
		metrics.JWTVerificationFailures.WithLabelValues("hub_session_reject").Inc()
	}
	fail(c, errcode.ErrForbidden)
	c.Abort()
	return false
}

// acceptAccessClaims enforces the access-token jti blacklist after ParseToken
// (#888). Policy for legacy tokens without jti: accept-with-log for
// compatibility until those tokens expire naturally.
func (m *AuthMiddleware) acceptAccessClaims(c *gin.Context, claims *jwtutil.Claims) bool {
	if claims.ID == "" {
		slog.Info("access jwt missing jti; accepting legacy token until TTL",
			"user_id", claims.UserID,
			"device_id", claims.DeviceID,
			"path", c.FullPath(),
		)
		// Track legacy (non-revocable) token volume for migration monitoring.
		if metrics.JWTVerificationFailures != nil {
			metrics.JWTVerificationFailures.WithLabelValues("legacy_no_jti").Inc()
		}
		return true
	}
	if m.deps.BlacklistChecker == nil {
		return true
	}
	blacklisted, err := m.deps.BlacklistChecker.IsAccessTokenBlacklisted(c.Request.Context(), claims.ID)
	if err != nil {
		// The Redis-backed checker itself fail-opens on Redis errors and
		// returns the residual error here. The default policy is fail-open
		// (allow the request) to avoid locking users out during a Redis
		// outage. Operators hardening production set
		// AGENTHUB_AUTH_FAIL_CLOSED=true so a Redis outage cannot let a
		// revoked (logged-out) access JWT back in: the request is rejected
		// with 401 because revocation status could not be verified.
		if config.AuthFailClosed() {
			slog.Warn("access jti blacklist check error, fail-closed",
				"jti", claims.ID, "user_id", claims.UserID, "error", err)
			if metrics.JTIBlacklistCheckErrors != nil {
				metrics.JTIBlacklistCheckErrors.Inc()
			}
			m.auditPermission(c, claims.UserID, "auth_validate", false, map[string]interface{}{
				"reason": "jti_blacklist_check_failed_fail_closed",
				"path":   c.FullPath(),
			}, c.ClientIP())
			if metrics.JWTVerificationFailures != nil {
				metrics.JWTVerificationFailures.WithLabelValues("jti_blacklist_check_failed").Inc()
			}
			fail(c, errcode.AuthInvalidToken)
			c.Abort()
			return false
		}
		slog.Warn("access jti blacklist check error, fail-open", "jti", claims.ID, "error", err)
		// Fail-open Redis error — security-relevant, must be visible in Grafana.
		if metrics.JTIBlacklistCheckErrors != nil {
			metrics.JTIBlacklistCheckErrors.Inc()
		}
		return true
	}
	if blacklisted {
		m.auditPermission(c, claims.UserID, "auth_validate", false, map[string]interface{}{
			"reason": "access_jti_blacklisted",
			"path":   c.FullPath(),
		}, c.ClientIP())
		if metrics.JWTVerificationFailures != nil {
			metrics.JWTVerificationFailures.WithLabelValues("jti_blacklisted").Inc()
		}
		fail(c, errcode.AuthInvalidToken)
		c.Abort()
		return false
	}
	return true
}

// RequireHubSession is a middleware that requires a Hub-issued local session.
// TokenDance Account provider tokens prove identity only; they must not authorize Hub
// product APIs, device routing, Web task dispatch, or user-local resources.
// WebSocket upgrades share the same post-parse gate via AuthMiddleware.WSHandler().
func (m *AuthMiddleware) RequireHubSession() gin.HandlerFunc {
	return func(c *gin.Context) {
		if !m.enforceHubSession(c) {
			return
		}
		c.Next()
	}
}

// RequireAdmin is a middleware that restricts access to admin users.
// Admin user IDs are read from the comma-separated AGENTHUB_ADMIN_USERS
// environment variable. If the variable is empty, all requests are denied
// (fail-closed) to prevent accidental open access.
//
// This middleware MUST be applied after AuthMiddleware, which populates the
// "user_id" context value.
//
// Permission decisions (denied/granted) are audited via AuditPermissionFn
// when it is set.
func (m *AuthMiddleware) RequireAdmin() gin.HandlerFunc {
	adminUsers := m.adminUsers
	return func(c *gin.Context) {
		userID := c.GetString("user_id")
		clientIP := c.ClientIP()
		if userID == "" {
			m.auditPermission(c, userID, "admin_access", false, map[string]interface{}{
				"reason": "missing_user_id",
			}, clientIP)
			fail(c, errcode.AuthInvalidToken)
			c.Abort()
			return
		}
		if len(adminUsers) == 0 {
			m.auditPermission(c, userID, "admin_access", false, map[string]interface{}{
				"reason": "admin_users_not_configured",
			}, clientIP)
			fail(c, errcode.ErrForbidden)
			c.Abort()
			return
		}
		for _, admin := range adminUsers {
			if admin == userID {
				m.auditPermission(c, userID, "admin_access", true, map[string]interface{}{
					"path": c.FullPath(),
				}, clientIP)
				c.Next()
				return
			}
		}
		m.auditPermission(c, userID, "admin_access", false, map[string]interface{}{
			"reason": "not_in_admin_list",
			"path":   c.FullPath(),
		}, clientIP)
		fail(c, errcode.ErrForbidden)
		c.Abort()
	}
}

// parseAdminUsers reads AGENTHUB_ADMIN_USERS once at construction (#1551).
// The admin list is captured by the AuthMiddleware instance, so multiple
// instances (parallel tests, in-process servers) do not share mutable state
// and a restart-free change cannot bypass access control mid-flight.
func parseAdminUsers() []string {
	s := os.Getenv("AGENTHUB_ADMIN_USERS")
	if s == "" {
		return nil
	}
	parts := strings.Split(s, ",")
	users := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			users = append(users, p)
		}
	}
	return users
}

// auditPermission is a helper that calls the package-level AuditPermissionFn
// when set, recording permission decisions for the audit log.
func (m *AuthMiddleware) auditPermission(c *gin.Context, userID string, decision string, allowed bool, details map[string]interface{}, clientIP string) {
	if m.deps.PermissionAudit == nil {
		return
	}
	if userID == "" {
		// 未认证请求（如 WS 401）没有身份可审计；audit_events.user_id 是
		// NOT NULL uuid，空串会让 PostgreSQL 报 22P02 并污染错误日志。
		return
	}
	// Observability: enrich audit details with correlation fields
	// when available. These are best-effort; missing values are simply omitted.
	if details == nil {
		details = make(map[string]interface{})
	}
	if rid := reqlog.GetRequestID(c.Request.Context()); rid != "" {
		details["request_id"] = rid
	}
	if tid := c.GetString("task_id"); tid != "" {
		details["task_id"] = tid
	}
	if sid := c.GetString("session_id"); sid != "" {
		details["session_id"] = sid
	}
	if traceID := c.GetHeader("X-AgentHub-Trace-ID"); traceID != "" {
		details["trace_id"] = traceID
	}
	m.deps.PermissionAudit(c.Request.Context(), userID, decision, allowed, details, clientIP)
}
