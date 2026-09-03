package handler

import (
	"net/http"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/middleware"
	"github.com/gin-gonic/gin"

	sharederr "github.com/agenthub/pkg/errcode"
)

type Response struct {
	Code string      `json:"code"`
	Data interface{} `json:"data,omitempty"`
}

// OK writes Hub success envelope {"code":"ok","data":...}.
// Wire success code is lowercase "ok" (errcode.OK.Code), not HTTP "OK".
func OK(c *gin.Context, data interface{}) {
	c.JSON(http.StatusOK, Response{
		Code: errcode.OK.Code,
		Data: data,
	})
}

// Fail writes a standardized error response with the unified envelope:
//
//	{"error": {"code": "...", "message": "...", "traceId": "..."}}
func Fail(c *gin.Context, e *errcode.Error) {
	// No status clamp here on purpose: errcode.New guarantees a non-zero
	// HTTPStatus, so this write site cannot hand WriteHeader(0) to net/http
	// (#2243). Re-clamping per call site is what let two sites drift to
	// different fallbacks.
	traceID := middleware.GetRequestID(c)
	if traceID == "" {
		traceID = sharederr.NewTraceID()
	}
	c.AbortWithStatusJSON(e.HTTPStatus, sharederr.EnvelopeForGinWithTrace(e.WithTrace(traceID)))
}

func FailWithMessage(c *gin.Context, e *errcode.Error, message string) {
	Fail(c, e.WithMessage(message))
}
