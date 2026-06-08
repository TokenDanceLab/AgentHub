package repository

import (
	"time"

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

func ListAttachmentsByMessageIDs(db *gorm.DB, messageIDs []string) (map[string][]model.Attachment, error) {
	attachmentsByMessage := make(map[string][]model.Attachment)
	if len(messageIDs) == 0 {
		return attachmentsByMessage, nil
	}

	var rows []struct {
		MessageID      string
		ID             string
		Hash           string
		Size           int64
		MimeType       string
		OriginalName   string
		UploaderUserID string
		CreatedAt      time.Time
	}
	if err := db.Table("message_attachments AS ma").
		Select(`
			ma.message_id,
			a.id,
			a.hash,
			a.size,
			a.mime_type,
			a.original_name,
			a.uploader_user_id,
			a.created_at
		`).
		Joins("INNER JOIN attachments AS a ON a.id = ma.attachment_id").
		Where("ma.message_id IN ?", messageIDs).
		Order("ma.created_at ASC, ma.attachment_id ASC").
		Scan(&rows).Error; err != nil {
		return nil, err
	}

	for _, row := range rows {
		attachmentsByMessage[row.MessageID] = append(attachmentsByMessage[row.MessageID], model.Attachment{
			ID:             row.ID,
			Hash:           row.Hash,
			Size:           row.Size,
			MimeType:       row.MimeType,
			OriginalName:   row.OriginalName,
			UploaderUserID: row.UploaderUserID,
			CreatedAt:      row.CreatedAt,
		})
	}
	return attachmentsByMessage, nil
}
