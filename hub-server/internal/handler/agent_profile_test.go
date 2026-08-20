package handler_test

import (
	"context"
	"net/http"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/handler"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/service/agentprofile"
)

// ── Existing tests ──────────────────────────────────────────────────────────

func TestAgentProfileHandlerGetProfilePassesCurrentUserToService(t *testing.T) {
	svc := &mockAgentProfileService{
		getFn: func(ctx context.Context, id, ownerID string) (*model.AgentProfile, error) {
			require.Equal(t, "profile-1", id)
			require.Equal(t, "user-1", ownerID)
			return &model.AgentProfile{ID: id, OwnerID: ownerID, Name: "Owner profile"}, nil
		},
	}
	h := handler.NewAgentProfileHandler(svc)
	c, w := newGinCtx("GET", "/web/agent-profiles/profile-1", nil, "user_id", "user-1")
	c.Params = gin.Params{{Key: "id", Value: "profile-1"}}

	h.GetProfile(c)

	require.Equal(t, 200, w.Code)
	require.True(t, svc.getCalled)
	require.Contains(t, w.Body.String(), "Owner profile")
}

func TestMarketHandlerGetMarketProfileUsesPublicProfileLookup(t *testing.T) {
	svc := &mockAgentProfileService{
		getPublicFn: func(ctx context.Context, id string) (*model.AgentProfile, error) {
			require.Equal(t, "profile-1", id)
			return &model.AgentProfile{ID: id, OwnerID: "owner-1", IsPublic: true}, nil
		},
	}
	h := handler.NewMarketHandler(svc)
	c, w := newGinCtx("GET", "/web/market/profiles/profile-1", nil, "user_id", "user-2")
	c.Params = gin.Params{{Key: "id", Value: "profile-1"}}

	h.GetMarketProfile(c)

	require.Equal(t, 200, w.Code)
	require.True(t, svc.getPublicCalled)
}

func TestMarketHandlerGetMarketProfileRejectsPrivateProfiles(t *testing.T) {
	svc := &mockAgentProfileService{
		getPublicFn: func(ctx context.Context, id string) (*model.AgentProfile, error) {
			return nil, errcode.AgentNotFound.WithMessage("profile is not public")
		},
	}
	h := handler.NewMarketHandler(svc)
	c, w := newGinCtx("GET", "/web/market/profiles/profile-1", nil, "user_id", "user-2")
	c.Params = gin.Params{{Key: "id", Value: "profile-1"}}

	h.GetMarketProfile(c)

	require.Equal(t, 404, w.Code)
	require.True(t, svc.getPublicCalled)
	require.Contains(t, w.Body.String(), errcode.AgentNotFound.Code)
}

// ── New tests: Create, List, Update, Delete, Publish, Install ──────────────

func TestAgentProfileHandlerCreateProfileSuccess(t *testing.T) {
	svc := &mockAgentProfileService{
		createFn: func(ctx context.Context, ownerID string, req *model.AgentProfile) (*model.AgentProfile, error) {
			require.Equal(t, "user-1", ownerID)
			require.Equal(t, "test-profile", req.Name)
			return &model.AgentProfile{ID: "p-1", Name: req.Name}, nil
		},
	}
	h := handler.NewAgentProfileHandler(svc)
	body := map[string]interface{}{
		"name":       "test-profile",
		"runtime_id": "codex",
	}
	c, w := newGinCtx(http.MethodPost, "/web/agent-profiles", body, "user_id", "user-1")

	h.CreateProfile(c)

	require.Equal(t, 200, w.Code)
	require.True(t, svc.createCalled)
	require.Contains(t, w.Body.String(), "p-1")
}

func TestAgentProfileHandlerCreateProfileNormalizesJSONLikeFields(t *testing.T) {
	svc := &mockAgentProfileService{
		createFn: func(ctx context.Context, ownerID string, req *model.AgentProfile) (*model.AgentProfile, error) {
			require.Equal(t, "user-1", ownerID)
			require.JSONEq(t, `{"codex":"gpt-5"}`, req.ModelMapping)
			require.JSONEq(t, `["skill-1","skill-2"]`, req.Skills)
			require.JSONEq(t, `["mcp-1"]`, req.MCPServers)
			require.JSONEq(t, `["shell"]`, req.ToolAllowlist)
			require.JSONEq(t, `{"mode":"default"}`, req.ApprovalPolicy)
			require.JSONEq(t, `{"edge":"local"}`, req.TargetPreferences)
			return &model.AgentProfile{ID: "p-1", Name: req.Name}, nil
		},
	}
	h := handler.NewAgentProfileHandler(svc)
	body := map[string]interface{}{
		"name":               "test-profile",
		"runtime_id":         "codex",
		"model_mapping":      map[string]interface{}{"codex": "gpt-5"},
		"skills":             []string{"skill-1", "skill-2"},
		"mcp_servers":        []string{"mcp-1"},
		"tool_allowlist":     []string{"shell"},
		"approval_policy":    map[string]interface{}{"mode": "default"},
		"target_preferences": map[string]interface{}{"edge": "local"},
	}
	c, w := newGinCtx(http.MethodPost, "/web/agent-profiles", body, "user_id", "user-1")

	h.CreateProfile(c)

	require.Equal(t, 200, w.Code)
	require.True(t, svc.createCalled)
}

