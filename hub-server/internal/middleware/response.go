package middleware

import (
	"net/http"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/gin-gonic/gin"

	sharederr "github.com/agenthub/pkg/errcode"
)

// fail writes an errcode.Error as a standardized error response and aborts the chain.
// Uses the unified envelope: {"error": {"code": "...", "message": "...", "traceId": "..."}}
func fail(c *gin.Context, e *errcode.Error) {
	status := e.HTTPStatus
	if status == 0 {
		status = http.StatusInternalServerError
	}
	traceID := GetRequestID(c)
	if traceID == "" {
		traceID = sharederr.NewTraceID()
	}
	c.AbortWithStatusJSON(status, sharederr.EnvelopeForGinWithTrace(e.WithTrace(traceID)))
}
