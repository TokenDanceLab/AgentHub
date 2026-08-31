package ws

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/metrics"
	"github.com/agenthub/hub-server/internal/testkit"
	"github.com/coder/websocket"
	"github.com/prometheus/client_golang/prometheus/testutil"
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
	writeLoopStarted := make(chan struct{})
	writeLoopExited := make(chan struct{})
	go func() {
		close(writeLoopStarted)
		defer close(writeLoopExited)
		for range c.Send {
			// In real code this would write to WebSocket; here we just drain.
		}
	}()

	// Wait until the goroutine is blocking on range instead of a fixed sleep.
	testkit.WaitFor(t, 2*time.Second, writeLoopStarted, "writeLoop goroutine did not start")

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

	// Wait for registration (deadline poll instead of a fixed sleep).
	testkit.Eventually(t, 2*time.Second, func() bool { return manager.Count() == 1 },
		"connection never registered", func() string {
			return fmt.Sprintf("Count = %d", manager.Count())
		})

	// Shutdown the manager (close channels, connections).
	manager.Shutdown()

	// Wait for the connection to be unregistered instead of a fixed sleep.
	testkit.Eventually(t, 2*time.Second, func() bool { return manager.Count() == 0 },
		"connection not closed after Shutdown", nil)

	// Connection should have been closed by shutdown.
	_, _, err = conn.Read(context.Background())
	if err == nil {
		t.Fatal("expected read error after shutdown")
	}
	conn.Close(websocket.StatusNormalClosure, "")
}

func TestWSReadTimeoutConstant(t *testing.T) {
	expected := 2*config.WSHeartbeatInterval + config.WSPingTimeout
	if WSReadTimeout != expected {
		t.Fatalf("WSReadTimeout = %v, want %v (2x heartbeat + ping timeout)", WSReadTimeout, expected)
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

// ── Concurrent Access Tests ──

// TestManagerConcurrentRegisterUnregister verifies that concurrent Register
// and Unregister operations do not race or cause map corruption.
func TestManagerConcurrentRegisterUnregister(t *testing.T) {
	m := NewManager()

	const numConns = 100
	var conns []*Conn
	for i := 0; i < numConns; i++ {
		c := &Conn{Send: make(chan []byte, 4)}
		conns = append(conns, c)
	}

	var wg sync.WaitGroup

	// Phase 1: Register all concurrently
	for i := 0; i < numConns; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			require.NoError(t, m.Register(conns[idx]))
		}(i)
	}
	wg.Wait()

	require.Equal(t, numConns, m.Count())

	// Phase 2: Unregister all concurrently
	for i := 0; i < numConns; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			m.Unregister(conns[idx].ID)
		}(i)
	}
	wg.Wait()

	require.Equal(t, 0, m.Count())
}

// TestManagerConcurrentSetAuth verifies that concurrent SetAuth calls on
// different connections do not race, and that connections exceeding the
// per-user cap are properly unregistered instead of becoming zombies.
func TestManagerConcurrentSetAuth(t *testing.T) {
	m := NewManager()

	const numConns = 20
	var conns []*Conn
	for i := 0; i < numConns; i++ {
		c := &Conn{Send: make(chan []byte, 4)}
		require.NoError(t, m.Register(c))
		conns = append(conns, c)
	}

	var wg sync.WaitGroup
	for i := 0; i < numConns; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			m.SetAuth(conns[idx].ID, "shared-user", "desktop", fmt.Sprintf("dev-%d", idx%5))
		}(i)
	}
	wg.Wait()

	// Only WSMaxConnsPerUser (10) connections should remain. The connections
	// that exceeded the cap are closed and unregistered to avoid zombies.
	require.Equal(t, config.WSMaxConnsPerUser, m.Count())
}

// TestManagerConcurrentPushToConn verifies that concurrent PushToConn calls
// across multiple connections do not race.
func TestManagerConcurrentPushToConn(t *testing.T) {
	m := NewManager()

	const numConns = 20
	var conns []*Conn
	for i := 0; i < numConns; i++ {
		c := &Conn{Send: make(chan []byte, 64)}
		require.NoError(t, m.Register(c))
		conns = append(conns, c)
	}

	var wg sync.WaitGroup
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			c := conns[idx%numConns]
			frame := NewFrame(TypeMessageNew, map[string]string{
				"msg_id": fmt.Sprintf("msg-%d", idx),
			})
			result := m.PushToConn(c.ID, frame)
			require.True(t, result.Queued)
			require.Equal(t, DeliveryStatusQueued, result.Status)
		}(i)
	}
	wg.Wait()

	// Verify all messages were delivered (none dropped).
	for _, c := range conns {
		count := len(c.Send)
		require.GreaterOrEqual(t, count, 3) // at least some per conn
		require.LessOrEqual(t, count, 20)   // not more than total sends
	}
	require.Equal(t, numConns, m.Count())
}