func TestAgentProfileHandlerCreateProfileRejectsInvalidJSONLikeField(t *testing.T) {
	svc := &mockAgentProfileService{}
	h := handler.NewAgentProfileHandler(svc)
	body := map[string]interface{}{
		"name":          "test-profile",
		"runtime_id":    "codex",
		"model_mapping": []string{"not-an-object"},
	}
	c, w := newGinCtx(http.MethodPost, "/web/agent-profiles", body, "user_id", "user-1")

	h.CreateProfile(c)

	require.Equal(t, 400, w.Code)
	require.Contains(t, w.Body.String(), "bad_request")
	require.False(t, svc.createCalled)
}

func TestAgentProfileHandlerCreateProfileBadRequest(t *testing.T) {
	svc := &mockAgentProfileService{}
	h := handler.NewAgentProfileHandler(svc)
	c, w := newGinCtx(http.MethodPost, "/web/agent-profiles", nil, "user_id", "user-1")

	h.CreateProfile(c)

	require.Equal(t, 400, w.Code)
	require.Contains(t, w.Body.String(), "bad_request")
	require.False(t, svc.createCalled)
}

func TestAgentProfileHandlerListProfilesSuccess(t *testing.T) {
	svc := &mockAgentProfileService{
		listFn: func(ctx context.Context, ownerID, runtimeID, q, cursor string, pageSize int) (*agentprofile.ListResult, error) {
			require.Equal(t, "user-1", ownerID)
			return &agentprofile.ListResult{Items: nil, Cursor: "", HasMore: false}, nil
		},
	}
	h := handler.NewAgentProfileHandler(svc)
	c, w := newGinCtxWithQuery(http.MethodGet, "/web/agent-profiles", "", nil, "user_id", "user-1")

	h.ListProfiles(c)

	require.Equal(t, 200, w.Code)
	require.True(t, svc.listCalled)
}

func TestAgentProfileHandlerUpdateProfileSuccess(t *testing.T) {
	svc := &mockAgentProfileService{
		updateFn: func(ctx context.Context, id, ownerID string, updates map[string]interface{}) (*model.AgentProfile, error) {
			require.Equal(t, "profile-1", id)
			return &model.AgentProfile{ID: id, Name: "Updated"}, nil
		},
	}
	h := handler.NewAgentProfileHandler(svc)
	body := map[string]interface{}{"name": "Updated"}
	c, w := newGinCtx(http.MethodPut, "/web/agent-profiles/profile-1", body, "user_id", "user-1")
	c.Params = gin.Params{{Key: "id", Value: "profile-1"}}

	h.UpdateProfile(c)

	require.Equal(t, 200, w.Code)
	require.True(t, svc.updateCalled)
}

func TestAgentProfileHandlerUpdateProfileNormalizesJSONLikeFields(t *testing.T) {
	svc := &mockAgentProfileService{
		updateFn: func(ctx context.Context, id, ownerID string, updates map[string]interface{}) (*model.AgentProfile, error) {
			require.Equal(t, "profile-1", id)
			require.JSONEq(t, `{"codex":"gpt-5"}`, updates["model_mapping"].(string))
			require.JSONEq(t, `["skill-1"]`, updates["skills"].(string))
			require.JSONEq(t, `["mcp-1"]`, updates["mcp_servers"].(string))
			require.JSONEq(t, `["shell"]`, updates["tool_allowlist"].(string))
			require.JSONEq(t, `{"mode":"default"}`, updates["approval_policy"].(string))
			require.JSONEq(t, `{"edge":"local"}`, updates["target_preferences"].(string))
			return &model.AgentProfile{ID: id, Name: "Updated"}, nil
		},
	}
	h := handler.NewAgentProfileHandler(svc)
	body := map[string]interface{}{
		"model_mapping":      `{"codex":"gpt-5"}`,
		"skills":             []string{"skill-1"},
		"mcp_servers":        []string{"mcp-1"},
		"tool_allowlist":     []string{"shell"},
		"approval_policy":    map[string]interface{}{"mode": "default"},
		"target_preferences": map[string]interface{}{"edge": "local"},
	}
	c, w := newGinCtx(http.MethodPut, "/web/agent-profiles/profile-1", body, "user_id", "user-1")
	c.Params = gin.Params{{Key: "id", Value: "profile-1"}}

	h.UpdateProfile(c)

	require.Equal(t, 200, w.Code)
	require.True(t, svc.updateCalled)
}

