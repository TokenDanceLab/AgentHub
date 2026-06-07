package service

import (
	"context"
	"errors"
	"strings"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
)

// WorkspaceListResult holds paginated Hub project/workspace results.
type WorkspaceListResult struct {
	Items   []model.Workspace `json:"items"`
	HasMore bool              `json:"has_more"`
	Cursor  string            `json:"next_cursor,omitempty"`
}

// WorkspaceUpdate carries PATCH semantics: nil fields are not changed.
type WorkspaceUpdate struct {
	Name        *string
	Description *string
}

// WorkspaceService exposes Web-owned project CRUD backed by Hub workspaces.
type WorkspaceService struct {
	db *gorm.DB
}

func NewWorkspaceService(db *gorm.DB) *WorkspaceService {
	return &WorkspaceService{db: db}
}

func (s *WorkspaceService) Create(ctx context.Context, ownerID string, req *model.Workspace) (*model.Workspace, error) {
	name := strings.TrimSpace(req.Name)
	if name == "" {
		return nil, errcode.ErrBadRequest.WithMessage("workspace name is required")
	}

	existing, err := repository.FindWorkspaceByOwnerAndName(s.db, ownerID, name)
	if err == nil && existing != nil {
		return nil, errcode.UserInvalidParam.WithMessage("workspace name already exists")
	}
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}

	req.ID = ""
	req.OwnerID = ownerID
	req.Name = name
	req.Description = strings.TrimSpace(req.Description)
	if err := repository.CreateWorkspace(s.db, req); err != nil {
		return nil, err
	}
	return req, nil
}

func (s *WorkspaceService) Get(ctx context.Context, id, ownerID string) (*model.Workspace, error) {
	workspace, err := repository.GetWorkspaceByID(s.db, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errcode.UserNotFound
		}
		return nil, err
	}
	if workspace.OwnerID != ownerID {
		return nil, errcode.AuthDeviceMismatch
	}
	return workspace, nil
}

func (s *WorkspaceService) Update(ctx context.Context, id, ownerID string, req *WorkspaceUpdate) (*model.Workspace, error) {
	workspace, err := repository.GetWorkspaceByID(s.db, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errcode.UserNotFound
		}
		return nil, err
	}
	if workspace.OwnerID != ownerID {
		return nil, errcode.AuthDeviceMismatch
	}

	if req.Name != nil {
		name := strings.TrimSpace(*req.Name)
		if name == "" {
			return nil, errcode.ErrBadRequest.WithMessage("workspace name is required")
		}
		if name != workspace.Name {
			existing, err := repository.FindWorkspaceByOwnerAndName(s.db, ownerID, name)
			if err == nil && existing != nil && existing.ID != workspace.ID {
				return nil, errcode.UserInvalidParam.WithMessage("workspace name already exists")
			}
			if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
				return nil, err
			}
		}
		workspace.Name = name
	}
	if req.Description != nil {
		workspace.Description = strings.TrimSpace(*req.Description)
	}

	if err := repository.UpdateWorkspace(s.db, workspace); err != nil {
		return nil, err
	}
	return workspace, nil
}

func (s *WorkspaceService) List(ctx context.Context, ownerID, q, cursor string, pageSize int) (*WorkspaceListResult, error) {
	workspaces, hasMore, err := repository.ListWorkspaces(s.db, ownerID, strings.TrimSpace(q), cursor, pageSize)
	if err != nil {
		return nil, err
	}
	nextCursor := ""
	if hasMore && len(workspaces) > 0 {
		nextCursor = workspaces[len(workspaces)-1].ID
	}
	return &WorkspaceListResult{Items: workspaces, HasMore: hasMore, Cursor: nextCursor}, nil
}
