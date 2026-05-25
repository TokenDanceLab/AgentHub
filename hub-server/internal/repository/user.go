package repository

import (
	"errors"
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
	// Username is derived from the sub prefix; password is empty (user must use OIDC login).
	username := "td_" + sub
	if len(username) > 32 {
		username = username[:32]
	}
	now := time.Now()
	user = &model.User{
		Username:              username,
		Nickname:              sub, // can be changed later
		TokenDanceSub:         &sub,
		TokenDanceSubLinkedAt: &now,
	}
	if err := CreateUser(db, user); err != nil {
		return nil, err
	}
	return user, nil
}
