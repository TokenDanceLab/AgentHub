package httpserver

import (
	"crypto/subtle"
	"net/http"
	"strings"

	debugpkg "github.com/agenthub/pkg/debug"

	"github.com/agenthub/edge-server/internal/jwtutil"
)

// WSEdgeBearerSubprotocol is the fixed WebSocket subprotocol negotiated for
// clients that carry an Edge/local token in Sec-WebSocket-Protocol.
//
// Convention (preferred browser / desktop path for /v1/events):
//
//	Sec-WebSocket-Protocol: agenthub.edge.bearer.v1, <edge-token>
//
// The client requests both the fixed marker and the raw Edge token. Auth
// middleware extracts the token from the upgrade request header. The Accept
// layer should negotiate only the fixed marker (never the token) so the
// secret is not echoed back in the response.
//
// Alternate single-token form (also accepted):
//
//	Sec-WebSocket-Protocol: access_token.<edge-token>
//
// Auth source priority for Edge WS upgrades (/v1/events):
//  1. Authorization: Bearer <token> (native clients that can set headers)
//  2. X-AgentHub-Edge-Token header
//  3. Sec-WebSocket-Protocol token carriage (preferred browser path)
//
// Query access_token is intentionally not accepted: it leaks into proxy logs,
// browser history, and Referer headers. Clients must migrate to Bearer,
// X-AgentHub-Edge-Token, or Sec-WebSocket-Protocol.
// #nosec G101 -- constant WS subprotocol marker, not a credential
const WSEdgeBearerSubprotocol = "agenthub.edge.bearer.v1"

// authTokenCandidates extracts all possible auth tokens from a request.
//
// For ordinary HTTP: Authorization Bearer and X-AgentHub-Edge-Token.
// For WebSocket upgrades to /v1/events: also Sec-WebSocket-Protocol.
// Query access_token is rejected (fail closed) to prevent log/referrer leaks.
func authTokenCandidates(r *http.Request) []string {
	candidates := []string{
		bearerToken(r.Header.Get("Authorization")),
		strings.TrimSpace(r.Header.Get("X-AgentHub-Edge-Token")),
	}
	if isWebSocketUpgrade(r) && r.URL.Path == "/v1/events" {
		if tok := tokenFromWSSubprotocols(r.Header.Values("Sec-WebSocket-Protocol")); tok != "" {
			candidates = append(candidates, tok)
		}
	}
	return candidates
}

// tokenFromWSSubprotocols extracts an Edge auth token from Sec-WebSocket-Protocol values.
//
// Accepted forms:
//   - "agenthub.edge.bearer.v1, <token>" (preferred; marker is ignored)
//   - "access_token.<token>" (single-token alternate)
//
// Multiple header values and comma-separated lists are both handled.
func tokenFromWSSubprotocols(values []string) string {
	var protos []string
	for _, v := range values {
		for _, part := range strings.Split(v, ",") {
			part = strings.TrimSpace(part)
			if part != "" {
				protos = append(protos, part)
			}
		}
	}
	if len(protos) == 0 {
		return ""
	}

	// Prefer explicit access_token.<token> form when present.
	for _, p := range protos {
		if strings.HasPrefix(p, "access_token.") {
			tok := strings.TrimPrefix(p, "access_token.")
			if tok != "" {
				return tok
			}
		}
	}

	// Preferred two-token form: fixed marker + raw Edge token.
	// Return the first non-marker protocol token.
	for _, p := range protos {
		if p == WSEdgeBearerSubprotocol || p == "agenthub" || p == "agenthub.bearer.v1" {
			continue
		}
		return p
	}
	return ""
}

func bearerToken(header string) string {
	header = strings.TrimSpace(header)
	if len(header) < len("Bearer ") || !strings.EqualFold(header[:len("Bearer ")], "Bearer ") {
		return ""
	}
	return strings.TrimSpace(header[len("Bearer "):])
}

func constantTimeEqual(got, want string) bool {
	if got == "" || want == "" || len(got) != len(want) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(got), []byte(want)) == 1
}

// debugAuthFunc builds the auth predicate guarding sensitive debug endpoints
// (pprof, /debug/config, /debug/state).
//
// Defense layers (in priority order):
//  1. Dev mode → nil (debug endpoints public; dev-only convenience).
//  2. Configured local auth token → BearerAuth(token) (pre-shared secret).
//  3. Configured Hub JWT secret → Hub-JWT validation fallback. This closes
//     the gap where an operator configures HubJWTSecret for the REST auth
//     middleware but leaves LocalAuthToken empty: previously debugAuthFunc
//     returned nil, which exposed pprof/config/state to any caller even
//     though Hub-JWT mode is a production-grade deployment.
//  4. Neither configured → deny-all (fail-closed). In the normal Run()
//     flow this branch is unreachable: when neither token is configured,
//     startup auto-generates a local token, which satisfies layer 2.
//
// The Hub-JWT fallback reuses the same jwtutil.ValidateHubToken trust chain
// as localAuthMiddleware, so a Hub-issued Edge-scoped HS256 JWT accepted on
// REST routes is also accepted on debug routes — and nothing else is.
func debugAuthFunc(cfg Config) func(r *http.Request) bool {
	if cfg.Dev {
		return nil
	}
	if cfg.LocalAuthToken != "" {
		return debugpkg.BearerAuth(cfg.LocalAuthToken)
	}
	if cfg.HubJWTSecret != "" {
		return hubJWTDebugAuth(cfg.HubJWTSecret, cfg.EdgeDeviceID)
	}
	return func(r *http.Request) bool { return false }
}

// hubJWTDebugAuth returns an auth predicate that accepts a Bearer Hub JWT
// validated against the shared Hub secret and expected Edge device ID.
func hubJWTDebugAuth(hubJWTSecret, edgeDeviceID string) func(r *http.Request) bool {
	secret := []byte(hubJWTSecret)
	deviceID := strings.TrimSpace(edgeDeviceID)
	return func(r *http.Request) bool {
		got := bearerToken(r.Header.Get("Authorization"))
		if got == "" {
			return false
		}
		if strings.HasPrefix(got, "td_") {
			// TokenDance bearer tokens are not Edge sessions.
			return false
		}
		_, err := jwtutil.ValidateHubToken(got, secret, deviceID)
		return err == nil
	}
}
