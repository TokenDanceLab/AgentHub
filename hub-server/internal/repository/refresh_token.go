package repository

import (
	"errors"
	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/model"
)

func UpsertRefreshToken(db *gorm.DB, rt *model.RefreshToken) error {
	var existing model.RefreshToken
	err := db.Where("user_id = ? AND device_type = ? AND device_id = ?",
		rt.UserID, rt.DeviceType, rt.DeviceID).First(&existing).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return db.Create(rt).Error
	}
	if err != nil {
		return err
	}
	rt.ID = existing.ID
	return db.Save(rt).Error
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
