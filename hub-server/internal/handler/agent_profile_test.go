package handler_test

import (
	"context"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/handler"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/service"
)

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
	require.Contains(t, w.Body.String(), "AGENT_NOT_FOUND")
}

type mockAgentProfileService struct {
	getCalled       bool
	getPublicCalled bool
	getFn           func(ctx context.Context, id, ownerID string) (*model.AgentProfile, error)
	getPublicFn     func(ctx context.Context, id string) (*model.AgentProfile, error)
}

func (m *mockAgentProfileService) Create(ctx context.Context, ownerID string, req *model.AgentProfile) (*model.AgentProfile, error) {
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
	return nil, nil
}

func (m *mockAgentProfileService) Delete(ctx context.Context, id, ownerID string) error {
	return nil
}

func (m *mockAgentProfileService) List(ctx context.Context, ownerID, runtimeID, q, cursor string, pageSize int) (*service.ListResult, error) {
	return nil, nil
}

func (m *mockAgentProfileService) Publish(ctx context.Context, id, ownerID string) error {
	return nil
}

func (m *mockAgentProfileService) Unpublish(ctx context.Context, id, ownerID string) error {
	return nil
}

func (m *mockAgentProfileService) Install(ctx context.Context, id, installerID string) (*model.AgentProfile, error) {
	return nil, nil
}

func (m *mockAgentProfileService) SearchMarket(ctx context.Context, runtimeID, q, sortBy, cursor string, pageSize int) (*service.ListResult, error) {
	return nil, nil
}

func (m *mockAgentProfileService) Rate(ctx context.Context, profileID, raterID string, score int) (float64, int, error) {
	return 0, 0, nil
}
