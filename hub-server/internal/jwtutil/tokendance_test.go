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
	resetTokenDanceJWKSCache(server.URL)

	token := signTokenDanceTestToken(t, priv, "https://issuer.example", "agenthub-client")

	claims, err := ParseTokenDanceJWT(token, "https://issuer.example", "agenthub-client")
	if err != nil {
		t.Fatalf("ParseTokenDanceJWT valid token failed: %v", err)
	}
	if claims.Subject != "user-1" {
		t.Fatalf("subject = %q, want user-1", claims.Subject)
	}

	if _, err := ParseTokenDanceJWT(token, "https://other-issuer.example", "agenthub-client"); err == nil {
		t.Fatal("expected wrong issuer to be rejected")
	}
	if _, err := ParseTokenDanceJWT(token, "https://issuer.example", "other-client"); err == nil {
		t.Fatal("expected wrong audience to be rejected")
	}
}

func resetTokenDanceJWKSCache(jwksURI string) {
	defaultJWKSCache.mu.Lock()
	defer defaultJWKSCache.mu.Unlock()
	defaultJWKSCache.keys = nil
	defaultJWKSCache.fetched = time.Time{}
	defaultJWKSCache.jwksURI = jwksURI
	defaultJWKSCache.ttl = time.Hour
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
