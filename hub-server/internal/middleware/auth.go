package middleware

import (
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/handler"
	"github.com/agenthub/hub-server/internal/jwtutil"
)

func AuthMiddleware(secret string) gin.HandlerFunc {
	return func(c *gin.Context) {
		header := c.GetHeader("Authorization")
		if header == "" || !strings.HasPrefix(header, "Bearer ") {
			handler.Fail(c, errcode.AuthInvalidToken)
			c.Abort()
			return
		}
		tokenStr := strings.TrimPrefix(header, "Bearer ")
		claims, err := jwtutil.ParseToken(tokenStr, secret)
		if err != nil {
			handler.Fail(c, errcode.AuthInvalidToken)
			c.Abort()
			return
		}
		c.Set("user_id", claims.UserID)
		c.Set("device_type", claims.DeviceType)
		c.Set("device_id", claims.DeviceID)
		c.Next()
	}
}
