package middleware

import (
	"net/http"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/gin-gonic/gin"
)

// responseBody mirrors handler.Response so middleware can write error responses
// without importing the handler package (avoiding a circular dependency where
// middleware imports handler and handler references middleware types).
type responseBody struct {
	Code    string      `json:"code"`
	Message string      `json:"message"`
	Data    interface{} `json:"data,omitempty"`
}

// fail writes an errcode.Error as a JSON response and aborts the chain.
// It is the middleware-local equivalent of handler.Fail, maintaining the
// same wire format ({code, message}) so API consumers see no difference.
func fail(c *gin.Context, e *errcode.Error) {
	status := e.HTTPStatus
	if status == 0 {
		status = http.StatusInternalServerError
	}
	c.AbortWithStatusJSON(status, responseBody{
		Code:    e.Code,
		Message: e.Message,
	})
}
