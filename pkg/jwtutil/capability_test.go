package jwtutil

import (
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const testCapabilitySecret = "test-capability-secret-minimum-32-chars-long!"

// TestCapabilityRoundTrip verifies the cross-server contract: a token minted
// by IssueCapabilityToken (Hub side) validates with ValidateCapabilityToken
// (Edge side) and carries the bound claims.
func TestCapabilityRoundTrip(t *testing.T) {
	token, err := IssueCapabilityToken(
		[]byte(testCapabilitySecret),
		"user-1", "edge-1", "proj_local", "run-start",
		time.Minute,
		CapabilityIssueOptions{Action: "run-start", TargetID: "target-1", ThreadID: "thread-1"},
	)
	if err != nil {
		t.Fatalf("IssueCapabilityToken: %v", err)
	}

	claims, err := ValidateCapabilityToken(token, []byte(testCapabilitySecret), "edge-1")
	if err != nil {
		t.Fatalf("ValidateCapabilityToken: %v", err)
	}
	if claims.UserID != "user-1" || claims.ProjectID != "proj_local" || claims.Purpose != "run-start" {
		t.Fatalf("claims = %+v", claims)
	}
	if claims.TargetID != "target-1" || claims.ThreadID != "thread-1" {
		t.Fatalf("bindings = %+v", claims)
	}
	if claims.Issuer != CapabilityIssuer || claims.Audience[0] != CapabilityAudience {
		t.Fatalf("iss/aud = %q/%v", claims.Issuer, claims.Audience)
	}
}

// TestValidateCapabilityRejectsDeviceMismatch verifies the Edge-side device
// binding: a token minted for edge-1 must not validate for edge-2.
func TestValidateCapabilityRejectsDeviceMismatch(t *testing.T) {
	token, err := IssueCapabilityToken([]byte(testCapabilitySecret), "user-1", "edge-1", "proj_local", "run-start", time.Minute)
	if err != nil {
		t.Fatalf("IssueCapabilityToken: %v", err)
	}
	if _, err := ValidateCapabilityToken(token, []byte(testCapabilitySecret), "edge-2"); err == nil {
		t.Fatal("expected device mismatch to be rejected")
	}
}

// TestValidateCapabilityRejectsExpired verifies expired tokens map to
// ErrCapabilityTokenExpired.
func TestValidateCapabilityRejectsExpired(t *testing.T) {
	now := time.Now()
	claims := CapabilityClaims{
		UserID:    "user-1",
		DeviceID:  "edge-1",
		ProjectID: "proj_local",
		Purpose:   "run-start",
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    CapabilityIssuer,
			Audience:  []string{CapabilityAudience},
			IssuedAt:  jwt.NewNumericDate(now.Add(-2 * time.Minute)),
			ExpiresAt: jwt.NewNumericDate(now.Add(-1 * time.Minute)),
		},
	}
	token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(testCapabilitySecret))
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	if _, err := ValidateCapabilityToken(token, []byte(testCapabilitySecret), "edge-1"); err != ErrCapabilityTokenExpired {
		t.Fatalf("err = %v, want ErrCapabilityTokenExpired", err)
	}
}

// TestIssueCapabilityClampsTTL verifies the TTL clamp window.
func TestIssueCapabilityClampsTTL(t *testing.T) {
	token, err := IssueCapabilityToken([]byte(testCapabilitySecret), "user-1", "edge-1", "proj_local", "run-start", 1*time.Second)
	if err != nil {
		t.Fatalf("IssueCapabilityToken: %v", err)
	}
	parsed, err := jwt.ParseWithClaims(token, &CapabilityClaims{}, func(t *jwt.Token) (interface{}, error) {
		return []byte(testCapabilitySecret), nil
	})
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	claims := parsed.Claims.(*CapabilityClaims)
	ttl := claims.ExpiresAt.Sub(claims.IssuedAt.Time)
	if ttl < CapabilityMinTTL {
		t.Fatalf("ttl = %v, want >= %v", ttl, CapabilityMinTTL)
	}
}

// TestIssueCapabilityRejectsShortSecret verifies the secret floor.
func TestIssueCapabilityRejectsShortSecret(t *testing.T) {
	if _, err := IssueCapabilityToken([]byte("short"), "user-1", "edge-1", "proj_local", "run-start", time.Minute); err != ErrCapabilitySecretTooShort {
		t.Fatalf("err = %v, want ErrCapabilitySecretTooShort", err)
	}
	if _, err := IssueCapabilityToken(nil, "user-1", "edge-1", "proj_local", "run-start", time.Minute); err != ErrCapabilitySecretEmpty {
		t.Fatalf("err = %v, want ErrCapabilitySecretEmpty", err)
	}
}
