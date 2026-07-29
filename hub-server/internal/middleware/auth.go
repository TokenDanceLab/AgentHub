package middleware

import (
	"context"
	"log/slog"
	"os"
	"strings"
	"sync"

	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/jwtutil"
	"github.com/agenthub/hub-server/internal/metrics"
	"github.com/gin-gonic/gin"
)

// AuditPermissionFn is an optional callback that receives permission-decision
// audit events. Set by the app during initialization to wire the AuditService
// into middleware without creating import cycles.
var AuditPermissionFn func(ctx context.Context, userID string, decision string, allowed bool, details map[string]interface{}, clientIP string)

// AccessTokenBlacklistChecker is the subset of cache used to reject revoked
// access JWTs by jti after logout (#888). Optional: when nil, blacklist checks
// are skipped (unit tests without Redis).
type AccessTokenBlacklistChecker interface {
	IsAccessTokenBlacklisted(ctx context.Context, jti string) (bool, error)
}

// accessTokenBlacklist is set during app wiring; nil means no blacklist check.
var accessTokenBlacklist AccessTokenBlacklistChecker

// SetAccessTokenBlacklist wires the Redis-backed access-token jti blacklist
// checker used by AuthMiddleware and WSAuthMiddleware. Pass nil to disable.
func SetAccessTokenBlacklist(c AccessTokenBlacklistChecker) {
	accessTokenBlacklist = c
}

