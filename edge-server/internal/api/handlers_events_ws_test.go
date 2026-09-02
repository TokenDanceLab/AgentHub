package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"github.com/agenthub/edge-server/internal/events"
)

// TestWriteEventsLoop_ZombiePeerHitsWriteDeadline pins the zombie-peer fix
// (#2154): a client that stops draining its TCP receive buffer must not be
// able to hang the write loop until the kernel TCP retransmission cap
// (minutes). With per-write deadlines the loop fails and returns promptly.
// Without the fix this test times out.
func TestWriteEventsLoop_ZombiePeerHitsWriteDeadline(t *testing.T) {
	orig := wsWriteTimeout
	wsWriteTimeout = 500 * time.Millisecond
	t.Cleanup(func() { wsWriteTimeout = orig })

	loopResult := make(chan error, 1)
	testUpgrader := websocket.Upgrader{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := testUpgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()

		ch := make(chan events.EventEnvelope)
		readDone := make(chan struct{})
		defer close(readDone)
		heartbeat := time.NewTicker(time.Hour)
		defer heartbeat.Stop()

		go func() {
			loopResult <- writeEventsLoop(conn, nil, ch, nil, heartbeat, readDone, 1, localSingleTenantBypass)
		}()

		// Keep pushing 1 MiB events until the stalled peer's socket buffers
		// fill and writes start blocking; the write deadline must then fire.
		payload := strings.Repeat("x", 1<<20)
		for i := 0; i < 256; i++ {
			select {
			case ch <- events.EventEnvelope{ID: "zombie", Type: "test.zombie", Payload: payload}:
			case <-loopResult:
				return
			}
		}
	}))
	t.Cleanup(srv.Close)

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http")
	clientConn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer clientConn.Close()
	// Deliberately never read from clientConn: the peer is a zombie.

	select {
	case loopErr := <-loopResult:
		if loopErr == nil {
			t.Fatal("writeEventsLoop returned nil; want a write deadline error against a zombie peer")
		}
	case <-time.After(30 * time.Second):
		t.Fatal("writeEventsLoop did not return within 30s against a zombie peer (write deadline missing?)")
	}
}
