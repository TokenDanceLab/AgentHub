package middleware

import (
	"net/http"
	"os"
	"strings"
	"sync"

	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/handler"
	"github.com/agenthub/hub-server/internal/jwtutil"
	"github.com/gin-gonic/gin"
)

// AuthMiddleware returns a Gin middleware that validates JWT bearer tokens.
// It supports dual-mode authentication:
// 1. TokenDance ID RS256 JWT (if configured) — primary, validated via JWKS
// 2. Local HS256 JWT — fallback for legacy Hub-issued tokens
//
// User identity (user_id, device_type, device_id) is injected into the Gin context.
func AuthMiddleware(cfg *config.Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		header := c.GetHeader("Authorization")
		if header == "" || !strings.HasPrefix(header, "Bearer ") {
			handler.Fail(c, errcode.AuthInvalidToken)
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
			handler.Fail(c, errcode.AuthInvalidToken)
			c.Abort()
			return
		}
		validateToken(c, cfg, tokenStr)
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
		handler.Fail(c, errcode.AuthInvalidToken)
		c.Abort()
		return
	}
	c.Set("user_id", claims.UserID)
	c.Set("device_type", claims.DeviceType)
	c.Set("device_id", claims.DeviceID)
	c.Set("auth_source", "hub_local")
	c.Next()
}

// RequireLocalAuth is a middleware that blocks requests authenticated via
// TokenDance ID bearer tokens from mutating Hub-local user resources.
// TokenDance ID tokens are read-only for local user data (profile, password, etc.).
// Apply this middleware after AuthMiddleware on write endpoints that modify
// user-local resources.
func RequireLocalAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.GetString("auth_source") == "tokendance_id" {
			handler.Fail(c, &errcode.Error{
				Code:       "FORBIDDEN",
				Message:    "TokenDance bearer sessions cannot modify Hub-local user resources",
				HTTPStatus: http.StatusForbidden,
			})
			c.Abort()
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
func RequireAdmin() gin.HandlerFunc {
	adminUsers := getAdminUsers()
	return func(c *gin.Context) {
		userID := c.GetString("user_id")
		if userID == "" {
			handler.Fail(c, errcode.AuthInvalidToken)
			c.Abort()
			return
		}
		if len(adminUsers) == 0 {
			handler.Fail(c, &errcode.Error{
				Code:       "FORBIDDEN",
				Message:    "admin access not configured — set AGENTHUB_ADMIN_USERS",
				HTTPStatus: http.StatusForbidden,
			})
			c.Abort()
			return
		}
		for _, admin := range adminUsers {
			if admin == userID {
				c.Next()
				return
			}
		}
		handler.Fail(c, &errcode.Error{
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
