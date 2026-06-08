package router

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"

	"github.com/agenthub/hub-server/internal/cache"
	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/handler"
	"github.com/agenthub/hub-server/internal/metrics"
	"github.com/agenthub/hub-server/internal/service"
)

func TestNoRouteReturnsNotFound(t *testing.T) {
	gin.SetMode(gin.TestMode)
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("miniredis: %v", err)
	}
	t.Cleanup(mr.Close)
	metrics.Register()

	r := gin.New()
	SetupRoutes(
		r,
		&config.Config{},
		"",
		cache.NewClient(redis.NewClient(&redis.Options{Addr: mr.Addr()})),
		nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil,
	)

	for _, path := range []string{"/does-not-exist", "/metrics", "/debug/pprof/"} {
		t.Run(path, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, path, nil)
			w := httptest.NewRecorder()

			r.ServeHTTP(w, req)

			if w.Code != http.StatusNotFound {
				t.Fatalf("status = %d, want %d; body=%q", w.Code, http.StatusNotFound, w.Body.String())
			}
		})
	}
}

type routerMessageServiceStub struct{}

func (routerMessageServiceStub) SendMessage(ctx context.Context, sessionID, senderUserID string, req service.SendMessageRequest) (*service.SendMessageResponse, error) {
	return nil, nil
}
func (routerMessageServiceStub) GetMessages(ctx context.Context, sessionID, userID string, beforeSeq int64, limit int) ([]service.MessageResponse, error) {
	return nil, nil
}
func (routerMessageServiceStub) GetMessagesIncremental(ctx context.Context, sessionID, userID string, afterSeq int64, limit int) ([]service.MessageResponse, error) {
	return nil, nil
}
func (routerMessageServiceStub) EditMessage(ctx context.Context, msgID, userID string, req service.EditMessageRequest) (*service.EditMessageResponse, error) {
	return nil, nil
}
func (routerMessageServiceStub) RecallMessage(ctx context.Context, msgID, userID string) error {
	return nil
}
func (routerMessageServiceStub) PinMessage(ctx context.Context, userID, sessionID, msgID string) error {
	return nil
}
func (routerMessageServiceStub) UnpinMessage(ctx context.Context, userID, sessionID, msgID string) error {
	return nil
}
func (routerMessageServiceStub) ListPinnedMessages(ctx context.Context, userID, sessionID string) ([]service.MessageResponse, error) {
	return nil, nil
}
func (routerMessageServiceStub) ForwardMessage(ctx context.Context, userID, msgID string, targetSessionIDs []string) error {
	return nil
}
func (routerMessageServiceStub) MarkRead(ctx context.Context, userID, sessionID string, lastReadSeq int64) error {
	return nil
}
func (routerMessageServiceStub) SearchMessages(ctx context.Context, userID, q, sessionID, contentType, from, to string) ([]service.MessageResponse, error) {
	return nil, nil
}
func (routerMessageServiceStub) AddMessageReaction(ctx context.Context, userID, sessionID, msgID, reaction string) (*service.MessageReactionResponse, error) {
	return nil, nil
}
func (routerMessageServiceStub) RemoveMessageReaction(ctx context.Context, userID, sessionID, msgID, reaction string) (*service.MessageReactionResponse, error) {
	return nil, nil
}

func TestClientMessagesEditRouteIsRegistered(t *testing.T) {
	gin.SetMode(gin.TestMode)
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("miniredis: %v", err)
	}
	t.Cleanup(mr.Close)
	metrics.Register()

	r := gin.New()
	SetupRoutes(
		r,
		&config.Config{},
		"",
		cache.NewClient(redis.NewClient(&redis.Options{Addr: mr.Addr()})),
		nil, nil, nil, nil, nil,
		handler.NewMessageHandler(routerMessageServiceStub{}),
		nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil,
	)

	req := httptest.NewRequest(http.MethodPut, "/client/messages/msg-1", nil)
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	if w.Code == http.StatusNotFound || w.Code == http.StatusMethodNotAllowed {
		t.Fatalf("PUT /client/messages/:id was not registered; status=%d body=%q", w.Code, w.Body.String())
	}
}

func TestClientMessageReactionRoutesAreRegistered(t *testing.T) {
	gin.SetMode(gin.TestMode)
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("miniredis: %v", err)
	}
	t.Cleanup(mr.Close)
	metrics.Register()

	r := gin.New()
	SetupRoutes(
		r,
		&config.Config{},
		"",
		cache.NewClient(redis.NewClient(&redis.Options{Addr: mr.Addr()})),
		nil, nil, nil, nil, nil,
		handler.NewMessageHandler(routerMessageServiceStub{}),
		nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil,
	)

	for _, tt := range []struct {
		method string
		path   string
	}{
		{method: http.MethodPost, path: "/client/messages/msg-1/reactions"},
		{method: http.MethodDelete, path: "/client/messages/msg-1/reactions"},
	} {
		t.Run(tt.method, func(t *testing.T) {
			req := httptest.NewRequest(tt.method, tt.path, nil)
			w := httptest.NewRecorder()

			r.ServeHTTP(w, req)

			if w.Code == http.StatusNotFound || w.Code == http.StatusMethodNotAllowed {
				t.Fatalf("%s %s was not registered; status=%d body=%q", tt.method, tt.path, w.Code, w.Body.String())
			}
		})
	}
}
