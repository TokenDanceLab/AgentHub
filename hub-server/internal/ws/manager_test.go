package ws

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/stretchr/testify/require"
)

func TestManagerShutdown_ClosesAllConnections(t *testing.T) {
	m := NewManager()

	// Create test connections with real channels.
	c1 := &Conn{
		ID:   "conn-1",
		Send: make(chan []byte, 4),
	}
	c2 := &Conn{
		ID:   "conn-2",
		Send: make(chan []byte, 4),
	}

	m.mu.Lock()
	m.conns[c1.ID] = c1
	m.conns[c2.ID] = c2
	m.mu.Unlock()

	if m.Count() != 2 {
		t.Fatalf("Count = %d, want 2", m.Count())
	}

	m.Shutdown()

	if m.Count() != 0 {
		t.Fatalf("Count after Shutdown = %d, want 0", m.Count())
	}

	// Verify channels are closed (reading from a closed channel returns zero value).
	select {
	case _, ok := <-c1.Send:
		if ok {
			t.Fatal("c1.Send should be closed")
		}
	default:
		// Channel is closed and drained.
	}
	select {
	case _, ok := <-c2.Send:
		if ok {
			t.Fatal("c2.Send should be closed")
		}
	default:
	}
}

func TestManagerShutdown_UnblocksWriteLoopGoroutines(t *testing.T) {
	m := NewManager()

	c := &Conn{
		ID:   "conn-g",
		Send: make(chan []byte, 4),
	}

	m.mu.Lock()
	m.conns[c.ID] = c
	m.mu.Unlock()

	// Simulate a writeLoop goroutine blocked on the Send channel.
	writeLoopExited := make(chan struct{})
	go func() {
		defer close(writeLoopExited)
		for range c.Send {
			// In real code this would write to WebSocket; here we just drain.
		}
	}()

	// Give the goroutine time to block on range.
	time.Sleep(50 * time.Millisecond)

	m.Shutdown()

	// writeLoop should exit within a reasonable time.
	select {
	case <-writeLoopExited:
		// OK — goroutine exited.
	case <-time.After(2 * time.Second):
		t.Fatal("writeLoop goroutine did not exit after Shutdown")
	}
}

func TestManagerUnregister_Idempotent(t *testing.T) {
	m := NewManager()

	c := &Conn{
		ID:   "conn-idem",
		Send: make(chan []byte, 4),
	}

	m.mu.Lock()
	m.conns[c.ID] = c
	m.mu.Unlock()

	// First unregister.
	m.Unregister(c.ID)
	if m.Count() != 0 {
		t.Fatalf("Count after first Unregister = %d, want 0", m.Count())
	}

	// Second unregister of the same conn — must not panic.
	m.Unregister(c.ID)
	if m.Count() != 0 {
		t.Fatalf("Count after second Unregister = %d, want 0", m.Count())
	}
}

func TestManagerUnregister_AfterShutdown(t *testing.T) {
	// Verify that Unregister called after Shutdown (by readLoop defers)
	// does not panic.
	m := NewManager()

	c := &Conn{
		ID:   "conn-post-shutdown",
		Send: make(chan []byte, 4),
	}

	m.mu.Lock()
	m.conns[c.ID] = c
	m.mu.Unlock()

	m.Shutdown()

	// readLoop defer calls Unregister — must not panic.
	m.Unregister(c.ID)
}

func TestPushToConn_AfterChannelClosed(t *testing.T) {
	// Verify PushToConn does not panic when the Send channel is already closed.
	m := NewManager()

	c := &Conn{
		ID:   "conn-safe",
		Send: make(chan []byte, 4),
	}

	m.mu.Lock()
	m.conns[c.ID] = c
	m.mu.Unlock()

	// Close the channel manually (simulating shutdown race).
	c.closeSend()

	// PushToConn must not panic.
	m.PushToConn(c.ID, NewFrame(TypeMessageNew, map[string]string{
		"session_id": "sess-1",
	}))
}

func TestPushToConn_AfterUnregister(t *testing.T) {
	// PushToConn must not panic after the connection has been unregistered
	// and its channel closed.
	m := NewManager()

	c := &Conn{
		ID:   "conn-after-unreg",
		Send: make(chan []byte, 4),
	}

	m.mu.Lock()
	m.conns[c.ID] = c
	m.mu.Unlock()

	m.Unregister(c.ID)

	// PushToConn to unregistered conn — must not panic, just drop.
	m.PushToConn(c.ID, NewFrame(TypeMessageNew, map[string]string{
		"session_id": "sess-1",
	}))
}

