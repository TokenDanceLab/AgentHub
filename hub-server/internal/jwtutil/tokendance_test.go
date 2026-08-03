package jwtutil

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"math/big"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

func TestParseTokenDanceJWTRequiresExpectedIssuerAndAudience(t *testing.T) {
	priv, jwks := tokenDanceTestKey(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(jwks))
	}))
	t.Cleanup(server.Close)

	// Instance-owned verifier (#1551): no process-global JWKS state.
	v := NewTokenDanceVerifier(server.URL)

	token := signTokenDanceTestToken(t, priv, "https://issuer.example", "agenthub-client")

	claims, err := v.ParseJWT(token, "https://issuer.example", "agenthub-client")
	if err != nil {
		t.Fatalf("ParseJWT valid token failed: %v", err)
	}
	if claims.Subject != "user-1" {
		t.Fatalf("subject = %q, want user-1", claims.Subject)
	}

	if _, err := v.ParseJWT(token, "https://other-issuer.example", "agenthub-client"); err == nil {
		t.Fatal("expected wrong issuer to be rejected")
	}
	if _, err := v.ParseJWT(token, "https://issuer.example", "other-client"); err == nil {
		t.Fatal("expected wrong audience to be rejected")
	}
}

func tokenDanceTestKey(t *testing.T) (*rsa.PrivateKey, string) {
	t.Helper()
	priv, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	kid := tokenDanceTestKID(&priv.PublicKey)
	n := base64.RawURLEncoding.EncodeToString(priv.PublicKey.N.Bytes())
	e := base64.RawURLEncoding.EncodeToString(big.NewInt(int64(priv.PublicKey.E)).Bytes())
	jwks := `{"keys":[{"kty":"RSA","use":"sig","alg":"RS256","kid":"` + kid + `","n":"` + n + `","e":"` + e + `"}]}`
	return priv, jwks
}

func tokenDanceTestKID(pub *rsa.PublicKey) string {
	hash := sha256.Sum256(pub.N.Bytes())
	return base64.RawURLEncoding.EncodeToString(hash[:16])
}

func signTokenDanceTestToken(t *testing.T, priv *rsa.PrivateKey, issuer, audience string) string {
	t.Helper()
	now := time.Now()
	claims := TokenDanceClaims{
		Email:         "user@example.com",
		EmailVerified: true,
		Name:          "Test User",
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    issuer,
			Subject:   "user-1",
			Audience:  jwt.ClaimStrings{audience},
			ExpiresAt: jwt.NewNumericDate(now.Add(time.Hour)),
			IssuedAt:  jwt.NewNumericDate(now),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	token.Header["kid"] = tokenDanceTestKID(&priv.PublicKey)
	signed, err := token.SignedString(priv)
	if err != nil {
		t.Fatalf("sign token: %v", err)
	}
	return signed
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

	vA := NewTokenDanceVerifier(srvA.URL)
	vB := NewTokenDanceVerifier(srvB.URL)

	// Force A's cache to populate first (it fetches B's server URL — no,
	// A points at srvA which serves jwksA; the token needs B's key, so A
	// must reject and B must accept).
	if _, err := vA.ParseJWT(tokenB, "https://issuer.example", "agenthub-client"); err == nil {
		t.Fatal("verifier A must reject a token signed with B's key")
	}
	claims, err := vB.ParseJWT(tokenB, "https://issuer.example", "agenthub-client")
	if err != nil {
		t.Fatalf("verifier B must accept: %v", err)
	}
	if claims.Subject != "user-1" {
		t.Fatalf("subject = %q, want user-1", claims.Subject)
	}
}
