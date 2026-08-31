package repository

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"time"

	"github.com/agenthub/hub-server/internal/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
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

// FindOrCreateByTokenDanceSub atomically finds or creates a Hub user linked to
// a TokenDance ID sub. On conflict (existing user), nickname and avatar are
// refreshed from the provided claims. Uses a single INSERT … ON CONFLICT
// statement to avoid TOCTOU races on concurrent first-logins (#2102 F13).
func FindOrCreateByTokenDanceSub(db *gorm.DB, sub, name, picture string) (*model.User, error) {
	username := tokenDanceUsername(sub)
	now := time.Now()
	nickname := name
	if nickname == "" {
		nickname = tokenDanceNickname(sub)
	}

	user := &model.User{
		Username:              username,
		Nickname:              nickname,
		AvatarURL:             picture,
		TokenDanceSub:         &sub,
		TokenDanceSubLinkedAt: &now,
	}

	// Upsert: on conflict update nickname + avatar only when incoming values
	// are non-empty. We use COALESCE-like logic via SQL expressions so empty
	// claims don't wipe existing profile data.
	err := db.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "tokendance_sub"}},
		DoUpdates: clause.Assignments(map[string]interface{}{
			"nickname":   gorm.Expr("CASE WHEN ? <> '' THEN ? ELSE nickname END", name, name),
			"avatar_url": gorm.Expr("CASE WHEN ? <> '' THEN ? ELSE avatar_url END", picture, picture),
		}),
	}).Create(user).Error
	if err != nil {
		return nil, err
	}

	// After upsert, re-fetch to get the canonical row (ID, timestamps, and
	// any DB-applied defaults). This also ensures the returned struct reflects
	// the post-conflict state rather than the input struct.
	result, err := FindByTokenDanceSub(db, sub)
	if err != nil {
		return nil, err
	}
	return result, nil
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
