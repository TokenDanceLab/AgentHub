package repository

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/model"
)

var ErrPinLimitExceeded = errors.New("pin limit exceeded for session")

func InsertMessage(db *gorm.DB, msg *model.Message) error {
	return db.Create(msg).Error
}

func GetMessageByID(db *gorm.DB, id string) (*model.Message, error) {
	var msg model.Message
	err := db.Where("id = ?", id).First(&msg).Error
	return &msg, err
}

func GetMessageBySessionAndID(db *gorm.DB, sessionID, id string) (*model.Message, error) {
	var msg model.Message
	err := db.Where("session_id = ? AND id = ?", sessionID, id).First(&msg).Error
	return &msg, err
}

func GetMessagesBySession(db *gorm.DB, sessionID string, beforeSeq int64, limit int) ([]model.Message, error) {
	limit = config.ClampPageSize(limit, config.MaxMessagePageLimit, config.DefaultPaginationLimit)
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
		"UPDATE sessions SET next_seq = next_seq + 1, last_message_at = CURRENT_TIMESTAMP WHERE id = ? RETURNING next_seq",
		sessionID,
	).Scan(&seq).Error
	return seq, err
}

func UpdateMessageRecalled(db *gorm.DB, id string) error {
	return db.Model(&model.Message{}).Where("id = ?", id).Update("recalled", true).Error
}

