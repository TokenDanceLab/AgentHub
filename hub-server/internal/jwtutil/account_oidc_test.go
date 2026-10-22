//nolint:gosec // Test fixtures deliberately build invalid and future claims.
package jwtutil

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"github.com/agenthub/hub-server/internal/outboundhttp"
	"github.com/agenthub/pkg/testkit/oidcfixture"
)

func TestAccountOIDCVerifierValidatesIssuerAudienceNonceAndAzp(t *testing.T) {
	key := oidcfixture.NewKey(t)
	server := jwksServer(t, key.JWKS)
	verifier := NewAccountOIDCVerifier(server.URL, VerifierConfig{})
	token := signAccountTestToken(t, key, accountTestClaims{
		issuer:   "https://account.example",
		audience: []string{"agenthub"},
		azp:      "agenthub",
		subject:  "acct_user",
		nonce:    "nonce-1",
	})

	claims, err := verifier.ParseIDToken(context.Background(), token, "https://account.example", "agenthub", "nonce-1")
	if err != nil {
		t.Fatalf("valid token rejected: %v", err)
	}
	if claims.Subject != "acct_user" {
		t.Fatalf("subject = %q", claims.Subject)
	}
	if _, err := verifier.ParseIDToken(context.Background(), token, "https://other.example", "agenthub", "nonce-1"); err == nil {
		t.Fatal("wrong issuer must be rejected")
	}
	if _, err := verifier.ParseIDToken(context.Background(), token, "https://account.example", "other-client", "nonce-1"); err == nil {
		t.Fatal("wrong audience must be rejected")
	}
	if _, err := verifier.ParseIDToken(context.Background(), token, "https://account.example", "agenthub", "nonce-2"); err == nil {
		t.Fatal("wrong nonce must be rejected")
	}
	wrongAZP := signAccountTestToken(t, key, accountTestClaims{
		issuer:   "https://account.example",
		audience: []string{"agenthub", "other"},
		azp:      "other",
		subject:  "acct_user",
		nonce:    "nonce-1",
	})
	if _, err := verifier.ParseIDToken(context.Background(), wrongAZP, "https://account.example", "agenthub", "nonce-1"); err == nil {
		t.Fatal("wrong azp must be rejected")
	}
}

func TestAccountOIDCVerifierRequiresNonceAndCurrentClaims(t *testing.T) {
	key := oidcfixture.NewKey(t)
	server := jwksServer(t, key.JWKS)
	verifier := NewAccountOIDCVerifier(server.URL, VerifierConfig{})
	valid := signAccountTestToken(t, key, accountTestClaims{
		issuer:   "https://account.example",
		audience: []string{"agenthub"},
		subject:  "acct_user",
		nonce:    "nonce-1",
	})
	if _, err := verifier.ParseIDToken(context.Background(), valid, "https://account.example", "agenthub", ""); err == nil {
		t.Fatal("missing expected nonce must be rejected")
	}

	now := time.Now()
	expired := signRawAccountToken(t, key, &AccountOIDCClaims{
		Nonce: "nonce-1",
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    "https://account.example",
			Subject:   "acct_user",
			Audience:  jwt.ClaimStrings{"agenthub"},
			ExpiresAt: jwt.NewNumericDate(now.Add(-time.Hour)),
			IssuedAt:  jwt.NewNumericDate(now.Add(-2 * time.Hour)),
		},
	})
	if _, err := verifier.ParseIDToken(context.Background(), expired, "https://account.example", "agenthub", "nonce-1"); err == nil {
		t.Fatal("expired token must be rejected")
	}
}

func TestAccountOIDCVerifierInstancesIndependent(t *testing.T) {
	keyA := oidcfixture.NewKey(t)
	keyB := oidcfixture.NewKey(t)
	serverA := jwksServer(t, keyA.JWKS)
	serverB := jwksServer(t, keyB.JWKS)
	verifierA := NewAccountOIDCVerifier(serverA.URL, VerifierConfig{})
	verifierB := NewAccountOIDCVerifier(serverB.URL, VerifierConfig{})
	tokenB := signAccountTestToken(t, keyB, accountTestClaims{
		issuer:   "https://account.example",
		audience: []string{"agenthub"},
		subject:  "acct_b",
		nonce:    "nonce-1",
	})
	if _, err := verifierA.ParseIDToken(context.Background(), tokenB, "https://account.example", "agenthub", "nonce-1"); err == nil {
		t.Fatal("verifier A must reject B's key")
	}
	if _, err := verifierB.ParseIDToken(context.Background(), tokenB, "https://account.example", "agenthub", "nonce-1"); err != nil {
		t.Fatalf("verifier B must accept its own key: %v", err)
	}
}

