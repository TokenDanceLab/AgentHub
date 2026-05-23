package handler_test

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/gin-gonic/gin"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/handler"
	"github.com/agenthub/hub-server/internal/service"
)

type mockMessageService struct {
	sendMsgFn     func(ctx context.Context, sessionID, senderUserID string, req service.SendMessageRequest) (*service.SendMessageResponse, error)
	getMsgsFn     func(ctx context.Context, sessionID, userID string, beforeSeq int64, limit int) ([]service.MessageResponse, error)
	getMsgsIncrFn func(ctx context.Context, sessionID, userID string, afterSeq int64, limit int) ([]service.MessageResponse, error)
	recallFn      func(ctx context.Context, msgID, userID string) error
	pinFn         func(ctx context.Context, userID, sessionID, msgID string) error
	unpinFn       func(ctx context.Context, userID, sessionID, msgID string) error
	listPinsFn    func(ctx context.Context, userID, sessionID string) ([]service.MessageResponse, error)
	forwardFn     func(ctx context.Context, userID, msgID string, targetSessionIDs []string) error
	markReadFn    func(ctx context.Context, userID, sessionID string, lastReadSeq int64) error
	searchFn      func(ctx context.Context, userID, q, sessionID, contentType, from, to string) ([]service.MessageResponse, error)
}

func (m *mockMessageService) SendMessage(ctx context.Context, sessionID, senderUserID string, req service.SendMessageRequest) (*service.SendMessageResponse, error) {
	return m.sendMsgFn(ctx, sessionID, senderUserID, req)
}
func (m *mockMessageService) GetMessages(ctx context.Context, sessionID, userID string, beforeSeq int64, limit int) ([]service.MessageResponse, error) {
	return m.getMsgsFn(ctx, sessionID, userID, beforeSeq, limit)
}
func (m *mockMessageService) GetMessagesIncremental(ctx context.Context, sessionID, userID string, afterSeq int64, limit int) ([]service.MessageResponse, error) {
	return m.getMsgsIncrFn(ctx, sessionID, userID, afterSeq, limit)
}
func (m *mockMessageService) RecallMessage(ctx context.Context, msgID, userID string) error {
	return m.recallFn(ctx, msgID, userID)
}
func (m *mockMessageService) PinMessage(ctx context.Context, userID, sessionID, msgID string) error {
	return m.pinFn(ctx, userID, sessionID, msgID)
}
func (m *mockMessageService) UnpinMessage(ctx context.Context, userID, sessionID, msgID string) error {
	return m.unpinFn(ctx, userID, sessionID, msgID)
}
func (m *mockMessageService) ListPinnedMessages(ctx context.Context, userID, sessionID string) ([]service.MessageResponse, error) {
	return m.listPinsFn(ctx, userID, sessionID)
}
func (m *mockMessageService) ForwardMessage(ctx context.Context, userID, msgID string, targetSessionIDs []string) error {
	return m.forwardFn(ctx, userID, msgID, targetSessionIDs)
}
func (m *mockMessageService) MarkRead(ctx context.Context, userID, sessionID string, lastReadSeq int64) error {
	return m.markReadFn(ctx, userID, sessionID, lastReadSeq)
}
func (m *mockMessageService) SearchMessages(ctx context.Context, userID, q, sessionID, contentType, from, to string) ([]service.MessageResponse, error) {
	return m.searchFn(ctx, userID, q, sessionID, contentType, from, to)
}

// ── SendMessage ─────────────────────────────────────────────────────

