package middleware

import (
	"context"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/agenthub/hub-server/internal/handler"
	"github.com/agenthub/hub-server/internal/errcode"
)

// Timeout returns a middleware that sets a request deadline.
// If the handler exceeds the deadline, the request is aborted with a 504 status.
func Timeout(d time.Duration) gin.HandlerFunc {
	return func(c *gin.Context) {
		ctx, cancel := context.WithTimeout(c.Request.Context(), d)
		defer cancel()

		c.Request = c.Request.WithContext(ctx)

		done := make(chan struct{})
		go func() {
			c.Next()
			close(done)
		}()

		select {
		case <-done:
		case <-ctx.Done():
			if ctx.Err() == context.DeadlineExceeded {
				c.Abort()
				handler.Fail(c, errcode.New("REQUEST_TIMEOUT", "request timed out", http.StatusGatewayTimeout))
			}
		}
	}
}
