package handler

import (
	"context"
	"log/slog"
	"os"
	"strings"
	"time"

	"github.com/coder/websocket"
	"github.com/gin-gonic/gin"

	"github.com/agenthub/hub-server/internal/metrics"
	"github.com/agenthub/hub-server/internal/middleware"
	"github.com/agenthub/hub-server/internal/ws"
	"github.com/agenthub/pkg/errcode"
	"github.com/agenthub/pkg/safego"
)

type WebSocketHandler struct {
	manager *ws.Manager
	env     string
	// onTyping receives the typing fan-out callback. memberIDs is the session
	// membership that canTypeInSession already resolved while admitting the
	// frame, handed downstream so the fan-out does not resolve it a second
	// time (#2154 P2-10: typing frames arrive continuously while a user types,
	// and each resolution is a cache.GetOrLoad round trip).
	onTyping    func(userID, sessionID string, memberIDs []string)
	userLimiter *middleware.WSUserConnLimiter
}

func NewWebSocketHandler(manager *ws.Manager, env string) *WebSocketHandler {
	limiter := middleware.NewWSUserConnLimiter(func(connID string) {
		// Kick the oldest connection by closing it. The writeLoop/readLoop
		// goroutines will detect the closure and unregister.
		if c := manager.FindByConnID(connID); c != nil {
			c.Close()
		}
		if metrics.WSKickedConns != nil {
			metrics.WSKickedConns.Inc()
		}
	})
	return &WebSocketHandler{
		manager:     manager,
		env:         env,
		userLimiter: limiter,
	}
}

// SetOnTyping installs the typing fan-out callback. The callback is only ever
// invoked for a frame whose sender was admitted as a session member, and it
// receives the membership list that admission already resolved.
func (h *WebSocketHandler) SetOnTyping(fn func(userID, sessionID string, memberIDs []string)) {
	h.onTyping = fn
}

func (h *WebSocketHandler) ServeWS(c *gin.Context) {
	// Authentication is an HTTP-upgrade invariant. Fail closed here as
	// defense-in-depth if a future route forgets WSAuthMiddleware; never fall
	// back to an in-band token frame that bypasses blacklist/session gates.
	userID := c.GetString("user_id")
	if userID == "" {
		// Envelope + traceId like the rest of the API surface (#2123 P3-7):
		// a bare AbortWithStatus left WS clients with an empty body.
		Fail(c, errcode.ErrInvalidToken)
		return
	}

	// Negotiate the fixed bearer marker for the preferred browser auth path
	// (Sec-WebSocket-Protocol: agenthub.bearer.v1, <hub-jwt>). Per RFC 6455
	// §4.1 a client that offered subprotocols MUST fail the WebSocket
	// connection when the server selects none, so without this the browser
	// bearer path breaks at the handshake. Only the fixed marker is listed —
	// never the JWT — so the token is not echoed back in the response (see
	// middleware.WSBearerSubprotocol / tokenFromWSSubprotocols).
	opts := &websocket.AcceptOptions{
		Subprotocols: []string{middleware.WSBearerSubprotocol},
	}
	if !h.isProductionEnv() {
		// Dev: allow loopback origins (localhost / 127.0.0.1 / ::1 on any port).
		// This replaces the previous InsecureSkipVerify (which disabled ALL origin
		// checks) with explicit patterns so that non-loopback origins are still
		// rejected even in development mode.
		opts.OriginPatterns = []string{
			"localhost",
			"localhost:*",
			"127.0.0.1",
			"127.0.0.1:*",
			"[::1]",
			"[::1]:*",
		}
	}

	wsConn, err := websocket.Accept(c.Writer, c.Request, opts)
	if err != nil {
		slog.Warn("ws upgrade failed", "error", err)
		return
	}

	conn := ws.NewConnWithBufferSize(wsConn, h.manager.SendBufferSize())
	if err := h.manager.Register(conn); err != nil {
		slog.Error("ws register failed", "error", err)
		_ = wsConn.Close(websocket.StatusInternalError, "")
		return
	}

	h.manager.SetAuth(conn.ID, userID, c.GetString("device_type"), c.GetString("device_id"))
	h.userLimiter.Acquire(userID, conn.ID)
	// writeLoop must start before PushToConn so the stamped auth.ok frame has a
	// draining goroutine ready to take it off conn.Send (writeLoop is launched
	// below on its own goroutine). Routing auth.ok through PushToConn instead
	// of the legacy sendFrame bypass unifies seq_id stamping so clients can
	// detect loss via seq gaps (G12 fix); subsequent data frames start at
	// seq_id=2 because auth.ok now consumes seq_id=1.
	// Track connection-scoped goroutines so Manager.Shutdown can wait for
	// them to converge. Add(2) covers writeLoop + readLoop; each defers Done.
	h.manager.GoroutineAdd(2)
	h.startWriteLoop(conn)
	h.manager.PushToConn(conn.ID, ws.NewFrame(ws.TypeAuthOK, nil))
	safego.SafeGo("ws.readLoop", func() {
		defer h.manager.GoroutineDone()
		h.authenticatedReadLoop(conn)
	})
}

