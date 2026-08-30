package repository

import (
	"time"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/model"
)

func CreateSession(db *gorm.DB, session *model.Session) error {
	return db.Create(session).Error
}

func GetSessionByID(db *gorm.DB, id string) (*model.Session, error) {
	var s model.Session
	err := db.Where("id = ?", id).First(&s).Error
	if err != nil {
		return nil, err
	}
	return &s, nil
}

func UpdateSession(db *gorm.DB, session *model.Session) error {
	return db.Save(session).Error
}

func FindPrivateSessionBetween(db *gorm.DB, userA, userB string) (*model.Session, error) {
	var s model.Session
	err := db.Raw(`
		SELECT s.* FROM sessions s
		INNER JOIN session_members sm1 ON sm1.session_id = s.id AND sm1.member_id = ? AND sm1.member_type = 'user' AND sm1.left_at IS NULL
		INNER JOIN session_members sm2 ON sm2.session_id = s.id AND sm2.member_id = ? AND sm2.member_type = 'user' AND sm2.left_at IS NULL
		WHERE s.type = ?
		LIMIT 1
	`, userA, userB, model.SessionTypePrivate).Scan(&s).Error
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, nil
		}
		return nil, err
	}
	if s.ID == "" {
		return nil, nil
	}
	return &s, nil
}

func TouchSessionLastMessage(db *gorm.DB, sessionID string) error {
	return db.Model(&model.Session{}).Where("id = ?", sessionID).
		Update("last_message_at", time.Now()).Error
}

// SyncSessionSeq advances the persistent seq mirror to at least seq (never
// regresses). Redis is the live allocation source; this mirror lets a fresh
// Redis (restart / FLUSH / key expiry) recover the sequence without repeating
// or regressing values (AH seq continuity contract, #1533).
func SyncSessionSeq(db *gorm.DB, sessionID string, seq int64) error {
	return db.Model(&model.Session{}).Where("id = ? AND next_seq < ?", sessionID, seq).
		Update("next_seq", seq).Error
}

func SearchSessions(db *gorm.DB, userID, q string) ([]SessionWithMeta, error) {
	var result []SessionWithMeta
	err := db.Raw(`
		SELECT s.*, sm.role, sm.pinned, sm.archived, sm.muted, sm.last_read_seq,
			COALESCE(mc.member_count, 0) as member_count
		FROM sessions s
		INNER JOIN session_members sm ON sm.session_id = s.id AND sm.member_id = ? AND sm.left_at IS NULL
		LEFT JOIN LATERAL (SELECT COUNT(*) as member_count FROM session_members WHERE session_id = s.id AND left_at IS NULL) mc ON true
		WHERE s.dissolved = false AND (s.type = 'group' OR (s.type = 'private')) AND s.name LIKE ?
		ORDER BY s.last_message_at DESC NULLS LAST, s.created_at DESC
		LIMIT 20
	`, userID, "%"+q+"%").Scan(&result).Error
	return result, err
}

func ListUserSessions(db *gorm.DB, userID string) ([]SessionWithMeta, error) {
	var result []SessionWithMeta
	err := db.Raw(`
		SELECT s.*, sm.role, sm.pinned, sm.archived, sm.muted, sm.last_read_seq,
			COALESCE(mc.member_count, 0) as member_count
		FROM sessions s
		INNER JOIN session_members sm ON sm.session_id = s.id AND sm.member_id = ? AND sm.left_at IS NULL
		LEFT JOIN LATERAL (SELECT COUNT(*) as member_count FROM session_members WHERE session_id = s.id AND left_at IS NULL) mc ON true
		WHERE s.dissolved = false
		ORDER BY sm.pinned DESC, COALESCE(s.last_message_at, s.created_at) DESC
		LIMIT 500
	`, userID).Scan(&result).Error
	return result, err
}

func ListWorkspaceSessions(db *gorm.DB, workspaceID, userID string) ([]SessionWithMeta, error) {
	var result []SessionWithMeta
	err := db.Raw(`
		SELECT s.*, sm.role, sm.pinned, sm.archived, sm.muted, sm.last_read_seq,
			COALESCE(mc.member_count, 0) as member_count
		FROM sessions s
		INNER JOIN session_members sm ON sm.session_id = s.id AND sm.member_id = ? AND sm.left_at IS NULL
		LEFT JOIN LATERAL (SELECT COUNT(*) as member_count FROM session_members WHERE session_id = s.id AND left_at IS NULL) mc ON true
		WHERE s.workspace_id = ? AND s.dissolved = false
		ORDER BY sm.pinned DESC, COALESCE(s.last_message_at, s.created_at) DESC
		LIMIT 500
	`, userID, workspaceID).Scan(&result).Error
	return result, err
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
