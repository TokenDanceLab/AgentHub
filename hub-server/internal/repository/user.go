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
