package message

import (
	"testing"
	"time"

	"github.com/agenthub/hub-server/internal/model"
)

func strPtr(s string) *string { return &s }

func TestCollectReplyToIDs(t *testing.T) {
	msgs := []model.Message{
		{ID: "m1", ReplyToMsgID: strPtr("r1")},
		{ID: "m2", ReplyToMsgID: nil},
		{ID: "m3", ReplyToMsgID: strPtr("")},
		{ID: "m4", ReplyToMsgID: strPtr("r1")},
		{ID: "m5", ReplyToMsgID: strPtr("r2")},
	}
	ids := collectReplyToIDs(msgs)
	if len(ids) != 2 {
		t.Fatalf("len = %d, want 2; ids=%v", len(ids), ids)
	}
	seen := map[string]bool{}
	for _, id := range ids {
		seen[id] = true
	}
	if !seen["r1"] || !seen["r2"] {
		t.Fatalf("ids = %v", ids)
	}
}

func TestFileImageMessageIDs(t *testing.T) {
	msgs := []model.Message{
		{ID: "t1", ContentType: model.ContentTypeText},
		{ID: "f1", ContentType: model.ContentTypeFile},
		{ID: "i1", ContentType: model.ContentTypeImage},
		{ID: "f1", ContentType: model.ContentTypeFile}, // dedupe
		{ID: "", ContentType: model.ContentTypeImage},  // empty id skipped
	}
	ids := fileImageMessageIDs(msgs)
	if len(ids) != 2 {
		t.Fatalf("len = %d, want 2; ids=%v", len(ids), ids)
	}
	if ids[0] != "f1" || ids[1] != "i1" {
		t.Fatalf("order/ids = %v", ids)
	}
}

func TestOrderMessagesByIDs(t *testing.T) {
	msgMap := map[string]model.Message{
		"a": {ID: "a", Content: "A"},
		"c": {ID: "c", Content: "C"},
	}
	ordered := orderMessagesByIDs(msgMap, []string{"c", "missing", "a"})
	if len(ordered) != 2 {
		t.Fatalf("len = %d, want 2", len(ordered))
	}
	if ordered[0].ID != "c" || ordered[1].ID != "a" {
		t.Fatalf("order = %+v", ordered)
	}
}

func TestBuildReplyToInfoRecalled(t *testing.T) {
	if buildReplyToInfo(nil) != nil {
		t.Fatal("nil reply should be nil")
	}
	reply := &model.Message{
		ID:          "r1",
		SenderID:    "u2",
		ContentType: model.ContentTypeImage,
		Content:     "secret",
		Recalled:    true,
		CreatedAt:   time.Date(2026, 3, 4, 5, 6, 7, 0, time.UTC),
	}
	info := buildReplyToInfo(reply)
	if info.Content != "" || info.ContentType != "text" {
		t.Fatalf("recalled blanking failed: %+v", info)
	}
	if !info.Recalled || info.ID != "r1" || info.SenderID != "u2" {
		t.Fatalf("fields: %+v", info)
	}
	if info.CreatedAt != "2026-03-04T05:06:07Z" {
		t.Fatalf("CreatedAt = %q", info.CreatedAt)
	}
}

func TestBuildReplyToInfoNormal(t *testing.T) {
	reply := &model.Message{
		ID:          "r2",
		SenderID:    "u3",
		ContentType: model.ContentTypeText,
		Content:     "hi",
		Recalled:    false,
		CreatedAt:   time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC),
	}
	info := buildReplyToInfo(reply)
	if info.Content != "hi" || info.ContentType != model.ContentTypeText || info.Recalled {
		t.Fatalf("normal reply: %+v", info)
	}
}

func TestProjectOneMessage(t *testing.T) {
	editedAt := time.Date(2026, 6, 1, 12, 0, 0, 0, time.UTC)
	replyID := "parent-1"
	m := model.Message{
		ID:           "m1",
		SessionID:    "s1",
		SeqID:        7,
		ClientMsgID:  "c1",
		SenderType:   model.SenderTypeUser,
		SenderID:     "u1",
		ContentType:  model.ContentTypeText,
		Content:      "body",
		ReplyToMsgID: &replyID,
		Recalled:     false,
		Edited:       true,
		EditedAt:     &editedAt,
		CreatedAt:    time.Date(2026, 5, 1, 0, 0, 0, 0, time.UTC),
	}
	atts := map[string][]model.Attachment{
		"m1": {{ID: "att-1"}},
	}
	replies := map[string]*model.Message{
		"parent-1": {
			ID:          "parent-1",
			SenderID:    "u0",
			ContentType: model.ContentTypeText,
			Content:     "orig",
			CreatedAt:   time.Date(2026, 4, 1, 0, 0, 0, 0, time.UTC),
		},
	}
	resp := projectOneMessage(m, atts, replies)
	if resp.ID != "m1" || resp.SeqID != 7 || resp.EditedAt != "2026-06-01T12:00:00Z" {
		t.Fatalf("core fields: %+v", resp)
	}
	if len(resp.Attachments) != 1 || resp.Attachments[0].ID != "att-1" {
		t.Fatalf("attachments: %+v", resp.Attachments)
	}
	if resp.ReplyTo == nil || resp.ReplyTo.Content != "orig" {
		t.Fatalf("reply: %+v", resp.ReplyTo)
	}

	// nil EditedAt / nil reply map / empty attachments
	m2 := model.Message{
		ID:        "m2",
		CreatedAt: time.Date(2026, 5, 2, 0, 0, 0, 0, time.UTC),
	}
	resp2 := projectOneMessage(m2, nil, nil)
	if resp2.EditedAt != "" || resp2.Attachments != nil || resp2.ReplyTo != nil {
		t.Fatalf("empty projection: %+v", resp2)
	}
}

func TestProjectMessageResponses(t *testing.T) {
	msgs := []model.Message{
		{ID: "a", Content: "A", CreatedAt: time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)},
		{ID: "b", Content: "B", CreatedAt: time.Date(2026, 1, 2, 0, 0, 0, 0, time.UTC)},
	}
	out := projectMessageResponses(msgs, nil, nil)
	if len(out) != 2 || out[0].ID != "a" || out[1].ID != "b" {
		t.Fatalf("out = %+v", out)
	}
}