func TestAgentProfileHandlerUpdateProfileRejectsInvalidJSONLikeField(t *testing.T) {
	svc := &mockAgentProfileService{}
	h := handler.NewAgentProfileHandler(svc)
	body := map[string]interface{}{"skills": map[string]interface{}{"not": "array"}}
	c, w := newGinCtx(http.MethodPut, "/web/agent-profiles/profile-1", body, "user_id", "user-1")
	c.Params = gin.Params{{Key: "id", Value: "profile-1"}}

	h.UpdateProfile(c)

	require.Equal(t, 400, w.Code)
	require.Contains(t, w.Body.String(), "bad_request")
	require.False(t, svc.updateCalled)
}

func TestAgentProfileHandlerUpdateProfileBadRequest(t *testing.T) {
	svc := &mockAgentProfileService{}
	h := handler.NewAgentProfileHandler(svc)
	c, w := newGinCtx(http.MethodPut, "/web/agent-profiles/profile-1", nil, "user_id", "user-1")
	c.Params = gin.Params{{Key: "id", Value: "profile-1"}}

	h.UpdateProfile(c)

	require.Equal(t, 400, w.Code)
	require.False(t, svc.updateCalled)
}

func TestAgentProfileHandlerDeleteProfileSuccess(t *testing.T) {
	svc := &mockAgentProfileService{
		deleteFn: func(ctx context.Context, id, ownerID string) error {
			require.Equal(t, "profile-1", id)
			return nil
		},
	}
	h := handler.NewAgentProfileHandler(svc)
	c, w := newGinCtx(http.MethodDelete, "/web/agent-profiles/profile-1", nil, "user_id", "user-1")
	c.Params = gin.Params{{Key: "id", Value: "profile-1"}}

	h.DeleteProfile(c)

	require.Equal(t, 200, w.Code)
	require.True(t, svc.deleteCalled)
}

func TestAgentProfileHandlerDeleteProfileNotFound(t *testing.T) {
	svc := &mockAgentProfileService{
		deleteFn: func(ctx context.Context, id, ownerID string) error {
			return errcode.AgentNotFound
		},
	}
	h := handler.NewAgentProfileHandler(svc)
	c, w := newGinCtx(http.MethodDelete, "/web/agent-profiles/profile-1", nil, "user_id", "user-1")
	c.Params = gin.Params{{Key: "id", Value: "profile-1"}}

	h.DeleteProfile(c)

	require.Equal(t, 404, w.Code)
	require.Contains(t, w.Body.String(), errcode.AgentNotFound.Code)
}

func TestAgentProfileHandlerPublishProfileSuccess(t *testing.T) {
	svc := &mockAgentProfileService{
		publishFn: func(ctx context.Context, id, ownerID string) error {
			require.Equal(t, "profile-1", id)
			return nil
		},
	}
	h := handler.NewAgentProfileHandler(svc)
	c, w := newGinCtx(http.MethodPost, "/web/agent-profiles/profile-1/publish", nil, "user_id", "user-1")
	c.Params = gin.Params{{Key: "id", Value: "profile-1"}}

	h.PublishProfile(c)

	require.Equal(t, 200, w.Code)
	require.True(t, svc.publishCalled)
}

func TestAgentProfileHandlerPublishProfileError(t *testing.T) {
	svc := &mockAgentProfileService{
		publishFn: func(ctx context.Context, id, ownerID string) error {
			return errcode.AgentNotFound
		},
	}
	h := handler.NewAgentProfileHandler(svc)
	c, w := newGinCtx(http.MethodPost, "/web/agent-profiles/profile-1/publish", nil, "user_id", "user-1")
	c.Params = gin.Params{{Key: "id", Value: "profile-1"}}

	h.PublishProfile(c)

	require.Equal(t, 404, w.Code)
}

func TestAgentProfileHandlerInstallProfileSuccess(t *testing.T) {
	svc := &mockAgentProfileService{
		installFn: func(ctx context.Context, id, installerID string) (*model.AgentProfile, error) {
			require.Equal(t, "profile-1", id)
			return &model.AgentProfile{ID: "installed-1", Name: "Installed Copy"}, nil
		},
	}
	h := handler.NewAgentProfileHandler(svc)
	c, w := newGinCtx(http.MethodPost, "/web/agent-profiles/profile-1/install", nil, "user_id", "user-1")
	c.Params = gin.Params{{Key: "id", Value: "profile-1"}}

	h.InstallProfile(c)

	require.Equal(t, 200, w.Code)
	require.True(t, svc.installCalled)
}

