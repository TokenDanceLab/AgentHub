package message

import (
	"errors"
	"testing"
	"time"

	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
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

// TestIsUniqueViolation_UsedBySendMessage covers the duplicate-key
// classification SendMessage's idempotent-retry branch depends on.
//
// This test used to exercise a package-private isDuplicateKeyError that lived
// in builders.go. #2244 slice 1 deleted that copy and pointed the branch at
// repository.IsUniqueViolation, the single implementation, so the test now
// exercises that.
//
// FOUR of the five original cases are carried over verbatim. The fifth —
// upper-case "UNIQUE constraint failed: messages.client_msg_id" — used to
// assert `false`, with the comment `// case-sensitive "unique"`. That assertion
// did not describe intended behaviour, it PINNED THE BUG this slice exists to
// fix: it locked in that a SQLite-style upper-case unique violation was not
// recognised, so a client retrying a send that had already landed got a 500
// instead of its own message. It is flipped to `true` here, and the flip is
// proved at the behavioural level (not just the classifier level) by
// TestSendMessage_PersistDuplicateSQLiteUppercaseIsIdempotent and
// TestPinMessage_DuplicateSQLiteUppercaseIsIdempotent in
// unique_violation_test.go, both of which are red against the old code.
func TestIsUniqueViolation_UsedBySendMessage(t *testing.T) {
	cases := []struct {
		err  error
		want bool
	}{
		{nil, false},
		{errors.New("something else"), false},
		{errors.New("ERROR: duplicate key value violates unique constraint"), true},
		{errors.New("UNIQUE constraint failed: messages.client_msg_id"), true}, // was `false`: pinned the case-sensitivity bug (#2244)
		{errors.New("unique constraint failed: messages.client_msg_id"), true},
	}
	for _, tc := range cases {
		if got := repository.IsUniqueViolation(tc.err); got != tc.want {
			t.Fatalf("repository.IsUniqueViolation(%v) = %v, want %v", tc.err, got, tc.want)
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
