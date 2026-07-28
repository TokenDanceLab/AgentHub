package handler

import (
	"encoding/json"
	"testing"

	dto "github.com/prometheus/client_model/go"

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

	h := NewWebSocketHandler(ws.NewManager(), "")
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

// TestSendFrameProducesZeroSeqIDLocksBypass is a characterization test for the
// G12 KNOWN DEFECT: sendFrame writes directly to conn.Send, bypassing
// Manager.PushToConn's seq.Add(1) stamping (manager.go:387). The frame
// therefore reaches the wire with SeqID=0, which frame.go's json "omitempty"
// tag drops entirely — so clients cannot detect loss of these frames via
// seq_id gaps. This test locks the current bypass behavior so any future
// change that accidentally adds seq_id stamping to sendFrame (or reroutes it
// through PushToConn) will be caught and the G12 characterization updated.
//
// The fix (routing auth.ok through PushToConn) is an operator decision and is
// NOT applied in this characterization PR.
func TestSendFrameProducesZeroSeqIDLocksBypass(t *testing.T) {
	h := NewWebSocketHandler(ws.NewManager(), "")
	conn := ws.NewConn(nil)

	h.sendFrame(conn, ws.NewFrame(ws.TypeAuthOK, nil))

	select {
	case data := <-conn.Send:
		// Lock the wire-level behavior: seq_id must be absent because
		// sendFrame bypasses PushToConn's seq stamping. If this fails,
		// sendFrame now stamps seq_id — update the G12 characterization
		// and the PR body recommendation.
		var raw map[string]json.RawMessage
		if err := json.Unmarshal(data, &raw); err != nil {
			t.Fatalf("unmarshal frame: %v", err)
		}
		if _, exists := raw["seq_id"]; exists {
			t.Fatal("seq_id must be absent on wire: sendFrame bypasses PushToConn seq stamping (G12 KNOWN DEFECT)")
		}
		// Lock the parsed behavior: SeqID is zero and the frame is auth.ok.
		frame, err := ws.ParseFrame(data)
		if err != nil {
			t.Fatalf("parse frame: %v", err)
		}
		if frame.Type != ws.TypeAuthOK {
			t.Fatalf("frame type = %q, want %q", frame.Type, ws.TypeAuthOK)
		}
		if frame.SeqID != 0 {
			t.Fatalf("SeqID = %d, want 0 (sendFrame bypasses seq stamping)", frame.SeqID)
		}
	default:
		t.Fatal("expected frame on conn.Send, but channel was empty")
	}
}

// TestSendFrameBypassCounterIncrements locks the ws_sendframe_bypass_total
// metric behavior: every sendFrame call that produces a frame increments the
// counter with the frame's Type as the frame_type label value. This gives
// operators visibility into the bypass traffic rate (G12 observability-first).
func TestSendFrameBypassCounterIncrements(t *testing.T) {
	metrics.Register()

	h := NewWebSocketHandler(ws.NewManager(), "")
	conn := ws.NewConn(nil)

	before := bypassCounterValue(t, ws.TypeAuthOK)
	h.sendFrame(conn, ws.NewFrame(ws.TypeAuthOK, nil))
	after := bypassCounterValue(t, ws.TypeAuthOK)

	if after != before+1 {
		t.Fatalf("ws_sendframe_bypass_total{frame_type=%q} = %v, want %v (delta should be 1 per sendFrame call)",
			ws.TypeAuthOK, after, before+1)
	}

	// Drain the queued frame so the buffer is not left full for other tests.
	select {
	case <-conn.Send:
	default:
	}
}

func bypassCounterValue(t *testing.T, frameType string) float64 {
	t.Helper()
	m := &dto.Metric{}
	if err := metrics.WSSendFrameBypass.WithLabelValues(frameType).Write(m); err != nil {
		t.Fatalf("write ws_sendframe_bypass_total metric: %v", err)
	}
	return m.GetCounter().GetValue()
}
