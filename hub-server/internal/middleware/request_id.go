package middleware

import (
	"github.com/gin-gonic/gin"

	"github.com/agenthub/hub-server/pkg/uuidv7"
)

const requestIDHeader = "X-Request-ID"

// RequestIDKey is the Gin context key where the request ID is stored.
const RequestIDKey = "request_id"

// RequestID is a Gin middleware that propagates or generates an X-Request-ID.
// If the incoming request already carries an X-Request-ID header, it is
// reused; otherwise a new UUIDv7 is generated. The ID is stored in the Gin
// context under RequestIDKey and echoed back in the response header.
func RequestID() gin.HandlerFunc {
	return func(c *gin.Context) {
		rid := c.GetHeader(requestIDHeader)
		if rid == "" {
			rid = uuidv7.Must()
		}
		c.Set(RequestIDKey, rid)
		c.Header(requestIDHeader, rid)
		c.Next()
	}
}

// GetRequestID extracts the request ID from the Gin context.
// Returns an empty string if the middleware was not applied.
func GetRequestID(c *gin.Context) string {
	return c.GetString(RequestIDKey)
}