// AuthMiddleware returns a Gin middleware that validates JWT bearer tokens and
// classifies the auth source.
// It supports dual-mode identity parsing:
// 1. TokenDance ID RS256 JWT (if configured) — identity compatibility only
// 2. Local HS256 JWT — Hub-issued product session
//
// User identity (user_id, device_type, device_id) is injected into the Gin context.
// Product APIs must add RequireHubSession after this middleware.
func AuthMiddleware(cfg *config.Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		header := c.GetHeader("Authorization")
		if header == "" || !strings.HasPrefix(header, "Bearer ") {
			fail(c, errcode.AuthInvalidToken)
			c.Abort()
			return
		}
		tokenStr := strings.TrimPrefix(header, "Bearer ")
		validateToken(c, cfg, tokenStr)
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
const WSBearerSubprotocol = "agenthub.bearer.v1"

// WSAuthMiddleware returns a Gin middleware that validates JWT tokens for
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
func WSAuthMiddleware(cfg *config.Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		tokenStr := extractWSToken(c)
		if tokenStr == "" {
			// G9: WS auth path previously had no audit log and no metric.
			auditPermission(c, "", "auth_validate", false, map[string]interface{}{
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

		// WebSocket sessions must be Hub-issued sessions. TokenDance ID bearer
		// tokens prove identity only and must not bypass the Hub session/device
		// handshake by authenticating at the upgrade middleware layer.
		claims, err := jwtutil.ParseToken(tokenStr, cfg.JWT.Secret)
		if err != nil {
			// G9: WS auth path previously had no audit log and no metric.
			auditPermission(c, "", "auth_validate", false, map[string]interface{}{
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
		if !acceptAccessClaims(c, claims) {
			return
		}
		setHubLocalClaims(c, claims)
		if !enforceHubSession(c) {
			return
		}
		c.Next()
	}
}

// extractWSToken resolves the Hub JWT for a WebSocket upgrade request.
// See WSAuthMiddleware for the full priority list and protocol convention.
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
func validateToken(c *gin.Context, cfg *config.Config, tokenStr string) {
	// Try TokenDance ID RS256 JWT first (if TokenDance ID is configured).
	if cfg.TokenDanceID.IssuerURL != "" && cfg.TokenDanceID.ClientID != "" {
		if claims, err := jwtutil.ParseTokenDanceJWT(tokenStr, cfg.TokenDanceID.IssuerURL, cfg.TokenDanceID.ClientID); err == nil {
			c.Set("user_id", claims.Subject)
			c.Set("device_type", "tokendance_bearer")
			c.Set("device_id", "")
			c.Set("auth_source", "tokendance_id")
			c.Next()
			return
		}
	}

	// Fallback to local HS256 JWT.
	claims, err := jwtutil.ParseToken(tokenStr, cfg.JWT.Secret)
	if err != nil {
		auditPermission(c, "", "auth_validate", false, map[string]interface{}{
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
	if !acceptAccessClaims(c, claims) {
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
// RequireHubSession and WSAuthMiddleware. It rejects:
//   - non-hub_local auth_source (e.g. TokenDance identity bearer)
//   - non-empty purpose (edge-api / run-start / capability class)
//   - edge / tokendance_bearer device_type (defense in depth)
// On rejection it audits, fails closed with 403, and aborts the request.
// Returns true when the session is allowed to proceed.
func enforceHubSession(c *gin.Context) bool {
	authSource := c.GetString("auth_source")
	deviceType := c.GetString("device_type")
	purpose := c.GetString("purpose")

	reason := ""
	switch {
	case authSource != "hub_local":
		reason = "auth_source"
	case purpose != "":
		reason = "purpose"
	case deviceType == "edge" || deviceType == "tokendance_bearer":
		reason = "device_type"
	}
	if reason == "" {
		return true
	}

	auditPermission(c, c.GetString("user_id"), "hub_session_required", false, map[string]interface{}{
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
func acceptAccessClaims(c *gin.Context, claims *jwtutil.Claims) bool {
	if claims.ID == "" {
		slog.Info("access jwt missing jti; accepting legacy token until TTL",
			"user_id", claims.UserID,
			"device_id", claims.DeviceID,
			"path", c.FullPath(),
		)
		// G9: track legacy (non-revocable) token volume for migration monitoring.
		if metrics.JWTVerificationFailures != nil {
			metrics.JWTVerificationFailures.WithLabelValues("legacy_no_jti").Inc()
		}
		return true
	}
	if accessTokenBlacklist == nil {
		return true
	}
	blacklisted, err := accessTokenBlacklist.IsAccessTokenBlacklisted(c.Request.Context(), claims.ID)
	if err != nil {
		// Checker already fail-opens on Redis errors; treat residual errors as open.
		slog.Warn("access jti blacklist check error, fail-open", "jti", claims.ID, "error", err)
		// G9: fail-open Redis error — security-relevant, must be visible in Grafana.
		if metrics.JTIBlacklistCheckErrors != nil {
			metrics.JTIBlacklistCheckErrors.Inc()
		}
		return true
	}
	if blacklisted {
		auditPermission(c, claims.UserID, "auth_validate", false, map[string]interface{}{
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
// TokenDance ID bearer tokens prove identity only; they must not authorize Hub
// product APIs, device routing, Web task dispatch, or user-local resources.
// WebSocket upgrades share the same post-parse gate via WSAuthMiddleware.
func RequireHubSession() gin.HandlerFunc {
	return func(c *gin.Context) {
		if !enforceHubSession(c) {
			return
		}
		c.Next()
	}
}

// RequireLocalAuth is kept for existing call sites. Local Hub auth and Hub
// session are the same boundary after TokenDance ID OIDC exchange.
func RequireLocalAuth() gin.HandlerFunc {
	return RequireHubSession()
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
func RequireAdmin() gin.HandlerFunc {
	adminUsers := getAdminUsers()
	return func(c *gin.Context) {
		userID := c.GetString("user_id")
		clientIP := c.ClientIP()
		if userID == "" {
			auditPermission(c, userID, "admin_access", false, map[string]interface{}{
				"reason": "missing_user_id",
			}, clientIP)
			fail(c, errcode.AuthInvalidToken)
			c.Abort()
			return
		}
		if len(adminUsers) == 0 {
			auditPermission(c, userID, "admin_access", false, map[string]interface{}{
				"reason": "admin_users_not_configured",
			}, clientIP)
			fail(c, errcode.ErrForbidden)
			c.Abort()
			return
		}
		for _, admin := range adminUsers {
			if admin == userID {
				auditPermission(c, userID, "admin_access", true, map[string]interface{}{
					"path": c.FullPath(),
				}, clientIP)
				c.Next()
				return
			}
		}
		auditPermission(c, userID, "admin_access", false, map[string]interface{}{
			"reason": "not_in_admin_list",
			"path":   c.FullPath(),
		}, clientIP)
		fail(c, errcode.ErrForbidden)
		c.Abort()
	}
}

// getAdminUsers reads and caches the AGENTHUB_ADMIN_USERS env var once at
// process startup via sync.Once. The admin list is read on the first call
// (typically during the first admin-authenticated request) and then cached
// for the lifetime of the process.
//
// This means changes to AGENTHUB_ADMIN_USERS require a process restart to
// take effect. The sync.Once pattern is intentional: it avoids racing on
// os.Getenv during concurrent requests and prevents mid-flight admin list
// changes that could bypass access control.
var (
	adminUsersOnce sync.Once
	adminUsersList []string
)

func getAdminUsers() []string {
	adminUsersOnce.Do(func() {
		s := os.Getenv("AGENTHUB_ADMIN_USERS")
		if s == "" {
			return
		}
		parts := strings.Split(s, ",")
		for _, p := range parts {
			p = strings.TrimSpace(p)
			if p != "" {
				adminUsersList = append(adminUsersList, p)
			}
		}
	})
	return adminUsersList
}

// auditPermission is a helper that calls the package-level AuditPermissionFn
// when set, recording permission decisions for the audit log.
func auditPermission(c *gin.Context, userID string, decision string, allowed bool, details map[string]interface{}, clientIP string) {
	if AuditPermissionFn == nil {
		return
	}
	AuditPermissionFn(c.Request.Context(), userID, decision, allowed, details, clientIP)
}
