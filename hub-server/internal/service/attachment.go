package service

import (
	"context"
	"errors"
	"fmt"

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

func (s *AttachmentService) ProbeAttachment(ctx context.Context, hash string) (*model.Attachment, error) {
	a, err := repository.GetAttachmentByHash(s.db, hash)
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

func (s *AttachmentService) GetAttachmentByID(ctx context.Context, id string) (*model.Attachment, error) {
	a, err := repository.GetAttachmentByID(s.db, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errcode.AttachNotFound
		}
		return nil, err
	}
	return a, nil
}

func PathFromHash(hash string) string {
	return fmt.Sprintf("uploads/%s/%s/%s", hash[:2], hash[2:4], hash)
}

func (s *AttachmentService) MaxUploadSize() int64 {
	return s.uploadCfg.MaxSize
}
