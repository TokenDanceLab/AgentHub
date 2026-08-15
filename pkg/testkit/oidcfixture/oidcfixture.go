// Package oidcfixture provides a self-contained mock TokenDance ID provider
// for tests: RSA key generation, deterministic key ID, JWKS rendering, RS256
// ID-token signing, and a full authorize/token HTTP server.
//
// The KID derivation and JWKS shape must stay byte-consistent with the Hub's
// jwtutil.TokenDanceVerifier, so tokens signed by this fixture parse cleanly
// against the production verifier. This package replaces the verbatim-duplicated
// keygen/kid/jwks/sign helpers that lived in five separate test files.
package oidcfixture

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"math/big"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// Claims mirrors hub jwtutil.TokenDanceClaims field-for-field so a signed token
// parses identically with the Hub verifier, without pkg depending on the hub.
type Claims struct {
	Email         string `json:"email,omitempty"`
	EmailVerified bool   `json:"email_verified"`
	Name          string `json:"name,omitempty"`
	Picture       string `json:"picture,omitempty"`
	jwt.RegisteredClaims
}

// ComputeKID derives the deterministic key ID from an RSA public key:
// base64url(sha256(N)[:16]). This exact algorithm must stay consistent across
// every place that signs TokenDance ID tokens.
func ComputeKID(pub *rsa.PublicKey) string {
	hash := sha256.Sum256(pub.N.Bytes())
	return base64.RawURLEncoding.EncodeToString(hash[:16])
}

// JWKS renders the public JWKS document for a key (kty=RSA, use=sig, alg=RS256).
func JWKS(pub *rsa.PublicKey, kid string) string {
	n := base64.RawURLEncoding.EncodeToString(pub.N.Bytes())
	e := base64.RawURLEncoding.EncodeToString(big.NewInt(int64(pub.E)).Bytes())
	return fmt.Sprintf(
		`{"keys":[{"kty":"RSA","use":"sig","alg":"RS256","kid":"%s","n":"%s","e":"%s"}]}`,
		kid, n, e,
	)
}

// Key is a generated RSA-2048 key with its precomputed kid and JWKS.
type Key struct {
	Private *rsa.PrivateKey
	Kid     string
	JWKS    string
}

// NewKey generates an RSA-2048 key and precomputes its kid and JWKS.
func NewKey(t testing.TB) *Key {
	t.Helper()
	priv, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("oidcfixture: generate key: %v", err)
	}
	kid := ComputeKID(&priv.PublicKey)
	return &Key{
		Private: priv,
		Kid:     kid,
		JWKS:    JWKS(&priv.PublicKey, kid),
	}
}

// SignToken signs an RS256 ID token with an explicit key + kid. It is the
// primitive behind Key.SignIDToken; exposed for callers that already hold a
// *rsa.PrivateKey and its kid rather than a *Key.
func SignToken(t testing.TB, priv *rsa.PrivateKey, kid, issuer, audience, subject, email, name string) string {
	t.Helper()
	now := time.Now()
	claims := Claims{
		Email:         email,
		EmailVerified: true,
		Name:          name,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    issuer,
			Subject:   subject,
			Audience:  jwt.ClaimStrings{audience},
			ExpiresAt: jwt.NewNumericDate(now.Add(time.Hour)),
			IssuedAt:  jwt.NewNumericDate(now),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	token.Header["kid"] = kid
	signed, err := token.SignedString(priv)
	if err != nil {
		t.Fatalf("oidcfixture: sign id token: %v", err)
	}
	return signed
}

// SignIDToken signs an RS256 ID token with the key's private key and kid.
// email and name fill the TokenDance profile claims.
func (k *Key) SignIDToken(t testing.TB, issuer, audience, subject, email, name string) string {
	return SignToken(t, k.Private, k.Kid, issuer, audience, subject, email, name)
}

// Provider is a running mock TokenDance ID server plus its signing key.
type Provider struct {
	Server *httptest.Server
	Key    *Key
}

// NewServer starts a mock TokenDance ID provider exposing GET /oidc/jwks,
// GET /oidc/authorize, and POST /oidc/token. The token endpoint signs an
// RS256 ID token with the provider key using subject "user-mock-<code-prefix>"
// and audience = the posted client_id.
func NewServer(t testing.TB) *Provider {
	t.Helper()
	key := NewKey(t)

	mux := http.NewServeMux()
	mux.HandleFunc("GET /oidc/jwks", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(key.JWKS))
	})
	mux.HandleFunc("GET /oidc/authorize", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		_, _ = w.Write([]byte("<html><body>Mock TokenDance ID — Authorize</body></html>"))
	})
	mux.HandleFunc("POST /oidc/token", func(w http.ResponseWriter, r *http.Request) {
		if err := r.ParseForm(); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": "invalid_request"})
			return
		}
		grantType := r.FormValue("grant_type")
		code := r.FormValue("code")
		clientID := r.FormValue("client_id")
		redirectURI := r.FormValue("redirect_uri")
		if grantType != "authorization_code" {
			w.WriteHeader(http.StatusBadRequest)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": "unsupported_grant_type"})
			return
		}
		if code == "" || clientID == "" || redirectURI == "" {
			w.WriteHeader(http.StatusBadRequest)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": "invalid_request"})
			return
		}
		sub := "user-mock-" + code[:8]
		idToken := key.SignIDToken(t, "http://"+r.Host, clientID, sub, sub+"@tokendance.test", "Mock User "+sub)
		resp := map[string]any{
			"access_token":  "mock-access-token-" + code[:8],
			"token_type":    "Bearer",
			"expires_in":    3600,
			"id_token":      idToken,
			"refresh_token": "mock-refresh-token-" + code[:8],
			"scope":         "openid profile email",
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(resp)
	})

	return &Provider{Server: httptest.NewServer(mux), Key: key}
}
