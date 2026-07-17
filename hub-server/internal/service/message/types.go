package message

import "github.com/agenthub/hub-server/internal/model"

// SendMessageRequest is the API body for posting a message to a session.
type SendMessageRequest struct {
	ClientMsgID  string  `json:"client_msg_id"`
	ContentType  string  `json:"content_type"`
	Content      string  `json:"content"`
	ReplyToMsgID *string `json:"reply_to_message_id,omitempty"`
}

// ReplyToInfo is the nested reply target projection on MessageResponse.
type ReplyToInfo struct {
	ID          string `json:"id"`
	SenderID    string `json:"sender_id"`
	ContentType string `json:"content_type"`
	Content     string `json:"content"`
	Recalled    bool   `json:"recalled"`
	CreatedAt   string `json:"created_at"`
}

// MessageResponse is the API projection of a stored message (history/search/pins).
type MessageResponse struct {
	ID           string             `json:"id"`
	SessionID    string             `json:"session_id"`
	SeqID        int64              `json:"seq_id"`
	ClientMsgID  string             `json:"client_msg_id"`
	SenderType   string             `json:"sender_type"`
	SenderID     string             `json:"sender_id"`
	ContentType  string             `json:"content_type"`
	Content      string             `json:"content"`
	ReplyToMsgID *string            `json:"reply_to_message_id,omitempty"`
	ReplyTo      *ReplyToInfo       `json:"reply_to,omitempty"`
	Attachments  []model.Attachment `json:"attachments,omitempty"`
	Recalled     bool               `json:"recalled"`
	Edited       bool               `json:"edited"`
	EditedAt     string             `json:"edited_at,omitempty"`
	CreatedAt    string             `json:"created_at"`
}

// SendMessageResponse is returned after a successful (or idempotent) send.
type SendMessageResponse struct {
	MessageID string `json:"message_id"`
	SeqID     int64  `json:"seq_id"`
	CreatedAt string `json:"created_at"`
}

// EditMessageRequest is the API body for editing message content.
type EditMessageRequest struct {
	ContentType string `json:"content_type"`
	Content     string `json:"content"`
}

// EditMessageResponse is returned after a successful edit.
type EditMessageResponse struct {
	MessageID string `json:"message_id"`
	EditedAt  string `json:"edited_at"`
}
