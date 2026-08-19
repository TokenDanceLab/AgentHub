package handler_test

import (
	"context"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"

	"github.com/agenthub/hub-server/internal/handler"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/service/mcpserver"
	"github.com/agenthub/hub-server/internal/service/skill"
)

func TestSkillHandlerGetSkillPassesCurrentUserToService(t *testing.T) {
	svc := &mockSkillCatalogService{
		getFn: func(ctx context.Context, id, ownerID string) (*model.Skill, error) {
			require.Equal(t, "skill-1", id)
			require.Equal(t, "user-1", ownerID)
			return &model.Skill{ID: id, OwnerID: ownerID, Name: "Owner skill"}, nil
		},
	}
	h := handler.NewSkillHandler(svc)
	c, w := newGinCtx("GET", "/web/skills/skill-1", nil, "user_id", "user-1")
	c.Params = gin.Params{{Key: "id", Value: "skill-1"}}

	h.GetSkill(c)

	require.Equal(t, 200, w.Code)
	require.True(t, svc.getCalled)
	require.Contains(t, w.Body.String(), "Owner skill")
}

func TestMCPServerHandlerGetMCPServerPassesCurrentUserToService(t *testing.T) {
	svc := &mockMCPCatalogService{
		getFn: func(ctx context.Context, id, ownerID string) (*model.MCPServer, error) {
			require.Equal(t, "mcp-1", id)
			require.Equal(t, "user-1", ownerID)
			return &model.MCPServer{ID: id, OwnerID: ownerID, Name: "Owner MCP"}, nil
		},
	}
	h := handler.NewMCPServerHandler(svc)
	c, w := newGinCtx("GET", "/web/mcp-servers/mcp-1", nil, "user_id", "user-1")
	c.Params = gin.Params{{Key: "id", Value: "mcp-1"}}

	h.GetMCPServer(c)

	require.Equal(t, 200, w.Code)
	require.True(t, svc.getCalled)
	require.Contains(t, w.Body.String(), "Owner MCP")
}

type mockSkillCatalogService struct {
	getCalled bool
	getFn     func(ctx context.Context, id, ownerID string) (*model.Skill, error)
}

func (m *mockSkillCatalogService) Create(ctx context.Context, ownerID string, req *model.Skill) (*model.Skill, error) {
	return nil, nil
}

func (m *mockSkillCatalogService) Get(ctx context.Context, id, ownerID string) (*model.Skill, error) {
	m.getCalled = true
	if m.getFn != nil {
		return m.getFn(ctx, id, ownerID)
	}
	return nil, nil
}

func (m *mockSkillCatalogService) Update(ctx context.Context, id, ownerID string, req *model.Skill) (*model.Skill, error) {
	return nil, nil
}

func (m *mockSkillCatalogService) Delete(ctx context.Context, id, ownerID string) error {
	return nil
}

func (m *mockSkillCatalogService) List(ctx context.Context, ownerID, q, skillType, cursor string, pageSize int) (*skill.ListResult, error) {
	return nil, nil
}

func (m *mockSkillCatalogService) Publish(ctx context.Context, id, ownerID string) error {
	return nil
}

func (m *mockSkillCatalogService) Unpublish(ctx context.Context, id, ownerID string) error {
	return nil
}

func (m *mockSkillCatalogService) SearchPublic(ctx context.Context, q, skillType, cursor string, pageSize int) (*skill.ListResult, error) {
	return nil, nil
}

type mockMCPCatalogService struct {
	getCalled bool
	getFn     func(ctx context.Context, id, ownerID string) (*model.MCPServer, error)
}

func (m *mockMCPCatalogService) Create(ctx context.Context, ownerID string, req *model.MCPServer) (*model.MCPServer, error) {
	return nil, nil
}

func (m *mockMCPCatalogService) Get(ctx context.Context, id, ownerID string) (*model.MCPServer, error) {
	m.getCalled = true
	if m.getFn != nil {
		return m.getFn(ctx, id, ownerID)
	}
	return nil, nil
}

func (m *mockMCPCatalogService) Update(ctx context.Context, id, ownerID string, req *model.MCPServer) (*model.MCPServer, error) {
	return nil, nil
}

func (m *mockMCPCatalogService) Delete(ctx context.Context, id, ownerID string) error {
	return nil
}

func (m *mockMCPCatalogService) List(ctx context.Context, ownerID, q, transport, cursor string, pageSize int) (*mcpserver.ListResult, error) {
	return nil, nil
}

func (m *mockMCPCatalogService) Publish(ctx context.Context, id, ownerID string) error {
	return nil
}

func (m *mockMCPCatalogService) Unpublish(ctx context.Context, id, ownerID string) error {
	return nil
}

func (m *mockMCPCatalogService) SearchPublic(ctx context.Context, q, transport, cursor string, pageSize int) (*mcpserver.ListResult, error) {
	return nil, nil
}