// startWriteLoop launches conn's write loop on its own goroutine and releases
// the connection-goroutine slot that ServeWS's GoroutineAdd(2) reserved for it.
//
// SafeGo, not a bare `go func(){}`: writeLoop recovers its own body panics (see
// writeLoop for why it keeps a RecoverInto of its own), but writeLoop's
// first-registered `defer conn.W.Close(...)` runs *last* under LIFO, so a panic
// raised by the close itself escapes writeLoop and only this launcher guard
// stands between it and a process crash. Same shape as ws.readLoop above
// (#2246 slice 1 follow-up); ws_write_loop_safego_test.go pins both guards.
func (h *WebSocketHandler) startWriteLoop(conn *ws.Conn) {
	safego.SafeGo("ws.writeLoop", func() {
		defer h.manager.GoroutineDone()
		h.writeLoop(conn)
	})
}

// writeLoop drains conn.Send onto the socket until the channel closes or a
// write fails.
//
// Recovery goes through safego.RecoverInto instead of relying on the launch
// site's SafeGo guard because the panic log has to keep conn_id, and a safego
// name is a metric/observer label that must stay low-cardinality and stable —
// conn_id cannot ride along in it. RecoverInto is Recover plus an error slot
// and both call pkg/safego's unexported report, so the stack trace, the counter
// and the PanicObserver dispatch are identical to SafeGo's.
//
// Registration order is the whole trick, and Go's LIFO defer order is what
// makes it work:
//
//  1. defer conn.W.Close(...)        registered first  -> runs last
//  2. defer the conn_id log          registered second -> runs second
//  3. defer safego.RecoverInto(...)  registered last   -> runs first
//
// So on a body panic: RecoverInto runs first — it stops the panic, logs the
// stack, dispatches the observer (goroutine_panic_recoveries_total) and fills
// recoveredErr; the log defer then sees recoveredErr and writes the conn_id
// correlation line the bare recover used to write; and the Close defer still
// runs afterwards, so the peer keeps getting StatusNormalClosure exactly as
// before. A panic raised by Close itself cannot be recovered here (that defer
// is the one panicking): it escapes to startWriteLoop's SafeGo guard (#2246).
func (h *WebSocketHandler) writeLoop(conn *ws.Conn) {
	defer conn.W.Close(websocket.StatusNormalClosure, "")
	var recoveredErr error
	defer func() {
		if recoveredErr != nil {
			slog.Error("ws writeLoop panic recovered", "conn_id", conn.ID, "panic", recoveredErr)
		}
	}()
	defer safego.RecoverInto("ws.writeLoop", &recoveredErr)
	for data := range conn.Send {
		// Per-write deadline: a peer that stops draining its TCP receive
		// buffer would otherwise block this goroutine until the ~65s
		// read-timeout cleanup reaps the connection (zombie writeLoop). A
		// bounded write context fails fast so writeLoop returns and
		// cleanupConn reaps the connection promptly.
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		err := conn.W.Write(ctx, websocket.MessageText, data)
		cancel()
		if err != nil {
			slog.Warn("ws write error", "conn_id", conn.ID, "error", err)
			return
		}
	}
}

// authenticatedReadLoop reads messages after the HTTP upgrade middleware has
// authenticated and authorized the Hub session.
func (h *WebSocketHandler) authenticatedReadLoop(conn *ws.Conn) {
	defer h.cleanupConn(conn)
	h.processIncoming(conn)
}

// processIncoming is the shared message-read loop for authenticated connections.
// Per-connection message rate limiting is enforced: messages that exceed the rate
// limit are dropped and a warning is logged.
func (h *WebSocketHandler) processIncoming(conn *ws.Conn) {
	for {
		data, err := conn.ReadMessage(context.Background())
		if err != nil {
			slog.Info("ws read error", "user_id", conn.UserID, "error", err)
			return
		}

		// Per-connection message rate limiting.
		if !conn.AllowMessage() {
			if metrics.WSRateLimitedMsgs != nil {
				metrics.WSRateLimitedMsgs.Inc()
			}
			slog.Warn("ws message rate limited: dropping message",
				"conn_id", conn.ID,
				"user_id", conn.UserID,
			)
			continue
		}

		frame, err := ws.ParseFrame(data)
		if err != nil {
			continue
		}

		switch frame.Type {
		case ws.TypeTyping:
			h.handleTyping(conn, frame)
		default:
			slog.Debug("ws unknown frame type", "type", frame.Type)
		}
	}
}

