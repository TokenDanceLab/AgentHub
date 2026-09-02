package repository

import (
	"time"

	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const defaultTargetPageSize = 50

func CreateExecutionTarget(db *gorm.DB, t *model.ExecutionTarget) error {
	return db.Create(t).Error
}

func CreateExecutionTargetIfNotExists(db *gorm.DB, t *model.ExecutionTarget) (bool, error) {
	result := db.Clauses(clause.OnConflict{DoNothing: true}).Create(t)
	if result.Error != nil {
		return false, result.Error
	}
	return result.RowsAffected > 0, nil
}

func GetExecutionTargetByID(db *gorm.DB, id string) (*model.ExecutionTarget, error) {
	var t model.ExecutionTarget
	err := db.Where("id = ? AND deleted_at IS NULL", id).First(&t).Error
	if err != nil {
		return nil, err
	}
	return &t, nil
}

func UpdateExecutionTarget(db *gorm.DB, t *model.ExecutionTarget) error {
	return db.Save(t).Error
}

func SoftDeleteExecutionTarget(db *gorm.DB, id, ownerID string) error {
	return db.Model(&model.ExecutionTarget{}).
		Where("id = ? AND owner_id = ? AND deleted_at IS NULL", id, ownerID).
		Update("deleted_at", time.Now()).Error
}

func ListExecutionTargets(db *gorm.DB, ownerID, targetType, cursor string, pageSize int) ([]model.ExecutionTarget, bool, error) {
	pageSize = config.ClampPageSize(pageSize, config.MaxListPageSize, defaultTargetPageSize)

	qry := db.Where("owner_id = ? AND deleted_at IS NULL", ownerID)
	if targetType != "" {
		qry = qry.Where("target_type = ?", targetType)
	}
	if cursor != "" {
		qry = qry.Where("id > ?", cursor)
	}

	var targets []model.ExecutionTarget
	if err := qry.Order("id ASC").Limit(pageSize + 1).Find(&targets).Error; err != nil {
		return nil, false, err
	}

	hasMore := len(targets) > pageSize
	if hasMore {
		targets = targets[:pageSize]
	}
	return targets, hasMore, nil
}

func FindTargetByOwnerAndName(db *gorm.DB, ownerID, name string) (*model.ExecutionTarget, error) {
	var t model.ExecutionTarget
	err := db.Where("owner_id = ? AND name = ? AND deleted_at IS NULL", ownerID, name).First(&t).Error
	if err != nil {
		return nil, err
	}
	return &t, nil
}
