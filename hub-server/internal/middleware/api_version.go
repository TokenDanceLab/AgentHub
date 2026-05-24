package middleware

import "github.com/gin-gonic/gin"

const apiVersion = "1.0.0"

// APIVersion adds an X-API-Version header to every response.
func APIVersion() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("X-API-Version", apiVersion)
		c.Next()
	}
}
