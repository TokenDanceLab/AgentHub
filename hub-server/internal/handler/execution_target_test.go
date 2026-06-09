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

	get  func(ctx context.Context, id, ownerID string) (*model.ExecutionTarget, error)
	list func(ctx context.Context, ownerID, targetType, cursor string, pageSize int) (*service.TargetListResult, error)
}

func (m *mockExecutionTargetService) Create(ctx context.Context, ownerID string, req *model.ExecutionTarget) (*model.ExecutionTarget, error) {
	m.createCalled = true
	m.createReq = req
	return &model.ExecutionTarget{ID: "target-1", OwnerID: ownerID, Name: req.Name}, nil
}

func (m *mockExecutionTargetService) Get(ctx context.Context, id, ownerID string) (*model.ExecutionTarget, error) {
	if m.get != nil {
		return m.get(ctx, id, ownerID)
	}
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
	if m.list != nil {
		return m.list(ctx, ownerID, targetType, cursor, pageSize)
	}
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

func TestExecutionTargetHandlerGetDoesNotReturnBearerCredentialInAuthMethod(t *testing.T) {
	gin.SetMode(gin.TestMode)
	secret := "edge-secret-token-should-not-leak"
	svc := &mockExecutionTargetService{
		get: func(ctx context.Context, id, ownerID string) (*model.ExecutionTarget, error) {
			require.Equal(t, "target-1", id)
			require.Equal(t, "owner-1", ownerID)
			return &model.ExecutionTarget{
				ID:                 id,
				OwnerID:            ownerID,
				Name:               "Cloud target",
				TargetType:         "cloud_edge",
				WorkspaceAllowlist: "[]",
				TrustLevel:         "cloud",
				HealthState:        "unknown",
				AuthMethod:         secret,
				Capabilities:       "{}",
				Metadata:           "{}",
			}, nil
		},
	}
	h := handler.NewExecutionTargetHandler(svc)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set("user_id", "owner-1")
	c.Params = gin.Params{{Key: "id", Value: "target-1"}}
	c.Request = httptest.NewRequest(http.MethodGet, "/web/execution-targets/target-1", nil)

	h.GetTarget(c)

	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	require.NotContains(t, w.Body.String(), secret)
	require.NotContains(t, w.Body.String(), "Bearer")
	require.NotContains(t, w.Body.String(), `"auth_method"`)
}

func TestExecutionTargetHandlerListReturnsOnlyAuthMethodStrategy(t *testing.T) {
	gin.SetMode(gin.TestMode)
	secret := "edge-secret-token-should-not-leak"
	svc := &mockExecutionTargetService{
		list: func(ctx context.Context, ownerID, targetType, cursor string, pageSize int) (*service.TargetListResult, error) {
			return &service.TargetListResult{
				Items: []model.ExecutionTarget{
					{
						ID:                 "target-1",
						OwnerID:            ownerID,
						Name:               "Cloud target",
						TargetType:         "cloud_edge",
						WorkspaceAllowlist: "[]",
						TrustLevel:         "cloud",
						HealthState:        "unknown",
						AuthMethod:         "hub_jwt",
						Capabilities:       "{}",
						Metadata:           "{}",
					},
					{
						ID:                 "target-2",
						OwnerID:            ownerID,
						Name:               "Legacy target",
						TargetType:         "cloud_edge",
						WorkspaceAllowlist: "[]",
						TrustLevel:         "cloud",
						HealthState:        "unknown",
						AuthMethod:         secret,
						Capabilities:       "{}",
						Metadata:           "{}",
					},
				},
			}, nil
		},
	}
	h := handler.NewExecutionTargetHandler(svc)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set("user_id", "owner-1")
	c.Request = httptest.NewRequest(http.MethodGet, "/web/execution-targets", nil)

	h.ListTargets(c)

	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	require.Contains(t, w.Body.String(), `"auth_method":"hub_jwt"`)
	require.NotContains(t, w.Body.String(), secret)
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
