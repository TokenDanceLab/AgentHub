package handler

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// --- Mock ---

type mockNotificationService struct {
	listNotifications func(ctx context.Context, userID string, unreadOnly bool, limit, offset int) ([]model.Notification, error)
	markRead          func(ctx context.Context, userID, notifID string) error
	markAllRead       func(ctx context.Context, userID string) error
}

func (m *mockNotificationService) ListNotifications(ctx context.Context, userID string, unreadOnly bool, limit, offset int) ([]model.Notification, error) {
	if m.listNotifications == nil {
		return nil, nil
	}
	return m.listNotifications(ctx, userID, unreadOnly, limit, offset)
}

func (m *mockNotificationService) MarkRead(ctx context.Context, userID, notifID string) error {
	if m.markRead == nil {
		return nil
	}
	return m.markRead(ctx, userID, notifID)
}

func (m *mockNotificationService) MarkAllRead(ctx context.Context, userID string) error {
	if m.markAllRead == nil {
		return nil
	}
	return m.markAllRead(ctx, userID)
}

// --- Tests ---

func TestNotificationHandler_ListNotifications(t *testing.T) {
	gin.SetMode(gin.TestMode)

	called := false
	svc := &mockNotificationService{
		listNotifications: func(ctx context.Context, userID string, unreadOnly bool, limit, offset int) ([]model.Notification, error) {
			called = true
			assert.Equal(t, "user-1", userID)
			assert.False(t, unreadOnly)
			assert.Equal(t, 50, limit) // DefaultPaginationLimit
			assert.Equal(t, 0, offset)
			return []model.Notification{
				{ID: "notif-1", UserID: userID, Type: "info", Read: false},
				{ID: "notif-2", UserID: userID, Type: "alert", Read: true},
			}, nil
		},
	}
	h := NewNotificationHandler(svc)

	r := gin.New()
	r.GET("/web/notifications", func(c *gin.Context) {
		c.Set("user_id", "user-1")
		h.ListNotifications(c)
	})

	req := httptest.NewRequest(http.MethodGet, "/web/notifications", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	require.True(t, called)
	assert.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Body.String(), "notif-1")
	assert.Contains(t, w.Body.String(), "notif-2")
}

func TestNotificationHandler_ListNotifications_UnreadOnly(t *testing.T) {
	gin.SetMode(gin.TestMode)

	called := false
	svc := &mockNotificationService{
		listNotifications: func(ctx context.Context, userID string, unreadOnly bool, limit, offset int) ([]model.Notification, error) {
			called = true
			assert.True(t, unreadOnly)
			return []model.Notification{
				{ID: "notif-1", UserID: userID, Type: "info", Read: false},
			}, nil
		},
	}
	h := NewNotificationHandler(svc)

	r := gin.New()
	r.GET("/web/notifications", func(c *gin.Context) {
		c.Set("user_id", "user-1")
		h.ListNotifications(c)
	})

	req := httptest.NewRequest(http.MethodGet, "/web/notifications?unread_only=true&limit=10&offset=5", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	require.True(t, called)
	assert.Equal(t, http.StatusOK, w.Code)
}

func TestNotificationHandler_MarkRead(t *testing.T) {
	gin.SetMode(gin.TestMode)

	called := false
	svc := &mockNotificationService{
		markRead: func(ctx context.Context, userID, notifID string) error {
			called = true
			assert.Equal(t, "user-1", userID)
			assert.Equal(t, "notif-1", notifID)
			return nil
		},
	}
	h := NewNotificationHandler(svc)

	r := gin.New()
	r.POST("/web/notifications/:id/read", func(c *gin.Context) {
		c.Set("user_id", "user-1")
		h.MarkRead(c)
	})

	req := httptest.NewRequest(http.MethodPost, "/web/notifications/notif-1/read", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	require.True(t, called)
	assert.Equal(t, http.StatusOK, w.Code)
}

func TestNotificationHandler_ReadAll(t *testing.T) {
	gin.SetMode(gin.TestMode)

	called := false
	svc := &mockNotificationService{
		markAllRead: func(ctx context.Context, userID string) error {
			called = true
			assert.Equal(t, "user-1", userID)
			return nil
		},
	}
	h := NewNotificationHandler(svc)

	r := gin.New()
	r.POST("/web/notifications/read-all", func(c *gin.Context) {
		c.Set("user_id", "user-1")
		h.ReadAll(c)
	})

	body := bytes.NewBufferString(`{}`)
	req := httptest.NewRequest(http.MethodPost, "/web/notifications/read-all", body)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	require.True(t, called)
	assert.Equal(t, http.StatusOK, w.Code)
}

// TestNotificationHandler_ListNotifications_OffsetClamped pins the offset
// clamp (#2154): client-supplied offsets are capped at MaxPaginationOffset
// and negatives normalize to 0 before reaching the service.
func TestNotificationHandler_ListNotifications_OffsetClamped(t *testing.T) {
	gin.SetMode(gin.TestMode)

	cases := []struct {
		query      string
		wantOffset int
	}{
		{"?offset=1000000", config.MaxPaginationOffset},
		{"?offset=-5", 0},
		{"?offset=abc", 0},
		{"?offset=42", 42},
	}
	for _, tc := range cases {
		t.Run(tc.query, func(t *testing.T) {
			gotOffset := -1
			svc := &mockNotificationService{
				listNotifications: func(ctx context.Context, userID string, unreadOnly bool, limit, offset int) ([]model.Notification, error) {
					gotOffset = offset
					return nil, nil
				},
			}
			h := NewNotificationHandler(svc)
			r := gin.New()
			r.GET("/web/notifications", func(c *gin.Context) {
				c.Set("user_id", "user-1")
				h.ListNotifications(c)
			})
			req := httptest.NewRequest(http.MethodGet, "/web/notifications"+tc.query, nil)
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)
			require.Equal(t, http.StatusOK, w.Code)
			assert.Equal(t, tc.wantOffset, gotOffset)
		})
	}
}
