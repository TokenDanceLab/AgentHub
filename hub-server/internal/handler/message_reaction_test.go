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

func TestMessageHandler_AddMessageReaction_Success(t *testing.T) {
	svc := &mockMessageService{
		addReactionFn: func(ctx context.Context, userID, sessionID, msgID, reaction string) (*service.MessageReactionResponse, error) {
			if userID != "u1" || sessionID != "s1" || msgID != "m1" || reaction != "heart" {
				t.Fatalf("unexpected add reaction args: userID=%s sessionID=%s msgID=%s reaction=%s", userID, sessionID, msgID, reaction)
			}
			return &service.MessageReactionResponse{
				MessageID:   msgID,
				SessionID:   sessionID,
				Reaction:    reaction,
				Count:       2,
				ReactedByMe: true,
			}, nil
		},
	}
	h := handler.NewMessageHandler(svc)

	c, w := newGinCtx("POST", "/client/messages/m1/reactions", map[string]string{
		"session_id": "s1",
		"reaction":   "heart",
	}, "user_id", "u1")
	c.Params = gin.Params{{Key: "id", Value: "m1"}}
	h.AddMessageReaction(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var body struct {
		Code string                          `json:"code"`
		Data service.MessageReactionResponse `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	if body.Data.MessageID != "m1" || body.Data.SessionID != "s1" || body.Data.Reaction != "heart" || body.Data.Count != 2 || !body.Data.ReactedByMe {
		t.Fatalf("unexpected response: %+v", body.Data)
	}
}

func TestMessageHandler_AddMessageReaction_BadRequest(t *testing.T) {
	svc := &mockMessageService{}
	h := handler.NewMessageHandler(svc)

	c, w := newGinCtx("POST", "/client/messages/m1/reactions", nil, "user_id", "u1")
	c.Params = gin.Params{{Key: "id", Value: "m1"}}
	h.AddMessageReaction(c)

	if w.Code != 400 {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestMessageHandler_RemoveMessageReaction_Success(t *testing.T) {
	svc := &mockMessageService{
		removeReactionFn: func(ctx context.Context, userID, sessionID, msgID, reaction string) (*service.MessageReactionResponse, error) {
			if userID != "u1" || sessionID != "s1" || msgID != "m1" || reaction != "heart" {
				t.Fatalf("unexpected remove reaction args: userID=%s sessionID=%s msgID=%s reaction=%s", userID, sessionID, msgID, reaction)
			}
			return &service.MessageReactionResponse{
				MessageID:   msgID,
				SessionID:   sessionID,
				Reaction:    reaction,
				Count:       1,
				ReactedByMe: false,
			}, nil
		},
	}
	h := handler.NewMessageHandler(svc)

	c, w := newGinCtx("DELETE", "/client/messages/m1/reactions", map[string]string{
		"session_id": "s1",
		"reaction":   "heart",
	}, "user_id", "u1")
	c.Params = gin.Params{{Key: "id", Value: "m1"}}
	h.RemoveMessageReaction(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestMessageHandler_RemoveMessageReaction_NotMember(t *testing.T) {
	svc := &mockMessageService{
		removeReactionFn: func(ctx context.Context, userID, sessionID, msgID, reaction string) (*service.MessageReactionResponse, error) {
			return nil, errcode.SessionNotMember
		},
	}
	h := handler.NewMessageHandler(svc)

	c, w := newGinCtx("DELETE", "/client/messages/m1/reactions", map[string]string{
		"session_id": "s1",
		"reaction":   "heart",
	}, "user_id", "u1")
	c.Params = gin.Params{{Key: "id", Value: "m1"}}
	h.RemoveMessageReaction(c)

	if w.Code != 403 {
		t.Fatalf("expected 403, got %d", w.Code)
	}
}
