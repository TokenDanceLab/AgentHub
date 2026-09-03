// Package resputil holds the single JSON response writer for the Edge
// server's inbound HTTP surface: the REST api, MCP JSON-RPC over HTTP, and
// the httpserver middleware that rejects requests before they reach a
// transport (CORS origin, local auth).
//
// Before this package, internal/api and internal/mcp each carried their own
// writeJSON copy with drifted semantics (charset, nil handling, log text).
// This is the converged implementation (#1675): every edge writer delegates
// here so the wire behavior cannot diverge again.
//
// A third copy used to live in the shared pkg/errcode.WriteJSON and differed
// exactly where it mattered — it discarded json.Encode errors instead of
// logging them. That export is gone, so this is the only JSON writer an edge
// request can hit (#2246).
package resputil

import (
	"encoding/json"
	"log/slog"
	"net/http"
)

// WriteJSON writes v as a JSON response with the given HTTP status.
// Content-Type is "application/json; charset=utf-8". A nil v writes only the
// status and headers (empty body) — protocol error paths that have no
// payload rely on this. Encoding errors are logged, never returned: the
// status is already written by then, and the failure is an operator signal,
// not a caller-facing error.
func WriteJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if v == nil {
		return
	}
	if err := json.NewEncoder(w).Encode(v); err != nil {
		slog.Error("write json response failed", "error", err)
	}
}
