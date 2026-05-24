package handler

import (
	"net/http"

<<<<<<< HEAD
	"github.com/gin-gonic/gin"
	"github.com/agenthub/server-hub/internal/errcode"
=======
	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/gin-gonic/gin"
>>>>>>> origin/master
)

type Response struct {
	Code    string      `json:"code"`
	Message string      `json:"message"`
	Data    interface{} `json:"data,omitempty"`
}

func OK(c *gin.Context, data interface{}) {
	c.JSON(http.StatusOK, Response{
		Code: errcode.OK.Code,
		Data: data,
	})
}

func Fail(c *gin.Context, e *errcode.Error) {
	status := e.HTTPStatus
	if status == 0 {
		status = http.StatusInternalServerError
	}
	c.JSON(status, Response{
		Code:    e.Code,
		Message: e.Message,
	})
}

func FailWithMessage(c *gin.Context, e *errcode.Error, message string) {
<<<<<<< HEAD
	c.JSON(e.HTTPStatus, Response{
=======
	status := e.HTTPStatus
	if status == 0 {
		status = http.StatusInternalServerError
	}
	c.JSON(status, Response{
>>>>>>> origin/master
		Code:    e.Code,
		Message: message,
	})
}
