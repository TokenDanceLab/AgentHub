package repository

import (
	"time"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/model"
)

// BatchSoftDeleteMembers soft-deletes multiple session members of the same
// member_type in a single UPDATE. Empty slice is a no-op. Mirrors per-member
// SoftDeleteMember semantics (sets left_at where currently NULL).
func BatchSoftDeleteMembers(db *gorm.DB, sessionID, memberType string, memberIDs []string) error {
	if len(memberIDs) == 0 {
		return nil
	}
	now := time.Now()
	return db.Model(&model.SessionMember{}).
		Where("session_id = ? AND member_type = ? AND member_id IN ? AND left_at IS NULL",
			sessionID, memberType, memberIDs).
		Update("left_at", now).Error
}