// cleanupConn unregisters the connection from the manager and releases the
// per-user connection limiter slot.
func (h *WebSocketHandler) cleanupConn(conn *ws.Conn) {
	h.userLimiter.Release(conn.UserID, conn.ID)
	h.manager.Unregister(conn.ID)
}

// handleTyping admits a typing frame and hands it to the fan-out callback.
//
// Admission is unchanged (#2154 P2-10 only removed the *second* member
// resolution): an empty session id, a missing ResolveMembers hook, a panicking
// hook and a non-member sender are all still dropped here, with the same warn
// log, and the callback is never reached for them.
func (h *WebSocketHandler) handleTyping(conn *ws.Conn, frame *ws.Frame) {
	sessionID := typingSessionID(frame.Payload)
	if sessionID == "" {
		return
	}
	memberIDs, ok := h.canTypeInSession(conn.UserID, sessionID)
	if !ok {
		slog.Warn("ws typing rejected: user is not a session member", "user_id", conn.UserID, "session_id", sessionID)
		return
	}
	if h.onTyping != nil {
		h.onTyping(conn.UserID, sessionID, memberIDs)
	}
}

func typingSessionID(payload any) string {
	if m, ok := payload.(map[string]interface{}); ok {
		if sid, ok := m["session_id"].(string); ok {
			return sid
		}
	}
	if m, ok := payload.(map[string]string); ok {
		if sid, ok := m["session_id"]; ok {
			return sid
		}
	}
	if s, ok := payload.(string); ok {
		return s
	}
	return ""
}

// canTypeInSession reports whether userID is an active member of sessionID and,
// when it is, returns the membership list it resolved to reach that verdict.
//
// Returning the list is what lets the typing path resolve session members
// exactly once per frame instead of twice (#2154 P2-10) — the fan-out callback
// used to re-resolve the same sessionID and re-run the same senderIsMember
// scan. The admission verdict itself is byte-for-byte the old one: empty ids or
// a missing ResolveMembers hook deny, a panicking hook denies (recovered and
// error-logged as before), and a sender absent from the resolved list denies.
// On denial the returned list is nil so a caller can never fan out from it.
func (h *WebSocketHandler) canTypeInSession(userID, sessionID string) (memberIDs []string, ok bool) {
	if userID == "" || sessionID == "" || h.manager.ResolveMembers == nil {
		return nil, false
	}
	defer func() {
		if r := recover(); r != nil {
			slog.Error("ws canTypeInSession panic recovered in ResolveMembers callback",
				"user_id", userID, "session_id", sessionID, "panic", r)
			memberIDs = nil
			ok = false
		}
	}()
	resolved := h.manager.ResolveMembers(sessionID)
	for _, memberID := range resolved {
		if memberID == userID {
			return resolved, true
		}
	}
	return nil, false
}

// sendFrame writes a frame directly to conn.Send, bypassing Manager.PushToConn
// and therefore the per-connection seq_id stamping contract documented at
// internal/ws/fanout.go (PushToConn: "every delivery attempt that reaches the
// connection is stamped with the connection's monotonic seq_id"). Frames sent
// here reach the
// wire with SeqID=0, which frame.go's json "omitempty" tag drops entirely, so
// clients cannot detect loss of these frames via seq_id gaps.
//
// G12 RESOLVED: the historical production caller (ServeWS auth.ok handshake)
// now routes through Manager.PushToConn so auth.ok receives seq_id=1 and
// subsequent data frames shift by 1 (wire-visible). sendFrame is retained for
// the G12 characterization tests in ws_internal_test.go and any future
// non-seq-critical control frames; production code MUST prefer PushToConn so
// every wire frame carries a monotonic seq_id.
//
// ws_sendframe_bypass_total{frame_type} observes the bypass traffic rate so
// operators can see the volume of frames escaping seq_id stamping. The counter
// is nil-guarded to align with #1441 (builds that never call metrics.Register
// must not panic).
func (h *WebSocketHandler) sendFrame(conn *ws.Conn, frame ws.Frame) {
	data, err := frame.Marshal()
	if err != nil {
		return
	}
	if metrics.WSSendFrameBypass != nil {
		metrics.WSSendFrameBypass.WithLabelValues(frame.Type).Inc()
	}
	select {
	case conn.Send <- data:
	default:
		if metrics.WSDroppedFrames != nil {
			metrics.WSDroppedFrames.Inc()
		}
		slog.Warn("ws frame dropped: send buffer full", "conn_id", conn.ID, "user_id", conn.UserID)
	}
}

// isProductionEnv returns true when running in production/release mode.
// It uses the config-managed env when set; otherwise falls back to GIN_MODE.
func (h *WebSocketHandler) isProductionEnv() bool {
	env := h.env
	if env == "" {
		env = os.Getenv("GIN_MODE")
	}
	switch strings.ToLower(strings.TrimSpace(env)) {
	case "production", "prod", "release":
		return true
	default:
		return false
	}
}
