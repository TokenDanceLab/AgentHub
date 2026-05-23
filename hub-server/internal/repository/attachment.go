package repository

import (
	"github.com/agenthub/hub-server/internal/model"
	"gorm.io/gorm"
)

func CreateAttachment(db *gorm.DB, a *model.Attachment) error {
	return db.Create(a).Error
}

func GetAttachmentByHash(db *gorm.DB, hash string) (*model.Attachment, error) {
	var a model.Attachment
	err := db.Where("hash = ?", hash).First(&a).Error
	if err != nil {
		return nil, err
	}
	return &a, nil
}

func GetAttachmentByID(db *gorm.DB, id string) (*model.Attachment, error) {
	var a model.Attachment
	err := db.Where("id = ?", id).First(&a).Error
	if err != nil {
		return nil, err
	}
	return &a, nil
}
