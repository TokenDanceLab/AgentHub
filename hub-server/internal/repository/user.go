package repository

import (
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
