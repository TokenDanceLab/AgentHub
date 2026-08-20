package agentprofile

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
)

// Service handles CRUD for user-managed agent profiles.
type Service struct {
	db *gorm.DB
}

func NewService(db *gorm.DB) *Service {
	return &Service{db: db}
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

func (s *Service) Create(ctx context.Context, ownerID string, req *model.AgentProfile) (*model.AgentProfile, error) {
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

func (s *Service) Get(ctx context.Context, id, ownerID string) (*model.AgentProfile, error) {
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
	return p, nil
}

func (s *Service) GetPublic(ctx context.Context, id string) (*model.AgentProfile, error) {
	p, err := repository.GetAgentProfileByID(s.db, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errcode.AgentNotFound
		}
		return nil, err
	}
	if !p.IsPublic {
		return nil, errcode.AgentNotFound.WithMessage("profile is not public")
	}
	return p, nil
}

func (s *Service) Update(ctx context.Context, id, ownerID string, updates map[string]interface{}) (*model.AgentProfile, error) {
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
		name, err := stringUpdateValue("name", v)
		if err != nil {
			return nil, err
		}
		p.Name = name
	}
	if v, ok := updates["description"]; ok {
		description, err := stringUpdateValue("description", v)
		if err != nil {
			return nil, err
		}
		p.Description = description
	}
	if v, ok := updates["runtime_id"]; ok {
		runtimeID, err := stringUpdateValue("runtime_id", v)
		if err != nil {
			return nil, err
		}
		p.RuntimeID = runtimeID
	}
	if v, ok := updates["model"]; ok {
		modelName, err := stringUpdateValue("model", v)
		if err != nil {
			return nil, err
		}
		p.Model = modelName
	}
	if v, ok := updates["provider"]; ok {
		provider, err := stringUpdateValue("provider", v)
		if err != nil {
			return nil, err
		}
		p.Provider = provider
	}
	if v, ok := updates["reasoning_effort"]; ok {
		reasoningEffort, err := stringUpdateValue("reasoning_effort", v)
		if err != nil {
			return nil, err
		}
		p.ReasoningEffort = reasoningEffort
	}
	if v, ok := updates["permission_mode"]; ok {
		permissionMode, err := stringUpdateValue("permission_mode", v)
		if err != nil {
			return nil, err
		}
		p.PermissionMode = permissionMode
	}
	// JSONB fields — validate before applying
	if v, ok := updates["model_mapping"]; ok {
		modelMapping, err := jsonUpdateValue("model_mapping", v, true)
		if err != nil {
			return nil, err
		}
		p.ModelMapping = modelMapping
	}
	if v, ok := updates["skills"]; ok {
		skills, err := jsonUpdateValue("skills", v, false)
		if err != nil {
			return nil, err
		}
		p.Skills = skills
	}
	if v, ok := updates["mcp_servers"]; ok {
		mcpServers, err := jsonUpdateValue("mcp_servers", v, false)
		if err != nil {
			return nil, err
		}
		p.MCPServers = mcpServers
	}
	if v, ok := updates["tool_allowlist"]; ok {
		toolAllowlist, err := jsonUpdateValue("tool_allowlist", v, false)
		if err != nil {
			return nil, err
		}
		p.ToolAllowlist = toolAllowlist
	}
	if v, ok := updates["approval_policy"]; ok {
		approvalPolicy, err := jsonUpdateValue("approval_policy", v, true)
		if err != nil {
			return nil, err
		}
		p.ApprovalPolicy = approvalPolicy
	}
	if v, ok := updates["target_preferences"]; ok {
		targetPreferences, err := jsonUpdateValue("target_preferences", v, true)
		if err != nil {
			return nil, err
		}
		p.TargetPreferences = targetPreferences
	}
	if v, ok := updates["context_budget_max_tokens"]; ok {
		switch val := v.(type) {
		case float64:
			if math.Trunc(val) != val {
				return nil, errcode.ErrBadRequest.WithMessage("context_budget_max_tokens must be an integer")
			}
			p.ContextBudgetMaxTokens = int(val)
		case int:
			p.ContextBudgetMaxTokens = val
		default:
			return nil, errcode.ErrBadRequest.WithMessage("context_budget_max_tokens must be an integer")
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

func (s *Service) Delete(ctx context.Context, id, ownerID string) error {
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

func (s *Service) List(ctx context.Context, ownerID, runtimeID, q, cursor string, pageSize int) (*ListResult, error) {
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

func (s *Service) Publish(ctx context.Context, id, ownerID string) error {
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

func (s *Service) Unpublish(ctx context.Context, id, ownerID string) error {
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

func (s *Service) Install(ctx context.Context, id, installerID string) (*model.AgentProfile, error) {
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
func (s *Service) SearchMarket(ctx context.Context, runtimeID, q, sortBy, cursor string, pageSize int) (*ListResult, error) {
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
func (s *Service) Rate(ctx context.Context, profileID, raterID string, score int) (float64, int, error) {
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

func stringUpdateValue(field string, value any) (string, error) {
	v, ok := value.(string)
	if !ok {
		return "", errcode.ErrBadRequest.WithMessage(fmt.Sprintf("%s must be a string", field))
	}
	return v, nil
}

func jsonUpdateValue(field string, value any, wantObject bool) (string, error) {
	if value == nil {
		return "", errcode.ErrBadRequest.WithMessage(fmt.Sprintf("%s must not be null", field))
	}
	if s, ok := value.(string); ok {
		if wantObject {
			var obj map[string]any
			if err := json.Unmarshal([]byte(s), &obj); err != nil {
				return "", errcode.ErrBadRequest.WithMessage(fmt.Sprintf("%s must be a JSON object", field))
			}
			return s, nil
		}
		var arr []any
		if err := json.Unmarshal([]byte(s), &arr); err != nil {
			return "", errcode.ErrBadRequest.WithMessage(fmt.Sprintf("%s must be a JSON array", field))
		}
		return s, nil
	}
	if wantObject {
		if _, ok := value.(map[string]any); !ok {
			return "", errcode.ErrBadRequest.WithMessage(fmt.Sprintf("%s must be a JSON object", field))
		}
	} else {
		switch value.(type) {
		case []any, []string:
		default:
			return "", errcode.ErrBadRequest.WithMessage(fmt.Sprintf("%s must be a JSON array", field))
		}
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		return "", errcode.ErrBadRequest.WithMessage(fmt.Sprintf("%s is not valid JSON", field))
	}
	return string(encoded), nil
}
