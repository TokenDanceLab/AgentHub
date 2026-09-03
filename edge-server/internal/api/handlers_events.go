package api

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gorilla/websocket"

	"github.com/agenthub/edge-server/internal/errcode"
	"github.com/agenthub/edge-server/internal/events"
	"github.com/agenthub/edge-server/internal/lifecycle"
	"github.com/agenthub/edge-server/internal/store"
	"github.com/agenthub/pkg/safego"
)

// Handler holds dependencies for HTTP and WebSocket handlers.
func (h *Handler) GetEvents(w http.ResponseWriter, r *http.Request) {
	// Parse cursor from query.
	cursorStr := r.URL.Query().Get("cursor")
	if cursorStr == "" {
		cursorStr = r.URL.Query().Get("pageCursor")
	}

	var cursor int64
	if cursorStr != "" {
		if n, err := strconv.ParseInt(cursorStr, 10, 64); err == nil {
			cursor = n
		}
	}

	// Capture ownership principal before the long-lived WS loop.
	// Local single-tenant bypass keeps full stream; empty userID fails closed (#878).
	userID := h.ownerUserID(r)
	repo := ensureStore(h)

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		slog.Error("websocket upgrade failed", "error", err)
		return
	}
	defer conn.Close()

	// 2.3a: Limit maximum WebSocket frame read size to 64 KB for Edge
	// connections.  Edge frames are command/control messages that are much
	// smaller than Hub frames, so a tighter limit is appropriate.
	conn.SetReadLimit(64 * 1024)

	if h.Metrics != nil {
		h.Metrics.RecordWSConnect()
		defer h.Metrics.RecordWSDisconnect()
	}

	slog.Info("websocket connected", "cursor", cursor, "hubUser", userID != "")

	subID, ch, replay := h.Bus.Subscribe(cursor)
	defer h.Bus.Unsubscribe(subID)

	// Send replayed events, filtered by ownership under Hub JWT (AH-SR-045).
	if err := replayEventsToClient(conn, repo, replay, userID); err != nil {
		slog.Info("websocket write error during replay", "error", err)
		return
	}

	// Heartbeat ticker: every 30 seconds.
	heartbeat := time.NewTicker(30 * time.Second)
	defer heartbeat.Stop()

	clientControl := make(chan map[string]any, 8)

	// Read goroutine to detect close and handle pong timeout.
	// When the read deadline expires (no pong within 60s), the connection
	// is closed to force the write loop to exit.
	done := make(chan struct{})
	readDone := make(chan struct{})
	defer close(done)
	startClientReadLoop(conn, done, readDone, clientControl)

	// Write loop: push events and heartbeats.
	_ = writeEventsLoop(conn, repo, ch, clientControl, heartbeat, readDone, subID, userID)
}

// replayEventsToClient sends the replayed events, filtered by ownership under
// Hub JWT (AH-SR-045).
func replayEventsToClient(conn *websocket.Conn, repo store.Repository, replay []events.EventEnvelope, userID string) error {
	for _, evt := range replay {
		if !eventVisibleToUser(repo, evt, userID) {
			continue
		}
		if err := conn.WriteJSON(evt); err != nil {
			return err
		}
	}
	return nil
}

// startClientReadLoop runs the WebSocket read goroutine that detects client
// closes, refreshes the pong deadline, and forwards control frames to the
// clientControl channel. It closes readDone when the connection dies.
func startClientReadLoop(conn *websocket.Conn, done <-chan struct{}, readDone chan<- struct{}, clientControl chan<- map[string]any) {
	safego.SafeGo("eventsClientRead", func() {
		defer close(readDone)
		defer conn.Close()
		_ = conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		conn.SetPongHandler(func(string) error {
			_ = conn.SetReadDeadline(time.Now().Add(60 * time.Second))
			return nil
		})
		for {
			select {
			case <-done:
				return
			default:
			}
			_, message, err := conn.ReadMessage()
			if err != nil {
				break
			}
			if response, ok := websocketClientControlResponse(message); ok {
				select {
				case clientControl <- response:
				case <-done:
					return
				}
			}
		}
	})
}

// wsWriteTimeout bounds each websocket write: a peer that stops draining its
// TCP receive buffer would otherwise block the write loop until the kernel
// gives up on retransmission (minutes), keeping the subscriber goroutines
// alive as zombies. Mirrors the Hub writeLoop per-write deadline
// (hub-server/internal/handler/ws.go). Declared as a var so tests can shrink
// it.
var wsWriteTimeout = 10 * time.Second

