package dispatch

import (
	"time"

	"github.com/agenthub/hub-server/internal/model"
)

// Message is a single thread-history or pinned-context entry in a dispatch
// payload (and Edge HTTP run request). JSON field names match the historical
// package-private dispatchMessage shape so redispatch unmarshaling stays stable.
type Message struct {
	Role      string `json:"role"`
	Content   string `json:"content"`
	Timestamp string `json:"timestamp"` // RFC 3339
}

// NewMessage builds a Message with UTC RFC3339 timestamp.
func NewMessage(role, content string, at time.Time) Message {
	return Message{
		Role:      role,
		Content:   content,
		Timestamp: at.UTC().Format(time.RFC3339),
	}
}

// MessageFromModel maps a Hub message row into a dispatch Message using
// ExtractMessageText + MapSenderType. Empty content returns ok=false so
// pinned-context loaders can skip blank rows.
func MessageFromModel(msg *model.Message) (Message, bool) {
	if msg == nil {
		return Message{}, false
	}
	content := ExtractMessageText(msg)
	if content == "" {
		return Message{}, false
	}
	return NewMessage(MapSenderType(msg.SenderType), content, msg.CreatedAt), true
}

// MapMessagesChronological maps Hub messages to dispatch Messages.
// When reverse is true, input is assumed DESC (newest first) and output is
// chronological (oldest first) — matches GetMessagesBySession usage.
// Empty extract results are kept (history path) so length matches input when
// reverse is true; use MapPinnedMessages to drop blanks.
func MapMessagesChronological(msgs []model.Message, reverse bool) []Message {
	if len(msgs) == 0 {
		return nil
	}
	result := make([]Message, len(msgs))
	for i := range msgs {
		content := ExtractMessageText(&msgs[i])
		m := NewMessage(MapSenderType(msgs[i].SenderType), content, msgs[i].CreatedAt)
		if reverse {
			result[len(msgs)-1-i] = m
		} else {
			result[i] = m
		}
	}
	return result
}

// MapPinnedMessages maps messages to dispatch Messages, skipping empty content.
func MapPinnedMessages(msgs []model.Message) []Message {
	if len(msgs) == 0 {
		return nil
	}
	result := make([]Message, 0, len(msgs))
	for i := range msgs {
		if m, ok := MessageFromModel(&msgs[i]); ok {
			result = append(result, m)
		}
	}
	return result
}
