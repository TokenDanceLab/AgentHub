package skill

import (
	"context"
	"errors"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
)

// Service handles CRUD for user-managed skills.
type Service struct {
	db *gorm.DB
}

// NewService creates a new Service.
func NewService(db *gorm.DB) *Service {
	return &Service{db: db}
}

// ListResult holds paginated skill results.
type ListResult struct {
	Items   []model.Skill `json:"items"`
	HasMore bool          `json:"has_more"`
	Cursor  string        `json:"next_cursor,omitempty"`
}

// ── CRUD ──

func (s *Service) Create(ctx context.Context, ownerID string, req *model.Skill) (*model.Skill, error) {
	if req.Name == "" {
		return nil, errcode.ErrBadRequest
	}
	if err := req.Validate(); err != nil {
		return nil, errcode.ErrBadRequest.WithMessage(err.Error())
	}

	// Check duplicate name
	existing, err := repository.FindSkillByOwnerAndName(s.db, ownerID, req.Name)
	if err == nil && existing != nil {
		return nil, errcode.UserInvalidParam.WithMessage("skill name already exists")
	}
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}

	req.OwnerID = ownerID
	req.ID = "" // let BeforeCreate generate
	if err := repository.CreateSkill(s.db, req); err != nil {
		return nil, err
	}
	return req, nil
}

func (s *Service) Get(ctx context.Context, id, ownerID string) (*model.Skill, error) {
	sk, err := repository.GetSkillByID(s.db, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errcode.UserNotFound
		}
		return nil, err
	}
	if sk.OwnerID != ownerID {
		return nil, errcode.AuthDeviceMismatch
	}
	return sk, nil
}

func (s *Service) Update(ctx context.Context, id, ownerID string, req *model.Skill) (*model.Skill, error) {
	sk, err := repository.GetSkillByID(s.db, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errcode.UserNotFound
		}
		return nil, err
	}
	if sk.OwnerID != ownerID {
		return nil, errcode.AuthDeviceMismatch
	}

	// Apply updates
	if req.Name != "" {
		sk.Name = req.Name
	}
	if req.Description != "" {
		sk.Description = req.Description
	}
	if req.SkillType != "" {
		sk.SkillType = req.SkillType
	}
	if req.RuntimeIDs != "" {
		sk.RuntimeIDs = req.RuntimeIDs
	}
	if req.EntryPoint != "" {
		sk.EntryPoint = req.EntryPoint
	}
	if req.ConfigSchema != "" {
		sk.ConfigSchema = req.ConfigSchema
	}
	if req.Version != "" {
		sk.Version = req.Version
	}

	if err := sk.Validate(); err != nil {
		return nil, errcode.ErrBadRequest.WithMessage(err.Error())
	}
	if err := repository.UpdateSkill(s.db, sk); err != nil {
		return nil, err
	}
	return sk, nil
}

func (s *Service) Delete(ctx context.Context, id, ownerID string) error {
	sk, err := repository.GetSkillByID(s.db, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return errcode.UserNotFound
		}
		return err
	}
	if sk.OwnerID != ownerID {
		return errcode.AuthDeviceMismatch
	}
	return repository.SoftDeleteSkill(s.db, id, ownerID)
}

func (s *Service) List(ctx context.Context, ownerID, q, skillType, cursor string, pageSize int) (*ListResult, error) {
	skills, hasMore, err := repository.ListSkills(s.db, ownerID, q, skillType, cursor, pageSize)
	if err != nil {
		return nil, err
	}
	var nextCursor string
	if hasMore && len(skills) > 0 {
		nextCursor = skills[len(skills)-1].ID
	}
	return &ListResult{Items: skills, HasMore: hasMore, Cursor: nextCursor}, nil
}

// ── Market ──

func (s *Service) Publish(ctx context.Context, id, ownerID string) error {
	sk, err := repository.GetSkillByID(s.db, id)
	if err != nil {
		return errcode.UserNotFound
	}
	if sk.OwnerID != ownerID {
		return errcode.AuthDeviceMismatch
	}
	sk.IsPublic = true
	return repository.UpdateSkill(s.db, sk)
}

func (s *Service) Unpublish(ctx context.Context, id, ownerID string) error {
	sk, err := repository.GetSkillByID(s.db, id)
	if err != nil {
		return errcode.UserNotFound
	}
	if sk.OwnerID != ownerID {
		return errcode.AuthDeviceMismatch
	}
	sk.IsPublic = false
	return repository.UpdateSkill(s.db, sk)
}

func (s *Service) SearchPublic(ctx context.Context, q, skillType, cursor string, pageSize int) (*ListResult, error) {
	skills, hasMore, err := repository.ListPublicSkills(s.db, q, skillType, cursor, pageSize)
	if err != nil {
		return nil, err
	}
	var nextCursor string
	if hasMore && len(skills) > 0 {
		nextCursor = skills[len(skills)-1].ID
	}
	return &ListResult{Items: skills, HasMore: hasMore, Cursor: nextCursor}, nil
}
