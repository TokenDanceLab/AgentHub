package service

import (
	"context"
	"errors"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
)

// ProviderBindingService handles CRUD for provider bindings.
type ProviderBindingService struct {
	db *gorm.DB
}

func NewProviderBindingService(db *gorm.DB) *ProviderBindingService {
	return &ProviderBindingService{db: db}
}

// PBListResult holds paginated provider binding results.
type PBListResult struct {
	Items   []model.ProviderBinding `json:"items"`
	HasMore bool                    `json:"has_more"`
	Cursor  string                  `json:"next_cursor,omitempty"`
}

// ── CRUD ──

func (s *ProviderBindingService) Create(ctx context.Context, ownerID string, req *model.ProviderBinding) (*model.ProviderBinding, error) {
	if req.Provider == "" {
		return nil, errcode.ErrBadRequest
	}
	if err := req.Validate(); err != nil {
		return nil, errcode.ErrBadRequest.WithMessage(err.Error())
	}

	req.OwnerID = ownerID
	req.ID = "" // let BeforeCreate generate
	if err := repository.CreateProviderBinding(s.db, req); err != nil {
		return nil, err
	}
	return req, nil
}

func (s *ProviderBindingService) Get(ctx context.Context, id, ownerID string) (*model.ProviderBinding, error) {
	pb, err := repository.GetProviderBindingByID(s.db, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errcode.UserNotFound
		}
		return nil, err
	}
	if pb.OwnerID != ownerID {
		return nil, errcode.AuthDeviceMismatch
	}
	return pb, nil
}

func (s *ProviderBindingService) Update(ctx context.Context, id, ownerID string, req *model.ProviderBinding) (*model.ProviderBinding, error) {
	pb, err := repository.GetProviderBindingByID(s.db, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errcode.UserNotFound
		}
		return nil, err
	}
	if pb.OwnerID != ownerID {
		return nil, errcode.AuthDeviceMismatch
	}

	// Apply updates
	if req.BindingName != "" {
		pb.BindingName = req.BindingName
	}
	if req.Provider != "" {
		pb.Provider = req.Provider
	}
	if req.BaseURL != "" {
		pb.BaseURL = req.BaseURL
	}
	pb.IsAvailable = req.IsAvailable
	pb.QuotaUsed = req.QuotaUsed
	pb.QuotaLimit = req.QuotaLimit
	if req.LastChecked != nil {
		pb.LastChecked = req.LastChecked
	}
	if req.Metadata != "" {
		pb.Metadata = req.Metadata
	}

	if err := pb.Validate(); err != nil {
		return nil, errcode.ErrBadRequest.WithMessage(err.Error())
	}
	if err := repository.UpdateProviderBinding(s.db, pb); err != nil {
		return nil, err
	}
	return pb, nil
}

func (s *ProviderBindingService) Delete(ctx context.Context, id, ownerID string) error {
	pb, err := repository.GetProviderBindingByID(s.db, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return errcode.UserNotFound
		}
		return err
	}
	if pb.OwnerID != ownerID {
		return errcode.AuthDeviceMismatch
	}
	return repository.DeleteProviderBinding(s.db, id, ownerID)
}

func (s *ProviderBindingService) List(ctx context.Context, ownerID, cursor string, pageSize int) (*PBListResult, error) {
	bindings, hasMore, err := repository.ListProviderBindings(s.db, ownerID, cursor, pageSize)
	if err != nil {
		return nil, err
	}
	var nextCursor string
	if hasMore && len(bindings) > 0 {
		nextCursor = bindings[len(bindings)-1].ID
	}
	return &PBListResult{Items: bindings, HasMore: hasMore, Cursor: nextCursor}, nil
}
