package handler

import (
	"testing"

	"github.com/agenthub/hub-server/internal/metrics"
	"github.com/agenthub/hub-server/internal/ws"
)

// TestSendFrameBufferFullWithoutMetricsRegistered is a regression test for the
// nil-metrics panic in sendFrame (#1360): builds that never call
// metrics.Register() (e.g. unit-test binaries or partial wiring) must not
// panic when the drop path increments metrics.WSDroppedFrames. The guard
// mirrors the existing ones at ws.go:34 (WSKickedConns), ws.go:185
// (WSRateLimitedMsgs) and ws/manager.go PushToConn (WSDroppedFrames).
func TestSendFrameBufferFullWithoutMetricsRegistered(t *testing.T) {
	if metrics.WSDroppedFrames != nil {
		t.Skip("metrics already registered in this test binary; nil-guard path not exercisable")
	}

	h := NewWebSocketHandler(ws.NewManager(), "test-secret-32-characters-long!!", "")
	conn := ws.NewConn(nil)
	// Fill the send buffer so sendFrame takes the drop branch.
	for i := 0; i < cap(conn.Send); i++ {
		conn.Send <- []byte("x")
	}

	// Must not panic even though metrics.WSDroppedFrames is nil.
	h.sendFrame(conn, ws.NewFrame(ws.TypeAuthOK, nil))

	if got := len(conn.Send); got != cap(conn.Send) {
		t.Fatalf("send buffer length = %d, want %d (frame must be dropped, not queued)", got, cap(conn.Send))
	}
}
