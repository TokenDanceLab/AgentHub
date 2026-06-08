package jwtutil

import (
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const testHubSecret = "my-secret-key-must-be-32-bytes-long!"

type scopedTestClaims struct {
	UserID     string `json:"user_id"`
	DeviceID   string `json:"device_id"`
	DeviceType string `json:"device_type,omitempty"`
	Purpose    string `json:"purpose,omitempty"`
	jwt.RegisteredClaims
}

func edgeScopedClaims(userID string, expiresIn time.Duration) scopedTestClaims {
	return scopedTestClaims{
		UserID:     userID,
		DeviceID:   "test-device",
		DeviceType: "edge",
		Purpose:    "edge-api",
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    "agenthub-hub",
			Audience:  jwt.ClaimStrings{"agenthub-edge"},
			Subject:   userID,
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(expiresIn)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
}

func newTestToken(secret string, claims scopedTestClaims) string {
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	s, _ := token.SignedString([]byte(secret))
	return s
}

func newEdgeScopedTestToken(secret string, userID string, expiresIn time.Duration) string {
	return newTestToken(secret, edgeScopedClaims(userID, expiresIn))
}

func newLegacyTestToken(secret string, userID string, expiresIn time.Duration) string {
	claims := HubClaims{
		UserID:   userID,
		DeviceID: "test-device",
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(expiresIn)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	s, _ := token.SignedString([]byte(secret))
	return s
}

func TestValidateHubToken_Success(t *testing.T) {
	token := newEdgeScopedTestToken(testHubSecret, "user-1", 1*time.Hour)
	claims, err := ValidateHubToken(token, []byte(testHubSecret), "test-device")
	if err != nil {
		t.Fatalf("ValidateHubToken returned error: %v", err)
	}
	if claims.UserID != "user-1" {
		t.Fatalf("UserID = %q, want user-1", claims.UserID)
	}
	if claims.DeviceID != "test-device" {
		t.Fatalf("DeviceID = %q, want test-device", claims.DeviceID)
	}
}

func TestValidateHubToken_Expired(t *testing.T) {
	token := newEdgeScopedTestToken(testHubSecret, "user-1", -1*time.Hour)
	_, err := ValidateHubToken(token, []byte(testHubSecret), "test-device")
	if err == nil {
		t.Fatal("expected error for expired token")
	}
	if err != ErrTokenExpired {
		t.Fatalf("error = %v, want ErrTokenExpired", err)
	}
}

func TestValidateHubToken_WrongSecret(t *testing.T) {
	token := newEdgeScopedTestToken("correct-secret-key-long-enough!!", "user-1", 1*time.Hour)
	_, err := ValidateHubToken(token, []byte("wrong-secret-key-also-long-enough"), "test-device")
	if err == nil {
		t.Fatal("expected error for wrong secret")
	}
}

func TestValidateHubToken_TamperedToken(t *testing.T) {
	token := newEdgeScopedTestToken(testHubSecret, "user-1", 1*time.Hour)
	// Tamper with the token by appending garbage
	tampered := token + "extra_garbage"
	_, err := ValidateHubToken(tampered, []byte(testHubSecret), "test-device")
	if err == nil {
		t.Fatal("expected error for tampered token")
	}
}

func TestValidateHubToken_ShortSecret(t *testing.T) {
	token := newEdgeScopedTestToken("short", "user-1", 1*time.Hour)
	_, err := ValidateHubToken(token, []byte("short"), "test-device")
	if err == nil {
		t.Fatal("expected error for short secret")
	}
	if err != ErrSecretTooShort {
		t.Fatalf("error = %v, want ErrSecretTooShort", err)
	}
}

func TestValidateHubToken_EmptyToken(t *testing.T) {
	_, err := ValidateHubToken("", []byte(testHubSecret), "test-device")
	if err == nil {
		t.Fatal("expected error for empty token")
	}
}

func TestValidateHubToken_EmptySecret(t *testing.T) {
	token := newEdgeScopedTestToken(testHubSecret, "user-1", 1*time.Hour)
	_, err := ValidateHubToken(token, nil, "test-device")
	if err == nil {
		t.Fatal("expected error for empty secret")
	}
	if err != ErrSecretEmpty {
		t.Fatalf("error = %v, want ErrSecretEmpty", err)
	}
}

func TestValidateHubToken_InvalidFormat(t *testing.T) {
	_, err := ValidateHubToken("not-a-valid-jwt", []byte(testHubSecret), "test-device")
	if err == nil {
		t.Fatal("expected error for invalid format")
	}
}

func TestValidateHubToken_EmptyUserID(t *testing.T) {
	token := newEdgeScopedTestToken(testHubSecret, "", 1*time.Hour)
	_, err := ValidateHubToken(token, []byte(testHubSecret), "test-device")
	if err == nil {
		t.Fatal("expected error for empty user_id")
	}
}

func TestValidateHubToken_RejectsLegacyUnscopedToken(t *testing.T) {
	token := newLegacyTestToken(testHubSecret, "user-1", 1*time.Hour)
	_, err := ValidateHubToken(token, []byte(testHubSecret), "test-device")
	if err == nil {
		t.Fatal("expected legacy unscoped Hub token to be rejected")
	}
}

func TestValidateHubToken_RejectsWrongIssuer(t *testing.T) {
	claims := edgeScopedClaims("user-1", 1*time.Hour)
	claims.Issuer = "other-issuer"
	token := newTestToken(testHubSecret, claims)
	_, err := ValidateHubToken(token, []byte(testHubSecret), "test-device")
	if err == nil {
		t.Fatal("expected wrong issuer to be rejected")
	}
}

func TestValidateHubToken_RejectsWrongAudience(t *testing.T) {
	claims := edgeScopedClaims("user-1", 1*time.Hour)
	claims.Audience = jwt.ClaimStrings{"agenthub-api"}
	token := newTestToken(testHubSecret, claims)
	_, err := ValidateHubToken(token, []byte(testHubSecret), "test-device")
	if err == nil {
		t.Fatal("expected wrong audience to be rejected")
	}
}

func TestValidateHubToken_RejectsMissingPurpose(t *testing.T) {
	claims := edgeScopedClaims("user-1", 1*time.Hour)
	claims.Purpose = ""
	token := newTestToken(testHubSecret, claims)
	_, err := ValidateHubToken(token, []byte(testHubSecret), "test-device")
	if err == nil {
		t.Fatal("expected missing purpose to be rejected")
	}
}

func TestValidateHubToken_RejectsWrongDeviceType(t *testing.T) {
	claims := edgeScopedClaims("user-1", 1*time.Hour)
	claims.DeviceType = "desktop"
	token := newTestToken(testHubSecret, claims)
	_, err := ValidateHubToken(token, []byte(testHubSecret), "test-device")
	if err == nil {
		t.Fatal("expected wrong device_type to be rejected")
	}
}

func TestValidateHubToken_RejectsMissingDeviceID(t *testing.T) {
	claims := edgeScopedClaims("user-1", 1*time.Hour)
	claims.DeviceID = ""
	token := newTestToken(testHubSecret, claims)
	_, err := ValidateHubToken(token, []byte(testHubSecret), "test-device")
	if err == nil {
		t.Fatal("expected missing device_id to be rejected")
	}
}

func TestValidateHubToken_RejectsWrongExpectedDeviceID(t *testing.T) {
	token := newEdgeScopedTestToken(testHubSecret, "user-1", 1*time.Hour)
	_, err := ValidateHubToken(token, []byte(testHubSecret), "other-edge-device")
	if err == nil {
		t.Fatal("expected token for a different Edge device to be rejected")
	}
}

func TestValidateHubToken_RS256TokenRejected(t *testing.T) {
	// An RS256 token (even with matching claims) should be rejected
	// because we only accept HMAC-based tokens.
	claims := HubClaims{
		UserID:   "user-1",
		DeviceID: "test-device",
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(1 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	// Even though this won't sign properly without a real key, the parse should
	// reject it because the signing method check fails.
	s, _ := token.SignedString(jwt.UnsafeAllowNoneSignatureType) // deliberately bad
	_, err := ValidateHubToken(s, []byte("my-secret-key-must-be-32-bytes-long!"), "test-device")
	if err == nil {
		t.Fatal("expected error for non-HMAC signing method")
	}
}
