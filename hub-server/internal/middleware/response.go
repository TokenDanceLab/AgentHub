package middleware

import (
	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/gin-gonic/gin"

	sharederr "github.com/agenthub/pkg/errcode"
)

// fail writes an errcode.Error as a standardized error response and aborts the chain.
// Uses the unified envelope: {"error": {"code": "...", "message": "...", "traceId": "..."}}
func fail(c *gin.Context, e *errcode.Error) {
	// errcode.New is the single place that guarantees a usable HTTPStatus;
	// clamping again here is what allowed handler/response.go (500) and
	// middleware/timeout.go (504) to disagree about the fallback (#2243).
	traceID := GetRequestID(c)
	if traceID == "" {
		traceID = sharederr.NewTraceID()
	}
	c.AbortWithStatusJSON(e.HTTPStatus, sharederr.EnvelopeForGinWithTrace(e.WithTrace(traceID)))
}
