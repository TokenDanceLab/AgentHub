package session

import "github.com/agenthub/hub-server/internal/repository"

// UnreadCount projects next_seq − last_read_seq, floored at zero.
func UnreadCount(nextSeq, lastReadSeq int64) int64 {
	unread := nextSeq - lastReadSeq
	if unread < 0 {
		return 0
	}
	return unread
}

// OwnerUserIDString dereferences a nullable owner user id to a stable string field.
func OwnerUserIDString(owner *string) string {
	if owner == nil {
		return ""
	}
	return *owner
}

// SessionListItemFromMeta maps a repository SessionWithMeta row to the API DTO.
// JSON field names on SessionListItem are contract-stable.
func SessionListItemFromMeta(sess repository.SessionWithMeta) SessionListItem {
	return SessionListItem{
		SessionID:     sess.ID,
		Type:          sess.Type,
		Name:          sess.Name,
		AvatarURL:     sess.AvatarURL,
		OwnerUserID:   OwnerUserIDString(sess.OwnerUserID),
		Pinned:        sess.Pinned,
		Archived:      sess.Archived,
		Muted:         sess.Muted,
		LastMessageAt: sess.LastMessageAt,
		UnreadCount:   UnreadCount(sess.NextSeq, sess.LastReadSeq),
		MemberCount:   sess.MemberCount,
		Role:          sess.Role,
		CreatedAt:     sess.CreatedAt,
	}
}

// MapSessionListItems maps repository list/search rows to API DTOs.
func MapSessionListItems(sessions []repository.SessionWithMeta) []SessionListItem {
	result := make([]SessionListItem, len(sessions))
	for i, sess := range sessions {
		result[i] = SessionListItemFromMeta(sess)
	}
	return result
}
