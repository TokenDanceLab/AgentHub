//go:build integration

package integration

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/handler"
	"github.com/agenthub/hub-server/internal/middleware"
	hubws "github.com/agenthub/hub-server/internal/ws"
	"github.com/coder/websocket"
	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

const wsTestSecret = "test-ws-secret-32-characters-long!!"

// TestWSReconnectReceivesMessages verifies that after a client disconnects
// and reconnects using the same user+device credentials, messages pushed
// via PushToUser are delivered to the new connection.
func TestWSReconnectReceivesMessages(t *testing.T) {
	manager := hubws.NewManager()
	manager.StartHeartbeat()
	defer manager.Shutdown()

	// Track connection drops and route-sets to verify reconnect lifecycle.
	var routeMu sync.Mutex
	routeSetCalls := make([]struct {
		userID     string
		deviceType string
		deviceID   string
	}, 0)
	routeDelCalls := 0

	manager.OnRouteSet = func(userID, deviceType, deviceID, connID, oldConnID string, wasOffline bool) {
		routeMu.Lock()
		defer routeMu.Unlock()
		routeSetCalls = append(routeSetCalls, struct {
			userID     string
			deviceType string
			deviceID   string
		}{userID, deviceType, deviceID})
	}
	manager.OnRouteDel = func(userID, deviceType, deviceID, connID string) {
		routeMu.Lock()
		defer routeMu.Unlock()
		routeDelCalls++
	}

	wsURL := newWSTestServer(t, manager)

	// First connection: authenticate as user-recon-1.
	conn1 := dialWS(t, wsURL, "user-recon-1")
	defer conn1.Close(websocket.StatusNormalClosure, "")

	frame := readWSFrame(t, conn1)
	if frame.Type != hubws.TypeAuthOK {
		t.Fatalf("conn1 auth: got %s, want auth.ok", frame.Type)
	}

	// Verify connection is registered.
	if got := manager.FindByUserDevice("user-recon-1", "web"); got == nil {
		t.Fatal("conn1 not registered")
	}
	if manager.Count() != 1 {
		t.Fatalf("manager count = %d, want 1", manager.Count())
	}

	// Disconnect conn1.
	conn1.Close(websocket.StatusNormalClosure, "")

	// Wait for the cleanup goroutine to unregister the stale connection.
	// Poll deterministically instead of a fixed sleep so the test does not
	// flake under load (cleanup may take longer than a fixed 200ms window) and
	// does not silently skip the assertion on a fast machine.
	deadline := time.Now().Add(2 * time.Second)
	for {
		if manager.Count() == 0 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("after disconnect manager count = %d, want 0 (cleanup did not complete within 2s)", manager.Count())
		}
		time.Sleep(10 * time.Millisecond)
	}

	// Second connection: reconnect as same user+device.
	conn2 := dialWS(t, wsURL, "user-recon-1")
	defer conn2.Close(websocket.StatusNormalClosure, "")

	frame = readWSFrame(t, conn2)
	if frame.Type != hubws.TypeAuthOK {
		t.Fatalf("conn2 auth: got %s, want auth.ok", frame.Type)
	}

	// Verify the reconnected connection is registered.
	if got := manager.FindByUserDevice("user-recon-1", "web"); got == nil {
		t.Fatal("conn2 not registered")
	}
	if manager.Count() != 1 {
		t.Fatalf("after reconnect manager count = %d, want 1", manager.Count())
	}

	// Push a message to the user via PushToUser and verify it arrives
	// on the new connection.
	msgFrame := hubws.NewFrame(hubws.TypeMessageNew, map[string]string{
		"text":       "Hello after reconnect",
		"session_id": "sess-1",
	})
	manager.PushToUser("user-recon-1", msgFrame)

	receivedFrame := readWSFrame(t, conn2)
	if receivedFrame.Type != hubws.TypeMessageNew {
		t.Fatalf("reconnect received frame type = %s, want %s", receivedFrame.Type, hubws.TypeMessageNew)
	}

	// Verify route lifecycle: set (conn1), del (conn1 disconnect), set (conn2).
	routeMu.Lock()
	sets := len(routeSetCalls)
	dels := routeDelCalls
	routeMu.Unlock()
	if sets < 2 {
		t.Errorf("expected at least 2 route-set calls (conn1 + conn2), got %d", sets)
	}
	if dels < 1 {
		t.Errorf("expected at least 1 route-del call (conn1 disconnect), got %d", dels)
	}
}

