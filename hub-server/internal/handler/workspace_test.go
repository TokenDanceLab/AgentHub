package handler_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/handler"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/service"
)

type mockWorkspaceService struct {
	createReq *model.Workspace
	updateReq *service.WorkspaceUpdate
	listQ     string
	listSize  int
	listCur   string

	createFn func(ctx context.Context, ownerID string, req *model.Workspace) (*model.Workspace, error)
	getFn    func(ctx context.Context, id, ownerID string) (*model.Workspace, error)
	updateFn func(ctx context.Context, id, ownerID string, req *service.WorkspaceUpdate) (*model.Workspace, error)
	listFn   func(ctx context.Context, ownerID, q, cursor string, pageSize int) (*service.WorkspaceListResult, error)
}

func (m *mockWorkspaceService) Create(ctx context.Context, ownerID string, req *model.Workspace) (*model.Workspace, error) {
	m.createReq = req
	if m.createFn != nil {
		return m.createFn(ctx, ownerID, req)
	}
	return &model.Workspace{ID: "workspace-1", OwnerID: ownerID, Name: req.Name}, nil
}

func (m *mockWorkspaceService) Get(ctx context.Context, id, ownerID string) (*model.Workspace, error) {
	if m.getFn != nil {
		return m.getFn(ctx, id, ownerID)
	}
	return &model.Workspace{ID: id, OwnerID: ownerID, Name: "Project"}, nil
}

func (m *mockWorkspaceService) Update(ctx context.Context, id, ownerID string, req *service.WorkspaceUpdate) (*model.Workspace, error) {
	m.updateReq = req
	if m.updateFn != nil {
		return m.updateFn(ctx, id, ownerID, req)
	}
	name := ""
	if req.Name != nil {
		name = *req.Name
	}
	return &model.Workspace{ID: id, OwnerID: ownerID, Name: name}, nil
}

func (m *mockWorkspaceService) List(ctx context.Context, ownerID, q, cursor string, pageSize int) (*service.WorkspaceListResult, error) {
	m.listQ = q
	m.listCur = cursor
	m.listSize = pageSize
	if m.listFn != nil {
		return m.listFn(ctx, ownerID, q, cursor, pageSize)
	}
	return &service.WorkspaceListResult{
		Items:   []model.Workspace{{ID: "workspace-1", OwnerID: ownerID, Name: "Project"}},
		HasMore: true,
		Cursor:  "workspace-1",
	}, nil
}

func TestWorkspaceHandlerCreateSuccess(t *testing.T) {
	gin.SetMode(gin.TestMode)
	svc := &mockWorkspaceService{}
	h := handler.NewWorkspaceHandler(svc)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set("user_id", "owner-1")
	c.Request = httptest.NewRequest(http.MethodPost, "/web/projects", strings.NewReader(`{"name":"Project","description":"Demo"}`))
	c.Request.Header.Set("Content-Type", "application/json")

	h.CreateWorkspace(c)

	require.Equal(t, http.StatusOK, w.Code)
	require.Equal(t, "Project", svc.createReq.Name)
	require.Equal(t, "Demo", svc.createReq.Description)
	var body map[string]any
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
	require.Equal(t, "OK", body["code"])
	require.NotNil(t, body["data"])
}

func TestWorkspaceHandlerCreateRejectsBadRequest(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := handler.NewWorkspaceHandler(&mockWorkspaceService{})

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set("user_id", "owner-1")
	c.Request = httptest.NewRequest(http.MethodPost, "/web/projects", strings.NewReader(`{"description":"missing name"}`))
	c.Request.Header.Set("Content-Type", "application/json")

	h.CreateWorkspace(c)

	require.Equal(t, http.StatusBadRequest, w.Code)
}

func TestWorkspaceHandlerGetPropagatesNotFound(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := handler.NewWorkspaceHandler(&mockWorkspaceService{
		getFn: func(ctx context.Context, id, ownerID string) (*model.Workspace, error) {
			return nil, errcode.UserNotFound
		},
	})

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set("user_id", "owner-1")
	c.Params = gin.Params{{Key: "id", Value: "missing"}}
	c.Request = httptest.NewRequest(http.MethodGet, "/web/projects/missing", nil)

	h.GetWorkspace(c)

	require.Equal(t, http.StatusNotFound, w.Code)
}

func TestWorkspaceHandlerListEnvelopeAndQuery(t *testing.T) {
	gin.SetMode(gin.TestMode)
	svc := &mockWorkspaceService{}
	h := handler.NewWorkspaceHandler(svc)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set("user_id", "owner-1")
	c.Request = httptest.NewRequest(http.MethodGet, "/web/projects?q=proj&pageSize=25&pageCursor=workspace-1", nil)

	h.ListWorkspaces(c)

	require.Equal(t, http.StatusOK, w.Code)
	require.Equal(t, "proj", svc.listQ)
	require.Equal(t, "workspace-1", svc.listCur)
	require.Equal(t, 25, svc.listSize)
	var body struct {
		Code string `json:"code"`
		Data struct {
			Items []model.Workspace `json:"items"`
			Page  struct {
				NextCursor string `json:"nextCursor"`
				HasMore    bool   `json:"hasMore"`
			} `json:"page"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
	require.Equal(t, "OK", body.Code)
	require.Len(t, body.Data.Items, 1)
	require.True(t, body.Data.Page.HasMore)
	require.Equal(t, "workspace-1", body.Data.Page.NextCursor)
}

func TestWorkspaceHandlerUpdateSuccess(t *testing.T) {
	gin.SetMode(gin.TestMode)
	svc := &mockWorkspaceService{}
	h := handler.NewWorkspaceHandler(svc)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set("user_id", "owner-1")
	c.Params = gin.Params{{Key: "id", Value: "workspace-1"}}
	c.Request = httptest.NewRequest(http.MethodPatch, "/web/projects/workspace-1", strings.NewReader(`{"name":"Updated","description":"Next"}`))
	c.Request.Header.Set("Content-Type", "application/json")

	h.UpdateWorkspace(c)

	require.Equal(t, http.StatusOK, w.Code)
	require.NotNil(t, svc.updateReq.Name)
	require.NotNil(t, svc.updateReq.Description)
	require.Equal(t, "Updated", *svc.updateReq.Name)
	require.Equal(t, "Next", *svc.updateReq.Description)
}