func TestPushToConnReportsDeliveryResult(t *testing.T) {
	t.Run("queued", func(t *testing.T) {
		m := NewManager()
		c := &Conn{
			ID:   "conn-ok",
			Send: make(chan []byte, 1),
		}
		m.mu.Lock()
		m.conns[c.ID] = c
		m.mu.Unlock()

		result := m.PushToConn(c.ID, NewFrame(TypeMessageNew, map[string]string{
			"session_id": "sess-1",
		}))

		require.True(t, result.Queued)
		require.Equal(t, DeliveryStatusQueued, result.Status)
		require.NoError(t, result.Err)
		require.Len(t, c.Send, 1)
	})

	t.Run("missing connection", func(t *testing.T) {
		m := NewManager()

		result := m.PushToConn("missing-conn", NewFrame(TypeMessageNew, map[string]string{
			"session_id": "sess-1",
		}))

		require.False(t, result.Queued)
		require.Equal(t, DeliveryStatusConnNotFound, result.Status)
		require.ErrorIs(t, result.Err, ErrDeliveryConnNotFound)
	})

	t.Run("closed connection", func(t *testing.T) {
		m := NewManager()
		c := &Conn{
			ID:   "conn-closed",
			Send: make(chan []byte, 1),
		}
		m.mu.Lock()
		m.conns[c.ID] = c
		m.mu.Unlock()
		c.closeSend()

		result := m.PushToConn(c.ID, NewFrame(TypeMessageNew, map[string]string{
			"session_id": "sess-1",
		}))

		require.False(t, result.Queued)
		require.Equal(t, DeliveryStatusConnClosed, result.Status)
		require.ErrorIs(t, result.Err, ErrDeliveryConnClosed)
	})

	t.Run("send buffer full", func(t *testing.T) {
		m := NewManager()
		c := &Conn{
			ID:   "conn-full",
			Send: make(chan []byte, 1),
		}
		c.Send <- []byte("already queued")
		m.mu.Lock()
		m.conns[c.ID] = c
		m.mu.Unlock()

		result := m.PushToConn(c.ID, NewFrame(TypeMessageNew, map[string]string{
			"session_id": "sess-1",
		}))

		require.False(t, result.Queued)
		require.Equal(t, DeliveryStatusBufferFull, result.Status)
		require.ErrorIs(t, result.Err, ErrDeliveryBufferFull)
		require.Len(t, c.Send, 1)
	})

	t.Run("marshal error", func(t *testing.T) {
		m := NewManager()
		c := &Conn{
			ID:   "conn-marshal",
			Send: make(chan []byte, 1),
		}
		m.mu.Lock()
		m.conns[c.ID] = c
		m.mu.Unlock()

		result := m.PushToConn(c.ID, NewFrame(TypeMessageNew, make(chan int)))

		require.False(t, result.Queued)
		require.Equal(t, DeliveryStatusMarshalError, result.Status)
		require.ErrorIs(t, result.Err, ErrDeliveryMarshalError)
		require.Empty(t, c.Send)
	})
}

func TestPushToConn_ConcurrentShutdownRace(t *testing.T) {
	// Stress-test the race between PushToConn and Shutdown.
	m := NewManager()

	const numConns = 50
	var conns []*Conn

	for i := 0; i < numConns; i++ {
		c := &Conn{
			ID:   "conn-race-" + string(rune('A'+i%26)) + string(rune('0'+i/26)),
			Send: make(chan []byte, 8),
		}
		conns = append(conns, c)
		m.mu.Lock()
		m.conns[c.ID] = c
		m.mu.Unlock()
	}

	var wg sync.WaitGroup

	// Start many PushToConn calls.
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			c := conns[idx%numConns]
			m.PushToConn(c.ID, NewFrame(TypeMessageNew, map[string]string{
				"text": "hello",
			}))
		}(i)
	}

	// Shutdown concurrently.
	wg.Add(1)
	go func() {
		defer wg.Done()
		m.Shutdown()
	}()

	// This must not panic.
	wg.Wait()
}

func TestConnCloseSend_ExactlyOnce(t *testing.T) {
	c := &Conn{Send: make(chan []byte, 4)}

	var wg sync.WaitGroup
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			c.closeSend()
		}()
	}
	wg.Wait()

	// Channel should be closed; reading should not panic.
	if !c.closed.Load() {
		t.Fatal("c.closed should be true after closeSend")
	}

	defer func() {
		if r := recover(); r != nil {
			t.Fatalf("unexpected panic: %v", r)
		}
	}()
	// Drain the closed channel.
	for range c.Send {
	}
}

