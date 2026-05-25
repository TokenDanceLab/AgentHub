package service

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
)

type AttachmentService struct {
	db        *gorm.DB
	uploadCfg config.UploadConfig
}

func NewAttachmentService(db *gorm.DB, uploadCfg config.UploadConfig) *AttachmentService {
	return &AttachmentService{db: db, uploadCfg: uploadCfg}
}

func (s *AttachmentService) ProbeAttachment(ctx context.Context, userID, hash string) (*model.Attachment, error) {
	if userID == "" {
		return nil, nil
	}
	a, err := repository.GetAttachmentByUploaderAndHash(s.db, userID, hash)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return a, nil
}

func (s *AttachmentService) SaveAttachment(ctx context.Context, uploaderID, hash, mimeType, originalName string, size int64) (*model.Attachment, error) {
	a := &model.Attachment{
		Hash:           hash,
		Size:           size,
		MimeType:       mimeType,
		OriginalName:   originalName,
		UploaderUserID: uploaderID,
	}
	if err := repository.CreateAttachment(s.db, a); err != nil {
		return nil, err
	}
	return a, nil
}

func (s *AttachmentService) GetAttachmentByID(ctx context.Context, userID, id string) (*model.Attachment, error) {
	if userID == "" {
		return nil, errcode.AttachNotFound
	}
	a, err := repository.GetAttachmentByID(s.db, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errcode.AttachNotFound
		}
		return nil, err
	}
	if a.UploaderUserID == userID {
		return a, nil
	}

	allowed, err := repository.CanUserAccessReferencedAttachment(s.db, userID, id)
	if err != nil {
		return nil, err
	}
	if !allowed {
		return nil, errcode.AttachNotFound
	}
	return a, nil
}

func IsValidAttachmentHash(hash string) bool {
	if len(hash) != 64 {
		return false
	}
	if strings.ToLower(hash) != hash {
		return false
	}
	for _, r := range hash {
		if (r < '0' || r > '9') && (r < 'a' || r > 'f') {
			return false
		}
	}
	return true
}

func PathFromHash(hash string) string {
	if !IsValidAttachmentHash(hash) {
		return ""
	}
	return fmt.Sprintf("uploads/%s/%s/%s", hash[:2], hash[2:4], hash)
}

func (s *AttachmentService) MaxUploadSize() int64 {
	return s.uploadCfg.MaxSize
}
