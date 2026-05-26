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

// AgentProfileService handles CRUD for user-managed agent profiles.
type AgentProfileService struct {
	db *gorm.DB
}

func NewAgentProfileService(db *gorm.DB) *AgentProfileService {
	return &AgentProfileService{db: db}
}

// CreateResult holds the created profile and pagination info for list endpoints.
type CreateResult struct {
	Profile *model.AgentProfile `json:"profile"`
}

type ListResult struct {
	Items   []model.AgentProfile `json:"items"`
	HasMore bool                 `json:"has_more"`
	Cursor  string               `json:"next_cursor,omitempty"`
}

// ── CRUD ──

func (s *AgentProfileService) Create(ctx context.Context, ownerID string, req *model.AgentProfile) (*model.AgentProfile, error) {
	if req.Name == "" || req.RuntimeID == "" {
		return nil, errcode.ErrBadRequest
	}
	if err := req.Validate(); err != nil {
		return nil, errcode.ErrBadRequest.WithMessage(err.Error())
	}

	// Check duplicate name
	existing, err := repository.FindProfileByOwnerAndName(s.db, ownerID, req.Name)
	if err == nil && existing != nil {
		return nil, errcode.UserInvalidParam.WithMessage("profile name already exists")
	}
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}

	req.OwnerID = ownerID
	req.ID = "" // let BeforeCreate generate
	if err := repository.CreateAgentProfile(s.db, req); err != nil {
		return nil, err
	}
	return req, nil
}

func (s *AgentProfileService) Get(ctx context.Context, id string) (*model.AgentProfile, error) {
	p, err := repository.GetAgentProfileByID(s.db, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errcode.UserNotFound
		}
		return nil, err
	}
	return p, nil
}

func (s *AgentProfileService) Update(ctx context.Context, id, ownerID string, updates map[string]interface{}) (*model.AgentProfile, error) {
	p, err := repository.GetAgentProfileByID(s.db, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errcode.UserNotFound
		}
		return nil, err
	}
	if p.OwnerID != ownerID {
		return nil, errcode.AuthDeviceMismatch
	}

	// Apply updates to model fields
	if v, ok := updates["name"]; ok {
		if name, ok2 := v.(string); ok2 {
			p.Name = name
		}
	}
	if v, ok := updates["description"]; ok {
		p.Description = v.(string)
	}
	if v, ok := updates["runtime_id"]; ok {
		p.RuntimeID = v.(string)
	}
	if v, ok := updates["model"]; ok {
		p.Model = v.(string)
	}
	if v, ok := updates["provider"]; ok {
		p.Provider = v.(string)
	}
	if v, ok := updates["reasoning_effort"]; ok {
		p.ReasoningEffort = v.(string)
	}
	if v, ok := updates["permission_mode"]; ok {
		p.PermissionMode = v.(string)
	}
	// JSONB fields — validate before applying
	if v, ok := updates["model_mapping"]; ok {
		p.ModelMapping = v.(string)
	}
	if v, ok := updates["skills"]; ok {
		p.Skills = v.(string)
	}
	if v, ok := updates["mcp_servers"]; ok {
		p.MCPServers = v.(string)
	}
	if v, ok := updates["tool_allowlist"]; ok {
		p.ToolAllowlist = v.(string)
	}
	if v, ok := updates["approval_policy"]; ok {
		p.ApprovalPolicy = v.(string)
	}
	if v, ok := updates["target_preferences"]; ok {
		p.TargetPreferences = v.(string)
	}
	if v, ok := updates["context_budget_max_tokens"]; ok {
		switch val := v.(type) {
		case float64:
			p.ContextBudgetMaxTokens = int(val)
		case int:
			p.ContextBudgetMaxTokens = val
		}
	}

	if err := p.Validate(); err != nil {
		return nil, errcode.ErrBadRequest.WithMessage(err.Error())
	}
	if err := repository.UpdateAgentProfile(s.db, p); err != nil {
		return nil, err
	}
	return p, nil
}

func (s *AgentProfileService) Delete(ctx context.Context, id, ownerID string) error {
	p, err := repository.GetAgentProfileByID(s.db, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return errcode.UserNotFound
		}
		return err
	}
	if p.OwnerID != ownerID {
		return errcode.AuthDeviceMismatch
	}
	return repository.SoftDeleteAgentProfile(s.db, id, ownerID)
}

