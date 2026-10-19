package handler

import (
	"context"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"

	"github.com/agenthub/hub-server/internal/ws"
)

// TestServeWS_RejectedHandshakeDoesNotKickOrChargeLimiter pins the ordering in
// ServeWS: the per-user limiter is charged only after SetAuth accepts the
// connection. If Acquire ran before the SetAuth cap check, the rejected 11th
// handshake would close the oldest live connection.
//
// The kick is observed on the connection itself: the first accepted client
// drains its auth.ok frame, then blocks on a second read. A kicked connection
// returns a close error; an untouched one stays open until its read context
// expires.
func TestServeWS_RejectedHandshakeDoesNotKickOrChargeLimiter(t *testing.T) {
	manager := ws.NewManager()
	gin.SetMode(gin.TestMode)
	router := gin.New()
	h := NewWebSocketHandler(manager, "")
	const userID = "user-limiter-order"
	router.GET("/client/ws", func(c *gin.Context) {
		c.Set("user_id", userID)
	}, h.ServeWS)

	srv := httptest.NewServer(router)
	t.Cleanup(srv.Close)

	url := "ws" + strings.TrimPrefix(srv.URL, "http") + "/client/ws"
	clients := make([]*websocket.Conn, 0, 10)
	t.Cleanup(func() {
		for _, client := range clients {
			_ = client.CloseNow()
		}
	})
	for i := 0; i < 10; i++ {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		client, _, err := websocket.Dial(ctx, url, nil)
		cancel()
		require.NoError(t, err, "dial accepted connection %d", i)
		clients = append(clients, client)
		// Auth is charged after the upgrade, so dial order alone does not
		// prove limiter order. Wait for this connection to be registered and
		// charged before opening the next one.
		require.Eventually(t, func() bool {
			return manager.Count() == i+1 && h.userLimiter.Count(userID) == i+1
		}, 5*time.Second, 10*time.Millisecond,
			"connection %d was not registered and charged before the next dial", i)
	}

	// Drain the first client's auth.ok so the next read observes only a kick.
	readCtx, cancelRead := context.WithTimeout(context.Background(), 5*time.Second)
	_, firstFrame, err := clients[0].Read(readCtx)
	cancelRead()
	require.NoError(t, err)
	require.Contains(t, string(firstFrame), "auth.ok")

	readResult := make(chan error, 1)
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_, _, readErr := clients[0].Read(ctx)
		readResult <- readErr
	}()

	// The 11th handshake is rejected by the per-user cap. Dial may fail or
	// succeed and then close; either outcome is a rejected handshake.
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	rejected, _, _ := websocket.Dial(ctx, url, nil)
	cancel()
	if rejected != nil {
		_ = rejected.CloseNow()
	}

	select {
	case readErr := <-readResult:
		require.ErrorIs(t, readErr, context.DeadlineExceeded,
			"a rejected handshake closed a live connection instead of leaving it open")
	case <-time.After(700 * time.Millisecond):
	}
	require.Equal(t, 10, h.userLimiter.Count(userID),
		"the rejected handshake must not add or remove a limiter slot")
}
