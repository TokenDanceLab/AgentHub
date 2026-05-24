package handler

import (
	"context"
	"log/slog"
	"time"

	"github.com/coder/websocket"
	"github.com/gin-gonic/gin"

	"github.com/agenthub/hub-server/internal/jwtutil"
	"github.com/agenthub/hub-server/internal/metrics"
	"github.com/agenthub/hub-server/internal/ws"
)

type WebSocketHandler struct {
	manager   *ws.Manager
	jwtSecret string
	onTyping  func(userID, sessionID string)
}

func NewWebSocketHandler(manager *ws.Manager, jwtSecret string) *WebSocketHandler {
	return &WebSocketHandler{manager: manager, jwtSecret: jwtSecret}
}

func (h *WebSocketHandler) SetOnTyping(fn func(userID, sessionID string)) {
	h.onTyping = fn
}

func (h *WebSocketHandler) ServeWS(c *gin.Context) {
	wsConn, err := websocket.Accept(c.Writer, c.Request, nil)
	if err != nil {
		slog.Warn("ws upgrade failed", "err", err)
		return
	}

	conn := ws.NewConn(wsConn)
	if err := h.manager.Register(conn); err != nil {
		slog.Error("ws register failed", "err", err)
		wsConn.Close(websocket.StatusInternalError, "")
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
			slog.Warn("ws write error", "conn_id", conn.ID, "err", err)
			return
		}
	}
}

func (h *WebSocketHandler) readLoop(conn *ws.Conn) {
	defer h.manager.Unregister(conn.ID)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	_, data, err := conn.W.Read(ctx)
	if err != nil {
		slog.Info("ws auth timeout or read error", "conn_id", conn.ID, "err", err)
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

	h.sendFrame(conn, ws.NewFrame(ws.TypeAuthOK, nil))

	for {
		_, data, err := conn.W.Read(context.Background())
		if err != nil {
			slog.Info("ws read error", "user_id", conn.UserID, "err", err)
			return
		}

		frame, err := ws.ParseFrame(data)
		if err != nil {
			continue
		}

		switch frame.Type {
		case ws.TypeTyping:
			slog.Debug("ws typing", "user_id", conn.UserID)
			if h.onTyping != nil {
				sessionID := ""
				if m, ok := frame.Payload.(map[string]interface{}); ok {
					if sid, ok := m["session_id"].(string); ok {
						sessionID = sid
					}
				}
				if sessionID == "" {
					if s, ok := frame.Payload.(string); ok {
						sessionID = s
					}
				}
				if sessionID != "" {
					h.onTyping(conn.UserID, sessionID)
				}
			}
		default:
			slog.Debug("ws unknown frame type", "type", frame.Type)
		}
	}
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
