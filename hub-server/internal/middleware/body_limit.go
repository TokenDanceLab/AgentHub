package middleware

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// BodyLimit wraps the request body with http.MaxBytesReader to cap the
// incoming request body size. When the body exceeds maxBytes, further
// reads return an error and the connection is flagged for close.
func BodyLimit(maxBytes int64) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxBytes)
		c.Next()
	}
}
