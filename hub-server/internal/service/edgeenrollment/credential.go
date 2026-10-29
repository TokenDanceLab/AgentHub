package edgeenrollment

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"time"

	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// checkIdentity follows the identity -> subject epoch lock order used by
// Account logout. Holding those locks until issuance commits prevents a stale
// browser authorization from minting a credential after logout has committed.
func (s *Service) checkIdentity(tx *gorm.DB, auth Authorizer, lock bool) error {
	if s.clientID == "" || auth.OIDCClientID != s.clientID || auth.Generation < 0 || !validID(auth.UserID) || !validID(auth.IdentityID) {
		return errcode.AuthInvalidToken
	}
	var identity model.UserIdentity
	query := tx.Where("id = ? AND user_id = ? AND provider = ? AND status = ?", auth.IdentityID, auth.UserID, model.IdentityProviderAccount, model.IdentityStatusActive)
	if lock {
		query = query.Clauses(clause.Locking{Strength: "UPDATE"})
	}
	if err := query.Take(&identity).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return errcode.AuthInvalidToken
		}
		return err
	}
	var epoch model.OIDCSubjectEpoch
	query = tx.Where("issuer = ? AND subject = ?", identity.Issuer, identity.Subject)
	if lock {
		query = query.Clauses(clause.Locking{Strength: "UPDATE"})
	}
	if err := query.Take(&epoch).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return errcode.AuthInvalidToken
		}
		return err
	}
	if epoch.Generation != auth.Generation {
		return errcode.AuthInvalidToken
	}
	var user model.User
	if err := tx.Select("id").Where("id = ?", auth.UserID).Take(&user).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return errcode.AuthInvalidToken
		}
		return err
	}
	return nil
}

func (s *Service) Exchange(ctx context.Context, enrollmentID, pollSecret string) (*ExchangeResult, error) {
	if !validID(enrollmentID) || !validSecret(pollSecret) {
		return nil, ErrInvalid
	}
	var result ExchangeResult
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var row model.EdgeEnrollment
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", enrollmentID).Take(&row).Error; err != nil {
			return err
		}
		if subtle.ConstantTimeCompare([]byte(row.PollSecretHash), []byte(digest(pollSecret))) != 1 || !row.ExpiresAt.After(s.now()) || row.ExchangedAt != nil {
			return ErrInvalid
		}
		if row.ConfirmedAt == nil {
			result = ExchangeResult{Status: "pending", ExpiresAt: row.ExpiresAt}
			return nil
		}
		if row.UserID == nil || row.UserIdentityID == nil {
			return ErrInvalid
		}
		auth := Authorizer{UserID: *row.UserID, IdentityID: *row.UserIdentityID, Generation: row.Generation, OIDCClientID: row.OIDCClientID}
		if err := s.checkIdentity(tx, auth, true); err != nil {
			return err
		}
		if err := lockOwnerAndCheckDeviceQuota(tx, auth.UserID, row.DeviceID); err != nil {
			return err
		}
		now := s.now()
		// ON CONFLICT plus the subsequent lock serializes even the first claim
		// from different enrollments of the same previously unknown device.
		device := model.Device{ID: row.DeviceID, UserID: auth.UserID, DeviceType: deviceType, Capabilities: `[]`, LastActiveAt: now}
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&device).Error; err != nil {
			return err
		}
		device = model.Device{}
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", row.DeviceID).Take(&device).Error; err != nil {
			return err
		}
		if device.UserID != auth.UserID || device.DeviceType != deviceType {
			return ErrConflict
		}
		target, err := pairedTarget(tx, row, auth.UserID)
		if err != nil {
			return err
		}
		// Locks can wait across the enrollment deadline; measure again at
		// issuance instead of relying on the pre-lock admission timestamp.
		now = s.now()
		if !row.ExpiresAt.After(now) {
			return ErrInvalid
		}
		token, err := secret()
		if err != nil {
			return err
		}
		credential := model.EdgeDeviceCredential{DeviceID: row.DeviceID, TargetID: target.ID, UserID: auth.UserID,
			UserIdentityID: auth.IdentityID, OIDCClientID: auth.OIDCClientID, Generation: auth.Generation,
			CredentialHash: digest(token), RuntimeID: row.RuntimeID, WorkspaceRoot: row.WorkspaceRoot,
			CreatedAt: now, ExpiresAt: now.Add(CredentialTTL)}
		if err := tx.Save(&credential).Error; err != nil {
			return err
		}
		row.ExchangedAt = &now
		if err := tx.Save(&row).Error; err != nil {
			return err
		}
		result = ExchangeResult{Status: "enrolled", DeviceID: row.DeviceID, TargetID: target.ID, Credential: token,
			ExpiresAt: credential.ExpiresAt, RuntimeID: row.RuntimeID, WorkspaceRoot: row.WorkspaceRoot}
		return nil
	})
	if err != nil {
		if repository.IsUniqueViolation(err) {
			return nil, ErrConflict
		}
		return nil, storageError(err)
	}
	return &result, nil
}