func TestAccountOIDCVerifierPinsRS256(t *testing.T) {
	key := oidcfixture.NewKey(t)
	server := jwksServer(t, key.JWKS)
	verifier := NewAccountOIDCVerifier(server.URL, VerifierConfig{})
	now := time.Now()
	claims := &AccountOIDCClaims{
		Nonce: "nonce-1",
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    "https://account.example",
			Subject:   "acct_user",
			Audience:  jwt.ClaimStrings{"agenthub"},
			ExpiresAt: jwt.NewNumericDate(now.Add(time.Hour)),
			IssuedAt:  jwt.NewNumericDate(now),
		},
	}
	signed := jwt.NewWithClaims(jwt.SigningMethodRS384, claims)
	signed.Header["kid"] = key.Kid
	raw, err := signed.SignedString(key.Private)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := verifier.ParseIDToken(context.Background(), raw, "https://account.example", "agenthub", "nonce-1"); err == nil {
		t.Fatal("RS384 must be rejected")
	}
}

func TestAccountOIDCVerifierBodyLimitAndRedirectPolicy(t *testing.T) {
	key := oidcfixture.NewKey(t)
	server := jwksServer(t, key.JWKS)
	verifier := NewAccountOIDCVerifier(server.URL, VerifierConfig{MaxBodyBytes: 16})
	if err := verifier.cache.fetchJWKS(context.Background()); err == nil || !strings.Contains(err.Error(), "body limit") {
		t.Fatalf("expected body-limit failure, got %v", err)
	}

	hits := 0
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
		_, _ = w.Write([]byte(key.JWKS))
	}))
	t.Cleanup(target.Close)
	redirector := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target.URL, http.StatusFound)
	}))
	t.Cleanup(redirector.Close)
	redirectVerifier := NewAccountOIDCVerifier(redirector.URL, VerifierConfig{HTTPClient: outboundhttp.NewClient(0)})
	if err := redirectVerifier.cache.fetchJWKS(context.Background()); err == nil {
		t.Fatal("redirected JWKS must fail")
	}
	if hits != 0 {
		t.Fatalf("redirect target was dialed %d times", hits)
	}
}

func TestAccountOIDCVerifierHonorsCancellation(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		<-r.Context().Done()
	}))
	t.Cleanup(server.Close)
	verifier := NewAccountOIDCVerifier(server.URL, VerifierConfig{})
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := verifier.ParseIDToken(ctx, "dummy.token.value", "https://account.example", "agenthub", "nonce"); err == nil {
		t.Fatal("cancelled context must fail")
	}
}

type accountTestClaims struct {
	issuer   string
	audience []string
	azp      string
	subject  string
	nonce    string
}

func signAccountTestToken(t *testing.T, key *oidcfixture.Key, in accountTestClaims) string {
	t.Helper()
	now := time.Now()
	return signRawAccountToken(t, key, &AccountOIDCClaims{
		Nonce: in.nonce,
		Azp:   in.azp,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    in.issuer,
			Subject:   in.subject,
			Audience:  jwt.ClaimStrings(in.audience),
			ExpiresAt: jwt.NewNumericDate(now.Add(time.Hour)),
			IssuedAt:  jwt.NewNumericDate(now),
		},
	})
}

func signRawAccountToken(t *testing.T, key *oidcfixture.Key, claims *AccountOIDCClaims) string {
	t.Helper()
	token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	token.Header["kid"] = key.Kid
	raw, err := token.SignedString(key.Private)
	if err != nil {
		t.Fatalf("sign token: %v", err)
	}
	return raw
}

func jwksServer(t *testing.T, jwks string) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(jwks))
	}))
	t.Cleanup(server.Close)
	return server
}