func TestManagerSetAuthKeepsDifferentDesktopDevicesOnline(t *testing.T) {
	m := NewManager()
	routeEvents := make([]string, 0, 2)
	m.OnRouteSet = func(userID, deviceType, deviceID, connID, oldConnID string, wasOffline bool) {
		routeEvents = append(routeEvents, oldConnID)
	}

	connA := &Conn{Send: make(chan []byte, 4)}
	connB := &Conn{Send: make(chan []byte, 4)}
	require.NoError(t, m.Register(connA))
	require.NoError(t, m.Register(connB))

	m.SetAuth(connA.ID, "user-route", "desktop", "dev-a")
	m.SetAuth(connB.ID, "user-route", "desktop", "dev-b")

	require.Len(t, routeEvents, 2)
	require.Equal(t, "", routeEvents[0])
	require.Equal(t, "", routeEvents[1])
	require.NotNil(t, m.FindByConnID(connA.ID))
	require.NotNil(t, m.FindByConnID(connB.ID))
}

func TestManagerSetAuthReportsOldConnForSameDesktopDeviceReconnect(t *testing.T) {
	m := NewManager()
	routeEvents := make([]string, 0, 2)
	m.OnRouteSet = func(userID, deviceType, deviceID, connID, oldConnID string, wasOffline bool) {
		routeEvents = append(routeEvents, oldConnID)
	}

	connOld := &Conn{Send: make(chan []byte, 4)}
	connNew := &Conn{Send: make(chan []byte, 4)}
	require.NoError(t, m.Register(connOld))
	require.NoError(t, m.Register(connNew))

	m.SetAuth(connOld.ID, "user-route", "desktop", "dev-a")
	m.SetAuth(connNew.ID, "user-route", "desktop", "dev-a")

	require.Len(t, routeEvents, 2)
	require.Equal(t, connOld.ID, routeEvents[1])
}

func TestWebSocketManagerShutdownFullLifecycle(t *testing.T) {
	// End-to-end: start a real WS server, connect, then shutdown.
	manager := NewManager()

	// Use a minimal HTTP server to accept ONE WebSocket connection.
	mux := http.NewServeMux()
	mux.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		wsConn, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		conn := NewConn(wsConn)
		_ = manager.Register(conn)

		// Simulate read/write loops (simplified).
		go func() {
			defer manager.Unregister(conn.ID)
			defer conn.Close()
			for {
				_, _, err := wsConn.Read(context.Background())
				if err != nil {
					return
				}
			}
		}()
		go func() {
			defer conn.Close()
			for range conn.Send {
				// In real code: write to WS.
			}
		}()
	})

	srv := httptest.NewServer(mux)
	defer srv.Close()

	wsURL := "ws" + srv.URL[4:] + "/ws"

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	conn, _, err := websocket.Dial(ctx, wsURL, nil)
	if err != nil {
		t.Fatalf("dial websocket: %v", err)
	}

	// Wait for registration.
	time.Sleep(100 * time.Millisecond)
	if manager.Count() != 1 {
		t.Fatalf("Count = %d, want 1", manager.Count())
	}

	// Shutdown the manager (close channels, connections).
	manager.Shutdown()

	time.Sleep(200 * time.Millisecond)

	// Connection should have been closed by shutdown.
	_, _, err = conn.Read(context.Background())
	if err == nil {
		t.Fatal("expected read error after shutdown")
	}
	conn.Close(websocket.StatusNormalClosure, "")
}

func TestWSReadTimeoutConstant(t *testing.T) {
	expected := 2 * 30 * time.Second
	if WSReadTimeout != expected {
		t.Fatalf("WSReadTimeout = %v, want %v (2x 30s heartbeat)", WSReadTimeout, expected)
	}
}

