package repository

import (
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/agenthub/hub-server/internal/model"
)

// UpsertRefreshToken atomically creates or updates a refresh token keyed by
// (user_id, device_type, device_id). Uses a single INSERT … ON CONFLICT statement
// to avoid TOCTOU races when the same device logs in concurrently (#2102 F12).
//
// After upsert, rt is populated with the actual database row (including the
// stable ID on update). Callers should not rely on rt.ID before this call.
func UpsertRefreshToken(db *gorm.DB, rt *model.RefreshToken) error {
	err := db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "user_id"}, {Name: "device_type"}, {Name: "device_id"}},
		DoUpdates: clause.AssignmentColumns([]string{"token_hash", "expires_at", "revoked"}),
	}).Create(rt).Error
	if err != nil {
		return err
	}

	// Re-fetch to obtain the canonical row. On conflict the DB retains the
	// existing row's primary key, but GORM's BeforeCreate hook may have
	// assigned a new UUID to the input struct. This query ensures the caller
	// sees the true persisted state.
	var result model.RefreshToken
	if err := db.Where("user_id = ? AND device_type = ? AND device_id = ?",
		rt.UserID, rt.DeviceType, rt.DeviceID).First(&result).Error; err != nil {
		return err
	}
	*rt = result
	return nil
}

func FindRefreshTokenByHash(db *gorm.DB, hash string) (*model.RefreshToken, error) {
	var rt model.RefreshToken
	err := db.Where("token_hash = ?", hash).First(&rt).Error
	if err != nil {
		return nil, err
	}
	return &rt, nil
}

func RevokeRefreshTokensByUserDevice(db *gorm.DB, userID, deviceID string) error {
	return db.Model(&model.RefreshToken{}).
		Where("user_id = ? AND device_id = ?", userID, deviceID).
		Update("revoked", true).Error
}

func RevokeAllUserTokens(db *gorm.DB, userID string) error {
	return db.Model(&model.RefreshToken{}).
		Where("user_id = ?", userID).
		Update("revoked", true).Error
}
