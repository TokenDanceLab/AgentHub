// DEPRECATED: This file is part of the legacy Hub Server entry point (cmd/agenthub-hub/main.go).
// The canonical handler wiring is in internal/app/app.go (DI architecture).
// Use internal/handler/* for route implementations.
// This file will be removed in Q3 2026.
package api

import (
	"encoding/json"
	"log/slog"
	"net/http"
)

// Handler holds Hub Server route dependencies (DB, cache, etc. — stubs for now).
type Handler struct{}

// RegisterRoutes wires all Hub Server REST endpoints.
// Routes map to api/openapi.yaml HubSyncRelay + Foundation tags.
func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	// Foundation
	mux.HandleFunc("GET /v1/health", h.GetHealth)

	// Auth & Users (HubSyncRelay)
	mux.HandleFunc("POST /v1/auth/login", h.PostLogin)
	mux.HandleFunc("POST /v1/auth/refresh", h.PostRefreshToken)
	mux.HandleFunc("GET /v1/users/me", h.GetCurrentUser)
	mux.HandleFunc("GET /v1/users/{userId}", h.GetUser)

	// Contacts & Groups (HubSyncRelay)
	mux.HandleFunc("GET /v1/contacts", h.GetContacts)
	mux.HandleFunc("POST /v1/contacts", h.PostContact)
	mux.HandleFunc("GET /v1/groups", h.GetGroups)
	mux.HandleFunc("POST /v1/groups", h.PostGroup)

	// Device & Edge Registration (HubSyncRelay)
	mux.HandleFunc("POST /v1/devices", h.PostDevice)
	mux.HandleFunc("GET /v1/devices/{deviceId}", h.GetDevice)
	mux.HandleFunc("POST /v1/edges/register", h.PostEdgeRegister)
	mux.HandleFunc("POST /v1/edges/heartbeat", h.PostEdgeHeartbeat)

	// Sync & Relay (HubSyncRelay)
	mux.HandleFunc("POST /v1/sync/pull", h.PostSyncPull)
	mux.HandleFunc("POST /v1/sync/push", h.PostSyncPush)
	mux.HandleFunc("POST /v1/relay/command", h.PostRelayCommand)
	mux.HandleFunc("POST /v1/relay/message", h.PostRelayMessage)
}

// ── Helpers ────────────────────────────────

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		slog.Error("write json", "err", err)
	}
}

func stub(w http.ResponseWriter, r *http.Request, endpoint string) {
	writeJSON(w, http.StatusNotImplemented, map[string]any{
		"error": map[string]any{
			"code":    "not_implemented",
			"message": endpoint + " — Hub Server stub (backend developer TODO)",
		},
	})
}

// ── Foundation ─────────────────────────────

func (h *Handler) GetHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"status":  "ok",
		"version": "v1",
		"service": "hub-server",
	})
}

// ── Auth & Users ───────────────────────────

func (h *Handler) PostLogin(w http.ResponseWriter, r *http.Request) {
	stub(w, r, "POST /v1/auth/login")
}
func (h *Handler) PostRefreshToken(w http.ResponseWriter, r *http.Request) {
	stub(w, r, "POST /v1/auth/refresh")
}
func (h *Handler) GetCurrentUser(w http.ResponseWriter, r *http.Request) {
	stub(w, r, "GET /v1/users/me")
}
func (h *Handler) GetUser(w http.ResponseWriter, r *http.Request) { stub(w, r, "GET /v1/users/:id") }

// ── Contacts & Groups ──────────────────────

func (h *Handler) GetContacts(w http.ResponseWriter, r *http.Request) { stub(w, r, "GET /v1/contacts") }
func (h *Handler) PostContact(w http.ResponseWriter, r *http.Request) {
	stub(w, r, "POST /v1/contacts")
}
func (h *Handler) GetGroups(w http.ResponseWriter, r *http.Request) { stub(w, r, "GET /v1/groups") }
func (h *Handler) PostGroup(w http.ResponseWriter, r *http.Request) { stub(w, r, "POST /v1/groups") }

// ── Device & Edge ──────────────────────────

func (h *Handler) PostDevice(w http.ResponseWriter, r *http.Request) { stub(w, r, "POST /v1/devices") }
func (h *Handler) GetDevice(w http.ResponseWriter, r *http.Request) {
	stub(w, r, "GET /v1/devices/:id")
}
func (h *Handler) PostEdgeRegister(w http.ResponseWriter, r *http.Request) {
	stub(w, r, "POST /v1/edges/register")
}
func (h *Handler) PostEdgeHeartbeat(w http.ResponseWriter, r *http.Request) {
	stub(w, r, "POST /v1/edges/heartbeat")
}

// ── Sync & Relay ───────────────────────────

func (h *Handler) PostSyncPull(w http.ResponseWriter, r *http.Request) {
	stub(w, r, "POST /v1/sync/pull")
}
func (h *Handler) PostSyncPush(w http.ResponseWriter, r *http.Request) {
	stub(w, r, "POST /v1/sync/push")
}
func (h *Handler) PostRelayCommand(w http.ResponseWriter, r *http.Request) {
	stub(w, r, "POST /v1/relay/command")
}
func (h *Handler) PostRelayMessage(w http.ResponseWriter, r *http.Request) {
	stub(w, r, "POST /v1/relay/message")
}
