package service

import (
	"context"
	"errors"
	"fmt"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
)

// MCPService handles CRUD for MCP server registry entries.
type MCPService struct {
	db *gorm.DB
}

// MCPListResult wraps paginated MCP server list responses.
type MCPListResult struct {
	Items   []model.MCPServer `json:"items"`
	HasMore bool              `json:"has_more"`
	Cursor  string            `json:"next_cursor,omitempty"`
}

// NewMCPService creates a new MCP server service.
func NewMCPService(db *gorm.DB) *MCPService {
	return &MCPService{db: db}
}

// Create adds a new MCP server owned by the given user.
func (s *MCPService) Create(ctx context.Context, ownerID string, m *model.MCPServer) (*model.MCPServer, error) {
	if m.Name == "" || m.Transport == "" {
		return nil, errcode.ErrBadRequest.WithMessage("name and transport are required")
	}
	if err := m.Validate(); err != nil {
		return nil, errcode.ErrBadRequest.WithMessage(err.Error())
	}

	// Check duplicate name for owner
	existing, err := repository.FindMCPServerByOwnerAndName(s.db, ownerID, m.Name)
	if err == nil && existing != nil {
		return nil, errcode.UserInvalidParam.WithMessage("MCP server name already exists")
	}
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}

	m.OwnerID = ownerID
	m.ID = "" // let BeforeCreate generate
	if err := repository.CreateMCPServer(s.db, m); err != nil {
		return nil, err
	}
	return m, nil
}

// Get retrieves a single MCP server by ID.
func (s *MCPService) Get(ctx context.Context, id string) (*model.MCPServer, error) {
	m, err := repository.GetMCPServerByID(s.db, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errcode.UserNotFound
		}
		return nil, err
	}
	return m, nil
}

// Update modifies an MCP server; owner must match.
func (s *MCPService) Update(ctx context.Context, id, ownerID string, m *model.MCPServer) (*model.MCPServer, error) {
	existing, err := repository.GetMCPServerByID(s.db, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errcode.UserNotFound
		}
		return nil, err
	}
	if existing.OwnerID != ownerID {
		return nil, errcode.AuthDeviceMismatch
	}

	// Apply allowed fields from the request
	if m.Name != "" {
		existing.Name = m.Name
	}
	if m.Transport != "" {
		existing.Transport = m.Transport
	}
	existing.Command = m.Command
	existing.Args = m.Args
	existing.EnvVars = m.EnvVars
	existing.URL = m.URL
	existing.AuthType = m.AuthType
	existing.AuthConfig = m.AuthConfig
	existing.ToolSchema = m.ToolSchema

	if err := existing.Validate(); err != nil {
		return nil, errcode.ErrBadRequest.WithMessage(err.Error())
	}
	if err := repository.UpdateMCPServer(s.db, existing); err != nil {
		return nil, err
	}
	return existing, nil
}

// Delete soft-deletes an MCP server; owner must match.
func (s *MCPService) Delete(ctx context.Context, id, ownerID string) error {
	m, err := repository.GetMCPServerByID(s.db, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return errcode.UserNotFound
		}
		return err
	}
	if m.OwnerID != ownerID {
		return errcode.AuthDeviceMismatch
	}
	return repository.SoftDeleteMCPServer(s.db, id, ownerID)
}

// List returns paginated MCP servers for an owner.
func (s *MCPService) List(ctx context.Context, ownerID, q, transport, cursor string, pageSize int) (*MCPListResult, error) {
	servers, hasMore, err := repository.ListMCPServers(s.db, ownerID, q, transport, cursor, pageSize)
	if err != nil {
		return nil, err
	}
	var nextCursor string
	if hasMore && len(servers) > 0 {
		nextCursor = servers[len(servers)-1].ID
	}
	return &MCPListResult{Items: servers, HasMore: hasMore, Cursor: nextCursor}, nil
}

// Publish marks an MCP server as public.
func (s *MCPService) Publish(ctx context.Context, id, ownerID string) error {
	m, err := repository.GetMCPServerByID(s.db, id)
	if err != nil {
		return errcode.UserNotFound
	}
	if m.OwnerID != ownerID {
		return errcode.AuthDeviceMismatch
	}
	m.IsPublic = true
	return repository.UpdateMCPServer(s.db, m)
}

// Unpublish marks an MCP server as private.
func (s *MCPService) Unpublish(ctx context.Context, id, ownerID string) error {
	m, err := repository.GetMCPServerByID(s.db, id)
	if err != nil {
		return errcode.UserNotFound
	}
	if m.OwnerID != ownerID {
		return errcode.AuthDeviceMismatch
	}
	m.IsPublic = false
	return repository.UpdateMCPServer(s.db, m)
}

// SearchPublic searches published MCP servers.
func (s *MCPService) SearchPublic(ctx context.Context, q, transport, cursor string, pageSize int) (*MCPListResult, error) {
	servers, hasMore, err := repository.ListPublicMCPServers(s.db, q, transport, cursor, pageSize)
	if err != nil {
		return nil, err
	}
	var nextCursor string
	if hasMore && len(servers) > 0 {
		nextCursor = fmt.Sprintf("%d", servers[len(servers)-1].InstallCount)
	}
	return &MCPListResult{Items: servers, HasMore: hasMore, Cursor: nextCursor}, nil
}
