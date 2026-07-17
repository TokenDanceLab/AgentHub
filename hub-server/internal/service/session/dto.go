package session

import "time"

// CreateSessionResponse is the API/handler DTO for session create.
// JSON field names are contract-stable.
type CreateSessionResponse struct {
	SessionID string `json:"session_id"`
	Type      string `json:"type"`
	Created   bool   `json:"created"`
}

// SessionListItem is the API/handler DTO for one session list/search row.
// JSON field names are contract-stable.
type SessionListItem struct {
	SessionID     string     `json:"session_id"`
	Type          string     `json:"type"`
	Name          string     `json:"name,omitempty"`
	AvatarURL     string     `json:"avatar_url,omitempty"`
	OwnerUserID   string     `json:"owner_user_id,omitempty"`
	Pinned        bool       `json:"pinned"`
	Archived      bool       `json:"archived"`
	Muted         bool       `json:"muted"`
	LastMessageAt *time.Time `json:"last_message_at,omitempty"`
	UnreadCount   int64      `json:"unread_count"`
	MemberCount   int64      `json:"member_count"`
	Role          string     `json:"role"`
	CreatedAt     time.Time  `json:"created_at"`
}

// NewCreateSessionResponse builds a create-session API response.
func NewCreateSessionResponse(sessionID, typ string, created bool) *CreateSessionResponse {
	return &CreateSessionResponse{SessionID: sessionID, Type: typ, Created: created}
}

// NewExistingSessionResponse builds a create-session response for an already-existing session.
func NewExistingSessionResponse(sessionID, typ string) *CreateSessionResponse {
	return NewCreateSessionResponse(sessionID, typ, false)
}
