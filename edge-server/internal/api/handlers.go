package api

import (
	"crypto/rand"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gorilla/websocket"

	"github.com/agenthub/edge-server/internal/events"
	"github.com/agenthub/edge-server/internal/runners"
	"github.com/agenthub/edge-server/internal/security"
)

// Handler holds dependencies for HTTP and WebSocket handlers.
type Handler struct {
	Bus      *events.Bus
	Registry *runners.Registry
}

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return security.IsTrustedLocalOrigin(r.Header.Get("Origin"))
	},
}

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

func listResponse(items any) map[string]any {
	return map[string]any{
		"items": items,
		"page": map[string]any{
			"hasMore": false,
		},
	}
}

func errorResponse(code, message string) map[string]any {
	return map[string]any{
		"error": map[string]any{
			"code":    code,
			"message": message,
		},
	}
}

func acceptedResponse(data map[string]any) map[string]any {
	return data
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		slog.Error("failed to write json response", "err", err)
	}
}

// ---------------------------------------------------------------------------
// genID generates random IDs with a given prefix.
// ---------------------------------------------------------------------------

func genID(prefix string) string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return fmt.Sprintf("%s%016x", prefix, b)
}

// ---------------------------------------------------------------------------
// GET /v1/health
// ---------------------------------------------------------------------------

func (h *Handler) GetHealth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, errorResponse("METHOD_NOT_ALLOWED", "method not allowed"))
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"status":  "ok",
		"version": "v1",
		"edgeId":  "local",
	})
}

// ---------------------------------------------------------------------------
// GET /v1/runners
// ---------------------------------------------------------------------------

func (h *Handler) GetRunners(w http.ResponseWriter, r *http.Request) {
	list := h.Registry.List()
	writeJSON(w, http.StatusOK, listResponse(list))
}

// ---------------------------------------------------------------------------
// GET /v1/runs  (empty list for now)
// ---------------------------------------------------------------------------

func (h *Handler) GetRuns(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, listResponse([]any{}))
}

// ---------------------------------------------------------------------------
// POST /v1/runs  (mock run)
// ---------------------------------------------------------------------------

func (h *Handler) PostRuns(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, errorResponse("METHOD_NOT_ALLOWED", "method not allowed"))
		return
	}

	runID := genID("run_")
	now := time.Now().UTC().Format(time.RFC3339)
	scope := map[string]any{"runId": runID}

	// Emit run.queued
	h.Bus.Publish("run.queued", scope, map[string]any{
		"runId":     runID,
		"status":    "queued",
		"createdAt": now,
	})

	// Run mock flow in background.
	go h.mockRunFlow(runID, scope)

	writeJSON(w, http.StatusAccepted, acceptedResponse(map[string]any{
		"runId":     runID,
		"status":    "queued",
		"createdAt": now,
	}))
}

func (h *Handler) mockRunFlow(runID string, scope map[string]any) {
	// 100ms delay then emit run.started
	time.Sleep(100 * time.Millisecond)
	h.Bus.Publish("run.started", scope, map[string]any{
		"runId":     runID,
		"status":    "started",
		"startedAt": time.Now().UTC().Format(time.RFC3339),
	})

	// Emit a few output.batch events
	time.Sleep(50 * time.Millisecond)
	h.Bus.Publish("run.output.batch", scope, map[string]any{
		"runId":  runID,
		"stream": "stdout",
		"chunks": []map[string]any{
			{"offset": 0, "text": "Initializing mock runner...\n"},
		},
	})

	time.Sleep(50 * time.Millisecond)
	h.Bus.Publish("run.output.batch", scope, map[string]any{
		"runId":  runID,
		"stream": "stdout",
		"chunks": []map[string]any{
			{"offset": 29, "text": "Executing mock task step 1/3...\n"},
		},
	})

	time.Sleep(50 * time.Millisecond)
	h.Bus.Publish("run.output.batch", scope, map[string]any{
		"runId":  runID,
		"stream": "stdout",
		"chunks": []map[string]any{
			{"offset": 60, "text": "Executing mock task step 2/3...\n"},
		},
	})

	time.Sleep(50 * time.Millisecond)
	h.Bus.Publish("run.output.batch", scope, map[string]any{
		"runId":  runID,
		"stream": "stderr",
		"chunks": []map[string]any{
			{"offset": 0, "text": "Warning: mock task is running in simulation mode\n"},
		},
	})

	time.Sleep(50 * time.Millisecond)
	h.Bus.Publish("run.output.batch", scope, map[string]any{
		"runId":  runID,
		"stream": "stdout",
		"chunks": []map[string]any{
			{"offset": 91, "text": "Executing mock task step 3/3...\n"},
		},
	})

	// Emit run.finished
	time.Sleep(50 * time.Millisecond)
	h.Bus.Publish("run.finished", scope, map[string]any{
		"runId":      runID,
		"status":     "finished",
		"finishedAt": time.Now().UTC().Format(time.RFC3339),
	})
}

