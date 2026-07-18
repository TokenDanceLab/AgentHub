package httpserver

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/agenthub/edge-server/internal/edgeidentity"
	"github.com/agenthub/edge-server/internal/errcode"
	"github.com/agenthub/edge-server/internal/jwtutil"
	"github.com/agenthub/edge-server/internal/security"
	sharederr "github.com/agenthub/pkg/errcode"
)

func corsMiddleware(next http.Handler, remoteMode bool, allowedOrigins []string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" {
			if !security.IsAllowedOrigin(origin, remoteMode, allowedOrigins) {
				sharederr.WriteJSON(w, http.StatusForbidden, errcode.ErrorBody(sharederr.ErrForbidden.WithMessage("forbidden origin")))
				return
			}
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-AgentHub-Edge-Token, X-AgentHub-Capability-Token")
			// Explicitly deny credential forwarding; edge uses Authorization headers, not cookies.
			w.Header().Set("Access-Control-Allow-Credentials", "false")
		}

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		next.ServeHTTP(w, r)
	})
}

func localAuthMiddleware(next http.Handler, localAuthToken string, hubJWTSecret string, edgeDeviceID string) http.Handler {
	localAuthToken = strings.TrimSpace(localAuthToken)
	hubJWTSecret = strings.TrimSpace(hubJWTSecret)
	edgeDeviceID = strings.TrimSpace(edgeDeviceID)

	// Local dev mode: no auth configured.
	if localAuthToken == "" && hubJWTSecret == "" {
		return next
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if isLocalAuthExempt(r) {
			next.ServeHTTP(w, r)
			return
		}

		for _, got := range authTokenCandidates(r) {
			// Skip TokenDance bearer tokens (td_ prefix) — they are NOT Edge sessions.
			if strings.HasPrefix(got, "td_") {
				continue
			}

			// 1. Try Hub JWT validation (TokenDance ID → Hub → Edge trust chain).
			if hubJWTSecret != "" {
				if claims, err := jwtutil.ValidateHubToken(got, []byte(hubJWTSecret), edgeDeviceID); err == nil {
					ctx := context.WithValue(r.Context(), edgeidentity.HubUserIDKey, claims.UserID)
					ctx = context.WithValue(ctx, edgeidentity.HubDeviceIDKey, claims.DeviceID)
					next.ServeHTTP(w, r.WithContext(ctx))
					return
				}
			}

			// 2. Fallback to pre-shared local auth token.
			if localAuthToken != "" && constantTimeEqual(got, localAuthToken) {
				next.ServeHTTP(w, r)
				return
			}
		}

		w.Header().Set("WWW-Authenticate", `Bearer realm="agenthub-edge"`)
		sharederr.WriteJSON(w, http.StatusUnauthorized, errcode.ErrorBody(sharederr.ErrUnauthorized))
	})
}

// isLocalAuthExempt reports whether a request is exempt from local auth checks.
// Only CORS preflight requests and the health endpoint are open when local
// auth is configured. Ordinary GET/HEAD routes can expose project metadata,
// run output, approvals, and local workspace state, so they must authenticate.
func isLocalAuthExempt(r *http.Request) bool {
	return r.Method == http.MethodOptions || r.URL.Path == "/v1/health"
}

func restTimeoutMiddleware(next http.Handler, timeout time.Duration) http.Handler {
	if timeout <= 0 {
		return next
	}
	timeoutHandler := http.TimeoutHandler(next, timeout, "request timeout\n")
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if isWebSocketUpgrade(r) {
			next.ServeHTTP(w, r)
			return
		}
		timeoutHandler.ServeHTTP(w, r)
	})
}

func isWebSocketUpgrade(r *http.Request) bool {
	return headerContainsToken(r.Header, "Connection", "upgrade") &&
		headerContainsToken(r.Header, "Upgrade", "websocket")
}

func headerContainsToken(header http.Header, key, want string) bool {
	for _, value := range header.Values(key) {
		for _, token := range strings.Split(value, ",") {
			if strings.EqualFold(strings.TrimSpace(token), want) {
				return true
			}
		}
	}
	return false
}