func TestAgentProfileHandlerInstallProfileError(t *testing.T) {
	svc := &mockAgentProfileService{
		installFn: func(ctx context.Context, id, installerID string) (*model.AgentProfile, error) {
			return nil, errcode.AgentNotFound
		},
	}
	h := handler.NewAgentProfileHandler(svc)
	c, w := newGinCtx(http.MethodPost, "/web/agent-profiles/profile-1/install", nil, "user_id", "user-1")
	c.Params = gin.Params{{Key: "id", Value: "profile-1"}}

	h.InstallProfile(c)

	require.Equal(t, 404, w.Code)
}

// ── Mock ────────────────────────────────────────────────────────────────────

type mockAgentProfileService struct {
	getCalled       bool
	getPublicCalled bool
	createCalled    bool
	updateCalled    bool
	deleteCalled    bool
	listCalled      bool
	publishCalled   bool
	installCalled   bool

	getFn       func(ctx context.Context, id, ownerID string) (*model.AgentProfile, error)
	getPublicFn func(ctx context.Context, id string) (*model.AgentProfile, error)
	createFn    func(ctx context.Context, ownerID string, req *model.AgentProfile) (*model.AgentProfile, error)
	updateFn    func(ctx context.Context, id, ownerID string, updates map[string]interface{}) (*model.AgentProfile, error)
	deleteFn    func(ctx context.Context, id, ownerID string) error
	listFn      func(ctx context.Context, ownerID, runtimeID, q, cursor string, pageSize int) (*agentprofile.ListResult, error)
	publishFn   func(ctx context.Context, id, ownerID string) error
	installFn   func(ctx context.Context, id, installerID string) (*model.AgentProfile, error)
}

func (m *mockAgentProfileService) Create(ctx context.Context, ownerID string, req *model.AgentProfile) (*model.AgentProfile, error) {
	m.createCalled = true
	if m.createFn != nil {
		return m.createFn(ctx, ownerID, req)
	}
	return nil, nil
}

func (m *mockAgentProfileService) Get(ctx context.Context, id, ownerID string) (*model.AgentProfile, error) {
	m.getCalled = true
	if m.getFn != nil {
		return m.getFn(ctx, id, ownerID)
	}
	return nil, nil
}

func (m *mockAgentProfileService) GetPublic(ctx context.Context, id string) (*model.AgentProfile, error) {
	m.getPublicCalled = true
	if m.getPublicFn != nil {
		return m.getPublicFn(ctx, id)
	}
	return nil, nil
}

func (m *mockAgentProfileService) Update(ctx context.Context, id, ownerID string, updates map[string]interface{}) (*model.AgentProfile, error) {
	m.updateCalled = true
	if m.updateFn != nil {
		return m.updateFn(ctx, id, ownerID, updates)
	}
	return nil, nil
}

func (m *mockAgentProfileService) Delete(ctx context.Context, id, ownerID string) error {
	m.deleteCalled = true
	if m.deleteFn != nil {
		return m.deleteFn(ctx, id, ownerID)
	}
	return nil
}

func (m *mockAgentProfileService) List(ctx context.Context, ownerID, runtimeID, q, cursor string, pageSize int) (*agentprofile.ListResult, error) {
	m.listCalled = true
	if m.listFn != nil {
		return m.listFn(ctx, ownerID, runtimeID, q, cursor, pageSize)
	}
	return nil, nil
}

func (m *mockAgentProfileService) Publish(ctx context.Context, id, ownerID string) error {
	m.publishCalled = true
	if m.publishFn != nil {
		return m.publishFn(ctx, id, ownerID)
	}
	return nil
}

func (m *mockAgentProfileService) Unpublish(ctx context.Context, id, ownerID string) error {
	return nil
}

func (m *mockAgentProfileService) Install(ctx context.Context, id, installerID string) (*model.AgentProfile, error) {
	m.installCalled = true
	if m.installFn != nil {
		return m.installFn(ctx, id, installerID)
	}
	return nil, nil
}

func (m *mockAgentProfileService) SearchMarket(ctx context.Context, runtimeID, q, sortBy, cursor string, pageSize int) (*agentprofile.ListResult, error) {
	return nil, nil
}

func (m *mockAgentProfileService) Rate(ctx context.Context, profileID, raterID string, score int) (float64, int, error) {
	return 0, 0, nil
}