// ---------------------------------------------------------------------------
// POST /v1/runs/{runId}:cancel
// ---------------------------------------------------------------------------

func (h *Handler) PostCancelRun(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, errorResponse("METHOD_NOT_ALLOWED", "method not allowed"))
		return
	}
	// Extract runId from path: /v1/runs/{runId}:cancel
	runID := extractRunID(r.URL.Path, ":cancel")
	writeJSON(w, http.StatusAccepted, acceptedResponse(map[string]any{
		"runId":  runID,
		"status": "cancelling",
	}))
}

// ---------------------------------------------------------------------------
// GET /v1/events  (WebSocket)
// ---------------------------------------------------------------------------

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

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		slog.Error("websocket upgrade failed", "err", err)
		return
	}
	defer conn.Close()

	slog.Info("websocket connected", "cursor", cursor)

	subID, ch, replay := h.Bus.Subscribe(cursor)
	defer h.Bus.Unsubscribe(subID)

	// Send replayed events.
	for _, evt := range replay {
		if err := conn.WriteJSON(evt); err != nil {
			slog.Info("websocket write error during replay", "err", err)
			return
		}
	}

	// Heartbeat ticker: every 30 seconds.
	heartbeat := time.NewTicker(30 * time.Second)
	defer heartbeat.Stop()

	// Read goroutine to detect close and handle pong.
	go func() {
		conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		conn.SetPongHandler(func(string) error {
			conn.SetReadDeadline(time.Now().Add(60 * time.Second))
			return nil
		})
		for {
			_, _, err := conn.ReadMessage()
			if err != nil {
				break
			}
		}
	}()

	// Write loop: push events and heartbeats.
	for {
		select {
		case evt, ok := <-ch:
			if !ok {
				return
			}
			if err := conn.WriteJSON(evt); err != nil {
				slog.Info("websocket write error", "err", err)
				return
			}
		case <-heartbeat.C:
			if err := conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				slog.Info("websocket heartbeat error", "err", err)
				return
			}
		}
	}
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

// RegisterRoutes registers all routes on the given mux.
func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/v1/health", h.GetHealth)
	mux.HandleFunc("/v1/runners", h.GetRunners)
	mux.HandleFunc("/v1/runs", func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			h.GetRuns(w, r)
		case http.MethodPost:
			h.PostRuns(w, r)
		default:
			writeJSON(w, http.StatusMethodNotAllowed, errorResponse("METHOD_NOT_ALLOWED", "method not allowed"))
		}
	})
	mux.HandleFunc("/v1/runs/", func(w http.ResponseWriter, r *http.Request) {
		// Routes with runId suffix: /v1/runs/{runId}:cancel
		if strings.HasSuffix(r.URL.Path, ":cancel") && r.Method == http.MethodPost {
			h.PostCancelRun(w, r)
			return
		}
		writeJSON(w, http.StatusNotFound, errorResponse("NOT_FOUND", "not found"))
	})
	mux.HandleFunc("/v1/events", h.GetEvents)
}
