package repository

import (
	"errors"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/agenthub/hub-server/internal/model"
)

// UpsertRefreshToken atomically creates or updates a refresh token keyed by
// (user_id, device_type, device_id). Uses a single INSERT … ON CONFLICT statement
// to avoid TOCTOU races when the same device logs in concurrently (#2102).
//
// After upsert, rt is populated with the actual database row (including the
// stable ID on update). Callers should not rely on rt.ID before this call.
func UpsertRefreshToken(db *gorm.DB, rt *model.RefreshToken) error {
	err := db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "user_id"}, {Name: "device_type"}, {Name: "device_id"}},
		DoUpdates: clause.AssignmentColumns([]string{"token_hash", "expires_at", "revoked", "user_identity_id"}),
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

// FindRefreshTokenForRotation only returns a token pinned to an active
// provider-neutral identity. Legacy NULL bindings and retired identities fail
// closed, so another active identity on the same Hub user cannot revive them.
func FindRefreshTokenForRotation(db *gorm.DB, hash string) (*model.RefreshToken, error) {
	var rt model.RefreshToken
	err := db.
		Where("token_hash = ?", hash).
		Where(`user_identity_id IN (
			SELECT id FROM user_identities WHERE status = 'active'
		)`).
		First(&rt).Error
	if err != nil {
		return nil, err
	}
	return &rt, nil
}

// LockActiveRefreshIdentity serializes refresh rotation against identity
// retirement until the enclosing transaction commits.
func LockActiveRefreshIdentity(db *gorm.DB, identityID string) (bool, error) {
	if identityID == "" {
		return false, nil
	}
	var identity model.UserIdentity
	err := db.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("id = ? AND status = 'active'", identityID).
		First(&identity).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, nil
}

// ClaimRefreshTokenForRotation atomically flips the presented token row from
// live to revoked and reports whether THIS caller won the claim
// (RowsAffected > 0). Concurrent presentations of the same hash race on this
// conditional UPDATE: exactly one winner proceeds with rotation; losers get
// false and must reject the presentation as token reuse (#2154). The claim
// precedes RevokeRefreshTokensByUserDevice/UpsertRefreshToken so the
// rotation window has no check-then-write gap.
func ClaimRefreshTokenForRotation(db *gorm.DB, tokenHash string) (bool, error) {
	result := db.Model(&model.RefreshToken{}).
		Where("token_hash = ? AND revoked = ?", tokenHash, false).
		Update("revoked", true)
	if result.Error != nil {
		return false, result.Error
	}
	return result.RowsAffected > 0, nil
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

// RevokeRefreshTokensForRetiredIdentity closes every existing Hub refresh
// session for a retired external binding. It is idempotent and never changes
// the identity history row.
func RevokeRefreshTokensForRetiredIdentity(db *gorm.DB, issuer, subject string) error {
	return db.Model(&model.RefreshToken{}).
		Where(`user_identity_id IN (
			SELECT id FROM user_identities
			WHERE issuer = ? AND subject = ? AND status = ?
		)`, issuer, subject, model.IdentityStatusRetired).
		Update("revoked", true).Error
}