func TestReadMessageDeliversData(t *testing.T) {
	// End-to-end: writeLoop + readLoop using ReadMessage.
	manager := NewManager()

	mux := http.NewServeMux()
	mux.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		wsConn, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		conn := NewConn(wsConn)
		_ = manager.Register(conn)

		// Write a message, then close.
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		wsConn.Write(ctx, websocket.MessageText, []byte(`{"type":"hello"}`))
		wsConn.Close(websocket.StatusNormalClosure, "")
	})

	srv := httptest.NewServer(mux)
	defer srv.Close()

	wsURL := "ws" + srv.URL[4:] + "/ws"
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	conn, _, err := websocket.Dial(ctx, wsURL, nil)
	if err != nil {
		t.Fatalf("dial websocket: %v", err)
	}
	defer conn.Close(websocket.StatusNormalClosure, "")

	wsConn := NewConn(conn)
	data, err := wsConn.ReadMessage(context.Background())
	if err != nil {
		t.Fatalf("ReadMessage: %v", err)
	}
	if string(data) != `{"type":"hello"}` {
		t.Fatalf("ReadMessage data = %q, want %q", string(data), `{"type":"hello"}`)
	}
}

func TestReadMessageDeadlineFires(t *testing.T) {
	// Create a live WS pair.  The server never writes, so ReadMessage must
	// time out per the caller-supplied context deadline.
	manager := NewManager()

	serverDone := make(chan struct{})
	mux := http.NewServeMux()
	mux.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		defer close(serverDone)
		wsConn, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		conn := NewConn(wsConn)
		_ = manager.Register(conn)
		defer manager.Unregister(conn.ID)
		defer conn.Close()

		// Read one message (the client will send "ping" to confirm connection).
		_, data, err := wsConn.Read(context.Background())
		if err != nil {
			return
		}
		if string(data) != "ping" {
			return
		}

		// Then just block — never write.  The client's ReadMessage should time out.
		select {
		case <-time.After(5 * time.Second):
		case <-r.Context().Done():
		}
	})

	srv := httptest.NewServer(mux)
	defer srv.Close()

	wsURL := "ws" + srv.URL[4:] + "/ws"
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	clientConn, _, err := websocket.Dial(ctx, wsURL, nil)
	if err != nil {
		t.Fatalf("dial websocket: %v", err)
	}
	defer clientConn.Close(websocket.StatusNormalClosure, "")

	// Confirm the connection is alive.
	if err := clientConn.Write(ctx, websocket.MessageText, []byte("ping")); err != nil {
		t.Fatalf("write ping: %v", err)
	}

	// Use a short deadline — 200ms — much shorter than the ws package default
	// of 60s, but still shorter than the server's 5s block.
	shortCtx, shortCancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer shortCancel()

	wsConn := NewConn(clientConn)
	_, err = wsConn.ReadMessage(shortCtx)
	if err == nil {
		t.Fatal("expected ReadMessage to time out, but got no error")
	}
	// The error should be a context deadline / close error from the websocket
	// library after the deadline fires.
}

func TestReadMessageParentDeadlineWinsWhenShorter(t *testing.T) {
	// WSReadTimeout is 60s.  Pass a parent context with a 10ms deadline and
	// verify the shorter deadline wins (ReadMessage returns quickly).
	manager := NewManager()

	serverDone := make(chan struct{})
	mux := http.NewServeMux()
	mux.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		defer close(serverDone)
		wsConn, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		conn := NewConn(wsConn)
		_ = manager.Register(conn)
		defer manager.Unregister(conn.ID)
		defer conn.Close()

		// Read the ping, then block forever.
		_, _, err = wsConn.Read(context.Background())
		if err != nil {
			return
		}
		select {
		case <-time.After(10 * time.Second):
		case <-r.Context().Done():
		}
	})

	srv := httptest.NewServer(mux)
	defer srv.Close()

	wsURL := "ws" + srv.URL[4:] + "/ws"
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	clientConn, _, err := websocket.Dial(ctx, wsURL, nil)
	if err != nil {
		t.Fatalf("dial websocket: %v", err)
	}
	defer clientConn.Close(websocket.StatusNormalClosure, "")

	if err := clientConn.Write(ctx, websocket.MessageText, []byte("ping")); err != nil {
		t.Fatalf("write ping: %v", err)
	}

	wsConn := NewConn(clientConn)

	// Very short parent deadline — should fire well before the 60s default.
	start := time.Now()
	shortCtx, shortCancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
	defer shortCancel()
	_, err = wsConn.ReadMessage(shortCtx)
	elapsed := time.Since(start)

	if err == nil {
		t.Fatal("expected ReadMessage to time out when parent deadline is very short")
	}
	if elapsed > 2*time.Second {
		t.Fatalf("ReadMessage took %v with 10ms parent deadline; expected fast failure", elapsed)
	}
}
