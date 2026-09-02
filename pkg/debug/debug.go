package debug

import (
	"context"
	"encoding/json"
	"github.com/agenthub/pkg/safego"
	"log/slog"
	"net/http"
	"net/http/pprof"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

// HealthChecker runs named health checks and returns a result.
type HealthChecker func(ctx context.Context) error

// ConfigDumper returns a sanitized config snapshot for /debug/config.
type ConfigDumper func() map[string]any

// StateDumper returns runtime state for /debug/state.
type StateDumper func() map[string]any

// MuxConfig controls what debug endpoints are registered.
type MuxConfig struct {
	// HealthCheckers maps name → checker. /health runs all and returns aggregate status.
	HealthCheckers map[string]HealthChecker

	// EnablePprof registers /debug/pprof/* endpoints.
	EnablePprof bool

	// MetricsHandler, if provided, is registered at /metrics.
	MetricsHandler http.Handler

	// ConfigDumper, if provided, registers /debug/config.
	ConfigDumper ConfigDumper

	// StateDumper, if provided, registers /debug/state.
	StateDumper StateDumper

	// Version is reported in /health response.
	Version string

	// StartTime is used to compute uptime in /health response.
	StartTime time.Time

	// Auth protects sensitive endpoints (pprof, config, state).
	// Return true to allow, false to deny (401).
	// If nil, all endpoints are publicly accessible.
	Auth func(r *http.Request) bool

	// MetricsAuth protects /metrics independently of Auth (#1547): metrics
	// availability must not depend on debug credentials. nil = public.
	// MetricsHandler is still only registered when MetricsHandler != nil.
	MetricsAuth func(r *http.Request) bool
}

// RegisterEndpoints registers all debug routes on the given mux.
// prefix should be "" or "/" — routes are registered as absolute paths.
func RegisterEndpoints(mux *http.ServeMux, cfg MuxConfig) {
	if mux == nil {
		panic("debug: nil mux")
	}

	mux.HandleFunc("/health", healthHandler(cfg))
	mux.HandleFunc("/ready", readyHandler(cfg))

	if cfg.EnablePprof {
		pprofHandler := pprofMux()
		mux.Handle("/debug/pprof/", authWrap(cfg.Auth, pprofHandler))
		mux.Handle("/debug/pprof/cmdline", authWrap(cfg.Auth, http.HandlerFunc(pprof.Cmdline)))
		mux.Handle("/debug/pprof/profile", authWrap(cfg.Auth, http.HandlerFunc(pprof.Profile)))
		mux.Handle("/debug/pprof/symbol", authWrap(cfg.Auth, http.HandlerFunc(pprof.Symbol)))
		mux.Handle("/debug/pprof/trace", authWrap(cfg.Auth, http.HandlerFunc(pprof.Trace)))
	}

	if cfg.MetricsHandler != nil {
		mux.Handle("/metrics", authWrap(cfg.MetricsAuth, cfg.MetricsHandler))
	}

	if cfg.ConfigDumper != nil {
		mux.HandleFunc("/debug/config", authFunc(cfg.Auth, configHandler(cfg)))
	}

	if cfg.StateDumper != nil {
		mux.HandleFunc("/debug/state", authFunc(cfg.Auth, stateHandler(cfg)))
	}
}

// BasicAuth returns an auth function that validates HTTP Basic Auth.
func BasicAuth(user, pass string) func(r *http.Request) bool {
	return func(r *http.Request) bool {
		u, p, ok := r.BasicAuth()
		if !ok {
			return false
		}
		return constantTimeEqual(u, user) && constantTimeEqual(p, pass)
	}
}

// BearerAuth returns an auth function that validates a Bearer token.
func BearerAuth(token string) func(r *http.Request) bool {
	return func(r *http.Request) bool {
		auth := r.Header.Get("Authorization")
		if !strings.HasPrefix(auth, "Bearer ") {
			return false
		}
		return constantTimeEqual(strings.TrimPrefix(auth, "Bearer "), token)
	}
}

// SanitizeConfig recursively redacts sensitive keys in a config map.
// Keys matching secret patterns are replaced with "[REDACTED]".
var secretPattern = regexp.MustCompile(`(?i)(password|passwd|secret|token|key|credential|private_key|auth_token|access_token|refresh_token|dsn|connection_string)`)

func SanitizeConfig(m map[string]any) map[string]any {
	return sanitizeMap(m)
}

func sanitizeMap(m map[string]any) map[string]any {
	out := make(map[string]any, len(m))
	for k, v := range m {
		if secretPattern.MatchString(k) {
			out[k] = "[REDACTED]"
			continue
		}
		switch val := v.(type) {
		case map[string]any:
			out[k] = sanitizeMap(val)
		default:
			out[k] = v
		}
	}
	return out
}

// --- handlers ---

func healthHandler(cfg MuxConfig) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()

		checks := make(map[string]string)
		overall := "ok"

		var mu sync.Mutex
		var wg sync.WaitGroup
		for name, checker := range cfg.HealthCheckers {
			wg.Add(1)
			go func(name string, checker HealthChecker) {
				defer safego.Recover("debug.health_check")
				defer wg.Done()
				if err := checker(ctx); err != nil {
					mu.Lock()
					checks[name] = "error: " + err.Error()
					overall = "degraded"
					mu.Unlock()
				} else {
					mu.Lock()
					checks[name] = "ok"
					mu.Unlock()
				}
			}(name, checker)
		}
		wg.Wait()

		resp := map[string]any{
			"status": overall,
			"checks": checks,
		}
		if cfg.Version != "" {
			resp["version"] = cfg.Version
		}
		if !cfg.StartTime.IsZero() {
			resp["uptime_seconds"] = int(time.Since(cfg.StartTime).Seconds())
		}

		code := http.StatusOK
		if overall != "ok" {
			code = http.StatusServiceUnavailable
		}
		writeJSON(w, code, resp)
	}
}

