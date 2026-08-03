package oidc

// Phase-2 token-exchange policy tests (#1564): redirect refusal (client_secret
// must never be replayed to another origin), fail-closed response body cap,
// and secret non-leakage on oversized bodies.

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/agenthub/hub-server/internal/config"
)

func TestExchangeCode_RedirectNotFollowed(t *testing.T) {
	redirectTargetHits := 0
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		redirectTargetHits++
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"access_token":"should-never-arrive"}`))
	}))
	defer target.Close()

	redirector := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target.URL, http.StatusFound)
	}))
	defer redirector.Close()

	svc := NewService(nil, config.TokenDanceIDConfig{
		IssuerURL:    redirector.URL,
		ClientID:     "agenthub-client",
		ClientSecret: "super-secret-client-secret",
	}, config.JWTConfig{}, nil)

	_, err := svc.exchangeCode(context.Background(), "auth-code-1", "verifier-1", "http://127.0.0.1/callback")
	require.Error(t, err)
	if redirectTargetHits != 0 {
		t.Fatalf("token exchange must not follow redirects; target dialed %d times", redirectTargetHits)
	}
}

func TestExchangeCode_BodyLimitFailClosed(t *testing.T) {
	// A huge token response with embedded secrets must fail closed and never
	// surface body content in the error.
	rawBody := strings.Repeat("x", 2*1024) + `"client_secret":"leaked-provider-secret","access_token":"leaked-token"`

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(rawBody))
	}))
	defer server.Close()

	svc := NewService(nil, config.TokenDanceIDConfig{
		IssuerURL:            server.URL,
		ClientID:             "agenthub-client",
		ClientSecret:         "super-secret-client-secret",
		MaxResponseBodyBytes: 1024,
	}, config.JWTConfig{}, nil)

	_, err := svc.exchangeCode(context.Background(), "auth-code-1", "verifier-1", "http://127.0.0.1/callback")
	require.Error(t, err)
	if !strings.Contains(err.Error(), "too large") {
		t.Fatalf("error should mention the body cap, got: %v", err)
	}
	for _, leaked := range []string{"leaked-provider-secret", "leaked-token"} {
		if strings.Contains(err.Error(), leaked) {
			t.Fatalf("oversize body content leaked %q: %s", leaked, err.Error())
		}
	}
}

func TestExchangeCode_SharedClientReusedAcrossCalls(t *testing.T) {
	// The service-owned client is constructed once and reused (connection
	// reuse); two exchanges against the same server share one client.
	tokenHits := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		tokenHits++
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":"invalid_grant"}`))
	}))
	defer server.Close()

	svc := NewService(nil, config.TokenDanceIDConfig{
		IssuerURL:    server.URL,
		ClientID:     "agenthub-client",
		ClientSecret: "super-secret-client-secret",
	}, config.JWTConfig{}, nil)

	for i := 0; i < 3; i++ {
		_, err := svc.exchangeCode(context.Background(), "auth-code-1", "verifier-1", "http://127.0.0.1/callback")
		require.Error(t, err)
	}
	if tokenHits != 3 {
		t.Fatalf("expected 3 token requests, got %d", tokenHits)
	}
}