func lockOwnerAndCheckDeviceQuota(tx *gorm.DB, userID, deviceID string) error {
	// This also serializes different Account identities bound to the same
	// owner. NO KEY UPDATE permits unrelated device/task foreign-key KEY SHARE
	// checks, avoiding an owner/device inversion with in-flight task writes.
	if err := repository.LockDeviceOwner(tx, userID); err != nil {
		return err
	}
	limit := config.MaxCloudEdgeDevicesPerUser()
	if limit <= 0 {
		return nil
	}
	exists, err := repository.DeviceExistsForUser(tx, deviceID, userID, deviceType)
	if err != nil || exists {
		return err
	}
	count, err := repository.CountDevicesByUserAndType(tx, userID, deviceType)
	if err != nil {
		return err
	}
	if count >= int64(limit) {
		return errcode.DeviceLimitExceeded
	}
	return nil
}

func pairedTarget(tx *gorm.DB, enrollment model.EdgeEnrollment, userID string) (*model.ExecutionTarget, error) {
	var existing model.EdgeDeviceCredential
	err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("device_id = ?", enrollment.DeviceID).Take(&existing).Error
	if err == nil {
		if existing.UserID != userID || existing.RuntimeID != enrollment.RuntimeID || existing.WorkspaceRoot != enrollment.WorkspaceRoot {
			return nil, ErrConflict
		}
		// A confirmation made before the last issuance/revocation cannot
		// resurrect or replace that credential. Re-enrollment needs a fresh
		// explicit user confirmation after the most recent credential event.
		if enrollment.ConfirmedAt == nil || !enrollment.ConfirmedAt.After(existing.CreatedAt) ||
			(existing.RevokedAt != nil && !enrollment.ConfirmedAt.After(*existing.RevokedAt)) {
			return nil, ErrConflict
		}
		var target model.ExecutionTarget
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ? AND owner_id = ? AND device_id = ? AND target_type = 'cloud_edge' AND deleted_at IS NULL", existing.TargetID, userID, enrollment.DeviceID).Take(&target).Error; err != nil {
			return nil, err
		}
		if target.WorkspaceRoot != enrollment.WorkspaceRoot {
			return nil, ErrConflict
		}
		return &target, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	allowlist, err := json.Marshal([]string{enrollment.WorkspaceRoot})
	if err != nil {
		return nil, err
	}
	target := model.ExecutionTarget{OwnerID: userID, DeviceID: &enrollment.DeviceID, Name: enrollment.Name,
		TargetType: "cloud_edge", WorkspaceRoot: enrollment.WorkspaceRoot, WorkspaceAllowlist: string(allowlist),
		TrustLevel: "cloud", HealthState: "unknown", AuthMethod: "none",
		Capabilities: `{"pairedDevice":true,"runtimeId":"openai-sdk","multiTurn":true,"toolExecution":false}`,
		Metadata:     `{"pairedDevice":true,"runtimeId":"openai-sdk"}`}
	if err := tx.Create(&target).Error; err != nil {
		return nil, err
	}
	return &target, nil
}

func principal(row model.EdgeDeviceCredential) *Principal {
	return &Principal{DeviceID: row.DeviceID, UserID: row.UserID, IdentityID: row.UserIdentityID, Generation: row.Generation,
		OIDCClientID: row.OIDCClientID, TargetID: row.TargetID, RuntimeID: row.RuntimeID, WorkspaceRoot: row.WorkspaceRoot,
		ExpiresAt: row.ExpiresAt, CredentialHash: row.CredentialHash}
}

func (s *Service) activeCredential(tx *gorm.DB, hash string) (*model.EdgeDeviceCredential, error) {
	if s.clientID == "" || len(hash) != 64 {
		return nil, errcode.AuthInvalidToken
	}
	var row model.EdgeDeviceCredential
	err := tx.Table("edge_device_credentials AS c").Select("c.*").
		Joins("JOIN users AS u ON u.id = c.user_id").
		Joins("JOIN user_identities AS i ON i.id = c.user_identity_id AND i.user_id = c.user_id").
		Joins("JOIN oidc_subject_epochs AS e ON e.issuer = i.issuer AND e.subject = i.subject").
		Joins("JOIN devices AS d ON d.id = c.device_id AND d.user_id = c.user_id").
		Joins("JOIN execution_targets AS t ON t.id = c.target_id AND t.owner_id = c.user_id AND t.device_id = c.device_id").
		Where("c.credential_hash = ? AND c.revoked_at IS NULL AND c.expires_at > ? AND c.oidc_client_id = ?", hash, s.now(), s.clientID).
		Where("i.provider = 'account' AND i.status = 'active' AND e.generation = c.generation AND d.device_type = ?", deviceType).
		Where("t.deleted_at IS NULL AND t.target_type = 'cloud_edge' AND t.workspace_root = c.workspace_root AND c.runtime_id = 'openai-sdk'").Take(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, errcode.AuthInvalidToken
	}
	return &row, err
}

