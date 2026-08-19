package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"

	"github.com/agenthub/hub-server/internal/service/audit"
)

type mockAuditService struct{}

func (m *mockAuditService) Query(ctx context.Context, callerUserID string, isAdmin bool, eventType, severity string, since, until *time.Time, cursor string, pageSize int) (*audit.ListResult, error) {
	return &audit.ListResult{Items: nil, HasMore: false}, nil
}

func TestAuditHandler_ListAuditEvents(t *testing.T) {
	gin.SetMode(gin.TestMode)

	r := gin.New()
	h := NewAuditHandler(&mockAuditService{})
	r.GET("/web/audit-events", func(c *gin.Context) {
		c.Set("user_id", "user-1")
		h.ListAuditEvents(c)
	})

	req := httptest.NewRequest(http.MethodGet, "/web/audit-events", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}
