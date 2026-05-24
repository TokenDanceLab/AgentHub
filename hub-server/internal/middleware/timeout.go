package middleware

import (
	"context"
	"time"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/handler"
	"github.com/gin-gonic/gin"
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
				handler.Fail(c, errcode.ErrTimeout)
				c.Abort()
			}
		}
	}
}
