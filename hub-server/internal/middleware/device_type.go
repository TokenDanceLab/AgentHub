package middleware

import (
	"slices"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/gin-gonic/gin"
)

func DeviceTypeCheck(allowedTypes ...string) gin.HandlerFunc {
	return func(c *gin.Context) {
		deviceType := c.GetString("device_type")
		if !slices.Contains(allowedTypes, deviceType) {
			fail(c, errcode.AuthDeviceMismatch)
			c.Abort()
			return
		}
		c.Next()
	}
}
