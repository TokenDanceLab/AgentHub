package service

import (
	"context"
	"errors"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
)

// SkillService handles CRUD for user-managed skills.
type SkillService struct {
	db *gorm.DB
}

func NewSkillService(db *gorm.DB) *SkillService {
	return &SkillService{db: db}
}

// SkillListResult holds paginated skill results.
type SkillListResult struct {
	Items   []model.Skill `json:"items"`
	HasMore bool          `json:"has_more"`
	Cursor  string        `json:"next_cursor,omitempty"`
}

// ── CRUD ──

func (s *SkillService) Create(ctx context.Context, ownerID string, req *model.Skill) (*model.Skill, error) {
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

func (s *SkillService) Get(ctx context.Context, id string) (*model.Skill, error) {
	sk, err := repository.GetSkillByID(s.db, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errcode.UserNotFound
		}
		return nil, err
	}
	return sk, nil
}

func (s *SkillService) Update(ctx context.Context, id, ownerID string, req *model.Skill) (*model.Skill, error) {
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

func (s *SkillService) Delete(ctx context.Context, id, ownerID string) error {
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

func (s *SkillService) List(ctx context.Context, ownerID, q, skillType, cursor string, pageSize int) (*SkillListResult, error) {
	skills, hasMore, err := repository.ListSkills(s.db, ownerID, q, skillType, cursor, pageSize)
	if err != nil {
		return nil, err
	}
	var nextCursor string
	if hasMore && len(skills) > 0 {
		nextCursor = skills[len(skills)-1].ID
	}
	return &SkillListResult{Items: skills, HasMore: hasMore, Cursor: nextCursor}, nil
}

// ── Market ──

func (s *SkillService) Publish(ctx context.Context, id, ownerID string) error {
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

func (s *SkillService) Unpublish(ctx context.Context, id, ownerID string) error {
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

func (s *SkillService) SearchPublic(ctx context.Context, q, skillType, cursor string, pageSize int) (*SkillListResult, error) {
	skills, hasMore, err := repository.ListPublicSkills(s.db, q, skillType, cursor, pageSize)
	if err != nil {
		return nil, err
	}
	var nextCursor string
	if hasMore && len(skills) > 0 {
		nextCursor = skills[len(skills)-1].ID
	}
	return &SkillListResult{Items: skills, HasMore: hasMore, Cursor: nextCursor}, nil
}
