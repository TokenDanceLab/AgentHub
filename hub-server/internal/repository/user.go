package repository

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/url"
	"strings"
	"time"

	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/uuidv7"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// ErrOIDCIdentityRetired means the exact (issuer, subject) binding exists but
// is intentionally no longer usable for authentication.
var ErrOIDCIdentityRetired = errors.New("oidc identity is retired")

var errAccountIdentityConflict = errors.New("account identity was created concurrently")

// AccountSessionInput describes the local state that must be committed
// together for an Account login. The raw refresh token never enters the
// repository; only its hash is persisted.
type AccountSessionInput struct {
	Issuer           string
	Subject          string
	Name             string
	Picture          string
	DeviceType       string
	DeviceID         string
	RefreshTokenHash string
	RefreshExpiresAt time.Time
}

func CreateUser(db *gorm.DB, user *model.User) error {
	return db.Create(user).Error
}

func GetUserByID(db *gorm.DB, id string) (*model.User, error) {
	var user model.User
	err := db.Where("id = ?", id).First(&user).Error
	if err != nil {
		return nil, err
	}
	return &user, nil
}

func GetUserByUsername(db *gorm.DB, username string) (*model.User, error) {
	var user model.User
	err := db.Where("username = ?", username).First(&user).Error
	if err != nil {
		return nil, err
	}
	return &user, nil
}

func UpdateUser(db *gorm.DB, user *model.User) error {
	return db.Save(user).Error
}

// GetUsersByIDs returns a map of user ID → *User for the given IDs.
func GetUsersByIDs(db *gorm.DB, ids []string) (map[string]*model.User, error) {
	if len(ids) == 0 {
		return map[string]*model.User{}, nil
	}
	var users []model.User
	if err := db.Where("id IN ?", ids).Find(&users).Error; err != nil {
		return nil, err
	}
	m := make(map[string]*model.User, len(users))
	for i := range users {
		m[users[i].ID] = &users[i]
	}
	return m, nil
}

// FindOrCreateByAccountIdentity maps the exact Account (issuer, subject) pair
// to a Hub-local user. It never matches by email, nickname or a legacy
// tokendance_sub. Account profile fields initialize a new local user only;
// later logins do not overwrite local profile edits.
func FindOrCreateByAccountIdentity(db *gorm.DB, issuer, subject, name, picture string) (*model.User, error) {
	var user *model.User
	err := db.Transaction(func(tx *gorm.DB) error {
		var err error
		user, _, err = findOrCreateAccountIdentityTx(tx, issuer, subject, name, picture)
		return err
	})
	if errors.Is(err, errAccountIdentityConflict) {
		_, existing, findErr := findAccountIdentityUser(db, issuer, subject)
		if findErr != nil {
			return nil, findErr
		}
		return existing, nil
	}
	if errors.Is(err, ErrOIDCIdentityRetired) {
		if revokeErr := RevokeRefreshTokensForRetiredIdentity(db, issuer, subject); revokeErr != nil {
			return nil, revokeErr
		}
	}
	if err != nil {
		return nil, err
	}
	return user, nil
}

// FindOrCreateAccountSession atomically binds the exact Account identity,
// registers the device and stores the refresh token. A concurrent first login
// rolls back its losing transaction and retries against the winning identity.
func FindOrCreateAccountSession(db *gorm.DB, in AccountSessionInput) (*model.User, error) {
	if in.RefreshTokenHash == "" || in.RefreshExpiresAt.IsZero() {
		return nil, errors.New("refresh token hash and expiry are required")
	}
	for attempt := 0; attempt < 2; attempt++ {
		var user *model.User
		err := db.Transaction(func(tx *gorm.DB) error {
			var err error
			var identity *model.UserIdentity
			user, identity, err = findOrCreateAccountIdentityTx(tx, in.Issuer, in.Subject, in.Name, in.Picture)
			if err != nil {
				return err
			}
			if err := UpsertDevice(tx, &model.Device{
				ID:           in.DeviceID,
				UserID:       user.ID,
				DeviceType:   in.DeviceType,
				Capabilities: "[]",
			}); err != nil {
				return err
			}
			return UpsertRefreshToken(tx, &model.RefreshToken{
				UserID:         user.ID,
				DeviceType:     in.DeviceType,
				DeviceID:       in.DeviceID,
				UserIdentityID: &identity.ID,
				TokenHash:      in.RefreshTokenHash,
				ExpiresAt:      in.RefreshExpiresAt,
			})
		})
		if err == nil {
			return user, nil
		}
		if errors.Is(err, ErrOIDCIdentityRetired) {
			if revokeErr := RevokeRefreshTokensForRetiredIdentity(db, in.Issuer, in.Subject); revokeErr != nil {
				return nil, revokeErr
			}
			return nil, ErrOIDCIdentityRetired
		}
		if !errors.Is(err, errAccountIdentityConflict) {
			return nil, err
		}
	}
	return nil, errAccountIdentityConflict
}

