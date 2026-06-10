package repository

import (
	"github.com/agenthub/hub-server/internal/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// UserSettingsRepository provides persistence for user settings.
type UserSettingsRepository struct {
	db *gorm.DB
}

// NewUserSettingsRepository creates a new repository instance.
func NewUserSettingsRepository(db *gorm.DB) *UserSettingsRepository {
	return &UserSettingsRepository{db: db}
}

// GetSettings returns all settings for a user.
func (r *UserSettingsRepository) GetSettings(userID string) ([]model.UserSetting, error) {
	var settings []model.UserSetting
	if err := r.db.Where("user_id = ?", userID).Find(&settings).Error; err != nil {
		return nil, err
	}
	return settings, nil
}

// UpsertSettings creates or updates settings for a user. It performs a
// batch upsert on the (user_id, key) unique constraint in a single query
// instead of one query per key (fixes N+1 pattern N1).
func (r *UserSettingsRepository) UpsertSettings(userID string, values map[string]string) ([]model.UserSetting, error) {
	settings := make([]model.UserSetting, 0, len(values))
	for key, value := range values {
		settings = append(settings, model.UserSetting{
			UserID: userID,
			Key:    key,
			Value:  value,
		})
	}
	if len(settings) == 0 {
		return settings, nil
	}
	err := r.db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "user_id"}, {Name: "key"}},
		DoUpdates: clause.AssignmentColumns([]string{"value"}),
	}).Create(&settings).Error
	if err != nil {
		return nil, err
	}
	return settings, nil
}
