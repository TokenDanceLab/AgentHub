package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func TestExtractRunID(t *testing.T) {
	tests := []struct {
		path     string
		suffix   string
		expected string
	}{
		{"/v1/runs/run_abc:cancel", ":cancel", "run_abc"},
		{"/v1/runs/run_xyz123:cancel", ":cancel", "run_xyz123"},
	}

	for _, tt := range tests {
		result := extractRunID(tt.path, tt.suffix)
		if result != tt.expected {
			t.Errorf("extractRunID(%q, %q) = %q, want %q", tt.path, tt.suffix, result, tt.expected)
		}
	}
}

// ── WebSocket upgrade test ──

func TestWebSocketUpgrade(t *testing.T) {
	h := newTestHandler()

	req := httptest.NewRequest(http.MethodGet, "/v1/events", nil)
	req.Header.Set("Connection", "upgrade")
	req.Header.Set("Upgrade", "websocket")
	req.Header.Set("Sec-WebSocket-Version", "13")
	req.Header.Set("Sec-WebSocket-Key", "dGhlIHNhbXBsZSBub25jZQ==")

	rec := httptest.NewRecorder()
	h.GetEvents(rec, req)

	// httptest doesn't support hijacking, so the upgrade will fail.
	// The handler calls upgrader.Upgrade which returns an error in test.
	// We just verify it doesn't panic and logs the error.
	if rec.Code != http.StatusOK {
		// Expected: upgrade fails in test server, handler returns early.
		// The 200 is because httptest doesn't switch protocols.
		t.Logf("WS upgrade in test returned %d (expected in httptest)", rec.Code)
	}
}

func TestWebSocketRespondsToApplicationPing(t *testing.T) {
	h := newTestHandler()
	server := httptest.NewServer(http.HandlerFunc(h.GetEvents))
	defer server.Close()

	wsURL := "ws" + strings.TrimPrefix(server.URL, "http")
	header := http.Header{}
	header.Set("Origin", "http://localhost:5173")
	conn, resp, err := websocket.DefaultDialer.Dial(wsURL, header)
	if err != nil {
		if resp != nil {
			t.Fatalf("dial failed with status %d: %v", resp.StatusCode, err)
		}
		t.Fatalf("dial failed: %v", err)
	}
	defer conn.Close()

	if err := conn.WriteJSON(map[string]any{"type": "ping", "ts": float64(123)}); err != nil {
		t.Fatalf("write ping: %v", err)
	}
	_ = conn.SetReadDeadline(time.Now().Add(time.Second))
	var got map[string]any
	if err := conn.ReadJSON(&got); err != nil {
		t.Fatalf("read pong: %v", err)
	}
	if got["type"] != "pong" {
		t.Fatalf("type = %v, want pong; frame=%v", got["type"], got)
	}
	if got["ts"] != float64(123) {
		t.Fatalf("ts = %v, want 123; frame=%v", got["ts"], got)
	}
}

func TestWebSocketOriginPolicy(t *testing.T) {
	tests := []struct {
		name   string
		origin string
		want   bool
	}{
		{"no origin", "", false},
		{"desktop dev", "http://localhost:5199", true},
		{"tauri dev", "http://localhost:5173", true},
		{"loopback", "http://127.0.0.1:5199", true},
		{"untrusted remote", "https://example.com", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/v1/events", nil)
			if tt.origin != "" {
				req.Header.Set("Origin", tt.origin)
			}
			got := upgrader.CheckOrigin(req)
			if got != tt.want {
				t.Fatalf("CheckOrigin(%q) = %v, want %v", tt.origin, got, tt.want)
			}
		})
	}
}