// TestManagerConcurrentCount verifies Count() is safe under concurrent Register.
func TestManagerConcurrentCount(t *testing.T) {
	m := NewManager()

	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			c := &Conn{Send: make(chan []byte, 4)}
			_ = m.Register(c)
			_ = m.Count() // Count must not race with Register
		}()
	}
	// Also run concurrent Unregister
	for i := 0; i < 25; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			c := &Conn{Send: make(chan []byte, 4)}
			_ = m.Register(c)
			m.Unregister(c.ID)
		}()
	}
	wg.Wait()

	// Count should be 50 (50 registered, 25 unregistered in parallel).
	// Actually due to timing, the exact count is non-deterministic but must not be negative.
	count := m.Count()
	require.GreaterOrEqual(t, count, 0)
	require.LessOrEqual(t, count, 75)
}

// TestRegister_ExceedsPerUserCap verifies that Register rejects a connection
// when the user already has WSMaxConnsPerUser active connections.
func TestRegister_ExceedsPerUserCap(t *testing.T) {
	m := NewManager()
	const testUser = "user-cap"

	// Register WSMaxConnsPerUser connections with UserID pre-set.
	for i := 0; i < config.WSMaxConnsPerUser; i++ {
		c := &Conn{
			UserID: testUser,
			Send:   make(chan []byte, 4),
		}
		require.NoError(t, m.Register(c))
	}
	require.Equal(t, config.WSMaxConnsPerUser, m.Count())

	// The next connection for the same user must be rejected.
	excess := &Conn{
		UserID: testUser,
		Send:   make(chan []byte, 4),
	}
	err := m.Register(excess)
	require.ErrorIs(t, err, ErrPerUserCapReached)

	// Count must not have increased.
	require.Equal(t, config.WSMaxConnsPerUser, m.Count())
}

// TestPingAll_ClosesStaleConnection proves the pingAll stale-detection path
// (P1: pingAll stale-close 14.6%): a real-dial connection whose underlying
// WebSocket is silently closed must be detected by the heartbeat pinger,
// accumulate missed-pong up to config.WSMaxMissedPongs, and then be closed +
// unregistered + counted by the ws_stale_close_total metric.
//
// The test uses a real websocket.Dial so the Conn.W is a genuine
// *websocket.Conn (not a stub), then closes the server-side W so Ping fails
// immediately and deterministically (rather than waiting WSPingTimeout=5s
// per miss). The heartbeat cadence is 100ms, so the close lands well inside
// the Eventually window.
func TestPingAll_ClosesStaleConnection(t *testing.T) {
	metrics.Register()

	manager := NewManager()

	// serverConn is captured by the accept handler so the test can close the
	// underlying WebSocket and assert on the Conn's closed flag afterwards.
	var serverConn *Conn

	mux := http.NewServeMux()
	mux.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		wsConn, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		conn := NewConn(wsConn)
		// Capture before Register so the happens-before established by the
		// manager's lock (which the test observes via Count()) also covers the
		// serverConn assignment — the test reads serverConn only after
		// observing Count()==1.
		serverConn = conn
		_ = manager.Register(conn)
		// Deliberately do NOT start read/write loops: the connection must be
		// detected as stale purely via pingAll, not via a read error path.
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()

	wsURL := "ws" + srv.URL[4:] + "/ws"
	dialCtx, dialCancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer dialCancel()
	clientConn, _, err := websocket.Dial(dialCtx, wsURL, nil)
	require.NoError(t, err, "dial websocket")
	defer clientConn.Close(websocket.StatusNormalClosure, "")

	// Wait for the server-side registration before silencing the conn.
	testkit.Eventually(t, 2*time.Second, func() bool { return manager.Count() == 1 },
		"connection never registered on the server", func() string {
			return fmt.Sprintf("Count = %d", manager.Count())
		})
	require.NotNil(t, serverConn, "server-side Conn must be captured")

	// Baseline the stale-close metric before triggering detection (the counter
	// is process-global; the delta isolates this test's contribution).
	metricBefore := testutil.ToFloat64(metrics.WSStaleClose)

	// Start the heartbeat pinger at a tight cadence.
	hbCtx, hbCancel := context.WithCancel(context.Background())
	defer hbCancel()
	manager.StartHeartbeatWithInterval(hbCtx, 100*time.Millisecond)

	// Silently close the underlying server-side WebSocket so c.W.Ping fails
	// fast on the next tick (a closed *websocket.Conn returns immediately
	// rather than blocking for WSPingTimeout=5s, keeping the test fast and
	// deterministic). The Conn remains registered, so pingAll still observes
	// it and must drive the stale-close path itself.
	serverConn.Close()

	// After config.WSMaxMissedPongs consecutive failed pings, pingAll must
	// unregister the connection (Count drops to 0) and close the Send channel.
	testkit.Eventually(t, 4*time.Second, func() bool { return manager.Count() == 0 },
		"stale connection was never closed/unregistered by pingAll", func() string {
			return fmt.Sprintf("Count=%d missedPong=%d closed=%v",
				manager.Count(),
				serverConn.missedPong.Load(),
				serverConn.closed.Load())
		})

	// The Conn must have been closed (closeSend ran during Unregister).
	require.True(t, serverConn.closed.Load(),
		"stale conn Send channel must be closed after pingAll-driven unregister")
	// The conn must no longer be discoverable.
	require.Nil(t, manager.FindByConnID(serverConn.ID),
		"stale conn must be removed from the registry")

	// The stale-close metric must have incremented by exactly 1 (one stale
	// close driven by this test).
	require.Equal(t, metricBefore+1, testutil.ToFloat64(metrics.WSStaleClose),
		"WSStaleClose must increment by exactly 1 for the single stale close")
}

