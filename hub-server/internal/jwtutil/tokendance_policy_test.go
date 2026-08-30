package jwtutil

// Phase-2 JWKS verifier policy tests (#1564): injected transport policy,
// fail-closed body limit, redirect refusal, and secret non-leakage.

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/agenthub/hub-server/internal/outboundhttp"
)

// testPolicyClient mirrors the composition-root client policy (bounded
// timeout, redirects refused) for injection tests.
func testPolicyClient() *http.Client {
	return outboundhttp.NewClient(0)
}

func TestTokenDanceVerifierBodyLimitFailClosed(t *testing.T) {
	priv, jwks := tokenDanceTestKey(t)
	_ = priv

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(jwks))
	}))
	defer srv.Close()

	// A cap smaller than the JWKS document must fail closed.
	v := NewTokenDanceVerifier(srv.URL, VerifierConfig{MaxBodyBytes: 16})
	if err := v.cache.fetchJWKS(context.Background()); err == nil {
		t.Fatal("expected body-limit failure for oversized JWKS")
	} else if !strings.Contains(err.Error(), "body limit") {
		t.Fatalf("error should mention the body limit, got: %v", err)
	}
}

func TestTokenDanceVerifierRedirectNotFollowed(t *testing.T) {
	// The JWKS endpoint answers with a redirect; the fail-closed policy must
	// not follow it (the configured URI is the only trusted origin, #1564).
	redirectTargetHits := 0
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		redirectTargetHits++
		_, _ = w.Write([]byte(`{"keys":[]}`))
	}))
	defer target.Close()

	redirector := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target.URL, http.StatusFound)
	}))
	defer redirector.Close()

	v := NewTokenDanceVerifier(redirector.URL, VerifierConfig{})
	if err := v.cache.fetchJWKS(context.Background()); err == nil {
		t.Fatal("expected redirect refusal")
	}
	if redirectTargetHits != 0 {
		t.Fatalf("redirect target must never be dialed, got %d hits", redirectTargetHits)
	}
}

func TestTokenDanceVerifierErrorDoesNotLeakJWKSBody(t *testing.T) {
	// A non-200 response body must never surface in the error (it could
	// carry provider debugging secrets).
	rawBody := `{"error":"invalid_client","client_secret":"provider-secret-value","access_token":"provider-token-value"}`

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(rawBody))
	}))
	defer srv.Close()

	v := NewTokenDanceVerifier(srv.URL, VerifierConfig{})
	err := v.cache.fetchJWKS(context.Background())
	if err == nil {
		t.Fatal("expected error for 500 JWKS response")
	}
	for _, leaked := range []string{"provider-secret-value", "provider-token-value", "client_secret", "access_token"} {
		if strings.Contains(err.Error(), leaked) {
			t.Fatalf("JWKS error leaked %q: %s", leaked, err.Error())
		}
	}
}

func TestTokenDanceVerifierInjectedClientUsed(t *testing.T) {
	// The composition-root client (custom timeout + redirect refusal) is the
	// one used for fetches; a fresh client is never constructed per fetch.
	fetches := 0
	_, jwks := tokenDanceTestKey(t)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fetches++
		_, _ = w.Write([]byte(jwks))
	}))
	defer srv.Close()

	client := testPolicyClient()
	v := NewTokenDanceVerifier(srv.URL, VerifierConfig{HTTPClient: client})
	if err := v.cache.fetchJWKS(context.Background()); err != nil {
		t.Fatalf("fetch with injected client failed: %v", err)
	}
	if fetches != 1 {
		t.Fatalf("expected 1 fetch, got %d", fetches)
	}
	if v.cache.client != client {
		t.Fatal("verifier must use the injected client instance")
	}
}
