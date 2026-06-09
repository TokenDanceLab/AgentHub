package jwtutil

import (
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

func TestGenerateAccessToken_RoundTrip(t *testing.T) {
	secret := "test-secret"
	token, err := GenerateAccessToken("user-1", "desktop", "dev-1", secret, 15*time.Minute)
	if err != nil {
		t.Fatalf("GenerateAccessToken failed: %v", err)
	}
	if token == "" {
		t.Fatal("expected non-empty token")
	}

	claims, err := ParseToken(token, secret)
	if err != nil {
		t.Fatalf("ParseToken failed: %v", err)
	}
	if claims.UserID != "user-1" {
		t.Errorf("expected user_id=user-1, got %s", claims.UserID)
	}
	if claims.DeviceType != "desktop" {
		t.Errorf("expected device_type=desktop, got %s", claims.DeviceType)
	}
	if claims.DeviceID != "dev-1" {
		t.Errorf("expected device_id=dev-1, got %s", claims.DeviceID)
	}
	if claims.ExpiresAt == nil {
		t.Fatal("expected ExpiresAt to be set")
	}
	if claims.IssuedAt == nil {
		t.Fatal("expected IssuedAt to be set")
	}
}

func TestParseToken_Expired(t *testing.T) {
	secret := "test-secret"
	token, err := GenerateAccessToken("user-1", "desktop", "dev-1", secret, -1*time.Second)
	if err != nil {
		t.Fatalf("GenerateAccessToken failed: %v", err)
	}

	_, err = ParseToken(token, secret)
	if err == nil {
		t.Fatal("expected error for expired token")
	}
}

func TestParseToken_WrongSecret(t *testing.T) {
	secret := "test-secret"
	token, err := GenerateAccessToken("user-1", "desktop", "dev-1", secret, 15*time.Minute)
	if err != nil {
		t.Fatalf("GenerateAccessToken failed: %v", err)
	}

	_, err = ParseToken(token, "wrong-secret")
	if err == nil {
		t.Fatal("expected error for wrong secret")
	}
}

func TestParseToken_Malformed(t *testing.T) {
	cases := []string{
		"",
		"not.a.jwt",
		"header.$$$.sig",
		"just-one-part",
	}

	for _, tc := range cases {
		_, err := ParseToken(tc, "secret")
		if err == nil {
			t.Errorf("expected error for malformed token %q", tc)
		}
	}
}

func TestParseToken_InvalidSignature(t *testing.T) {
	secret := "test-secret"
	token, err := GenerateAccessToken("user-1", "desktop", "dev-1", secret, 15*time.Minute)
	if err != nil {
		t.Fatalf("GenerateAccessToken failed: %v", err)
	}

	// Tamper with the payload: change last char of the middle part
	parts := []byte(token)
	if len(parts) > 20 {
		parts[len(parts)-5] ^= 0xff
	}

	_, err = ParseToken(string(parts), secret)
	if err == nil {
		t.Fatal("expected error for tampered token")
	}
}

func TestGenerateRefreshToken_ProducesValue(t *testing.T) {
	tok, err := GenerateRefreshToken()
	if err != nil {
		t.Fatalf("GenerateRefreshToken failed: %v", err)
	}
	if tok == "" {
		t.Fatal("expected non-empty refresh token")
	}
	if len(tok) < 32 {
		t.Errorf("expected refresh token >= 32 chars, got %d", len(tok))
	}
}

func TestGenerateRefreshToken_Unique(t *testing.T) {
	tokens := make(map[string]bool)
	for i := 0; i < 10; i++ {
		tok, err := GenerateRefreshToken()
		if err != nil {
			t.Fatalf("GenerateRefreshToken failed: %v", err)
		}
		if tokens[tok] {
			t.Fatal("expected unique tokens, got duplicate")
		}
		tokens[tok] = true
	}
}

func TestHashRefreshToken_Deterministic(t *testing.T) {
	tok := "my-refresh-token"
	h1 := HashRefreshToken(tok)
	h2 := HashRefreshToken(tok)
	if h1 != h2 {
		t.Fatal("expected deterministic hash")
	}
	if h1 == "" {
		t.Fatal("expected non-empty hash")
	}
}

func TestHashRefreshToken_DifferentInputs(t *testing.T) {
	h1 := HashRefreshToken("token-a")
	h2 := HashRefreshToken("token-b")
	if h1 == h2 {
		t.Fatal("expected different hashes for different inputs")
	}
}

func TestGenerateAccessToken_IncludesRegisteredClaims(t *testing.T) {
	secret := "test-secret"
	token, err := GenerateAccessToken("user-1", "desktop", "dev-1", secret, 15*time.Minute)
	if err != nil {
		t.Fatalf("GenerateAccessToken failed: %v", err)
	}

	claims, err := ParseToken(token, secret)
	if err != nil {
		t.Fatalf("ParseToken failed: %v", err)
	}

	if claims.ExpiresAt.Time.Before(time.Now()) {
		t.Error("expected ExpiresAt to be in the future")
	}
	if claims.IssuedAt.Time.After(time.Now()) {
		t.Error("expected IssuedAt to be in the past or present")
	}
}

func TestGenerateEdgeToken_IncludesEdgeScopedClaims(t *testing.T) {
	secret := "hub-secret-at-least-32-bytes-long!!"
	tokenString, err := GenerateEdgeToken("user-1", "edge-device-1", secret, 15*time.Minute)
	if err != nil {
		t.Fatalf("GenerateEdgeToken failed: %v", err)
	}
	if tokenString == "" {
		t.Fatal("expected non-empty token")
	}

	var claims struct {
		UserID     string `json:"user_id"`
		DeviceID   string `json:"device_id"`
		DeviceType string `json:"device_type"`
		Purpose    string `json:"purpose"`
		jwt.RegisteredClaims
	}
	token, err := jwt.ParseWithClaims(tokenString, &claims, func(t *jwt.Token) (interface{}, error) {
		return []byte(secret), nil
	}, jwt.WithValidMethods([]string{"HS256"}))
	if err != nil {
		t.Fatalf("parse edge token: %v", err)
	}
	if !token.Valid {
		t.Fatal("edge token is invalid")
	}
	if claims.Issuer != "agenthub-hub" {
		t.Fatalf("issuer = %q, want agenthub-hub", claims.Issuer)
	}
	if !claimStringsContain(claims.Audience, "agenthub-edge") {
		t.Fatalf("audience = %v, want agenthub-edge", claims.Audience)
	}
	if claims.Subject != "user-1" || claims.UserID != "user-1" {
		t.Fatalf("subject/user_id = %q/%q, want user-1", claims.Subject, claims.UserID)
	}
	if claims.DeviceID != "edge-device-1" {
		t.Fatalf("device_id = %q, want edge-device-1", claims.DeviceID)
	}
	if claims.DeviceType != "edge" {
		t.Fatalf("device_type = %q, want edge", claims.DeviceType)
	}
	if claims.Purpose != "edge-api" {
		t.Fatalf("purpose = %q, want edge-api", claims.Purpose)
	}
}

func claimStringsContain(values jwt.ClaimStrings, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}
