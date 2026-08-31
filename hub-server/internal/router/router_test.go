package router

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/alicebob/miniredis/v2"
	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/cache"
	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/handler"
	"github.com/agenthub/hub-server/internal/metrics"
	"github.com/agenthub/hub-server/internal/middleware"
	"github.com/agenthub/hub-server/internal/service/message"
	"github.com/agenthub/hub-server/internal/service/messagereaction"
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
	if err := SetupRoutes(
		r,
		&config.Config{},
		middleware.NewAuthMiddleware(&config.Config{}, middleware.AuthDependencies{}, nil),
		"",
		cache.NewClient(redis.NewClient(&redis.Options{Addr: mr.Addr()})),
		nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil,
	); err != nil {
		t.Fatal(err)
	}

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

func TestHealthRoutesExposeCompatibleLiveAndReadyEndpoints(t *testing.T) {
	gin.SetMode(gin.TestMode)
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("miniredis: %v", err)
	}
	t.Cleanup(mr.Close)

	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() {
		if err := rdb.Close(); err != nil {
			t.Fatalf("redis close: %v", err)
		}
	})
	cacheClient := cache.NewClient(rdb)

	sqlDB, mock, err := sqlmock.New(sqlmock.MonitorPingsOption(true))
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	t.Cleanup(func() {
		_ = sqlDB.Close()
	})
	mock.ExpectPing()
	mock.ExpectPing()

	gormDB, err := gorm.Open(postgres.New(postgres.Config{Conn: sqlDB}), &gorm.Config{
		SkipDefaultTransaction: true,
		PrepareStmt:            false,
		DisableAutomaticPing:   true,
	})
	if err != nil {
		t.Fatalf("gorm open: %v", err)
	}

	healthHandler := handler.NewHealthHandler(gormDB, cacheClient, &config.DBConfig{
		Host: "127.0.0.1",
		Port: 9999,
		User: "test",
		Name: "testdb",
	}, time.Now(), "router-test")

	r := gin.New()
	if err := SetupRoutes(
		r,
		&config.Config{},
		middleware.NewAuthMiddleware(&config.Config{}, middleware.AuthDependencies{}, nil),
		"",
		cacheClient,
		nil, nil, nil, nil, nil, nil, nil, nil, nil, nil,
		healthHandler,
		nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil,
	); err != nil {
		t.Fatal(err)
	}

	tests := []struct {
		path string
		want int
	}{
		{path: "/health", want: http.StatusOK},
		{path: "/health/live", want: http.StatusOK},
		{path: "/health/ready", want: http.StatusServiceUnavailable},
	}

	for _, tt := range tests {
		t.Run(tt.path, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, tt.path, nil)
			w := httptest.NewRecorder()

			r.ServeHTTP(w, req)

			if w.Code != tt.want {
				t.Fatalf("status = %d, want %d; body=%q", w.Code, tt.want, w.Body.String())
			}
		})
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("sql expectations: %v", err)
	}
}

type routerMessageServiceStub struct{}

func (routerMessageServiceStub) SendMessage(ctx context.Context, sessionID, senderUserID string, req message.SendMessageRequest) (*message.SendMessageResponse, error) {
	return nil, nil
}
func (routerMessageServiceStub) GetMessages(ctx context.Context, sessionID, userID string, beforeSeq int64, limit int) ([]message.MessageResponse, error) {
	return nil, nil
}
func (routerMessageServiceStub) GetMessagesIncremental(ctx context.Context, sessionID, userID string, afterSeq int64, limit int) ([]message.MessageResponse, error) {
	return nil, nil
}
func (routerMessageServiceStub) EditMessage(ctx context.Context, msgID, userID string, req message.EditMessageRequest) (*message.EditMessageResponse, error) {
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
func (routerMessageServiceStub) ListPinnedMessages(ctx context.Context, userID, sessionID string) ([]message.MessageResponse, error) {
	return nil, nil
}
func (routerMessageServiceStub) ForwardMessage(ctx context.Context, userID, msgID string, targetSessionIDs []string) error {
	return nil
}
func (routerMessageServiceStub) MarkRead(ctx context.Context, userID, sessionID string, lastReadSeq int64) error {
	return nil
}
func (routerMessageServiceStub) SearchMessages(ctx context.Context, userID, q, sessionID, contentType, from, to, cursor string, pageSize int) (*message.MessageSearchPage, error) {
	return nil, nil
}
func (routerMessageServiceStub) AddMessageReaction(ctx context.Context, userID, sessionID, msgID, reaction string) (*messagereaction.MessageReactionResponse, error) {
	return nil, nil
}
func (routerMessageServiceStub) RemoveMessageReaction(ctx context.Context, userID, sessionID, msgID, reaction string) (*messagereaction.MessageReactionResponse, error) {
	return nil, nil
}
func (routerMessageServiceStub) ListMessageReactions(ctx context.Context, userID, sessionID, msgID string) ([]messagereaction.MessageReactionResponse, error) {
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
	if err := SetupRoutes(
		r,
		&config.Config{},
		middleware.NewAuthMiddleware(&config.Config{}, middleware.AuthDependencies{}, nil),
		"",
		cache.NewClient(redis.NewClient(&redis.Options{Addr: mr.Addr()})),
		nil, nil, nil, nil, nil,
		handler.NewMessageHandler(routerMessageServiceStub{}),
		nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil,
	); err != nil {
		t.Fatal(err)
	}

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
	if err := SetupRoutes(
		r,
		&config.Config{},
		middleware.NewAuthMiddleware(&config.Config{}, middleware.AuthDependencies{}, nil),
		"",
		cache.NewClient(redis.NewClient(&redis.Options{Addr: mr.Addr()})),
		nil, nil, nil, nil, nil,
		handler.NewMessageHandler(routerMessageServiceStub{}),
		nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil,
	); err != nil {
		t.Fatal(err)
	}

	for _, tt := range []struct {
		method string
		path   string
	}{
		{method: http.MethodGet, path: "/client/messages/msg-1/reactions?session_id=sess-1"},
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