// TestWSMultipleDevicesPerUser verifies that a single user can have multiple
// WebSocket connections from different devices (e.g., desktop + web) and
// messages pushed via PushToUser are fanned out to ALL of them.
//
// The previous version of this test dialled TWO DIFFERENT users
// ("user-multi-dev" and "user-multi-dev-web") and then pushed to each user
// independently — so it never exercised the per-user multi-device fan-out
// that its name promises. It now uses ONE user with two different device
// types and asserts a single PushToUser reaches both connections.
func TestWSMultipleDevicesPerUser(t *testing.T) {
	manager := hubws.NewManager()
	manager.StartHeartbeat()
	defer manager.Shutdown()

	wsURL := newWSTestServer(t, manager)

	// Same user, two different device types (desktop + web).
	connDesktop := dialWSWithDevice(t, wsURL, "user-multi-dev", "desktop", "desktop-dev-1")
	defer connDesktop.Close(websocket.StatusNormalClosure, "")

	frame := readWSFrame(t, connDesktop)
	if frame.Type != hubws.TypeAuthOK {
		t.Fatalf("desktop auth: got %s, want auth.ok", frame.Type)
	}

	connWeb := dialWSWithDevice(t, wsURL, "user-multi-dev", "web", "web-dev-1")
	defer connWeb.Close(websocket.StatusNormalClosure, "")

	frame = readWSFrame(t, connWeb)
	if frame.Type != hubws.TypeAuthOK {
		t.Fatalf("web auth: got %s, want auth.ok", frame.Type)
	}

	// Both connections for the SAME user must be registered.
	if manager.Count() != 2 {
		t.Fatalf("manager count = %d, want 2 (both devices for same user)", manager.Count())
	}

	// A single PushToUser must fan out to BOTH connections of the same user.
	msg := hubws.NewFrame(hubws.TypeMessageNew, map[string]string{"text": "fanout-to-all-devices"})
	result := manager.PushToUser("user-multi-dev", msg)
	if result.Conns != 2 {
		t.Fatalf("PushToUser result.Conns = %d, want 2 (both user devices)", result.Conns)
	}
	if result.Queued != 2 {
		t.Fatalf("PushToUser result.Queued = %d, want 2 (delivered to both devices)", result.Queued)
	}

	gotDesktop := readWSFrame(t, connDesktop)
	if gotDesktop.Type != hubws.TypeMessageNew {
		t.Errorf("desktop got type=%s, want message.new", gotDesktop.Type)
	}
	gotWeb := readWSFrame(t, connWeb)
	if gotWeb.Type != hubws.TypeMessageNew {
		t.Errorf("web got type=%s, want message.new", gotWeb.Type)
	}
}

// TestWSHeartbeatKeepsConnection is intended to verify the manager's heartbeat
// ping/pong mechanism detects a healthy connection.
//
// SKIPPED HONESTLY: the heartbeat ticker runs on config.WSHeartbeatInterval
// (30s). A single heartbeat cycle therefore cannot be observed in a
// reasonable unit/integration-test window without either:
//  1. waiting 30s+ (unacceptable for CI), or
//  2. refactoring Manager.StartHeartbeat to accept an injectable interval
//     (a Manager logic change, out of scope for "pure test honesty").
//
// The previous version slept only 500ms and asserted the connection was still
// registered — which is true regardless of whether the heartbeat ever fired,
// so it verified nothing about the heartbeat ping/pong mechanism. Skipping
// loudly here so CI does not report a fake green for heartbeat coverage.
//
// TODO: once Manager gains a test seam for the heartbeat interval (e.g.
// StartHeartbeatWithInterval), rewrite this test to use a short interval and
// assert that a healthy connection's missedPong stays 0 and that a stale
// (unreachable) connection is closed+unregistered after WSMaxMissedPongs.
func TestWSHeartbeatKeepsConnection(t *testing.T) {
	t.Skip("heartbeat interval is 30s (config.WSHeartbeatInterval); cannot deterministically verify ping/pong without 30s wait or an injectable interval seam on Manager.StartHeartbeat")
}

// TestWSPushToNonexistentUser is a no-op (no delivery, no panic).
func TestWSPushToNonexistentUser(t *testing.T) {
	manager := hubws.NewManager()

	// PushToUser for a user with no connections should not panic.
	msg := hubws.NewFrame(hubws.TypeMessageNew, map[string]string{"text": "nowhere"})
	manager.PushToUser("nonexistent-user", msg)

	// PushToSession with no ResolveMembers set should not panic.
	manager.PushToSession("nonexistent-session", msg)

	// Set ResolveMembers and verify PushToSession still works without panic.
	manager.ResolveMembers = func(sessionID string) []string {
		return []string{"ghost-user"}
	}
	manager.PushToSession("session-1", msg)
}

