package handler_test

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"

	"github.com/agenthub/hub-server/internal/handler"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/service"
)

type mockExecutionTargetService struct {
	createCalled bool
}

func (m *mockExecutionTargetService) Create(ctx context.Context, ownerID string, req *model.ExecutionTarget) (*model.ExecutionTarget, error) {
	m.createCalled = true
	return &model.ExecutionTarget{ID: "target-1", OwnerID: ownerID, Name: req.Name}, nil
}

func (m *mockExecutionTargetService) Get(ctx context.Context, id, ownerID string) (*model.ExecutionTarget, error) {
	return nil, nil
}

func (m *mockExecutionTargetService) Update(ctx context.Context, id, ownerID string, req *model.ExecutionTarget) (*model.ExecutionTarget, error) {
	return nil, nil
}

func (m *mockExecutionTargetService) Delete(ctx context.Context, id, ownerID string) error {
	return nil
}

func (m *mockExecutionTargetService) List(ctx context.Context, ownerID, targetType, cursor string, pageSize int) (*service.TargetListResult, error) {
	return &service.TargetListResult{}, nil
}

func (m *mockExecutionTargetService) Ping(ctx context.Context, id, ownerID string) error {
	return nil
}

func TestExecutionTargetHandlerCreateRejectsClientManagedHealthState(t *testing.T) {
	gin.SetMode(gin.TestMode)
	svc := &mockExecutionTargetService{}
	h := handler.NewExecutionTargetHandler(svc)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set("user_id", "owner-1")
	c.Request = httptest.NewRequest(http.MethodPost, "/web/execution-targets", bytes.NewBufferString(`{
		"name": "forged target",
		"health_state": "healthy"
	}`))
	c.Request.Header.Set("Content-Type", "application/json")

	h.CreateTarget(c)

	require.Equal(t, http.StatusBadRequest, w.Code, w.Body.String())
	require.False(t, svc.createCalled, "Create should not run when health_state is client-managed")
}
