//nolint:gosec // 测试 fixture：凭据模式字符串用于构造测试用例，非真实凭据
package jwtutil

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"math/big"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"github.com/agenthub/pkg/testkit/oidcfixture"
)

func TestParseTokenDanceJWTRequiresExpectedIssuerAndAudience(t *testing.T) {
	priv, jwks := tokenDanceTestKey(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(jwks))
	}))
	t.Cleanup(server.Close)

	// Instance-owned verifier (#1551/#1564): no process-global JWKS state;
	// the transport/cache policy is injected explicitly.
	v := NewTokenDanceVerifier(server.URL, VerifierConfig{})

	token := signTokenDanceTestToken(t, priv, "https://issuer.example", "agenthub-client")

	claims, err := v.ParseJWT(context.Background(), token, "https://issuer.example", "agenthub-client")
	if err != nil {
		t.Fatalf("ParseJWT valid token failed: %v", err)
	}
	if claims.Subject != "user-1" {
		t.Fatalf("subject = %q, want user-1", claims.Subject)
	}

	if _, err := v.ParseJWT(context.Background(), token, "https://other-issuer.example", "agenthub-client"); err == nil {
		t.Fatal("expected wrong issuer to be rejected")
	}
	if _, err := v.ParseJWT(context.Background(), token, "https://issuer.example", "other-client"); err == nil {
		t.Fatal("expected wrong audience to be rejected")
	}
}

func tokenDanceTestKey(t *testing.T) (*rsa.PrivateKey, string) {
	t.Helper()
	key := oidcfixture.NewKey(t)
	return key.Private, key.JWKS
}

func tokenDanceTestKID(pub *rsa.PublicKey) string {
	return oidcfixture.ComputeKID(pub)
}

func signTokenDanceTestToken(t *testing.T, priv *rsa.PrivateKey, issuer, audience string) string {
	return oidcfixture.SignToken(t, priv, oidcfixture.ComputeKID(&priv.PublicKey), issuer, audience, "user-1", "user@example.com", "Test User")
}

// TestTokenDanceVerifierInstancesIndependent proves verifiers own their
// JWKS cache: two instances pointed at different endpoints do not share
// state (#1551).
func TestTokenDanceVerifierInstancesIndependent(t *testing.T) {
	_, jwksA := tokenDanceTestKey(t)
	privB, jwksB := tokenDanceTestKey(t)

	srvA := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(jwksA))
	}))
	defer srvA.Close()
	srvB := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(jwksB))
	}))
	defer srvB.Close()

	// Token signed with B's key — only verifier B must accept it.
	tokenB := signTokenDanceTestToken(t, privB, "https://issuer.example", "agenthub-client")

	vA := NewTokenDanceVerifier(srvA.URL, VerifierConfig{})
	vB := NewTokenDanceVerifier(srvB.URL, VerifierConfig{})

	// Force A's cache to populate first (it fetches B's server URL — no,
	// A points at srvA which serves jwksA; the token needs B's key, so A
	// must reject and B must accept).
	if _, err := vA.ParseJWT(context.Background(), tokenB, "https://issuer.example", "agenthub-client"); err == nil {
		t.Fatal("verifier A must reject a token signed with B's key")
	}
	claims, err := vB.ParseJWT(context.Background(), tokenB, "https://issuer.example", "agenthub-client")
	if err != nil {
		t.Fatalf("verifier B must accept: %v", err)
	}
	if claims.Subject != "user-1" {
		t.Fatalf("subject = %q, want user-1", claims.Subject)
	}
}

// TestParseJWTRejectsRS384TokenSignedWithSameKey (Task 4): even when a token
// is signed with the same RSA private key whose public half is published in
// the JWKS under alg=RS256, a token signed with RS384 must be rejected. The
// verifier pins RS256 via WithValidMethods + the keyfunc alg header check,
// so an alg-confusion downgrade is impossible.
func TestParseJWTRejectsRS384TokenSignedWithSameKey(t *testing.T) {
	priv, jwks := tokenDanceTestKey(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(jwks))
	}))
	t.Cleanup(server.Close)
	v := NewTokenDanceVerifier(server.URL, VerifierConfig{})

	now := time.Now()
	claims := TokenDanceClaims{
		Email: "user@example.com",
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    "https://issuer.example",
			Subject:   "user-1",
			Audience:  jwt.ClaimStrings{"agenthub-client"},
			ExpiresAt: jwt.NewNumericDate(now.Add(time.Hour)),
			IssuedAt:  jwt.NewNumericDate(now),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodRS384, claims)
	token.Header["kid"] = tokenDanceTestKID(&priv.PublicKey)
	signed, err := token.SignedString(priv)
	if err != nil {
		t.Fatalf("sign RS384 token: %v", err)
	}
	if _, err := v.ParseJWT(context.Background(), signed, "https://issuer.example", "agenthub-client"); err == nil {
		t.Fatal("expected RS384 token to be rejected (only RS256 is allowed)")
	}
}

