package session

import "github.com/agenthub/hub-server/internal/model"

// Domain event type strings published by session lifecycle write paths.
// Values are contract-stable for bus subscribers / WS bridge.
const (
	EventTypeSessionCreated      = "session.created"
	EventTypeSessionMemberJoined = "session.member_joined"
	EventTypeSessionMemberLeft   = "session.member_left"
	EventTypeSessionDissolved    = "session.dissolved"
	EventTypeSessionInfoUpdated  = "session.info_updated"
)

// PrivateSessionCreatedPayload builds the session.created bus payload for private sessions.
func PrivateSessionCreatedPayload(sessionID, currentUserID, targetUserID string) map[string]interface{} {
	return map[string]interface{}{
		"session_id": sessionID,
		"type":       model.SessionTypePrivate,
		"owner_id":   "",
		"members":    []string{currentUserID, targetUserID},
	}
}

// GroupSessionCreatedPayload builds the session.created bus payload for group sessions.
func GroupSessionCreatedPayload(sessionID, name, ownerUserID string, members []string) map[string]interface{} {
	return map[string]interface{}{
		"session_id": sessionID,
		"type":       model.SessionTypeGroup,
		"name":       name,
		"owner_id":   ownerUserID,
		"members":    members,
	}
}

// MemberJoinedPayload builds the session.member_joined bus payload.
func MemberJoinedPayload(sessionID, memberID, memberType string) map[string]interface{} {
	return map[string]interface{}{
		"session_id":  sessionID,
		"member_id":   memberID,
		"member_type": memberType,
	}
}

// MemberLeftPayload builds the session.member_left bus payload.
func MemberLeftPayload(sessionID, memberID string) map[string]interface{} {
	return map[string]interface{}{
		"session_id": sessionID,
		"member_id":  memberID,
	}
}

// SessionDissolvedPayload builds the session.dissolved bus payload.
func SessionDissolvedPayload(sessionID string) map[string]interface{} {
	return map[string]interface{}{
		"session_id": sessionID,
	}
}

// SessionInfoUpdatedPayload builds the session.info_updated bus payload.
func SessionInfoUpdatedPayload(sessionID string, changes map[string]interface{}) map[string]interface{} {
	return map[string]interface{}{
		"session_id": sessionID,
		"changes":    changes,
	}
}
