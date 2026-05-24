package repository

import (
	"errors"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/agenthub/hub-server/internal/model"
)

func CreateFriendship(db *gorm.DB, f *model.Friendship) error {
	return db.Create(f).Error
}

func GetFriendship(db *gorm.DB, userID, friendID string) (*model.Friendship, error) {
	var f model.Friendship
	err := db.Where("user_id = ? AND friend_id = ?", userID, friendID).First(&f).Error
	return &f, err
}

func GetFriendshipByID(db *gorm.DB, id string) (*model.Friendship, error) {
	var f model.Friendship
	err := db.Where("id = ?", id).First(&f).Error
	return &f, err
}

func UpdateFriendshipStatus(db *gorm.DB, userID, friendID, status string) error {
	return db.Model(&model.Friendship{}).
		Where("user_id = ? AND friend_id = ?", userID, friendID).
		Update("status", status).Error
}

func UpdateFriendshipByID(db *gorm.DB, id, status string) error {
	return db.Model(&model.Friendship{}).
		Where("id = ?", id).
		Update("status", status).Error
}

func UpdateFriendshipRemark(db *gorm.DB, userID, friendID, remark string) error {
	return db.Model(&model.Friendship{}).
		Where("user_id = ? AND friend_id = ? AND status = ?", userID, friendID, model.StatusAccepted).
		Update("remark", remark).Error
}

func DeleteFriendshipPair(db *gorm.DB, userID1, userID2 string) error {
	return db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("(user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)",
			userID1, userID2, userID2, userID1).Delete(&model.Friendship{}).Error; err != nil {
			return err
		}
		return nil
	})
}

func UpsertFriendship(db *gorm.DB, f *model.Friendship) error {
	return db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "user_id"}, {Name: "friend_id"}},
		DoUpdates: clause.AssignmentColumns([]string{"status", "remark", "request_message", "updated_at"}),
	}).Create(f).Error
}

func ListReceivedRequests(db *gorm.DB, userID string) ([]model.Friendship, error) {
	var requests []model.Friendship
	err := db.Where("friend_id = ? AND status = ?", userID, model.StatusPending).
		Order("created_at DESC").Find(&requests).Error
	return requests, err
}

func ListSentRequests(db *gorm.DB, userID string) ([]model.Friendship, error) {
	var requests []model.Friendship
	err := db.Where("user_id = ? AND status = ?", userID, model.StatusPending).
		Order("created_at DESC").Find(&requests).Error
	return requests, err
}

func ListAcceptedFriends(db *gorm.DB, userID string) ([]model.Friendship, error) {
	var friends []model.Friendship
	err := db.Where("user_id = ? AND status = ?", userID, model.StatusAccepted).Find(&friends).Error
	return friends, err
}

func FindFriendshipBetween(db *gorm.DB, userID1, userID2 string) (*model.Friendship, error) {
	var f model.Friendship
	err := db.Where("(user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)",
		userID1, userID2, userID2, userID1).First(&f).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &f, err
}

func GetFriendIDs(db *gorm.DB, userID string) ([]string, error) {
	var friendIDs []string
	err := db.Model(&model.Friendship{}).
		Where("user_id = ? AND status = ?", userID, model.StatusAccepted).
		Pluck("friend_id", &friendIDs).Error
	return friendIDs, err
}

func IsBlockedBy(db *gorm.DB, blockingUserID, blockedUserID string) (bool, error) {
	var count int64
	err := db.Model(&model.Friendship{}).
		Where("user_id = ? AND friend_id = ? AND status = ?", blockingUserID, blockedUserID, model.StatusBlocked).
		Count(&count).Error
	return count > 0, err
}
