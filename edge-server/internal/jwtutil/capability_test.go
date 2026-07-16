package jwtutil

import (
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

func newCapabilityToken(secret string, userID, deviceID, projectID, purpose string, expiresIn time.Duration) string {
	claims := CapabilityClaims{
		UserID:    userID,
		DeviceID:  deviceID,
		ProjectID: projectID,
		Purpose:   purpose,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    "agenthub-hub",
			Audience:  jwt.ClaimStrings{"agenthub-edge"},
			Subject:   userID,
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(expiresIn)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	s, _ := token.SignedString([]byte(secret))
	return s
}

func TestValidateCapabilityToken_Success(t *testing.T) {
	token := newCapabilityToken(testHubSecret, "user-1", "test-device", "proj_demo", "run-start", 1*time.Hour)
	claims, err := ValidateCapabilityToken(token, []byte(testHubSecret), "test-device")
	if err != nil {
		t.Fatalf("ValidateCapabilityToken returned error: %v", err)
	}
	if claims.UserID != "user-1" {
		t.Fatalf("UserID = %q, want user-1", claims.UserID)
	}
	if claims.DeviceID != "test-device" {
		t.Fatalf("DeviceID = %q, want test-device", claims.DeviceID)
	}
	if claims.ProjectID != "proj_demo" {
		t.Fatalf("ProjectID = %q, want proj_demo", claims.ProjectID)
	}
	if claims.Purpose != "run-start" {
		t.Fatalf("Purpose = %q, want run-start", claims.Purpose)
	}
}

func TestValidateCapabilityToken_Expired(t *testing.T) {
	token := newCapabilityToken(testHubSecret, "user-1", "test-device", "proj_demo", "run-start", -1*time.Hour)
	_, err := ValidateCapabilityToken(token, []byte(testHubSecret), "test-device")
	if err == nil {
		t.Fatal("expected error for expired capability token")
	}
	if err != ErrCapabilityTokenExpired {
		t.Fatalf("error = %v, want ErrCapabilityTokenExpired", err)
	}
}

func TestValidateCapabilityToken_WrongSecret(t *testing.T) {
	token := newCapabilityToken("correct-secret-key-long-enough!!", "user-1", "test-device", "proj_demo", "run-start", 1*time.Hour)
	_, err := ValidateCapabilityToken(token, []byte("wrong-secret-key-also-long-enough"), "test-device")
	if err == nil {
		t.Fatal("expected error for wrong secret")
	}
}

func TestValidateCapabilityToken_EmptyToken(t *testing.T) {
	_, err := ValidateCapabilityToken("", []byte(testHubSecret), "test-device")
	if err == nil {
		t.Fatal("expected error for empty token")
	}
	if err != ErrCapabilityTokenEmpty {
		t.Fatalf("error = %v, want ErrCapabilityTokenEmpty", err)
	}
}

func TestValidateCapabilityToken_EmptySecret(t *testing.T) {
	token := newCapabilityToken(testHubSecret, "user-1", "test-device", "proj_demo", "run-start", 1*time.Hour)
	_, err := ValidateCapabilityToken(token, nil, "test-device")
	if err == nil {
		t.Fatal("expected error for empty secret")
	}
	if err != ErrCapabilitySecretEmpty {
		t.Fatalf("error = %v, want ErrCapabilitySecretEmpty", err)
	}
}

func TestValidateCapabilityToken_ShortSecret(t *testing.T) {
	token := newCapabilityToken(testHubSecret, "user-1", "test-device", "proj_demo", "run-start", 1*time.Hour)
	_, err := ValidateCapabilityToken(token, []byte("short"), "test-device")
	if err == nil {
		t.Fatal("expected error for short secret")
	}
	if err != ErrCapabilitySecretTooShort {
		t.Fatalf("error = %v, want ErrCapabilitySecretTooShort", err)
	}
}

func TestValidateCapabilityToken_WrongDevice(t *testing.T) {
	token := newCapabilityToken(testHubSecret, "user-1", "test-device", "proj_demo", "run-start", 1*time.Hour)
	_, err := ValidateCapabilityToken(token, []byte(testHubSecret), "other-device")
	if err == nil {
		t.Fatal("expected error for wrong expected device ID")
	}
}

func TestValidateCapabilityToken_MissingUserID(t *testing.T) {
	token := newCapabilityToken(testHubSecret, "", "test-device", "proj_demo", "run-start", 1*time.Hour)
	_, err := ValidateCapabilityToken(token, []byte(testHubSecret), "test-device")
	if err == nil {
		t.Fatal("expected error for missing user_id")
	}
}

func TestValidateCapabilityToken_MissingProjectID(t *testing.T) {
	token := newCapabilityToken(testHubSecret, "user-1", "test-device", "", "run-start", 1*time.Hour)
	_, err := ValidateCapabilityToken(token, []byte(testHubSecret), "test-device")
	if err == nil {
		t.Fatal("expected error for missing project_id")
	}
}

func TestValidateCapabilityToken_WrongIssuer(t *testing.T) {
	claims := CapabilityClaims{
		UserID:    "user-1",
		DeviceID:  "test-device",
		ProjectID: "proj_demo",
		Purpose:   "run-start",
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    "wrong-issuer",
			Audience:  jwt.ClaimStrings{"agenthub-edge"},
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(1 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	s, _ := token.SignedString([]byte(testHubSecret))
	_, err := ValidateCapabilityToken(s, []byte(testHubSecret), "test-device")
	if err == nil {
		t.Fatal("expected error for wrong issuer")
	}
}

func TestValidateCapabilityToken_WrongAudience(t *testing.T) {
	claims := CapabilityClaims{
		UserID:    "user-1",
		DeviceID:  "test-device",
		ProjectID: "proj_demo",
		Purpose:   "run-start",
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    "agenthub-hub",
			Audience:  jwt.ClaimStrings{"wrong-audience"},
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(1 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	s, _ := token.SignedString([]byte(testHubSecret))
	_, err := ValidateCapabilityToken(s, []byte(testHubSecret), "test-device")
	if err == nil {
		t.Fatal("expected error for wrong audience")
	}
}

func TestValidateCapabilityToken_RS256Rejected(t *testing.T) {
	claims := CapabilityClaims{
		UserID:    "user-1",
		DeviceID:  "test-device",
		ProjectID: "proj_demo",
		Purpose:   "run-start",
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(1 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	s, _ := token.SignedString(jwt.UnsafeAllowNoneSignatureType)
	_, err := ValidateCapabilityToken(s, []byte(testHubSecret), "test-device")
	if err == nil {
		t.Fatal("expected error for non-HMAC signing method")
	}
}

// issueHubShapedCapabilityToken mirrors hub-server/internal/jwtutil.IssueCapabilityToken
// claim wire format (issuer/audience/purpose/action/target/thread). Kept local so this
// package does not import hub-server/internal (Go internal rules). AH-SR-046 / #461.
func issueHubShapedCapabilityToken(secret []byte, userID, deviceID, projectID, purpose string, ttl time.Duration, action, targetID, threadID string) (string, error) {
	if purpose == "" {
		purpose = "run-start"
	}
	if action == "" {
		action = purpose
	}
	if action != purpose {
		return "", ErrCapabilityTokenInvalid
	}
	now := time.Now()
	claims := CapabilityClaims{
		UserID:    userID,
		DeviceID:  deviceID,
		ProjectID: projectID,
		Purpose:   purpose,
		Action:    action,
		TargetID:  targetID,
		ThreadID:  threadID,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    "agenthub-hub",
			Audience:  []string{"agenthub-edge"},
			IssuedAt:  jwt.NewNumericDate(now),
			NotBefore: jwt.NewNumericDate(now.Add(-5 * time.Second)),
			ExpiresAt: jwt.NewNumericDate(now.Add(ttl)),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(secret)
}

func TestValidateCapabilityToken_HubIssueShape_RoundTripWithBindings(t *testing.T) {
	// Fixture evidence: Hub-shaped issue → Edge ValidateCapabilityToken with
	// purpose/action/target/thread (no production network).
	secret := []byte(testHubSecret)
	tok, err := issueHubShapedCapabilityToken(secret, "user-1", "test-device", "proj_local", "run-start", time.Minute, "run-start", "target-a", "thread_local")
	if err != nil {
		t.Fatalf("issueHubShapedCapabilityToken: %v", err)
	}
	claims, err := ValidateCapabilityToken(tok, secret, "test-device")
	if err != nil {
		t.Fatalf("ValidateCapabilityToken: %v", err)
	}
	if claims.UserID != "user-1" || claims.DeviceID != "test-device" || claims.ProjectID != "proj_local" {
		t.Fatalf("identity claims mismatch: %+v", claims)
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

func TestValidateCapabilityToken_HubIssueShape_RejectsWrongDevice(t *testing.T) {
	secret := []byte(testHubSecret)
	tok, err := issueHubShapedCapabilityToken(secret, "user-1", "test-device", "proj_local", "run-start", time.Minute, "run-start", "", "")
	if err != nil {
		t.Fatalf("issue: %v", err)
	}
	if _, err := ValidateCapabilityToken(tok, secret, "other-device"); err == nil {
		t.Fatal("expected error for wrong device")
	}
}

func TestValidateCapabilityToken_HubIssueShape_RejectsWrongSecret(t *testing.T) {
	tok, err := issueHubShapedCapabilityToken([]byte(testHubSecret), "user-1", "test-device", "proj_local", "run-start", time.Minute, "run-start", "", "")
	if err != nil {
		t.Fatalf("issue: %v", err)
	}
	if _, err := ValidateCapabilityToken(tok, []byte("wrong-secret-key-also-long-enough!!"), "test-device"); err == nil {
		t.Fatal("expected error for wrong secret")
	}
}

func TestValidateCapabilityToken_HubIssueShape_RejectsExpired(t *testing.T) {
	secret := []byte(testHubSecret)
	tok, err := issueHubShapedCapabilityToken(secret, "user-1", "test-device", "proj_local", "run-start", -time.Hour, "run-start", "", "")
	if err != nil {
		t.Fatalf("issue: %v", err)
	}
	_, err = ValidateCapabilityToken(tok, secret, "test-device")
	if err == nil {
		t.Fatal("expected error for expired token")
	}
	if err != ErrCapabilityTokenExpired {
		t.Fatalf("err = %v, want ErrCapabilityTokenExpired", err)
	}
}
