package handler

import (
	"encoding/json"
	"testing"
	"time"

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

// ── Typing admission (#2154 P2-10) ────────────────────────────────────────
//
// The typing frame used to resolve the session membership twice per frame:
// once inside canTypeInSession to admit the sender, and again inside the
// app-layer fan-out callback (which also repeated the senderIsMember scan).
// canTypeInSession now returns the list it resolved and handleTyping hands it
// to the callback. These tests lock both halves: the resolution count and the
// unchanged admission semantics.

// newTypingHandlerForTest builds a handler whose ResolveMembers hook counts
// invocations, plus a conn authenticated as userID.
func newTypingHandlerForTest(t *testing.T, userID string, members map[string][]string) (*WebSocketHandler, *ws.Conn, *int) {
	t.Helper()
	resolveCalls := 0
	mgr := ws.NewManager()
	mgr.ResolveMembers = func(sessionID string) []string {
		resolveCalls++
		return members[sessionID]
	}
	h := NewWebSocketHandler(mgr, "")
	conn := ws.NewConn(nil)
	conn.UserID = userID
	return h, conn, &resolveCalls
}

func typingFrame(sessionID string) *ws.Frame {
	frame := ws.NewFrame(ws.TypeTyping, map[string]interface{}{"session_id": sessionID})
	return &frame
}

func TestHandleTypingResolvesSessionMembersOncePerFrame(t *testing.T) {
	h, conn, resolveCalls := newTypingHandlerForTest(t, "user-sender", map[string][]string{
		"sess-1": {"user-sender", "user-peer-1", "user-peer-2"},
	})

	type fanout struct {
		userID    string
		sessionID string
		memberIDs []string
	}
	got := make(chan fanout, 4)
	h.SetOnTyping(func(userID, sessionID string, memberIDs []string) {
		got <- fanout{userID: userID, sessionID: sessionID, memberIDs: memberIDs}
	})

	// Three consecutive typing frames — the shape a real client produces while
	// a user keeps typing.
	for i := 0; i < 3; i++ {
		h.handleTyping(conn, typingFrame("sess-1"))
		select {
		case f := <-got:
			if f.userID != "user-sender" || f.sessionID != "sess-1" {
				t.Fatalf("typing callback = %+v", f)
			}
			if len(f.memberIDs) != 3 {
				t.Fatalf("callback memberIDs = %v, want the admitted membership handed down", f.memberIDs)
			}
		case <-time.After(time.Second):
			t.Fatal("typing callback was not invoked for an admitted member")
		}
	}

	if *resolveCalls != 3 {
		t.Fatalf("ResolveMembers calls = %d, want exactly 1 per frame (was 2 before #2154 P2-10)", *resolveCalls)
	}
}

func TestHandleTypingRejectsNonMemberWithoutCallback(t *testing.T) {
	h, conn, resolveCalls := newTypingHandlerForTest(t, "user-outsider", map[string][]string{
		"sess-1": {"user-member"},
	})
	called := make(chan struct{}, 1)
	h.SetOnTyping(func(userID, sessionID string, memberIDs []string) {
		called <- struct{}{}
	})

	h.handleTyping(conn, typingFrame("sess-1"))

	select {
	case <-called:
		t.Fatal("typing callback must not run for a non-member sender")
	case <-time.After(50 * time.Millisecond):
	}
	if *resolveCalls != 1 {
		t.Fatalf("ResolveMembers calls = %d, want 1 (admission still resolves once)", *resolveCalls)
	}
}

func TestHandleTypingDropsFrameWithoutSessionID(t *testing.T) {
	h, conn, resolveCalls := newTypingHandlerForTest(t, "user-sender", map[string][]string{
		"sess-1": {"user-sender"},
	})
	called := make(chan struct{}, 1)
	h.SetOnTyping(func(userID, sessionID string, memberIDs []string) {
		called <- struct{}{}
	})

	frame := ws.NewFrame(ws.TypeTyping, map[string]interface{}{})
	h.handleTyping(conn, &frame)

	select {
	case <-called:
		t.Fatal("typing callback must not run for a frame without session_id")
	case <-time.After(50 * time.Millisecond):
	}
	if *resolveCalls != 0 {
		t.Fatalf("ResolveMembers calls = %d, want 0", *resolveCalls)
	}
}

func TestCanTypeInSessionReturnsResolvedMembershipOnlyOnAdmit(t *testing.T) {
	h, _, _ := newTypingHandlerForTest(t, "user-sender", map[string][]string{
		"sess-1": {"user-sender", "user-peer"},
	})

	memberIDs, ok := h.canTypeInSession("user-sender", "sess-1")
	if !ok {
		t.Fatal("member must be admitted")
	}
	if len(memberIDs) != 2 || memberIDs[0] != "user-sender" || memberIDs[1] != "user-peer" {
		t.Fatalf("memberIDs = %v, want the full resolved membership", memberIDs)
	}

	// A denial must hand back no list, so a caller can never fan out from it.
	memberIDs, ok = h.canTypeInSession("user-outsider", "sess-1")
	if ok {
		t.Fatal("non-member must be denied")
	}
	if memberIDs != nil {
		t.Fatalf("denied memberIDs = %v, want nil", memberIDs)
	}
}

func TestCanTypeInSessionDeniesUnresolvableInputs(t *testing.T) {
	members := map[string][]string{"sess-1": {"user-sender"}}

	t.Run("empty ids", func(t *testing.T) {
		h, _, resolveCalls := newTypingHandlerForTest(t, "user-sender", members)
		if _, ok := h.canTypeInSession("", "sess-1"); ok {
			t.Fatal("empty userID must deny")
		}
		if _, ok := h.canTypeInSession("user-sender", ""); ok {
			t.Fatal("empty sessionID must deny")
		}
		if *resolveCalls != 0 {
			t.Fatalf("ResolveMembers calls = %d, want 0", *resolveCalls)
		}
	})

	t.Run("missing hook", func(t *testing.T) {
		h := NewWebSocketHandler(ws.NewManager(), "")
		if memberIDs, ok := h.canTypeInSession("user-sender", "sess-1"); ok || memberIDs != nil {
			t.Fatalf("missing ResolveMembers must deny, got (%v, %v)", memberIDs, ok)
		}
	})
}

func TestCanTypeInSessionRecoversPanickingResolver(t *testing.T) {
	h := NewWebSocketHandler(ws.NewManager(), "")
	h.manager.ResolveMembers = func(sessionID string) []string {
		panic("resolver blew up")
	}

	memberIDs, ok := h.canTypeInSession("user-sender", "sess-1")
	if ok {
		t.Fatal("a panicking resolver must deny, not propagate")
	}
	if memberIDs != nil {
		t.Fatalf("memberIDs = %v, want nil after recovery", memberIDs)
	}
}
