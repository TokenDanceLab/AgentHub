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
	updateCalled bool

	createReq *model.ExecutionTarget
	updateReq *model.ExecutionTarget
}

func (m *mockExecutionTargetService) Create(ctx context.Context, ownerID string, req *model.ExecutionTarget) (*model.ExecutionTarget, error) {
	m.createCalled = true
	m.createReq = req
	return &model.ExecutionTarget{ID: "target-1", OwnerID: ownerID, Name: req.Name}, nil
}

func (m *mockExecutionTargetService) Get(ctx context.Context, id, ownerID string) (*model.ExecutionTarget, error) {
	return nil, nil
}

func (m *mockExecutionTargetService) Update(ctx context.Context, id, ownerID string, req *model.ExecutionTarget) (*model.ExecutionTarget, error) {
	m.updateCalled = true
	m.updateReq = req
	return &model.ExecutionTarget{ID: id, OwnerID: ownerID, Name: req.Name}, nil
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

func TestExecutionTargetHandlerCreateNormalizesJSONLikeFields(t *testing.T) {
	gin.SetMode(gin.TestMode)
	svc := &mockExecutionTargetService{}
	h := handler.NewExecutionTargetHandler(svc)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set("user_id", "owner-1")
	c.Request = httptest.NewRequest(http.MethodPost, "/web/execution-targets", bytes.NewBufferString(`{
		"name": "local desktop",
		"workspace_allowlist": ["/repo", "/tmp"],
		"capabilities": {"runtime": "codex"},
		"metadata": "{\"labels\":[\"local\"]}"
	}`))
	c.Request.Header.Set("Content-Type", "application/json")

	h.CreateTarget(c)

	require.Equal(t, http.StatusCreated, w.Code, w.Body.String())
	require.True(t, svc.createCalled)
	require.JSONEq(t, `["/repo","/tmp"]`, svc.createReq.WorkspaceAllowlist)
	require.JSONEq(t, `{"runtime":"codex"}`, svc.createReq.Capabilities)
	require.JSONEq(t, `{"labels":["local"]}`, svc.createReq.Metadata)
}

func TestExecutionTargetHandlerUpdateClearsJSONLikeFields(t *testing.T) {
	gin.SetMode(gin.TestMode)
	svc := &mockExecutionTargetService{}
	h := handler.NewExecutionTargetHandler(svc)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set("user_id", "owner-1")
	c.Params = gin.Params{{Key: "id", Value: "target-1"}}
	c.Request = httptest.NewRequest(http.MethodPut, "/web/execution-targets/target-1", bytes.NewBufferString(`{
		"name": "local desktop",
		"workspace_allowlist": [],
		"capabilities": {},
		"metadata": {}
	}`))
	c.Request.Header.Set("Content-Type", "application/json")

	h.UpdateTarget(c)

	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	require.True(t, svc.updateCalled)
	require.JSONEq(t, `[]`, svc.updateReq.WorkspaceAllowlist)
	require.JSONEq(t, `{}`, svc.updateReq.Capabilities)
	require.JSONEq(t, `{}`, svc.updateReq.Metadata)
}

func TestExecutionTargetHandlerRejectsInvalidJSONLikeField(t *testing.T) {
	gin.SetMode(gin.TestMode)
	svc := &mockExecutionTargetService{}
	h := handler.NewExecutionTargetHandler(svc)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set("user_id", "owner-1")
	c.Request = httptest.NewRequest(http.MethodPost, "/web/execution-targets", bytes.NewBufferString(`{
		"name": "bad target",
		"metadata": ["not-an-object"]
	}`))
	c.Request.Header.Set("Content-Type", "application/json")

	h.CreateTarget(c)

	require.Equal(t, http.StatusBadRequest, w.Code, w.Body.String())
	require.False(t, svc.createCalled)
}