// TestParseJWTRejectsJWKSPublishedWithRS384Alg (Task 4): a JWKS entry that
// advertises alg=RS384 (even with a valid RSA key) must not be loaded, so a
// token signed with RS384 against that key cannot pass verification. The
// verifier pins the JWKS alg to RS256 during fetch.
func TestParseJWTRejectsJWKSPublishedWithRS384Alg(t *testing.T) {
	priv, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	kid := tokenDanceTestKID(&priv.PublicKey)
	n := base64.RawURLEncoding.EncodeToString(priv.N.Bytes())
	e := base64.RawURLEncoding.EncodeToString(big.NewInt(int64(priv.E)).Bytes())
	// JWKS advertises alg=RS384 — the entry must be skipped during fetch.
	jwks := `{"keys":[{"kty":"RSA","use":"sig","alg":"RS384","kid":"` + kid + `","n":"` + n + `","e":"` + e + `"}]}`
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(jwks))
	}))
	t.Cleanup(server.Close)
	v := NewTokenDanceVerifier(server.URL, VerifierConfig{})

	token := signTokenDanceTestToken(t, priv, "https://issuer.example", "agenthub-client")
	if _, err := v.ParseJWT(context.Background(), token, "https://issuer.example", "agenthub-client"); err == nil {
		t.Fatal("expected token to be rejected when JWKS only publishes an RS384 key")
	}
}

// TestParseJWTRejectsJWKSMissingAlg (Task 4): a JWKS entry without an alg
// field is not trusted, because the verifier cannot confirm the key is
// intended for RS256. The alg-pin requires alg == "RS256" explicitly.
func TestParseJWTRejectsJWKSMissingAlg(t *testing.T) {
	priv, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	kid := tokenDanceTestKID(&priv.PublicKey)
	n := base64.RawURLEncoding.EncodeToString(priv.N.Bytes())
	e := base64.RawURLEncoding.EncodeToString(big.NewInt(int64(priv.E)).Bytes())
	// No alg field — entry must be skipped.
	jwks := `{"keys":[{"kty":"RSA","use":"sig","kid":"` + kid + `","n":"` + n + `","e":"` + e + `"}]}`
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(jwks))
	}))
	t.Cleanup(server.Close)
	v := NewTokenDanceVerifier(server.URL, VerifierConfig{})

	token := signTokenDanceTestToken(t, priv, "https://issuer.example", "agenthub-client")
	if _, err := v.ParseJWT(context.Background(), token, "https://issuer.example", "agenthub-client"); err == nil {
		t.Fatal("expected token to be rejected when JWKS entry omits alg")
	}
}

// TestParseJWKSCtxCancellation verifies that JWKS fetch honors the caller's
// context: when ctx is cancelled before the HTTP round-trip completes, the
// fetch must fail with the context error rather than blocking on the
// client-level timeout (#2064 item ②).
func TestParseJWKSCtxCancellation(t *testing.T) {
	// Slow server: blocks until the request context is done, then returns.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		<-r.Context().Done()
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(srv.Close)

	v := NewTokenDanceVerifier(srv.URL, VerifierConfig{})

	ctx, cancel := context.WithCancel(context.Background())
	cancel() // cancel immediately

	_, err := v.ParseJWT(ctx, "dummy.token.here", "https://issuer.example", "agenthub-client")
	if err == nil {
		t.Fatal("ParseJWT with cancelled ctx must fail")
	}
	// The error should mention context cancellation, not a timeout.
	if !strings.Contains(err.Error(), "context canceled") && !strings.Contains(err.Error(), "jwks fetch failed") {
		t.Fatalf("expected context-related error, got: %v", err)
	}
}
