package repository

import (
	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/model"
)

func CreateSession(db *gorm.DB, session *model.Session) error {
	return db.Create(session).Error
}

func GetSessionByID(db *gorm.DB, id string) (*model.Session, error) {
	var s model.Session
	err := db.Where("id = ?", id).First(&s).Error
	return &s, err
}

func UpdateSession(db *gorm.DB, session *model.Session) error {
	return db.Save(session).Error
}

type SessionWithMeta struct {
	model.Session
	Role        string `json:"role"`
	Pinned      bool   `json:"pinned"`
	Archived    bool   `json:"archived"`
	Muted       bool   `json:"muted"`
	LastReadSeq int64  `json:"last_read_seq"`
	MemberCount int64  `json:"member_count"`
}

func ListUserSessions(db *gorm.DB, userID string) ([]SessionWithMeta, error) {
	var result []SessionWithMeta
	err := db.Raw(`
		SELECT s.*, sm.role, sm.pinned, sm.archived, sm.muted, sm.last_read_seq,
			(SELECT COUNT(*) FROM session_members WHERE session_id = s.id AND left_at IS NULL) as member_count
		FROM sessions s
		INNER JOIN session_members sm ON s.id = sm.session_id
		WHERE sm.member_type = ? AND sm.member_id = ? AND sm.left_at IS NULL AND s.dissolved = false
		ORDER BY sm.pinned DESC, s.last_message_at DESC NULLS LAST
	`, "user", userID).Scan(&result).Error
	return result, err
}

func FindPrivateSessionBetween(db *gorm.DB, userID1, userID2 string) (*model.Session, error) {
	var s model.Session
	err := db.Raw(`
		SELECT s.* FROM sessions s
		INNER JOIN session_members m1 ON s.id = m1.session_id
			AND m1.member_type = 'user' AND m1.member_id = ? AND m1.left_at IS NULL
		INNER JOIN session_members m2 ON s.id = m2.session_id
			AND m2.member_type = 'user' AND m2.member_id = ? AND m2.left_at IS NULL
		WHERE s.type = 'private' AND s.dissolved = false
		LIMIT 1
	`, userID1, userID2).Scan(&s).Error
	if err != nil {
		return nil, err
	}
	if s.ID == "" {
		return nil, nil
	}
	return &s, nil
}

func UpdateSessionNextSeq(db *gorm.DB, sessionID string, nextSeq int64) error {
	return db.Model(&model.Session{}).Where("id = ?", sessionID).
		Update("next_seq", nextSeq).Error
}

func TouchSessionLastMessage(db *gorm.DB, sessionID string) error {
	return db.Model(&model.Session{}).Where("id = ?", sessionID).
		Update("last_message_at", gorm.Expr("NOW()")).Error
}

func SearchSessions(db *gorm.DB, userID, q string) ([]SessionWithMeta, error) {
	var result []SessionWithMeta
	err := db.Raw(`
		SELECT s.*, sm.role, sm.pinned, sm.archived, sm.muted, sm.last_read_seq,
			(SELECT COUNT(*) FROM session_members WHERE session_id = s.id AND left_at IS NULL) as member_count
		FROM sessions s
		INNER JOIN session_members sm ON s.id = sm.session_id
		WHERE sm.member_type = ? AND sm.member_id = ? AND sm.left_at IS NULL AND s.dissolved = false
			AND s.name ILIKE ?
		ORDER BY sm.pinned DESC, s.last_message_at DESC NULLS LAST
	`, "user", userID, "%"+q+"%").Scan(&result).Error
	return result, err
}
