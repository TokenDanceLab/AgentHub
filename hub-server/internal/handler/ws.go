package handler

import (
	"context"
	"log/slog"
	"os"
	"strings"
	"time"

	"github.com/coder/websocket"
	"github.com/gin-gonic/gin"

	"github.com/agenthub/hub-server/internal/jwtutil"
	"github.com/agenthub/hub-server/internal/metrics"
	"github.com/agenthub/hub-server/internal/middleware"
	"github.com/agenthub/hub-server/internal/ws"
)

type WebSocketHandler struct {
	manager     *ws.Manager
	jwtSecret   string
	env         string
	onTyping    func(userID, sessionID string)
	userLimiter *middleware.WSUserConnLimiter
}

func NewWebSocketHandler(manager *ws.Manager, jwtSecret string, env string) *WebSocketHandler {
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
		jwtSecret:   jwtSecret,
		env:         env,
		userLimiter: limiter,
	}
}

func (h *WebSocketHandler) SetOnTyping(fn func(userID, sessionID string)) {
	h.onTyping = fn
}

func (h *WebSocketHandler) ServeWS(c *gin.Context) {
	opts := &websocket.AcceptOptions{}
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

	conn := ws.NewConn(wsConn)
	if err := h.manager.Register(conn); err != nil {
		slog.Error("ws register failed", "error", err)
		wsConn.Close(websocket.StatusInternalError, "")
		return
	}

	// #82: If middleware already authenticated the upgrade request,
	// use the Gin context values directly and skip in-protocol auth frame.
	if userID := c.GetString("user_id"); userID != "" {
		h.manager.SetAuth(conn.ID, userID, c.GetString("device_type"), c.GetString("device_id"))
		h.userLimiter.Acquire(userID, conn.ID)
		go h.writeLoop(conn)
		h.sendFrame(conn, ws.NewFrame(ws.TypeAuthOK, nil))
		go h.authenticatedReadLoop(conn)
		return
	}

	go h.writeLoop(conn)
	go h.readLoop(conn)
}

func (h *WebSocketHandler) writeLoop(conn *ws.Conn) {
	defer conn.W.Close(websocket.StatusNormalClosure, "")
	defer func() {
		if r := recover(); r != nil {
			slog.Error("ws writeLoop panic recovered", "conn_id", conn.ID, "panic", r)
		}
	}()
	ctx := context.Background()
	for data := range conn.Send {
		err := conn.W.Write(ctx, websocket.MessageText, data)
		if err != nil {
			slog.Warn("ws write error", "conn_id", conn.ID, "error", err)
			return
		}
	}
}

func (h *WebSocketHandler) readLoop(conn *ws.Conn) {
	defer h.cleanupConn(conn)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	_, data, err := conn.W.Read(ctx)
	if err != nil {
		slog.Info("ws auth timeout or read error", "conn_id", conn.ID, "error", err)
		return
	}

	frame, err := ws.ParseFrame(data)
	if err != nil || frame.Type != ws.TypeAuth {
		h.sendFrame(conn, ws.NewFrame(ws.TypeAuthFail, map[string]string{"reason": "first frame must be auth"}))
		time.Sleep(100 * time.Millisecond)
		conn.Close()
		return
	}

	payload, ok := frame.Payload.(map[string]interface{})
	if !ok {
		h.sendFrame(conn, ws.NewFrame(ws.TypeAuthFail, map[string]string{"reason": "invalid payload"}))
		time.Sleep(100 * time.Millisecond)
		conn.Close()
		return
	}

	accessToken, ok := payload["access_token"].(string)
	if !ok || accessToken == "" {
		h.sendFrame(conn, ws.NewFrame(ws.TypeAuthFail, map[string]string{"reason": "missing access_token"}))
		time.Sleep(100 * time.Millisecond)
		conn.Close()
		return
	}

	claims, err := jwtutil.ParseToken(accessToken, h.jwtSecret)
	if err != nil {
		h.sendFrame(conn, ws.NewFrame(ws.TypeAuthFail, map[string]string{"reason": "invalid token"}))
		time.Sleep(100 * time.Millisecond)
		conn.Close()
		return
	}

	h.manager.SetAuth(conn.ID, claims.UserID, claims.DeviceType, claims.DeviceID)
	h.userLimiter.Acquire(claims.UserID, conn.ID)

	h.sendFrame(conn, ws.NewFrame(ws.TypeAuthOK, nil))

	h.processIncoming(conn)
}

// authenticatedReadLoop reads messages from an already-authenticated WebSocket connection.
// It is used when the upgrade request was already authenticated by middleware,
// so no in-protocol auth frame exchange is needed.
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

func (h *WebSocketHandler) handleTyping(conn *ws.Conn, frame *ws.Frame) {
	sessionID := typingSessionID(frame.Payload)
	if sessionID == "" {
		return
	}
	if !h.canTypeInSession(conn.UserID, sessionID) {
		slog.Warn("ws typing rejected: user is not a session member", "user_id", conn.UserID, "session_id", sessionID)
		return
	}
	if h.onTyping != nil {
		h.onTyping(conn.UserID, sessionID)
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

func (h *WebSocketHandler) canTypeInSession(userID, sessionID string) bool {
	if userID == "" || sessionID == "" || h.manager.ResolveMembers == nil {
		return false
	}
	for _, memberID := range h.manager.ResolveMembers(sessionID) {
		if memberID == userID {
			return true
		}
	}
	return false
}

func (h *WebSocketHandler) sendFrame(conn *ws.Conn, frame ws.Frame) {
	data, err := frame.Marshal()
	if err != nil {
		return
	}
	select {
	case conn.Send <- data:
	default:
		metrics.WSDroppedFrames.Inc()
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