// writeEventsLoop is the WebSocket write loop: it pushes live events, control
// responses, and heartbeats until the connection is done. Every write runs
// under wsWriteTimeout so a stalled peer cannot hang the loop. Write
// failures are logged with their specific message before the error is
// returned.
func writeEventsLoop(conn *websocket.Conn, repo store.Repository, ch <-chan events.EventEnvelope, clientControl <-chan map[string]any, heartbeat *time.Ticker, readDone <-chan struct{}, subID int64, userID string) error {
	for {
		select {
		case <-readDone:
			return nil
		case response := <-clientControl:
			_ = conn.SetWriteDeadline(time.Now().Add(wsWriteTimeout))
			if err := conn.WriteJSON(response); err != nil {
				slog.Info("websocket control write error", "error", err)
				return err
			}
		case evt, ok := <-ch:
			if !ok {
				return nil
			}
			if evt.Type == events.GapEventType {
				slog.Warn("event bus gap detected, closing websocket to force client resync",
					"subscriber", subID)
				closeMsg := websocket.FormatCloseMessage(CloseCodeEventGap,
					"event gap: dropped events detected, reconnect to resync")
				_ = conn.SetWriteDeadline(time.Now().Add(wsWriteTimeout))
				_ = conn.WriteMessage(websocket.CloseMessage, closeMsg)
				return nil
			}
			if !eventVisibleToUser(repo, evt, userID) {
				continue
			}
			_ = conn.SetWriteDeadline(time.Now().Add(wsWriteTimeout))
			if err := conn.WriteJSON(evt); err != nil {
				slog.Info("websocket write error", "error", err)
				return err
			}
		case <-heartbeat.C:
			_ = conn.SetWriteDeadline(time.Now().Add(wsWriteTimeout))
			if err := conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				slog.Info("websocket heartbeat error", "error", err)
				return err
			}
		}
	}
}

func websocketClientControlResponse(message []byte) (map[string]any, bool) {
	var frame struct {
		Type string `json:"type"`
		Ts   any    `json:"ts,omitempty"`
	}
	if err := json.Unmarshal(message, &frame); err != nil || frame.Type != "ping" {
		return nil, false
	}
	response := map[string]any{"type": "pong"}
	if frame.Ts != nil {
		response["ts"] = frame.Ts
	}
	return response, true
}

func runtimeSessionIDForThread(threadID string) string {
	seed := sha256.Sum256([]byte("agenthub-runtime-session:" + threadID))
	session := make([]byte, 16)
	copy(session, seed[:16])
	session[6] = (session[6] & 0x0f) | 0x50
	session[8] = (session[8] & 0x3f) | 0x80
	return strings.Join([]string{
		hex.EncodeToString(session[0:4]),
		hex.EncodeToString(session[4:6]),
		hex.EncodeToString(session[6:8]),
		hex.EncodeToString(session[8:10]),
		hex.EncodeToString(session[10:16]),
	}, "-")
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// extractRunID extracts the run ID from paths like
// "/v1/runs/{runId}:cancel" by stripping the prefix and suffix.
func extractRunID(path, suffix string) string {
	trimmed := strings.TrimPrefix(path, "/v1/runs/")
	trimmed = strings.TrimSuffix(trimmed, suffix)
	return trimmed
}

func decodeOptionalJSON(r *http.Request, dst any) error {
	if r.Body == nil || r.Body == http.NoBody {
		return nil
	}
	defer r.Body.Close()
	if r.ContentLength == 0 {
		return nil
	}
	// Limit request body to 1MB to prevent memory exhaustion.
	// Use io.LimitReader instead of http.MaxBytesReader to avoid needing a ResponseWriter.
	r.Body = io.NopCloser(io.LimitReader(r.Body, 1<<20))
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(dst); err != nil {
		return err
	}
	return nil
}

func runToResponse(run store.Run) map[string]any {
	return lifecycle.RunResponse(run)
}

// activeRunExistsResponse builds the 409 body for "this thread already has an
// active run".
//
// This is the only place in edge-server that still calls errcode.ErrorBody
// directly instead of errcode.Write, and it is allow-listed by
// scripts/verify/verify-edge-status-ssot.py: the response has to carry the
// conflicting run's identifiers (runId/projectId/threadId/status) next to the
// error envelope so the client can offer to cancel or attach to it, while
// errcode.Write writes a fixed envelope. The status is NOT hand-copied either —
// the caller passes errcode.ErrActiveRunExists.HTTPStatus — and the gate also
// pins that, so the exemption cannot silently grow a second copy (#2245).
func activeRunExistsResponse(run store.Run) map[string]any {
	body := errcode.ErrorBody(errcode.ErrActiveRunExists)
	body["runId"] = run.ID
	body["projectId"] = run.ProjectID
	body["threadId"] = run.ThreadID
	body["status"] = run.Status
	return body
}

// threadHasAssistantHistory returns true when the thread contains at least one
// message from the agent (role "agent"), indicating the adapter should resume
// rather than start a fresh conversation.
func threadHasAssistantHistory(repo store.Repository, threadID string) bool {
	for _, item := range repo.ListThreadItems(threadID) {
		if item.Role == "agent" {
			return true
		}
	}
	return false
}

// ---------------------------------------------------------------------------
// POST /v1/permissions/decide  (Desktop permission gate)
// ---------------------------------------------------------------------------
