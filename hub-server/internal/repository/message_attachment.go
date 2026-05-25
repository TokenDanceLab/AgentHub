package repository

import (
	"github.com/agenthub/hub-server/internal/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func CreateMessageAttachmentReferences(db *gorm.DB, refs []model.MessageAttachment) error {
	if len(refs) == 0 {
		return nil
	}
	return db.Clauses(clause.OnConflict{DoNothing: true}).Create(&refs).Error
}

func CanUserAccessReferencedAttachment(db *gorm.DB, userID, attachmentID string) (bool, error) {
	if userID == "" || attachmentID == "" {
		return false, nil
	}

	var allowed bool
	err := db.Raw(`
		SELECT EXISTS (
			SELECT 1
			FROM message_attachments ma
			INNER JOIN session_members sm
				ON sm.session_id = ma.session_id
				AND sm.member_type = ?
				AND sm.member_id = ?
				AND sm.left_at IS NULL
			WHERE ma.attachment_id = ?
		) AS allowed
	`, model.MemberTypeUser, userID, attachmentID).Scan(&allowed).Error
	return allowed, err
}
