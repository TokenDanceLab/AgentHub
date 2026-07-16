package jwtutil

import (
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// edgeValidateShape mirrors edge-server/internal/jwtutil.ValidateCapabilityToken
// constraints (issuer/audience/alg/device bind). Kept local so this package does
// not import edge-server/internal (Go internal rules). Wire claim tags must stay
// aligned with edge CapabilityClaims (AH-SR-046 / #461 fixture evidence).
func edgeValidateShape(tokenStr string, secret []byte, expectedDeviceID string) (*CapabilityClaims, error) {
	if len(secret) == 0 {
		return nil, ErrCapabilitySecretEmpty
	}
	if len(secret) < 32 {
		return nil, ErrCapabilitySecretTooShort
	}
	if strings.TrimSpace(tokenStr) == "" {
		return nil, ErrCapabilityClaimsInvalid
	}
	if strings.TrimSpace(expectedDeviceID) == "" {
		return nil, ErrCapabilityClaimsInvalid
	}
	token, err := jwt.ParseWithClaims(tokenStr, &CapabilityClaims{}, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, ErrCapabilityClaimsInvalid
		}
		return secret, nil
	},
		jwt.WithLeeway(30*time.Second),
		jwt.WithValidMethods([]string{"HS256"}),
		jwt.WithIssuer("agenthub-hub"),
		jwt.WithAudience("agenthub-edge"),
	)
	if err != nil {
		return nil, err
	}
	claims, ok := token.Claims.(*CapabilityClaims)
	if !ok || !token.Valid {
		return nil, ErrCapabilityClaimsInvalid
	}
	if claims.UserID == "" || claims.DeviceID == "" || claims.ProjectID == "" {
		return nil, ErrCapabilityClaimsInvalid
	}
	if claims.DeviceID != expectedDeviceID {
		return nil, ErrCapabilityClaimsInvalid
	}
	return claims, nil
}

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
	// Hub always materializes Action (= purpose when omitted).
	if claims.Action != "run-start" {
		t.Fatalf("Action = %q, want run-start (defaulted from purpose)", claims.Action)
	}
}

func TestIssueCapabilityToken_RejectsEmptySecret(t *testing.T) {
	if _, err := IssueCapabilityToken(nil, "u", "d", "p", "run-start", time.Minute); err == nil {
		t.Fatal("expected error")
	}
}

func TestIssueCapabilityToken_WithBindings_EdgeValidateShape(t *testing.T) {
	// AH-SR-046 / #461: Hub issue → Edge-shaped validate roundtrip with
	// purpose/action/target/thread bindings (no production network).
	secret := []byte("hub-local-secret-minimum-32-chars!!")
	tok, err := IssueCapabilityToken(secret, "user-1", "edge-1", "proj_local", "run-start", time.Minute, CapabilityIssueOptions{
		Action:   "run-start",
		TargetID: "target-a",
		ThreadID: "thread_local",
	})
	if err != nil {
		t.Fatalf("IssueCapabilityToken: %v", err)
	}
	claims, err := edgeValidateShape(tok, secret, "edge-1")
	if err != nil {
		t.Fatalf("edgeValidateShape: %v", err)
	}
	if claims.Purpose != "run-start" {
		t.Fatalf("Purpose = %q, want run-start", claims.Purpose)
	}
	if claims.Action != "run-start" {
		t.Fatalf("Action = %q, want run-start", claims.Action)
	}
	if claims.TargetID != "target-a" {
		t.Fatalf("TargetID = %q, want target-a", claims.TargetID)
	}
	if claims.ThreadID != "thread_local" {
		t.Fatalf("ThreadID = %q, want thread_local", claims.ThreadID)
	}
}

func TestIssueCapabilityToken_RejectsActionPurposeMismatch(t *testing.T) {
	secret := []byte("hub-local-secret-minimum-32-chars!!")
	_, err := IssueCapabilityToken(secret, "user-1", "edge-1", "proj_local", "run-start", time.Minute, CapabilityIssueOptions{
		Action: "stream",
	})
	if err == nil {
		t.Fatal("expected error when action != purpose")
	}
	if err != ErrCapabilityClaimsInvalid {
		t.Fatalf("err = %v, want ErrCapabilityClaimsInvalid", err)
	}
}

func TestIssueCapabilityToken_RejectsShortSecret(t *testing.T) {
	_, err := IssueCapabilityToken([]byte("too-short"), "user-1", "edge-1", "proj_local", "run-start", time.Minute)
	if err == nil {
		t.Fatal("expected error for short secret")
	}
	if err != ErrCapabilitySecretTooShort {
		t.Fatalf("err = %v, want ErrCapabilitySecretTooShort", err)
	}
}

func TestIssueCapabilityToken_RejectsMissingClaims(t *testing.T) {
	secret := []byte("hub-local-secret-minimum-32-chars!!")
	if _, err := IssueCapabilityToken(secret, "", "edge-1", "proj_local", "run-start", time.Minute); err == nil {
		t.Fatal("expected error for empty user")
	}
	if _, err := IssueCapabilityToken(secret, "user-1", "", "proj_local", "run-start", time.Minute); err == nil {
		t.Fatal("expected error for empty device")
	}
	if _, err := IssueCapabilityToken(secret, "user-1", "edge-1", "", "run-start", time.Minute); err == nil {
		t.Fatal("expected error for empty project")
	}
}

func TestIssueCapabilityToken_EdgeValidateShape_RejectsWrongDevice(t *testing.T) {
	secret := []byte("hub-local-secret-minimum-32-chars!!")
	tok, err := IssueCapabilityToken(secret, "user-1", "edge-1", "proj_local", "run-start", time.Minute)
	if err != nil {
		t.Fatalf("IssueCapabilityToken: %v", err)
	}
	if _, err := edgeValidateShape(tok, secret, "other-edge"); err == nil {
		t.Fatal("expected error for wrong expected device")
	}
}

func TestIssueCapabilityToken_EdgeValidateShape_RejectsWrongSecret(t *testing.T) {
	secret := []byte("hub-local-secret-minimum-32-chars!!")
	tok, err := IssueCapabilityToken(secret, "user-1", "edge-1", "proj_local", "run-start", time.Minute)
	if err != nil {
		t.Fatalf("IssueCapabilityToken: %v", err)
	}
	if _, err := edgeValidateShape(tok, []byte("other-secret-key-also-32-bytes!!!!"), "edge-1"); err == nil {
		t.Fatal("expected error for wrong secret")
	}
}