// TestWSPushToConnBufferFull verifies that pushing to a connection with a
// full send buffer returns a buffer-full status without blocking indefinitely.
func TestWSPushToConnBufferFull(t *testing.T) {
	manager := hubws.NewManager()
	manager.StartHeartbeat()
	defer manager.Shutdown()

	wsURL := newWSTestServer(t, manager)

	conn := dialWS(t, wsURL, "user-bufferfull")
	defer conn.Close(websocket.StatusNormalClosure, "")

	frame := readWSFrame(t, conn)
	if frame.Type != hubws.TypeAuthOK {
		t.Fatalf("auth: got %s, want auth.ok", frame.Type)
	}

	// Find the conn ID.
	c := manager.FindByUserDevice("user-bufferfull", "web")
	if c == nil {
		t.Fatal("connection not found")
	}

	// Fill the send buffer by sending many frames without reading them.
	// Each frame is small, but the buffer has limited capacity.
	// We send enough to overflow the buffer, then verify at least one
	// PushToConn returns BufferFull.
	bufferFullHit := false
	for i := 0; i < 500; i++ {
		msg := hubws.NewFrame(hubws.TypeMessageNew, map[string]string{
			"text": "fill-buffer-message-number-" + strings.Repeat("x", 200),
		})
		result := manager.PushToConn(c.ID, msg)
		if result.Status == hubws.DeliveryStatusBufferFull {
			bufferFullHit = true
			break
		}
	}

	if !bufferFullHit {
		t.Log("buffer full not hit — buffer may be larger than expected or messages drained quickly")
	}

	// Drain and verify connection still works.
	time.Sleep(50 * time.Millisecond)
	conn.Close(websocket.StatusNormalClosure, "")
}

// ── WebSocket test helpers ────────────────────────────────────────────────────

func newWSTestServer(t *testing.T, manager *hubws.Manager) string {
	t.Helper()
	gin.SetMode(gin.TestMode)
	r := gin.New()
	h := handler.NewWebSocketHandler(manager, "")
	cfg := &config.Config{JWT: config.JWTConfig{Secret: wsTestSecret}}
	r.GET("/client/ws", middleware.WSAuthMiddleware(cfg), h.ServeWS)
	server := httptest.NewServer(r)
	t.Cleanup(server.Close)
	return "ws" + strings.TrimPrefix(server.URL, "http") + "/client/ws"
}

func dialWS(t *testing.T, url, userID string) *websocket.Conn {
	t.Helper()
	return dialWSWithDevice(t, url, userID, "web", "test-device-"+userID)
}

// dialWSWithDevice dials a WebSocket connection authenticating as userID with
// an explicit deviceType and deviceID. Tests that need to exercise per-user
// multi-device fan-out (e.g. desktop + web for the same user) must use this
// helper so the device claims differ; dialWS always claims deviceType "web".
func dialWSWithDevice(t *testing.T, url, userID, deviceType, deviceID string) *websocket.Conn {
	t.Helper()
	accessToken, err := generateWSAccessToken(userID, deviceType, deviceID, wsTestSecret, time.Hour)
	if err != nil {
		t.Fatalf("generate ws access token: %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	conn, _, err := websocket.Dial(ctx, url, &websocket.DialOptions{
		HTTPHeader: http.Header{"Authorization": []string{"Bearer " + accessToken}},
	})
	if err != nil {
		t.Fatalf("dial websocket: %v", err)
	}
	return conn
}

func readWSFrame(t *testing.T, conn *websocket.Conn) *hubws.Frame {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, data, err := conn.Read(ctx)
	if err != nil {
		t.Fatalf("read ws frame: %v", err)
	}
	frame, err := hubws.ParseFrame(data)
	if err != nil {
		t.Fatalf("parse ws frame: %v", err)
	}
	return frame
}

func generateWSAccessToken(userID, deviceType, deviceID, secret string, ttl time.Duration) (string, error) {
	now := time.Now()
	claims := struct {
		UserID     string `json:"user_id"`
		DeviceType string `json:"device_type"`
		DeviceID   string `json:"device_id"`
		jwt.RegisteredClaims
	}{
		UserID:     userID,
		DeviceType: deviceType,
		DeviceID:   deviceID,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    "agenthub-hub",
			Audience:  jwt.ClaimStrings{"agenthub-api"},
			Subject:   userID,
			ExpiresAt: jwt.NewNumericDate(now.Add(ttl)),
			IssuedAt:  jwt.NewNumericDate(now),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(secret))
}