func (s *Service) Authenticate(ctx context.Context, credential string) (*Principal, error) {
	if !validSecret(credential) {
		return nil, errcode.AuthInvalidToken
	}
	row, err := s.activeCredential(s.db.WithContext(ctx), digest(credential))
	if err != nil {
		return nil, storageError(err)
	}
	return principal(*row), nil
}

// ValidatePrincipal repeats the durable check during long polls and before
// delivery. A credential rotation also invalidates an already loaded principal.
func (s *Service) ValidatePrincipal(ctx context.Context, p *Principal) error {
	return s.validatePrincipal(s.db.WithContext(ctx), p)
}

// ValidatePrincipalTx serializes a protected write with Account logout,
// credential rotation and device revocation. The caller must supply an active
// transaction and call this before acquiring any task/outbox/target row locks.
// Identity -> epoch -> device is also the issuance/heartbeat lock order.
func (s *Service) ValidatePrincipalTx(tx *gorm.DB, p *Principal) error {
	if p == nil {
		return errcode.AuthInvalidToken
	}
	if err := s.checkIdentity(tx, Authorizer{UserID: p.UserID, IdentityID: p.IdentityID, Generation: p.Generation, OIDCClientID: p.OIDCClientID}, true); err != nil {
		return storageError(err)
	}
	var device model.Device
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", p.DeviceID).Take(&device).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return errcode.AuthInvalidToken
		}
		return storageError(err)
	}
	return s.validatePrincipal(tx, p)
}

func (s *Service) validatePrincipal(tx *gorm.DB, p *Principal) error {
	if p == nil {
		return errcode.AuthInvalidToken
	}
	row, err := s.activeCredential(tx, p.CredentialHash)
	if err != nil {
		return storageError(err)
	}
	if p.DeviceID != row.DeviceID || p.UserID != row.UserID || p.IdentityID != row.UserIdentityID || p.Generation != row.Generation ||
		p.OIDCClientID != row.OIDCClientID || p.TargetID != row.TargetID || p.RuntimeID != row.RuntimeID ||
		p.WorkspaceRoot != row.WorkspaceRoot || !p.ExpiresAt.Equal(row.ExpiresAt) {
		return errcode.AuthInvalidToken
	}
	return nil
}

func (s *Service) Heartbeat(ctx context.Context, p *Principal) error {
	if p == nil {
		return errcode.AuthInvalidToken
	}
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := s.ValidatePrincipalTx(tx, p); err != nil {
			return err
		}
		now := s.now()
		if err := tx.Model(&model.Device{}).Where("id = ?", p.DeviceID).Update("last_active_at", now).Error; err != nil {
			return err
		}
		return writeHealth(tx, p.TargetID, p.DeviceID, p.UserID, "online", now)
	})
	if err != nil {
		return storageError(err)
	}
	return nil
}

func (s *Service) Revoke(ctx context.Context, userID, deviceID string) error {
	if !validID(userID) || !validID(deviceID) {
		return ErrInvalid
	}
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var device model.Device
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ? AND user_id = ? AND device_type = ?", deviceID, userID, deviceType).Take(&device).Error; err != nil {
			return err
		}
		var credential model.EdgeDeviceCredential
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("device_id = ? AND user_id = ?", deviceID, userID).Take(&credential).Error; err != nil {
			return err
		}
		now := s.now()
		if credential.RevokedAt == nil {
			if err := tx.Model(&credential).Update("revoked_at", now).Error; err != nil {
				return err
			}
		}
		return writeHealth(tx, credential.TargetID, deviceID, userID, "offline", now)
	})
	if err != nil {
		return storageError(err)
	}
	return nil
}

func writeHealth(tx *gorm.DB, targetID, deviceID, userID, status string, now time.Time) error {
	expires := now.Add(HeartbeatTTL)
	evidence := model.ExecutionTargetEvidence{TargetID: targetID, Source: "paired_device", Status: status,
		ObservedTargetID: targetID, RouteKey: userID + ":edge:" + deviceID, ObservedAt: now, ExpiresAt: &expires}
	if err := repository.UpsertExecutionTargetEvidence(tx, &evidence); err != nil {
		return err
	}
	return tx.Model(&model.ExecutionTarget{}).Where("id = ? AND owner_id = ? AND device_id = ?", targetID, userID, deviceID).
		Updates(map[string]any{"health_state": status, "is_online": status == "online", "last_seen_at": now}).Error
}