func UpdateMessageContent(db *gorm.DB, id, contentType, content string) error {
	now := time.Now()
	result := db.Model(&model.Message{}).
		Where("id = ?", id).
		Updates(map[string]interface{}{
			"content_type": contentType,
			"content":      content,
			"edited":       true,
			"edited_at":    &now,
		})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

func InsertPin(db *gorm.DB, pin *model.MessagePin) error {
	return db.Create(pin).Error
}

// PinMessageAtomic inserts a pin within a transaction that locks the session row
// to serialize concurrent pin operations and atomically checks the per-session limit.
func PinMessageAtomic(db *gorm.DB, pin *model.MessagePin, maxPins int64) error {
	return db.Transaction(func(tx *gorm.DB) error {
		// Lock the session row to serialize concurrent pin operations.
		// PostgreSQL uses FOR UPDATE; SQLite (tests) skips row locking.
		if tx.Name() == "postgres" {
			var sessionID string
			if err := tx.Raw("SELECT id FROM sessions WHERE id = ? FOR UPDATE", pin.SessionID).Scan(&sessionID).Error; err != nil {
				return err
			}
			if sessionID == "" {
				return gorm.ErrRecordNotFound
			}
		}

		var count int64
		if err := tx.Model(&model.MessagePin{}).Where("session_id = ?", pin.SessionID).Count(&count).Error; err != nil {
			return err
		}
		if count >= maxPins {
			return ErrPinLimitExceeded
		}
		return tx.Create(pin).Error
	})
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
	err := db.Where("session_id = ?", sessionID).Order("pinned_at DESC").Limit(100).Find(&pins).Error
	return pins, err
}

// maxMessageIDsPerIN caps the number of message IDs accepted by
// GetMessagesByIDs to prevent oversized IN clauses.
const maxMessageIDsPerIN = 1000

func GetMessagesByIDs(db *gorm.DB, ids []string) ([]model.Message, error) {
	var msgs []model.Message
	if len(ids) == 0 {
		return msgs, nil
	}
	if len(ids) > maxMessageIDsPerIN {
		ids = ids[:maxMessageIDsPerIN]
	}
	err := db.Where("id IN ?", ids).Find(&msgs).Error
	return msgs, err
}

func GetMessagesBySessionAndIDs(db *gorm.DB, sessionID string, ids []string) ([]model.Message, error) {
	var msgs []model.Message
	err := db.Where("session_id = ? AND id IN ?", sessionID, ids).Find(&msgs).Error
	return msgs, err
}

// escapeILIKE escapes ILIKE wildcards so user input cannot match arbitrary patterns.
func escapeILIKE(s string) string {
	s = strings.ReplaceAll(s, `\`, `\\`)
	s = strings.ReplaceAll(s, `%`, `\%`)
	s = strings.ReplaceAll(s, `_`, `\_`)
	return s
}

func messageSearchCondition(db *gorm.DB, tableAlias, q string) (string, []interface{}) {
	if db.Name() == "postgres" {
		textExpr := postgresMessageTextExpression(tableAlias)
		return "(to_tsvector('simple', COALESCE(" + textExpr + ", '')) @@ plainto_tsquery('simple', ?) OR " + textExpr + " ILIKE ? ESCAPE '\\')",
			[]interface{}{q, "%" + escapeILIKE(q) + "%"}
	}

	textExpr := sqliteMessageTextExpression(tableAlias)
	return "COALESCE(" + textExpr + ", '') LIKE ? ESCAPE '\\'", []interface{}{"%" + escapeILIKE(q) + "%"}
}

func postgresMessageTextExpression(tableAlias string) string {
	if tableAlias == "" {
		return "content->>'text'"
	}
	return tableAlias + ".content->>'text'"
}

func sqliteMessageTextExpression(tableAlias string) string {
	if tableAlias == "" {
		return "json_extract(content, '$.text')"
	}
	return "json_extract(" + tableAlias + ".content, '$.text')"
}

// SearchMessages returns a page of messages matching q within sessionID,
// ordered by seq_id DESC (id DESC as the tie-break so keyset pagination is
// stable). cursor encodes "<seq>|<id>" from the previous page's last row;
// pageSize is clamped by the caller. Malformed/legacy cursors are treated as
// a fresh first page (same convention as the market profiles cursor).
// Returns (messages, hasMore): the caller asks for pageSize+1 rows and trims
// when hasMore is true.
func SearchMessages(db *gorm.DB, q, sessionID, contentType, from, to, cursor string, pageSize int) ([]model.Message, bool, error) {
	var msgs []model.Message
	searchCondition, searchArgs := messageSearchCondition(db, "", q)
	query := db.Where("session_id = ?", sessionID).
		Where("recalled = false").
		Where(searchCondition, searchArgs...)
	if contentType != "" {
		query = query.Where("content_type = ?", contentType)
	}
	if from != "" {
		query = query.Where("created_at >= ?", from)
	}
	if to != "" {
		query = query.Where("created_at <= ?", to)
	}
	if parts := strings.SplitN(cursor, "|", 2); len(parts) == 2 {
		if seq, err := strconv.ParseInt(parts[0], 10, 64); err == nil {
			query = query.Where("(seq_id < ? OR (seq_id = ? AND id < ?))", seq, seq, parts[1])
		}
	}
	query = query.Order("seq_id DESC, id DESC")
	if err := query.Limit(pageSize + 1).Find(&msgs).Error; err != nil {
		return nil, false, err
	}
	hasMore := len(msgs) > pageSize
	if hasMore {
		msgs = msgs[:pageSize]
	}
	return msgs, hasMore, nil
}

// SearchAllMessages searches messages across all sessions where the given user is
// an active member. Unlike SearchMessages, it joins through session_members to
// find relevant messages without requiring a specific session ID.
//
// Security: the SQL is built with fmt.Sprintf using the "m" table alias and
// dialect-specific expressions (messageSearchCondition). The tableAlias "m" is
// a hardcoded trusted literal from within this function, never from user input.
// User-provided values (q, contentType, from, to) are always passed as
// parameterized placeholders (?) and never interpolated into the SQL string.
// SearchAllMessages returns a page of messages matching q across every session
// where the given user is an active member, ordered by created_at DESC
// (id DESC tie-break). cursor encodes "<createdAtUnixNano>|<id>" from the
// previous page's last row; a malformed/legacy cursor starts a fresh page.
// Returns (messages, hasMore) with the pageSize+1 probing convention.
func SearchAllMessages(db *gorm.DB, userID, q, contentType, from, to, cursor string, pageSize int) ([]model.Message, bool, error) {
	var msgs []model.Message
	searchCondition, searchArgs := messageSearchCondition(db, "m", q)

	args := []interface{}{"user", userID}
	args = append(args, searchArgs...)

	if contentType != "" {
		args = append(args, contentType)
	}
	if from != "" {
		args = append(args, from)
	}
	if to != "" {
		args = append(args, to)
	}

	sql := fmt.Sprintf(
		`SELECT m.* FROM messages m
		INNER JOIN session_members sm ON m.session_id = sm.session_id
		WHERE sm.member_type = ? AND sm.member_id = ? AND sm.left_at IS NULL
			AND m.recalled = false
			AND %s`,
		searchCondition,
	)

	if contentType != "" {
		sql += " AND m.content_type = ?"
	}
	if from != "" {
		sql += " AND m.created_at >= ?"
	}
	if to != "" {
		sql += " AND m.created_at <= ?"
	}
	if parts := strings.SplitN(cursor, "|", 2); len(parts) == 2 {
		if nanos, err := strconv.ParseInt(parts[0], 10, 64); err == nil {
			cursorTime := time.Unix(0, nanos)
			args = append(args, cursorTime, cursorTime, parts[1])
			sql += " AND (m.created_at < ? OR (m.created_at = ? AND m.id < ?))"
		}
	}
	args = append(args, pageSize+1)
	sql += " ORDER BY m.created_at DESC, m.id DESC LIMIT ?"

	if err := db.Raw(sql, args...).Scan(&msgs).Error; err != nil {
		return nil, false, err
	}
	hasMore := len(msgs) > pageSize
	if hasMore {
		msgs = msgs[:pageSize]
	}
	return msgs, hasMore, nil
}
