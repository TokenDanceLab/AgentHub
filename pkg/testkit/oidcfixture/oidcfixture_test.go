package oidcfixture

import (
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
	"testing"

	"github.com/golang-jwt/jwt/v5"
)

// TestComputeKIDIsDeterministicAndStable verifies the KID algorithm matches
// the contract that the Hub verifier depends on: base64url(sha256(N)[:16]).
func TestComputeKIDIsDeterministicAndStable(t *testing.T) {
	key := NewKey(t)
	if key.Kid == "" {
		t.Fatal("kid is empty")
	}
	if got := ComputeKID(&key.Private.PublicKey); got != key.Kid {
		t.Fatalf("ComputeKID = %q, want %q", got, key.Kid)
	}
	if !strings.HasSuffix(key.JWKS, `]}`) || !strings.Contains(key.JWKS, key.Kid) {
		t.Fatalf("JWKS must contain the kid: %s", key.JWKS)
	}
}

// TestSignIDTokenParsesWithJWT verifies a signed token carries the kid header
// and the profile claims, and validates with the same key's public half.
func TestSignIDTokenParsesWithJWT(t *testing.T) {
	key := NewKey(t)
	tokenString := key.SignIDToken(t, "https://issuer", "client-a", "user-1", "user-1@example.com", "User One")

	parsed, err := jwt.Parse(tokenString, func(tok *jwt.Token) (any, error) {
		if tok.Header["kid"] != key.Kid {
			t.Fatalf("kid header = %v, want %q", tok.Header["kid"], key.Kid)
		}
		return &key.Private.PublicKey, nil
	})
	if err != nil {
		t.Fatalf("parse token: %v", err)
	}
	if !parsed.Valid {
		t.Fatal("token not valid")
	}
	claims, ok := parsed.Claims.(jwt.MapClaims)
	if !ok {
		t.Fatalf("claims type = %T, want jwt.MapClaims", parsed.Claims)
	}
	if claims["iss"] != "https://issuer" || claims["sub"] != "user-1" {
		t.Fatalf("iss/sub mismatch: %v", claims)
	}
	if claims["email"] != "user-1@example.com" || claims["name"] != "User One" {
		t.Fatalf("profile claims mismatch: %v", claims)
	}
}

// TestNewServerServesTokenEndpoint verifies the mock provider issues a token
// for a valid authorization_code exchange and signs it with the provider key.
func TestNewServerServesTokenEndpoint(t *testing.T) {
	provider := NewServer(t)
	defer provider.Server.Close()

	resp := make(map[string]any)
	form := url.Values{
		"grant_type":   {"authorization_code"},
		"code":         {"code-12345678"},
		"client_id":    {"client-a"},
		"redirect_uri": {"http://localhost/callback"},
	}
	httpResp, err := http.PostForm(provider.Server.URL+"/oidc/token", form)
	if err != nil {
		t.Fatalf("post token: %v", err)
	}
	defer httpResp.Body.Close()
	if err := json.NewDecoder(httpResp.Body).Decode(&resp); err != nil {
		t.Fatalf("decode token response: %v", err)
	}
	idToken, _ := resp["id_token"].(string)
	if idToken == "" {
		t.Fatalf("id_token missing: %v", resp)
	}
	if resp["access_token"] != "mock-access-token-code-123" {
		t.Fatalf("access_token = %v", resp["access_token"])
	}

	// The issued id_token must validate against the provider key.
	parsed, err := jwt.Parse(idToken, func(tok *jwt.Token) (any, error) {
		return &provider.Key.Private.PublicKey, nil
	})
	if err != nil || !parsed.Valid {
		t.Fatalf("issued id_token invalid: err=%v", err)
	}
}
