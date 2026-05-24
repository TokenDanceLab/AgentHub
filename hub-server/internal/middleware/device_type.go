package middleware

import (
	"slices"

<<<<<<< HEAD
	"github.com/gin-gonic/gin"
	"github.com/agenthub/server-hub/internal/errcode"
	"github.com/agenthub/server-hub/internal/handler"
=======
	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/handler"
	"github.com/gin-gonic/gin"
>>>>>>> origin/master
)

func DeviceTypeCheck(allowedTypes ...string) gin.HandlerFunc {
	return func(c *gin.Context) {
		deviceType := c.GetString("device_type")
		if !slices.Contains(allowedTypes, deviceType) {
			handler.Fail(c, errcode.AuthDeviceMismatch)
			c.Abort()
			return
		}
		c.Next()
	}
}
