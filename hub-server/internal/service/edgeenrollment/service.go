// Package edgeenrollment owns one-time pairing and identity-bound opaque Edge
// credentials. These credentials are never Hub product sessions or Edge API JWTs.
package edgeenrollment

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base32"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"net/http"
	"path"
	"strings"
	"time"
	"unicode"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	EnrollmentTTL = 10 * time.Minute
	CredentialTTL = 7 * 24 * time.Hour
	HeartbeatTTL  = 90 * time.Second
)

var (
	ErrInvalid  = errcode.New("edge_enrollment_invalid", "enrollment is invalid or expired", http.StatusBadRequest)
	ErrConflict = errcode.New("edge_enrollment_conflict", "enrollment or device is already bound", http.StatusConflict)
)

type Service struct {
	db       *gorm.DB
	clientID string
	now      func() time.Time
}

func New(db *gorm.DB, currentOIDCClientID string) *Service {
	return &Service{db: db, clientID: currentOIDCClientID, now: func() time.Time { return time.Now().UTC() }}
}

type StartInput struct {
	DeviceID      string `json:"device_id"`
	Name          string `json:"name"`
	RuntimeID     string `json:"runtime_id"`
	WorkspaceRoot string `json:"workspace_root"`
}

type StartResult struct {
	EnrollmentID string    `json:"enrollment_id"`
	UserCode     string    `json:"user_code"`
	PollSecret   string    `json:"poll_secret"`
	ExpiresAt    time.Time `json:"expires_at"`
}

type Authorizer struct {
	UserID       string `json:"user_id"`
	IdentityID   string `json:"identity_id"`
	Generation   int64  `json:"generation"`
	OIDCClientID string `json:"oidc_client_id"`
}

type EnrollmentSummary struct {
	EnrollmentID  string    `json:"enrollment_id"`
	DeviceID      string    `json:"device_id"`
	Name          string    `json:"name"`
	RuntimeID     string    `json:"runtime_id"`
	WorkspaceRoot string    `json:"workspace_root"`
	Status        string    `json:"status"`
	ExpiresAt     time.Time `json:"expires_at"`
}

type ExchangeResult struct {
	Status        string    `json:"status"`
	DeviceID      string    `json:"device_id,omitempty"`
	TargetID      string    `json:"target_id,omitempty"`
	Credential    string    `json:"credential,omitempty"`
	ExpiresAt     time.Time `json:"expires_at"`
	RuntimeID     string    `json:"runtime_id,omitempty"`
	WorkspaceRoot string    `json:"workspace_root,omitempty"`
}

type Principal struct {
	DeviceID       string    `json:"device_id"`
	UserID         string    `json:"user_id"`
	IdentityID     string    `json:"identity_id"`
	Generation     int64     `json:"generation"`
	OIDCClientID   string    `json:"oidc_client_id"`
	TargetID       string    `json:"target_id"`
	RuntimeID      string    `json:"runtime_id"`
	WorkspaceRoot  string    `json:"workspace_root"`
	ExpiresAt      time.Time `json:"expires_at"`
	CredentialHash string    `json:"-"`
}

func digest(secret string) string {
	hash := sha256.Sum256([]byte(secret))
	return hex.EncodeToString(hash[:])
}

func secret() (string, error) {
	var b [32]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b[:]), nil
}

func validSecret(value string) bool {
	if len(value) != 43 {
		return false
	}
	b, err := base64.RawURLEncoding.DecodeString(value)
	return err == nil && len(b) == 32 && base64.RawURLEncoding.EncodeToString(b) == value
}

func normalizeCode(value string) (string, error) {
	value = strings.ToUpper(strings.TrimSpace(value))
	if len(value) == 11 && value[5] == '-' {
		value = value[:5] + value[6:]
	}
	if len(value) != 10 {
		return "", ErrInvalid
	}
	for _, c := range value {
		if !(c >= 'A' && c <= 'Z' || c >= '2' && c <= '7') {
			return "", ErrInvalid
		}
	}
	return value, nil
}

func validID(value string) bool {
	id, err := uuid.Parse(value)
	return err == nil && id != uuid.Nil && id.String() == value
}

