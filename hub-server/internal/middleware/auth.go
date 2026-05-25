package middleware

import (
	"net/http"
	"strings"

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
