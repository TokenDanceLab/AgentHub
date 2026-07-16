package jwtutil

import (
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

func TestIssueCapabilityToken_RoundTripShape(t *testing.T) {
	secret := []byte("hub-local-secret-minimum-32-chars!!")
	tok, err := IssueCapabilityToken(secret, "user-1", "edge-1", "proj_local", "run-start", time.Minute)
	if err != nil {
		t.Fatalf("IssueCapabilityToken: %v", err)
	}
	if tok == "" {
		t.Fatal("empty token")
	}
	parsed, err := jwt.ParseWithClaims(tok, &CapabilityClaims{}, func(token *jwt.Token) (interface{}, error) {
		return secret, nil
	}, jwt.WithValidMethods([]string{"HS256"}), jwt.WithIssuer("agenthub-hub"), jwt.WithAudience("agenthub-edge"))
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	claims := parsed.Claims.(*CapabilityClaims)
	if claims.UserID != "user-1" || claims.DeviceID != "edge-1" || claims.ProjectID != "proj_local" || claims.Purpose != "run-start" {
		t.Fatalf("claims mismatch: %+v", claims)
	}
}

func TestIssueCapabilityToken_RejectsEmptySecret(t *testing.T) {
	if _, err := IssueCapabilityToken(nil, "u", "d", "p", "run-start", time.Minute); err == nil {
		t.Fatal("expected error")
	}
}
