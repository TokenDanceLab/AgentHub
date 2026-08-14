package handler

import (
	"strings"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

func normalizeUUID(value string) (string, bool) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", false
	}
	parsed, err := uuid.Parse(value)
	if err != nil {
		return "", false
	}
	return parsed.String(), true
}

// taskIDParam validates the :id path param as a UUID and returns the
// normalized value. Malformed IDs fail fast with 400 instead of leaking a
// Postgres "invalid input syntax for type uuid" (22P02) as a 500 through the
// generic errcode.ErrInternal fallback.
func taskIDParam(c *gin.Context) (string, bool) {
	taskID, ok := normalizeUUID(c.Param("id"))
	if !ok {
		Fail(c, errcode.ErrBadRequest.WithMessage("invalid task id: must be a UUID"))
		return "", false
	}
	return taskID, true
}
