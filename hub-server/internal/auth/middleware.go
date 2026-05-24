// Package auth provides JWT-based HTTP authentication middleware for the Hub Server.
package auth

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/golang-jwt/jwt/v5"
)

// contextKey is an unexported type to avoid collisions with other packages.
type contextKey string

const userContextKey contextKey = "auth_user"

// User represents an authenticated user extracted from JWT claims.
type User struct {
	ID   string
	Name string
}

// UserFromContext extracts user info from the request context.
// Returns false if no user was set by the middleware.
func UserFromContext(ctx context.Context) (*User, bool) {
	user, ok := ctx.Value(userContextKey).(*User)
	return user, ok
}

// Middleware provides HTTP authentication via JWT Bearer tokens.
type Middleware struct {
	jwtSecret    []byte
	skipPaths    map[string]bool // exact path matches
	skipPrefixes []string        // prefix matches (paths ending with /*)
}

// NewMiddleware creates an auth middleware. jwtSecret is required and is used
// to validate HMAC-signed JWT tokens. skipPaths are optional paths that bypass
// authentication; paths ending with "/*" match all sub-paths.
func NewMiddleware(jwtSecret string, skipPaths ...string) *Middleware {
	m := &Middleware{
		jwtSecret:    []byte(jwtSecret),
		skipPaths:    make(map[string]bool),
		skipPrefixes: make([]string, 0),
	}
	for _, p := range skipPaths {
		if strings.HasSuffix(p, "/*") {
			m.skipPrefixes = append(m.skipPrefixes, strings.TrimSuffix(p, "/*"))
		} else {
			m.skipPaths[p] = true
		}
	}
	return m
}

// Authenticate is an HTTP middleware that validates JWT Bearer tokens.
//
// It extracts the token from the Authorization header, validates the signature
// and expiration, and injects user info into the request context. Requests to
// paths configured as skip paths (including wildcard prefixes) bypass auth
// entirely.
//
// On failure it returns:
//   - 401 with {"error": "unauthorized", "message": "..."} for missing,
//     malformed, or expired tokens.
func (m *Middleware) Authenticate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Exact path match.
		if m.skipPaths[r.URL.Path] {
			next.ServeHTTP(w, r)
			return
		}
		// Prefix match for wildcard skip paths (e.g. /v1/public/*).
		for _, prefix := range m.skipPrefixes {
			if strings.HasPrefix(r.URL.Path, prefix) {
				next.ServeHTTP(w, r)
				return
			}
		}

		// Extract Bearer token from Authorization header.
		authHeader := r.Header.Get("Authorization")
		if authHeader == "" {
			writeAuthError(w, http.StatusUnauthorized, "missing Authorization header")
			return
		}

		tokenStr, ok := strings.CutPrefix(authHeader, "Bearer ")
		if !ok {
			writeAuthError(w, http.StatusUnauthorized, "invalid Authorization header format, expected 'Bearer <token>'")
			return
		}

		// Parse and validate JWT.
		token, err := jwt.Parse(tokenStr, func(token *jwt.Token) (interface{}, error) {
			if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
				return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
			}
			return m.jwtSecret, nil
		})

		if err != nil || !token.Valid {
			writeAuthError(w, http.StatusUnauthorized, "invalid or expired token")
			return
		}

		claims, ok := token.Claims.(jwt.MapClaims)
		if !ok {
			writeAuthError(w, http.StatusUnauthorized, "invalid token claims")
			return
		}

		sub, _ := claims.GetSubject()
		if sub == "" {
			writeAuthError(w, http.StatusUnauthorized, "token missing subject claim")
			return
		}

		name, _ := claims["name"].(string)

		user := &User{ID: sub, Name: name}
		ctx := context.WithValue(r.Context(), userContextKey, user)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// writeAuthError writes a JSON error response for auth failures.
func writeAuthError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{
		"error":   "unauthorized",
		"message": message,
	})
}