func validInput(in StartInput) bool {
	return validID(in.DeviceID) && in.RuntimeID == "openai-sdk" && len(in.Name) > 0 && len(in.Name) <= 128 &&
		strings.TrimSpace(in.Name) == in.Name && strings.IndexFunc(in.Name, unicode.IsControl) < 0 &&
		len(in.WorkspaceRoot) > 1 && len(in.WorkspaceRoot) <= 512 && path.IsAbs(in.WorkspaceRoot) &&
		path.Clean(in.WorkspaceRoot) == in.WorkspaceRoot && !strings.Contains(in.WorkspaceRoot, "\\") &&
		strings.IndexFunc(in.WorkspaceRoot, unicode.IsControl) < 0
}

func (s *Service) Start(ctx context.Context, in StartInput) (*StartResult, error) {
	if s.clientID == "" {
		return nil, errcode.AuthUnavailable
	}
	if !validInput(in) {
		return nil, ErrInvalid
	}
	poll, err := secret()
	if err != nil {
		return nil, errcode.AuthUnavailable
	}
	var codeBytes [7]byte
	if _, err := rand.Read(codeBytes[:]); err != nil {
		return nil, errcode.AuthUnavailable
	}
	code := base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(codeBytes[:])[:10]
	now := s.now()
	row := model.EdgeEnrollment{ID: uuid.NewString(), DeviceID: in.DeviceID, Name: in.Name, RuntimeID: in.RuntimeID,
		WorkspaceRoot: in.WorkspaceRoot, UserCodeHash: digest(code), PollSecretHash: digest(poll), CreatedAt: now, ExpiresAt: now.Add(EnrollmentTTL)}
	if err := s.db.WithContext(ctx).Create(&row).Error; err != nil {
		return nil, errcode.AuthUnavailable
	}
	return &StartResult{EnrollmentID: row.ID, UserCode: code[:5] + "-" + code[5:], PollSecret: poll, ExpiresAt: row.ExpiresAt}, nil
}

func summary(row model.EdgeEnrollment) *EnrollmentSummary {
	status := "pending"
	if row.ConfirmedAt != nil {
		status = "confirmed"
	}
	return &EnrollmentSummary{EnrollmentID: row.ID, DeviceID: row.DeviceID, Name: row.Name, RuntimeID: row.RuntimeID,
		WorkspaceRoot: row.WorkspaceRoot, Status: status, ExpiresAt: row.ExpiresAt}
}

// Preview must be exposed only to an authenticated Hub user. It deliberately
// returns neither the confirming account nor any authentication material.
func (s *Service) Preview(ctx context.Context, userCode string) (*EnrollmentSummary, error) {
	code, err := normalizeCode(userCode)
	if err != nil {
		return nil, err
	}
	var row model.EdgeEnrollment
	if err := s.db.WithContext(ctx).Where("user_code_hash = ? AND expires_at > ? AND exchanged_at IS NULL", digest(code), s.now()).Take(&row).Error; err != nil {
		return nil, storageError(err)
	}
	return summary(row), nil
}

func storageError(err error) error {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return ErrInvalid
	}
	var domain *errcode.Error
	if errors.As(err, &domain) {
		return err
	}
	return errcode.AuthUnavailable
}

func (s *Service) Confirm(ctx context.Context, auth Authorizer, userCode string) (*EnrollmentSummary, error) {
	code, err := normalizeCode(userCode)
	if err != nil {
		return nil, err
	}
	var row model.EdgeEnrollment
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("user_code_hash = ?", digest(code)).Take(&row).Error; err != nil {
			return err
		}
		if !row.ExpiresAt.After(s.now()) || row.ExchangedAt != nil {
			return ErrInvalid
		}
		if err := s.checkIdentity(tx, auth, true); err != nil {
			return err
		}
		if !row.ExpiresAt.After(s.now()) {
			return ErrInvalid
		}
		if row.ConfirmedAt != nil {
			return ErrConflict
		}
		var device model.Device
		err := tx.Where("id = ?", row.DeviceID).Take(&device).Error
		if err == nil && (device.UserID != auth.UserID || device.DeviceType != "edge") {
			return ErrConflict
		}
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		now := s.now()
		if !row.ExpiresAt.After(now) {
			return ErrInvalid
		}
		row.UserID, row.UserIdentityID, row.OIDCClientID = &auth.UserID, &auth.IdentityID, auth.OIDCClientID
		row.Generation, row.ConfirmedAt = auth.Generation, &now
		return tx.Save(&row).Error
	})
	if err != nil {
		return nil, storageError(err)
	}
	return summary(row), nil
}
