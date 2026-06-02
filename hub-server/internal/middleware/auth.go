package middleware

import (
	"context"
	"net/http"
	"os"
	"strings"
	"sync"

	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/jwtutil"
	"github.com/gin-gonic/gin"
)

// AuditPermissionFn is an optional callback that receives permission-decision
// audit events. Set by the app during initialization to wire the AuditService
// into middleware without creating import cycles.
var AuditPermissionFn func(ctx context.Context, userID string, decision string, allowed bool, details map[string]interface{}, clientIP string)

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

// WSAuthMiddleware returns a Gin middleware that validates JWT tokens for
// WebSocket upgrade requests. It checks the Authorization header first (for
// native clients), then falls back to the "access_token" query parameter
// (for browser WebSocket clients which cannot set custom headers).
func WSAuthMiddleware(cfg *config.Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		var tokenStr string
		header := c.GetHeader("Authorization")
		if header != "" && strings.HasPrefix(header, "Bearer ") {
			tokenStr = strings.TrimPrefix(header, "Bearer ")
		} else {
			tokenStr = c.Query("access_token")
		}
		if tokenStr == "" {
			fail(c, errcode.AuthInvalidToken)
			c.Abort()
			return
		}

		// WebSocket sessions must be Hub-issued sessions. TokenDance ID bearer
		// tokens prove identity only and must not bypass the Hub session/device
		// handshake by authenticating at the upgrade middleware layer.
		claims, err := jwtutil.ParseToken(tokenStr, cfg.JWT.Secret)
		if err != nil {
			fail(c, errcode.AuthInvalidToken)
			c.Abort()
			return
		}
		c.Set("user_id", claims.UserID)
		c.Set("device_type", claims.DeviceType)
		c.Set("device_id", claims.DeviceID)
		c.Set("auth_source", "hub_local")
		c.Next()
	}
}

// validateToken is a shared helper that validates a JWT token string and sets
// Gin context values. Used by both AuthMiddleware and WSAuthMiddleware.
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
		fail(c, errcode.AuthInvalidToken)
		c.Abort()
		return
	}
	c.Set("user_id", claims.UserID)
	c.Set("device_type", claims.DeviceType)
	c.Set("device_id", claims.DeviceID)
	c.Set("auth_source", "hub_local")
	c.Next()
}

// RequireHubSession is a middleware that requires a Hub-issued local session.
// TokenDance ID bearer tokens prove identity only; they must not authorize Hub
// product APIs, device routing, Web task dispatch, or user-local resources.
func RequireHubSession() gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.GetString("auth_source") != "hub_local" {
			auditPermission(c, c.GetString("user_id"), "hub_session_required", false, map[string]interface{}{
				"auth_source": c.GetString("auth_source"),
				"path":        c.FullPath(),
			}, c.ClientIP())
			fail(c, &errcode.Error{
				Code:       "FORBIDDEN",
				Message:    "Hub-issued session is required for this API",
				HTTPStatus: http.StatusForbidden,
			})
			c.Abort()
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
			fail(c, &errcode.Error{
				Code:       "FORBIDDEN",
				Message:    "admin access not configured — set AGENTHUB_ADMIN_USERS",
				HTTPStatus: http.StatusForbidden,
			})
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
		fail(c, &errcode.Error{
			Code:       "FORBIDDEN",
			Message:    "admin access required",
			HTTPStatus: http.StatusForbidden,
		})
		c.Abort()
	}
}

// getAdminUsers reads and caches the AGENTHUB_ADMIN_USERS env var.
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
