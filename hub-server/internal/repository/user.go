package repository

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"
	"time"

	"github.com/agenthub/hub-server/internal/model"
	"gorm.io/gorm"
)

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

func UpdatePassword(db *gorm.DB, userID string, passwordHash string) error {
	return db.Model(&model.User{}).Where("id = ?", userID).Update("password_hash", passwordHash).Error
}

// UpdatePasswordAndRevokeTokens atomically updates the user's password hash and
// revokes all their refresh tokens within a single transaction.
func UpdatePasswordAndRevokeTokens(db *gorm.DB, userID, passwordHash string) error {
	return db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&model.User{}).Where("id = ?", userID).Update("password_hash", passwordHash).Error; err != nil {
			return err
		}
		return tx.Model(&model.RefreshToken{}).Where("user_id = ?", userID).Update("revoked", true).Error
	})
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

// FindByTokenDanceSub looks up a user by their TokenDance ID subject claim.
func FindByTokenDanceSub(db *gorm.DB, sub string) (*model.User, error) {
	var user model.User
	err := db.Where("tokendance_sub = ?", sub).First(&user).Error
	if err != nil {
		return nil, err
	}
	return &user, nil
}

// FindOrCreateByTokenDanceSub looks up an existing user by TokenDance ID sub,
// or creates a new Hub user account linked to the sub on first login.
func FindOrCreateByTokenDanceSub(db *gorm.DB, sub string) (*model.User, error) {
	// Try to find existing user
	user, err := FindByTokenDanceSub(db, sub)
	if err == nil {
		return user, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}

	// First login — auto-create a Hub user linked to this TokenDance ID sub.
	// Username is derived from a readable prefix plus a hash suffix so long
	// TokenDance subjects cannot collide after truncation.
	username := tokenDanceUsername(sub)
	now := time.Now()
	user = &model.User{
		Username:              username,
		Nickname:              tokenDanceNickname(sub), // can be changed later
		TokenDanceSub:         &sub,
		TokenDanceSubLinkedAt: &now,
	}
	if err := CreateUser(db, user); err != nil {
		return nil, err
	}
	return user, nil
}

func tokenDanceUsername(sub string) string {
	hash := sha256.Sum256([]byte(sub))
	suffix := hex.EncodeToString(hash[:])[:10]

	const (
		prefix       = "td_"
		maxUsername  = 32
		separatorLen = 1
	)
	maxBaseLen := maxUsername - len(prefix) - separatorLen - len(suffix)
	base := sanitizeUsernamePart(sub)
	if len(base) > maxBaseLen {
		base = base[:maxBaseLen]
	}
	base = strings.Trim(base, "_")
	if base == "" {
		base = "user"
	}
	return prefix + base + "_" + suffix
}

func sanitizeUsernamePart(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	var b strings.Builder
	b.Grow(len(value))
	lastUnderscore := false
	for _, r := range value {
		allowed := (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9')
		if allowed {
			b.WriteRune(r)
			lastUnderscore = false
			continue
		}
		if !lastUnderscore {
			b.WriteByte('_')
			lastUnderscore = true
		}
	}
	return b.String()
}

func tokenDanceNickname(sub string) string {
	value := strings.TrimSpace(sub)
	if value == "" {
		return "TokenDance User"
	}
	runes := []rune(value)
	if len(runes) <= 64 {
		return value
	}
	return string(runes[:64])
}