func TestMessageHandler_SendMessage_Success(t *testing.T) {
	svc := &mockMessageService{
		sendMsgFn: func(ctx context.Context, sessionID, senderUserID string, req service.SendMessageRequest) (*service.SendMessageResponse, error) {
			return &service.SendMessageResponse{MessageID: "m1", SeqID: 1, CreatedAt: "2026-01-01T00:00:00Z"}, nil
		},
	}
	h := handler.NewMessageHandler(svc)

	c, w := newGinCtx("POST", "/client/sessions/s1/messages", map[string]string{
		"client_msg_id": "c1",
		"content_type":  "text",
		"content":       "Hello world",
	}, "user_id", "u1")
	c.Params = gin.Params{{Key: "id", Value: "s1"}}
	h.SendMessage(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestMessageHandler_SendMessage_NotMember(t *testing.T) {
	svc := &mockMessageService{
		sendMsgFn: func(ctx context.Context, sessionID, senderUserID string, req service.SendMessageRequest) (*service.SendMessageResponse, error) {
			return nil, errcode.SessionNotMember
		},
	}
	h := handler.NewMessageHandler(svc)

	c, w := newGinCtx("POST", "/client/sessions/s1/messages", map[string]string{
		"client_msg_id": "c1",
		"content_type":  "text",
		"content":       "Hello",
	}, "user_id", "u1")
	c.Params = gin.Params{{Key: "id", Value: "s1"}}
	h.SendMessage(c)

	if w.Code != 403 {
		t.Fatalf("expected 403, got %d", w.Code)
	}
}

func TestMessageHandler_SendMessage_BadRequest(t *testing.T) {
	svc := &mockMessageService{}
	h := handler.NewMessageHandler(svc)

	c, w := newGinCtx("POST", "/client/sessions/s1/messages", nil, "user_id", "u1")
	c.Params = gin.Params{{Key: "id", Value: "s1"}}
	h.SendMessage(c)

	if w.Code != 400 {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

// ── GetMessages ─────────────────────────────────────────────────────

func TestMessageHandler_GetMessages_Success(t *testing.T) {
	svc := &mockMessageService{
		getMsgsFn: func(ctx context.Context, sessionID, userID string, beforeSeq int64, limit int) ([]service.MessageResponse, error) {
			return []service.MessageResponse{
				{ID: "m1", SessionID: sessionID, SeqID: 1, ContentType: "text", Content: "Hello"},
			}, nil
		},
	}
	h := handler.NewMessageHandler(svc)

	c, w := newGinCtx("GET", "/client/sessions/s1/messages", nil, "user_id", "u1")
	c.Params = gin.Params{{Key: "id", Value: "s1"}}
	h.GetMessages(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

func TestMessageHandler_GetMessages_WithParams(t *testing.T) {
	svc := &mockMessageService{
		getMsgsFn: func(ctx context.Context, sessionID, userID string, beforeSeq int64, limit int) ([]service.MessageResponse, error) {
			if beforeSeq != 100 || limit != 20 {
				t.Errorf("expected beforeSeq=100, limit=20, got %d, %d", beforeSeq, limit)
			}
			return []service.MessageResponse{}, nil
		},
	}
	h := handler.NewMessageHandler(svc)

	c, w := newGinCtx("GET", "/client/sessions/s1/messages?before_seq=100&limit=20", nil, "user_id", "u1")
	c.Params = gin.Params{{Key: "id", Value: "s1"}}
	c.Request.URL.RawQuery = "before_seq=100&limit=20"
	h.GetMessages(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestMessageHandler_GetMessages_InvalidBeforeSeq(t *testing.T) {
	svc := &mockMessageService{}
	h := handler.NewMessageHandler(svc)

	c, w := newGinCtx("GET", "/client/sessions/s1/messages?before_seq=abc", nil, "user_id", "u1")
	c.Params = gin.Params{{Key: "id", Value: "s1"}}
	c.Request.URL.RawQuery = "before_seq=abc"
	h.GetMessages(c)

	if w.Code != 400 {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

// ── GetIncrementalMessages ──────────────────────────────────────────

func TestMessageHandler_GetIncrementalMessages_Success(t *testing.T) {
	svc := &mockMessageService{
		getMsgsIncrFn: func(ctx context.Context, sessionID, userID string, afterSeq int64, limit int) ([]service.MessageResponse, error) {
			return []service.MessageResponse{}, nil
		},
	}
	h := handler.NewMessageHandler(svc)

	c, w := newGinCtx("GET", "/client/sessions/s1/messages/sync?after_seq=0", nil, "user_id", "u1")
	c.Params = gin.Params{{Key: "id", Value: "s1"}}
	c.Request.URL.RawQuery = "after_seq=0"
	h.GetIncrementalMessages(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

// ── RecallMessage ───────────────────────────────────────────────────

func TestMessageHandler_RecallMessage_Success(t *testing.T) {
	svc := &mockMessageService{
		recallFn: func(ctx context.Context, msgID, userID string) error { return nil },
	}
	h := handler.NewMessageHandler(svc)

	c, w := newGinCtx("POST", "/client/messages/m1/recall", nil, "user_id", "u1")
	c.Params = gin.Params{{Key: "id", Value: "m1"}}
	h.RecallMessage(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

func TestMessageHandler_RecallMessage_NotFound(t *testing.T) {
	svc := &mockMessageService{
		recallFn: func(ctx context.Context, msgID, userID string) error {
			return errcode.MsgNotFound
		},
	}
	h := handler.NewMessageHandler(svc)

	c, w := newGinCtx("POST", "/client/messages/m1/recall", nil, "user_id", "u1")
	c.Params = gin.Params{{Key: "id", Value: "bad"}}
	h.RecallMessage(c)

	if w.Code != 404 {
		t.Fatalf("expected 404, got %d", w.Code)
	}
}

// ── PinMessage ──────────────────────────────────────────────────────

func TestMessageHandler_PinMessage_Success(t *testing.T) {
	svc := &mockMessageService{
		pinFn: func(ctx context.Context, userID, sessionID, msgID string) error { return nil },
	}
	h := handler.NewMessageHandler(svc)

	c, w := newGinCtx("POST", "/client/messages/m1/pin", map[string]string{
		"session_id": "s1",
	}, "user_id", "u1")
	c.Params = gin.Params{{Key: "id", Value: "m1"}}
	h.PinMessage(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

func TestMessageHandler_PinMessage_BadRequest(t *testing.T) {
	svc := &mockMessageService{}
	h := handler.NewMessageHandler(svc)

	c, w := newGinCtx("POST", "/client/messages/m1/pin", nil, "user_id", "u1")
	c.Params = gin.Params{{Key: "id", Value: "m1"}}
	h.PinMessage(c)

	if w.Code != 400 {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

// ── UnpinMessage ────────────────────────────────────────────────────

func TestMessageHandler_UnpinMessage_Success(t *testing.T) {
	svc := &mockMessageService{
		unpinFn: func(ctx context.Context, userID, sessionID, msgID string) error { return nil },
	}
	h := handler.NewMessageHandler(svc)

	c, w := newGinCtx("DELETE", "/client/messages/m1/pin", map[string]string{
		"session_id": "s1",
	}, "user_id", "u1")
	c.Params = gin.Params{{Key: "id", Value: "m1"}}
	h.UnpinMessage(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

// ── ListPins ────────────────────────────────────────────────────────

func TestMessageHandler_ListPins_Success(t *testing.T) {
	svc := &mockMessageService{
		listPinsFn: func(ctx context.Context, userID, sessionID string) ([]service.MessageResponse, error) {
			return []service.MessageResponse{
				{ID: "m1", SessionID: sessionID, SeqID: 1, ContentType: "text", Content: "Pinned"},
			}, nil
		},
	}
	h := handler.NewMessageHandler(svc)

	c, w := newGinCtx("GET", "/client/sessions/s1/pins", nil, "user_id", "u1")
	c.Params = gin.Params{{Key: "id", Value: "s1"}}
	h.ListPins(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

// ── ForwardMessage ──────────────────────────────────────────────────

func TestMessageHandler_ForwardMessage_Success(t *testing.T) {
	svc := &mockMessageService{
		forwardFn: func(ctx context.Context, userID, msgID string, targetSessionIDs []string) error { return nil },
	}
	h := handler.NewMessageHandler(svc)

	c, w := newGinCtx("POST", "/client/messages/m1/forward", map[string]any{
		"target_session_ids": []string{"s2", "s3"},
	}, "user_id", "u1")
	c.Params = gin.Params{{Key: "id", Value: "m1"}}
	h.ForwardMessage(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestMessageHandler_ForwardMessage_BadRequest(t *testing.T) {
	svc := &mockMessageService{}
	h := handler.NewMessageHandler(svc)

	c, w := newGinCtx("POST", "/client/messages/m1/forward", nil, "user_id", "u1")
	c.Params = gin.Params{{Key: "id", Value: "m1"}}
	h.ForwardMessage(c)

	if w.Code != 400 {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

// ── MarkRead ────────────────────────────────────────────────────────

func TestMessageHandler_MarkRead_Success(t *testing.T) {
	svc := &mockMessageService{
		markReadFn: func(ctx context.Context, userID, sessionID string, lastReadSeq int64) error { return nil },
	}
	h := handler.NewMessageHandler(svc)

	c, w := newGinCtx("POST", "/client/sessions/s1/read", map[string]any{
		"last_read_seq": json.Number("42"),
	}, "user_id", "u1")
	c.Params = gin.Params{{Key: "id", Value: "s1"}}
	h.MarkRead(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

func TestMessageHandler_MarkRead_BadRequest(t *testing.T) {
	svc := &mockMessageService{}
	h := handler.NewMessageHandler(svc)

	c, w := newGinCtx("POST", "/client/sessions/s1/read", nil, "user_id", "u1")
	c.Params = gin.Params{{Key: "id", Value: "s1"}}
	h.MarkRead(c)

	if w.Code != 400 {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

// ── SearchMessages ──────────────────────────────────────────────────

func TestMessageHandler_SearchMessages_Success(t *testing.T) {
	svc := &mockMessageService{
		searchFn: func(ctx context.Context, userID, q, sessionID, contentType, from, to string) ([]service.MessageResponse, error) {
			return []service.MessageResponse{}, nil
		},
	}
	h := handler.NewMessageHandler(svc)

	c, w := newGinCtx("GET", "/client/messages/search?q=hello", nil, "user_id", "u1")
	c.Request.URL.RawQuery = "q=hello"
	h.SearchMessages(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

func TestMessageHandler_SearchMessages_EmptyQuery(t *testing.T) {
	svc := &mockMessageService{}
	h := handler.NewMessageHandler(svc)

	c, w := newGinCtx("GET", "/client/messages/search", nil, "user_id", "u1")
	h.SearchMessages(c)

	if w.Code != 400 {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

// ── SearchSessionMessages ───────────────────────────────────────────

func TestMessageHandler_SearchSessionMessages_Success(t *testing.T) {
	svc := &mockMessageService{
		searchFn: func(ctx context.Context, userID, q, sessionID, contentType, from, to string) ([]service.MessageResponse, error) {
			return []service.MessageResponse{
				{ID: "m1", SessionID: sessionID, ContentType: "text", Content: "hello"},
			}, nil
		},
	}
	h := handler.NewMessageHandler(svc)

	c, w := newGinCtx("GET", "/client/sessions/s1/messages/search?q=hello", nil, "user_id", "u1")
	c.Params = gin.Params{{Key: "id", Value: "s1"}}
	c.Request.URL.RawQuery = "q=hello"
	h.SearchSessionMessages(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

func TestMessageHandler_SearchSessionMessages_EmptyQuery(t *testing.T) {
	svc := &mockMessageService{}
	h := handler.NewMessageHandler(svc)

	c, w := newGinCtx("GET", "/client/sessions/s1/messages/search", nil, "user_id", "u1")
	c.Params = gin.Params{{Key: "id", Value: "s1"}}
	h.SearchSessionMessages(c)

	if w.Code != 400 {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}
