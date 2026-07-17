package message

import (
	"errors"
	"testing"
	"time"

	"github.com/agenthub/hub-server/internal/model"
)

func TestFormatMessageTime(t *testing.T) {
	ts := time.Date(2026, 7, 17, 12, 30, 45, 0, time.UTC)
	got := formatMessageTime(ts)
	want := "2026-07-17T12:30:45Z"
	if got != want {
		t.Fatalf("formatMessageTime = %q, want %q", got, want)
	}
}

func TestFormatMessageTimePtr(t *testing.T) {
	if got := formatMessageTimePtr(nil); got != "" {
		t.Fatalf("nil ptr = %q, want empty", got)
	}
	ts := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	got := formatMessageTimePtr(&ts)
	want := "2026-01-02T03:04:05Z"
	if got != want {
		t.Fatalf("formatMessageTimePtr = %q, want %q", got, want)
	}
}

func TestSendMessageResponseFromModel(t *testing.T) {
	if sendMessageResponseFromModel(nil) != nil {
		t.Fatal("nil model should yield nil response")
	}
	m := &model.Message{
		ID:        "msg-1",
		SeqID:     42,
		CreatedAt: time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC),
	}
	resp := sendMessageResponseFromModel(m)
	if resp.MessageID != "msg-1" || resp.SeqID != 42 || resp.CreatedAt != "2026-07-01T00:00:00Z" {
		t.Fatalf("unexpected response: %+v", resp)
	}
}

func TestIsDuplicateKeyError(t *testing.T) {
	cases := []struct {
		err  error
		want bool
	}{
		{nil, false},
		{errors.New("something else"), false},
		{errors.New("ERROR: duplicate key value violates unique constraint"), true},
		{errors.New("UNIQUE constraint failed: messages.client_msg_id"), false}, // case-sensitive "unique"
		{errors.New("unique constraint failed: messages.client_msg_id"), true},
	}
	for _, tc := range cases {
		if got := isDuplicateKeyError(tc.err); got != tc.want {
			t.Fatalf("isDuplicateKeyError(%v) = %v, want %v", tc.err, got, tc.want)
		}
	}
}

func TestMessageAttachmentRefs(t *testing.T) {
	if refs := messageAttachmentRefs("s1", "m1", nil); refs != nil {
		t.Fatalf("nil ids should yield nil, got %v", refs)
	}
	refs := messageAttachmentRefs("s1", "m1", []string{"a1", "a2"})
	if len(refs) != 2 {
		t.Fatalf("len = %d, want 2", len(refs))
	}
	if refs[0].SessionID != "s1" || refs[0].MessageID != "m1" || refs[0].AttachmentID != "a1" {
		t.Fatalf("refs[0] = %+v", refs[0])
	}
	if refs[1].AttachmentID != "a2" {
		t.Fatalf("refs[1] = %+v", refs[1])
	}
}

func TestNewForwardedMessage(t *testing.T) {
	src := &model.Message{
		SenderType:  model.SenderTypeUser,
		SenderID:    "u1",
		ContentType: model.ContentTypeText,
		Content:     "hello",
	}
	fwd := newForwardedMessage("sess-2", 9, "client-new", src)
	if fwd.SessionID != "sess-2" || fwd.SeqID != 9 || fwd.ClientMsgID != "client-new" {
		t.Fatalf("ids: %+v", fwd)
	}
	if fwd.SenderID != "u1" || fwd.Content != "hello" || fwd.ContentType != model.ContentTypeText {
		t.Fatalf("payload: %+v", fwd)
	}

	empty := newForwardedMessage("s", 1, "c", nil)
	if empty.SessionID != "s" || empty.ClientMsgID != "c" || empty.SeqID != 1 {
		t.Fatalf("nil src shell: %+v", empty)
	}
}
