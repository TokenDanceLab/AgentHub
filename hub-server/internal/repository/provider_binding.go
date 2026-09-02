package repository

import (
	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/model"
	"gorm.io/gorm"
)

const defaultProviderBindingPageSize = 50

func CreateProviderBinding(db *gorm.DB, pb *model.ProviderBinding) error {
	return db.Create(pb).Error
}

func GetProviderBindingByID(db *gorm.DB, id string) (*model.ProviderBinding, error) {
	var pb model.ProviderBinding
	err := db.Where("id = ?", id).First(&pb).Error
	if err != nil {
		return nil, err
	}
	return &pb, nil
}

func UpdateProviderBinding(db *gorm.DB, pb *model.ProviderBinding) error {
	return db.Save(pb).Error
}

func DeleteProviderBinding(db *gorm.DB, id, ownerID string) error {
	return db.Where("id = ? AND owner_id = ?", id, ownerID).Delete(&model.ProviderBinding{}).Error
}

func ListProviderBindings(db *gorm.DB, ownerID, cursor string, pageSize int) ([]model.ProviderBinding, bool, error) {
	pageSize = config.ClampPageSize(pageSize, config.MaxListPageSize, defaultProviderBindingPageSize)

	qry := db.Where("owner_id = ?", ownerID)
	if cursor != "" {
		qry = qry.Where("id > ?", cursor)
	}

	var bindings []model.ProviderBinding
	if err := qry.Order("id ASC").Limit(pageSize + 1).Find(&bindings).Error; err != nil {
		return nil, false, err
	}

	hasMore := len(bindings) > pageSize
	if hasMore {
		bindings = bindings[:pageSize]
	}
	return bindings, hasMore, nil
}
