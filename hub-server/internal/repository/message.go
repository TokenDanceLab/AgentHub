package repository

import (
	"errors"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/model"
)

func InsertMessage(db *gorm.DB, msg *model.Message) error {
	return db.Create(msg).Error
}

func GetMessageByID(db *gorm.DB, id string) (*model.Message, error) {
	var msg model.Message
	err := db.Where("id = ?", id).First(&msg).Error
	return &msg, err
}

func GetMessagesBySession(db *gorm.DB, sessionID string, beforeSeq int64, limit int) ([]model.Message, error) {
	if limit <= 0 || limit > config.MaxMessagePageLimit {
		limit = config.DefaultPaginationLimit
	}
	var msgs []model.Message
	query := db.Where("session_id = ?", sessionID)
	if beforeSeq > 0 {
		query = query.Where("seq_id < ?", beforeSeq)
	}
	err := query.Order("seq_id DESC").Limit(limit).Find(&msgs).Error
	return msgs, err
}

func GetMessagesIncrement(db *gorm.DB, sessionID string, afterSeq int64, limit int) ([]model.Message, error) {
	if limit <= 0 || limit > config.MaxIncrementalMessageLimit {
		limit = config.MaxIncrementalMessageLimit
	}
	var msgs []model.Message
	err := db.Where("session_id = ? AND seq_id > ?", sessionID, afterSeq).
		Order("seq_id ASC").Limit(limit).Find(&msgs).Error
	return msgs, err
}

func GetMessageByClientMsgID(db *gorm.DB, sessionID, clientMsgID string) (*model.Message, error) {
	var msg model.Message
	err := db.Where("session_id = ? AND client_msg_id = ?", sessionID, clientMsgID).First(&msg).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &msg, err
}

func AllocateSeqID(tx *gorm.DB, sessionID string) (int64, error) {
	var seq int64
	err := tx.Raw(
		"UPDATE sessions SET next_seq = next_seq + 1, last_message_at = NOW() WHERE id = ? RETURNING next_seq",
		sessionID,
	).Scan(&seq).Error
	return seq, err
}

func UpdateMessageRecalled(db *gorm.DB, id string) error {
	return db.Model(&model.Message{}).Where("id = ?", id).Update("recalled", true).Error
}

func InsertPin(db *gorm.DB, pin *model.MessagePin) error {
	return db.Create(pin).Error
}

func DeletePin(db *gorm.DB, sessionID, messageID string) error {
	return db.Delete(&model.MessagePin{}, "session_id = ? AND message_id = ?", sessionID, messageID).Error
}

func CountPinsBySession(db *gorm.DB, sessionID string) (int64, error) {
	var count int64
	err := db.Model(&model.MessagePin{}).Where("session_id = ?", sessionID).Count(&count).Error
	return count, err
}

func ListPinsBySession(db *gorm.DB, sessionID string) ([]model.MessagePin, error) {
	var pins []model.MessagePin
	err := db.Where("session_id = ?", sessionID).Order("pinned_at DESC").Find(&pins).Error
	return pins, err
}

func GetMessagesByIDs(db *gorm.DB, ids []string) ([]model.Message, error) {
	var msgs []model.Message
	err := db.Where("id IN ?", ids).Find(&msgs).Error
	return msgs, err
}

func SearchMessages(db *gorm.DB, q, sessionID, contentType, from, to string) ([]model.Message, error) {
	var msgs []model.Message
	query := db.Where("session_id = ?", sessionID).
		Where("recalled = false").
		Where("content->>'text' ILIKE ?", "%"+q+"%")
	if contentType != "" {
		query = query.Where("content_type = ?", contentType)
	}
	if from != "" {
		query = query.Where("created_at >= ?", from)
	}
	if to != "" {
		query = query.Where("created_at <= ?", to)
	}
	err := query.Order("seq_id DESC").Limit(100).Find(&msgs).Error
	return msgs, err
}

func SearchAllMessages(db *gorm.DB, userID, q string) ([]model.Message, error) {
	var msgs []model.Message
	err := db.Raw(`
		SELECT m.* FROM messages m
		INNER JOIN session_members sm ON m.session_id = sm.session_id
		WHERE sm.member_type = ? AND sm.member_id = ? AND sm.left_at IS NULL
			AND m.recalled = false
			AND m.content->>'text' ILIKE ?
		ORDER BY m.created_at DESC
		LIMIT 100
	`, "user", userID, "%"+q+"%").Scan(&msgs).Error
	return msgs, err
}
