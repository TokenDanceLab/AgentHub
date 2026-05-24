package repository

import (
	"errors"
	"time"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/model"
)

func CreateSessionMember(db *gorm.DB, member *model.SessionMember) error {
	return db.Create(member).Error
}

func BatchCreateMembers(db *gorm.DB, members []*model.SessionMember) error {
	return db.Create(&members).Error
}

func GetMember(db *gorm.DB, sessionID, memberType, memberID string) (*model.SessionMember, error) {
	var m model.SessionMember
	err := db.Where("session_id = ? AND member_type = ? AND member_id = ?",
		sessionID, memberType, memberID).First(&m).Error
	return &m, err
}

func GetActiveMember(db *gorm.DB, sessionID, memberType, memberID string) (*model.SessionMember, error) {
	var m model.SessionMember
	err := db.Where("session_id = ? AND member_type = ? AND member_id = ? AND left_at IS NULL",
		sessionID, memberType, memberID).First(&m).Error
	return &m, err
}

func ListActiveMembers(db *gorm.DB, sessionID string) ([]*model.SessionMember, error) {
	var members []*model.SessionMember
	err := db.Where("session_id = ? AND left_at IS NULL", sessionID).Find(&members).Error
	return members, err
}

func IsMemberActive(db *gorm.DB, sessionID, memberType, memberID string) (bool, error) {
	var count int64
	err := db.Model(&model.SessionMember{}).
		Where("session_id = ? AND member_type = ? AND member_id = ? AND left_at IS NULL",
			sessionID, memberType, memberID).Count(&count).Error
	return count > 0, err
}

func SoftDeleteMember(db *gorm.DB, sessionID, memberType, memberID string) error {
	now := time.Now()
	return db.Model(&model.SessionMember{}).
		Where("session_id = ? AND member_type = ? AND member_id = ? AND left_at IS NULL",
			sessionID, memberType, memberID).
		Update("left_at", now).Error
}

func UpdateMemberSettings(db *gorm.DB, sessionID, memberType, memberID string, pinned, archived, muted *bool) error {
	updates := map[string]interface{}{}
	if pinned != nil {
		updates["pinned"] = *pinned
	}
	if archived != nil {
		updates["archived"] = *archived
	}
	if muted != nil {
		updates["muted"] = *muted
	}
	if len(updates) == 0 {
		return nil
	}
	return db.Model(&model.SessionMember{}).
		Where("session_id = ? AND member_type = ? AND member_id = ? AND left_at IS NULL",
			sessionID, memberType, memberID).Updates(updates).Error
}

func TransferOwnership(db *gorm.DB, sessionID, oldOwnerID, newOwnerID string) error {
	return db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&model.SessionMember{}).
			Where("session_id = ? AND member_type = ? AND member_id = ? AND left_at IS NULL",
				sessionID, "user", oldOwnerID).
			Update("role", model.MemberRoleMember).Error; err != nil {
			return err
		}
		if err := tx.Model(&model.SessionMember{}).
			Where("session_id = ? AND member_type = ? AND member_id = ? AND left_at IS NULL",
				sessionID, "user", newOwnerID).
			Update("role", model.MemberRoleOwner).Error; err != nil {
			return err
		}
		return tx.Model(&model.Session{}).Where("id = ?", sessionID).
			Update("owner_user_id", newOwnerID).Error
	})
}

func GetOtherMemberInPrivate(db *gorm.DB, sessionID, excludeUserID string) (*model.SessionMember, error) {
	var m model.SessionMember
	err := db.Where("session_id = ? AND member_type = ? AND member_id != ? AND left_at IS NULL",
		sessionID, model.MemberTypeUser, excludeUserID).First(&m).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &m, err
}

func UpdateLastReadSeq(db *gorm.DB, sessionID, memberID string, seq int64) error {
	return db.Model(&model.SessionMember{}).
		Where("session_id = ? AND member_type = ? AND member_id = ? AND left_at IS NULL AND last_read_seq < ?",
			sessionID, model.MemberTypeUser, memberID, seq).
		Update("last_read_seq", seq).Error
}

// ReactivateMember clears left_at for a soft-deleted member, effectively re-adding them.
func ReactivateMember(db *gorm.DB, sessionID, memberType, memberID string, role string) error {
	result := db.Model(&model.SessionMember{}).
		Where("session_id = ? AND member_type = ? AND member_id = ? AND left_at IS NOT NULL",
			sessionID, memberType, memberID).
		Updates(map[string]interface{}{
			"left_at":   nil,
			"role":      role,
			"joined_at": time.Now(),
		})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

// IsMemberSoftDeleted checks if a member exists but has left (soft-deleted).
func IsMemberSoftDeleted(db *gorm.DB, sessionID, memberType, memberID string) (bool, error) {
	var count int64
	err := db.Model(&model.SessionMember{}).
		Where("session_id = ? AND member_type = ? AND member_id = ? AND left_at IS NOT NULL",
			sessionID, memberType, memberID).Count(&count).Error
	return count > 0, err
}
