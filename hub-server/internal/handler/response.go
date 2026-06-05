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
	status := e.HTTPStatus
	if status == 0 {
		status = http.StatusInternalServerError
	}
	traceID := middleware.GetRequestID(c)
	if traceID == "" {
		traceID = sharederr.NewTraceID()
	}
	c.AbortWithStatusJSON(status, sharederr.EnvelopeForGinWithTrace(e.WithTrace(traceID)))
}

func FailWithMessage(c *gin.Context, e *errcode.Error, message string) {
	Fail(c, e.WithMessage(message))
}