func readyHandler(cfg MuxConfig) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
		defer cancel()

		for name, checker := range cfg.HealthCheckers {
			if err := checker(ctx); err != nil {
				slog.Warn("readiness check failed", "check", name, "err", err)
				writeJSON(w, http.StatusServiceUnavailable, map[string]any{
					"status": "not_ready",
					"check":  name,
					"error":  err.Error(),
				})
				return
			}
		}
		writeJSON(w, http.StatusOK, map[string]any{"status": "ready"})
	}
}

func configHandler(cfg MuxConfig) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		raw := cfg.ConfigDumper()
		sanitized := SanitizeConfig(raw)

		keys := make([]string, 0, len(sanitized))
		for k := range sanitized {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		ordered := make(map[string]any, len(sanitized))
		for _, k := range keys {
			ordered[k] = sanitized[k]
		}
		writeJSON(w, http.StatusOK, ordered)
	}
}

func stateHandler(cfg MuxConfig) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		writeJSON(w, http.StatusOK, cfg.StateDumper())
	}
}

func pprofMux() http.Handler {
	m := http.NewServeMux()
	m.HandleFunc("/", pprof.Index)
	return m
}

// --- auth helpers ---

func authWrap(auth func(r *http.Request) bool, next http.Handler) http.Handler {
	if auth == nil {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !auth(r) {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func authFunc(auth func(r *http.Request) bool, next http.HandlerFunc) http.HandlerFunc {
	if auth == nil {
		return next
	}
	return func(w http.ResponseWriter, r *http.Request) {
		if !auth(r) {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		next(w, r)
	}
}

// --- util ---

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	_ = enc.Encode(v)
}

func constantTimeEqual(a, b string) bool {
	if len(a) != len(b) {
		return false
	}
	var result byte
	for i := 0; i < len(a); i++ {
		result |= a[i] ^ b[i]
	}
	return result == 0
}