func findOrCreateAccountIdentityTx(
	db *gorm.DB,
	issuer, subject, name, picture string,
) (*model.User, *model.UserIdentity, error) {
	if issuer == "" || subject == "" {
		return nil, nil, errors.New("issuer and subject are required")
	}
	if err := lockAccountIdentity(db, issuer, subject); err != nil {
		return nil, nil, err
	}
	if identity, user, err := findAccountIdentityUser(db, issuer, subject); err == nil {
		return user, identity, nil
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil, err
	}

	now := time.Now().UTC()
	candidateID, err := uuidv7.New()
	if err != nil {
		return nil, nil, err
	}
	user := &model.User{
		ID:        candidateID,
		Username:  accountUsername(candidateID),
		Nickname:  accountDisplayName(name),
		AvatarURL: accountProfilePicture(picture),
	}
	if err := db.Create(user).Error; err != nil {
		return nil, nil, err
	}
	identity := &model.UserIdentity{
		UserID:   user.ID,
		Provider: model.IdentityProviderAccount,
		Issuer:   issuer,
		Subject:  subject,
		Status:   model.IdentityStatusActive,
		LinkedAt: now,
	}
	result := db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "issuer"}, {Name: "subject"}},
		DoNothing: true,
	}).Create(identity)
	if result.Error != nil {
		return nil, nil, result.Error
	}
	if result.RowsAffected == 0 {
		// Another first login won the unique race. The caller rolls back this
		// transaction, including the unbound candidate user, before retrying.
		return nil, nil, errAccountIdentityConflict
	}
	return user, identity, nil
}

func lockAccountIdentity(db *gorm.DB, issuer, subject string) error {
	if db.Name() != "postgres" {
		return nil
	}
	ctx := db.Statement.Context
	if ctx == nil {
		ctx = context.Background()
	}
	const query = "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))"
	key := issuer + "\n" + subject
	var err error
	switch conn := db.Statement.ConnPool.(type) {
	case *gorm.PreparedStmtTX:
		_, err = conn.Tx.ExecContext(ctx, query, key)
	case gorm.Tx:
		_, err = conn.ExecContext(ctx, query, key)
	default:
		err = errors.New("account identity lock requires a transaction")
	}
	return err
}

func findAccountIdentityUser(db *gorm.DB, issuer, subject string) (*model.UserIdentity, *model.User, error) {
	var identity model.UserIdentity
	if err := db.Where("issuer = ? AND subject = ?", issuer, subject).First(&identity).Error; err != nil {
		return nil, nil, err
	}
	if identity.Status != model.IdentityStatusActive {
		return nil, nil, ErrOIDCIdentityRetired
	}
	user, err := GetUserByID(db, identity.UserID)
	if err != nil {
		return nil, nil, err
	}
	return &identity, user, nil
}

func accountDisplayName(name string) string {
	name = strings.TrimSpace(name)
	if name == "" {
		name = "Account User"
	}
	return truncateRunes(name, 64)
}

func accountProfilePicture(picture string) string {
	picture = strings.TrimSpace(picture)
	if picture == "" || len([]rune(picture)) > 512 {
		return ""
	}
	parsed, err := url.Parse(picture)
	if err != nil || parsed.User != nil || parsed.Host == "" ||
		(parsed.Scheme != "http" && parsed.Scheme != "https") {
		return ""
	}
	return picture
}

func truncateRunes(value string, max int) string {
	runes := []rune(value)
	if len(runes) <= max {
		return value
	}
	return string(runes[:max])
}

func accountUsername(candidateID string) string {
	hash := sha256.Sum256([]byte(candidateID))
	return "acct_" + hex.EncodeToString(hash[:])[:12]
}