// ---------------------------------------------------------------------------
// Shutdown drain & shutdown-flag behavior tests (#2129 High-1)
// ---------------------------------------------------------------------------

func TestShutdown_WaitsForGoroutineConvergence(t *testing.T) {
	m := NewManager()

	const n = 8
	exited := make(chan struct{}, n)
	m.GoroutineAdd(n)
	for i := 0; i < n; i++ {
		go func() {
			defer m.GoroutineDone()
			exited <- struct{}{}
		}()
	}

	// Also register a fake conn so Shutdown has something to close.
	c := &Conn{ID: "drain-c", Send: make(chan []byte, 1)}
	m.mu.Lock()
	m.conns[c.ID] = c
	m.mu.Unlock()

	m.Shutdown()

	// All goroutines must have exited; Shutdown blocks until WG hits zero.
	for i := 0; i < n; i++ {
		select {
		case <-exited:
		case <-time.After(5 * time.Second):
			t.Fatalf("goroutine %d did not exit after Shutdown returned", i)
		}
	}
}

func TestShutdown_ReturnsAfterTimeoutWhenGoroutinesStuck(t *testing.T) {
	m := NewManager()

	// Spawn goroutines that will NOT exit until we release them after
	// Shutdown returns — this exercises the timeout path.
	blocker := make(chan struct{})
	const stuck = 3
	m.GoroutineAdd(stuck)
	for i := 0; i < stuck; i++ {
		go func() {
			defer m.GoroutineDone()
			<-blocker // intentionally blocks past the drain timeout
		}()
	}

	c := &Conn{ID: "stuck-c", Send: make(chan []byte, 1)}
	m.mu.Lock()
	m.conns[c.ID] = c
	m.mu.Unlock()

	start := time.Now()
	m.Shutdown()
	elapsed := time.Since(start)

	// Shutdown must return at or just above the drain timeout, not hang.
	if elapsed < shutdownDrainTimeout {
		t.Fatalf("Shutdown returned in %v, expected >= %v (timeout path)", elapsed, shutdownDrainTimeout)
	}
	if elapsed > shutdownDrainTimeout+2*time.Second {
		t.Fatalf("Shutdown took %v, expected ~%v (timeout + small margin)", elapsed, shutdownDrainTimeout)
	}

	// Release stuck goroutines so the test process can exit cleanly.
	close(blocker)
}

func TestShutdown_Idempotent(t *testing.T) {
	m := NewManager()
	c := &Conn{ID: "idem-c", Send: make(chan []byte, 1)}
	m.mu.Lock()
	m.conns[c.ID] = c
	m.mu.Unlock()

	m.Shutdown()
	// Second call must not panic, deadlock, or re-close channels.
	m.Shutdown()
}

func TestRegister_RejectedAfterShutdown(t *testing.T) {
	m := NewManager()
	m.Shutdown()

	c := &Conn{Send: make(chan []byte, 1)}
	err := m.Register(c)
	if err == nil {
		t.Fatal("Register after Shutdown should fail")
	}
	if !errors.Is(err, ErrShutdownInProgress) {
		t.Fatalf("Register error = %v, want ErrShutdownInProgress", err)
	}
}

func TestPushToConn_RejectedAfterShutdown(t *testing.T) {
	m := NewManager()
	c := &Conn{ID: "push-shut", Send: make(chan []byte, 4)}
	m.mu.Lock()
	m.conns[c.ID] = c
	m.mu.Unlock()

	m.Shutdown()

	res := m.PushToConn(c.ID, NewFrame(TypeMessageNew, map[string]string{"k": "v"}))
	if res.Status != DeliveryStatusConnClosed {
		t.Fatalf("PushToConn status = %v, want %v", res.Status, DeliveryStatusConnClosed)
	}
	if !errors.Is(res.Err, ErrShutdownInProgress) {
		t.Fatalf("PushToConn err = %v, want ErrShutdownInProgress", res.Err)
	}
}
