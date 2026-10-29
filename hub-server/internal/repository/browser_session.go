package repository

import (
	"errors"
	"time"

	"github.com/agenthub/hub-server/internal/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var ErrSessionRevoked = errors.New("session has been revoked")
var ErrLogoutJTIReuse = errors.New("logout jti claims changed")

// LockSubjectEpoch is called after the identity row lock, if an identity
// exists. The unique row also serializes first-login/logout for unknown users.
func LockSubjectEpoch(tx *gorm.DB, issuer, subject string) (*model.OIDCSubjectEpoch, error) {
	epoch := model.OIDCSubjectEpoch{Issuer: issuer, Subject: subject}
	if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&epoch).Error; err != nil {
		return nil, err
	}
	epoch = model.OIDCSubjectEpoch{}
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("issuer = ? AND subject = ?", issuer, subject).First(&epoch).Error; err != nil {
		return nil, err
	}
	return &epoch, nil
}

type BoundAccountSessionInput struct {
	AccountSessionInput
	ProofIssuedAt int64
	Browser       *model.BrowserSession
}

type BoundAccountSession struct {
	User       *model.User
	IdentityID string
	Generation int64
}

// CreateBoundAccountSession commits identity, epoch, device and either browser
// credential or native refresh together. Account proof checked before logout
// cannot mint a fresh session after that logout has committed.
func CreateBoundAccountSession(db *gorm.DB, in BoundAccountSessionInput) (*BoundAccountSession, error) {
	result := &BoundAccountSession{}
	err := db.Transaction(func(tx *gorm.DB) error {
		user, identity, err := findOrCreateAccountIdentityTx(tx, in.Issuer, in.Subject, in.Name, in.Picture)
		if err != nil {
			return err
		}
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ? AND status = 'active'", identity.ID).First(identity).Error; err != nil {
			return err
		}
		epoch, err := LockSubjectEpoch(tx, in.Issuer, in.Subject)
		if err != nil {
			return err
		}
		if in.ProofIssuedAt <= 0 || (epoch.LastLogoutIAT > 0 && in.ProofIssuedAt <= epoch.LastLogoutIAT) {
			return ErrSessionRevoked
		}
		if err := UpsertDevice(tx, &model.Device{ID: in.DeviceID, UserID: user.ID, DeviceType: in.DeviceType, Capabilities: "[]"}); err != nil {
			return err
		}
		if in.Browser != nil {
			in.Browser.UserID, in.Browser.UserIdentityID = user.ID, identity.ID
			in.Browser.OIDCClientID = in.OIDCClientID
			in.Browser.DeviceID, in.Browser.Generation = in.DeviceID, epoch.Generation
			if err := tx.Create(in.Browser).Error; err != nil {
				return err
			}
		} else {
			if in.RefreshTokenHash == "" || in.RefreshExpiresAt.IsZero() {
				return errors.New("refresh credential is required")
			}
			if err := UpsertRefreshToken(tx, &model.RefreshToken{UserID: user.ID, DeviceID: in.DeviceID, DeviceType: in.DeviceType, UserIdentityID: &identity.ID, OIDCClientID: in.OIDCClientID, TokenHash: in.RefreshTokenHash, ExpiresAt: in.RefreshExpiresAt}); err != nil {
				return err
			}
		}
		result.User, result.IdentityID, result.Generation = user, identity.ID, epoch.Generation
		return nil
	})
	if errors.Is(err, ErrOIDCIdentityRetired) {
		if revokeErr := RevokeRefreshTokensForRetiredIdentity(db, in.Issuer, in.Subject); revokeErr != nil {
			return nil, revokeErr
		}
	}
	return result, err
}

func CheckIdentityGeneration(db *gorm.DB, identityID, userID string, generation int64) (bool, error) {
	if identityID == "" || generation < 0 {
		return false, nil
	}
	var count int64
	err := db.Table("user_identities AS i").Joins("JOIN oidc_subject_epochs AS e ON e.issuer = i.issuer AND e.subject = i.subject").
		Where("i.id = ? AND i.user_id = ? AND i.status = 'active' AND e.generation = ?", identityID, userID, generation).Count(&count).Error
	return count == 1, err
}

func FindBrowserSession(db *gorm.DB, hash string, now time.Time) (*model.BrowserSession, error) {
	var session model.BrowserSession
	err := db.Table("browser_sessions AS b").Select("b.*").
		Joins("JOIN user_identities AS i ON i.id = b.user_identity_id AND i.user_id = b.user_id").
		Joins("JOIN oidc_subject_epochs AS e ON e.issuer = i.issuer AND e.subject = i.subject").
		Where("b.token_hash = ? AND b.revoked_at IS NULL AND b.expires_at > ? AND i.status = 'active' AND e.generation = b.generation", hash, now.UTC()).Take(&session).Error
	return &session, err
}

func RevokeBrowserSession(db *gorm.DB, hash string, now time.Time) error {
	return db.Model(&model.BrowserSession{}).Where("token_hash = ? AND revoked_at IS NULL", hash).Update("revoked_at", now).Error
}

// ApplyAccountLogout is one durable transaction. The issuer/JTI digest rejects
// claim substitution. Duplicates return the current generation so callers can
// retry live-socket invalidation after a lost response.
func ApplyAccountLogout(db *gorm.DB, issuer, subject, jti, claimsHash string, issuedAt int64, expiresAt time.Time) (string, int64, error) {
	var identityID string
	var generation int64
	err := db.Transaction(func(tx *gorm.DB) error {
		if err := lockAccountIdentity(tx, issuer, subject); err != nil {
			return err
		}
		var identity model.UserIdentity
		err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("issuer = ? AND subject = ?", issuer, subject).First(&identity).Error
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		identityID = identity.ID
		epoch, err := LockSubjectEpoch(tx, issuer, subject)
		if err != nil {
			return err
		}
		now := time.Now().UTC()
		event := model.OIDCLogoutEvent{Issuer: issuer, JTI: jti, ClaimsHash: claimsHash, ReceivedAt: now, ExpiresAt: expiresAt}
		insert := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&event)
		if insert.Error != nil {
			return insert.Error
		}
		if insert.RowsAffected == 0 {
			var existing model.OIDCLogoutEvent
			if err := tx.Where("issuer = ? AND jti = ?", issuer, jti).First(&existing).Error; err != nil {
				return err
			}
			if existing.ClaimsHash != claimsHash {
				return ErrLogoutJTIReuse
			}
			generation = epoch.Generation
			return nil
		}
		epoch.Generation++
		if issuedAt > epoch.LastLogoutIAT {
			epoch.LastLogoutIAT = issuedAt
		}
		if err := tx.Save(epoch).Error; err != nil {
			return err
		}
		generation = epoch.Generation
		if identityID != "" {
			if err := tx.Model(&model.RefreshToken{}).Where("user_identity_id = ?", identityID).Update("revoked", true).Error; err != nil {
				return err
			}
			if err := tx.Model(&model.BrowserSession{}).Where("user_identity_id = ? AND revoked_at IS NULL", identityID).Update("revoked_at", now).Error; err != nil {
				return err
			}
		}
		return nil
	})
	return identityID, generation, err
}