func (s *AgentProfileService) List(ctx context.Context, ownerID, runtimeID, q, cursor string, pageSize int) (*ListResult, error) {
	profiles, hasMore, err := repository.ListAgentProfiles(s.db, ownerID, runtimeID, q, cursor, pageSize)
	if err != nil {
		return nil, err
	}
	var nextCursor string
	if hasMore && len(profiles) > 0 {
		nextCursor = profiles[len(profiles)-1].ID
	}
	return &ListResult{Items: profiles, HasMore: hasMore, Cursor: nextCursor}, nil
}

// ── Market ──

func (s *AgentProfileService) Publish(ctx context.Context, id, ownerID string) error {
	p, err := repository.GetAgentProfileByID(s.db, id)
	if err != nil {
		return errcode.UserNotFound
	}
	if p.OwnerID != ownerID {
		return errcode.AuthDeviceMismatch
	}
	p.IsPublic = true
	return repository.UpdateAgentProfile(s.db, p)
}

func (s *AgentProfileService) Unpublish(ctx context.Context, id, ownerID string) error {
	p, err := repository.GetAgentProfileByID(s.db, id)
	if err != nil {
		return errcode.UserNotFound
	}
	if p.OwnerID != ownerID {
		return errcode.AuthDeviceMismatch
	}
	p.IsPublic = false
	return repository.UpdateAgentProfile(s.db, p)
}

func (s *AgentProfileService) Install(ctx context.Context, id, installerID string) (*model.AgentProfile, error) {
	src, err := repository.GetAgentProfileByID(s.db, id)
	if err != nil {
		return nil, errcode.UserNotFound
	}
	if !src.IsPublic {
		return nil, errcode.AgentNotFound.WithMessage("profile is not public")
	}
	if src.OwnerID == installerID {
		return nil, errcode.ErrBadRequest.WithMessage("cannot install your own profile")
	}
	// Check if already installed
	existing, _ := repository.FindProfileByOwnerAndName(s.db, installerID, src.Name)
	if existing != nil {
		return nil, errcode.GroupAlreadyMember.WithMessage("already installed") // reuse conflict code
	}

	dup, err := repository.DuplicateProfile(s.db, src, installerID)
	if err != nil {
		return nil, err
	}
	_ = repository.IncrementProfileInstallCount(s.db, id)
	return dup, nil
}

// SearchMarket searches public profiles.
func (s *AgentProfileService) SearchMarket(ctx context.Context, runtimeID, q, sortBy, cursor string, pageSize int) (*ListResult, error) {
	profiles, hasMore, err := repository.ListPublicProfiles(s.db, runtimeID, q, sortBy, cursor, pageSize)
	if err != nil {
		return nil, err
	}
	var nextCursor string
	if hasMore && len(profiles) > 0 {
		if sortBy == "" || sortBy == "recent" {
			nextCursor = profiles[len(profiles)-1].ID
		} else {
			nextCursor = fmt.Sprintf("%d", profiles[len(profiles)-1].InstallCount)
		}
	}
	return &ListResult{Items: profiles, HasMore: hasMore, Cursor: nextCursor}, nil
}

// Rate updates a profile's rating with simple averaging.
func (s *AgentProfileService) Rate(ctx context.Context, profileID, raterID string, score int) (float64, int, error) {
	if score < 1 || score > 5 {
		return 0, 0, errcode.ErrBadRequest.WithMessage("score must be between 1 and 5")
	}
	p, err := repository.GetAgentProfileByID(s.db, profileID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return 0, 0, errcode.UserNotFound
		}
		return 0, 0, err
	}
	if !p.IsPublic {
		return 0, 0, errcode.AgentNotFound.WithMessage("profile is not public")
	}
	if p.OwnerID == raterID {
		return 0, 0, errcode.ErrBadRequest.WithMessage("cannot rate your own profile")
	}
	newCount := p.RatingCount + 1
	newAvg := (p.RatingAvg*float64(p.RatingCount) + float64(score)) / float64(newCount)
	if err := repository.UpdateProfileRating(s.db, profileID, newAvg, newCount); err != nil {
		return 0, 0, err
	}
	return newAvg, newCount, nil
}
