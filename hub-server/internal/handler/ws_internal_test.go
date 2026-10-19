package handler

import (
	"testing"
	"time"

	"github.com/agenthub/hub-server/internal/ws"
)

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
		t.Fatalf("ResolveMembers calls = %d, want exactly 1 per frame (was 2 before #2154)", *resolveCalls)
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
