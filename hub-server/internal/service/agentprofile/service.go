package agentprofile

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strconv"

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

	// Apply scalar string updates to model fields (order matters: the first
	// invalid value still short-circuits exactly as the inline version did).
	for _, field := range agentProfileStringFields {
		if v, ok := updates[field.key]; ok {
			value, err := stringUpdateValue(field.key, v)
			if err != nil {
				return nil, err
			}
			field.apply(p, value)
		}
	}

	// Apply JSONB fields — validate before applying.
	for _, field := range agentProfileJSONFields {
		if v, ok := updates[field.key]; ok {
			value, err := jsonUpdateValue(field.key, v, field.required)
			if err != nil {
				return nil, err
			}
			field.apply(p, value)
		}
	}

	if v, ok := updates["context_budget_max_tokens"]; ok {
		value, err := intUpdateValue(v)
		if err != nil {
			return nil, err
		}
		p.ContextBudgetMaxTokens = value
	}

	if err := p.Validate(); err != nil {
		return nil, errcode.ErrBadRequest.WithMessage(err.Error())
	}
	if err := repository.UpdateAgentProfile(s.db, p); err != nil {
		return nil, err
	}
	return p, nil
}

type agentProfileStringField struct {
	key   string
	apply func(*model.AgentProfile, string)
}

// agentProfileStringFields maps update keys to profile fields for the scalar
// string updates — one declarative table replaces seven repeated inline blocks.
var agentProfileStringFields = []agentProfileStringField{
	{"name", func(p *model.AgentProfile, v string) { p.Name = v }},
	{"description", func(p *model.AgentProfile, v string) { p.Description = v }},
	{"runtime_id", func(p *model.AgentProfile, v string) { p.RuntimeID = v }},
	{"model", func(p *model.AgentProfile, v string) { p.Model = v }},
	{"provider", func(p *model.AgentProfile, v string) { p.Provider = v }},
	{"reasoning_effort", func(p *model.AgentProfile, v string) { p.ReasoningEffort = v }},
	{"permission_mode", func(p *model.AgentProfile, v string) { p.PermissionMode = v }},
}

type agentProfileJSONField struct {
	key      string
	required bool
	apply    func(*model.AgentProfile, string)
}

// agentProfileJSONFields maps update keys to the JSONB profile fields; the
// required flag selects the "must be an object" validation applied upstream.
var agentProfileJSONFields = []agentProfileJSONField{
	{"model_mapping", true, func(p *model.AgentProfile, v string) { p.ModelMapping = v }},
	{"skills", false, func(p *model.AgentProfile, v string) { p.Skills = v }},
	{"mcp_servers", false, func(p *model.AgentProfile, v string) { p.MCPServers = v }},
	{"tool_allowlist", false, func(p *model.AgentProfile, v string) { p.ToolAllowlist = v }},
	{"approval_policy", true, func(p *model.AgentProfile, v string) { p.ApprovalPolicy = v }},
	{"target_preferences", true, func(p *model.AgentProfile, v string) { p.TargetPreferences = v }},
}

// intUpdateValue coerces context_budget_max_tokens to an int; float values
// must be integral or the update is rejected (matching the previous inline
// switch behaviour).
func intUpdateValue(v any) (int, error) {
	switch val := v.(type) {
	case float64:
		if math.Trunc(val) != val {
			return 0, errcode.ErrBadRequest.WithMessage("context_budget_max_tokens must be an integer")
		}
		return int(val), nil
	case int:
		return val, nil
	default:
		return 0, errcode.ErrBadRequest.WithMessage("context_budget_max_tokens must be an integer")
	}
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
		last := profiles[len(profiles)-1]
		switch sortBy {
		case "install_count":
			// Composite cursor: sort value + tie-break id. The repo compares
			// `install_count < sortValue OR (= sortValue AND id > lastID)`.
			nextCursor = fmt.Sprintf("%d|%s", last.InstallCount, last.ID)
		case "rating":
			nextCursor = fmt.Sprintf("%s|%s", strconv.FormatFloat(last.RatingAvg, 'f', -1, 64), last.ID)
		default: // "recent"
			nextCursor = last.ID
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
