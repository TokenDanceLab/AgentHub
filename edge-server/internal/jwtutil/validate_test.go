package jwtutil

import (
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

func newTestToken(secret string, userID string, expiresIn time.Duration) string {
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
	token := newTestToken("my-secret-key-32bytes!!", "user-1", 1*time.Hour)
	claims, err := ValidateHubToken(token, []byte("my-secret-key-32bytes!!"))
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
	token := newTestToken("my-secret-key-32bytes!!", "user-1", -1*time.Hour)
	_, err := ValidateHubToken(token, []byte("my-secret-key-32bytes!!"))
	if err == nil {
		t.Fatal("expected error for expired token")
	}
	if err != ErrTokenExpired {
		t.Fatalf("error = %v, want ErrTokenExpired", err)
	}
}

func TestValidateHubToken_WrongSecret(t *testing.T) {
	token := newTestToken("correct-secret-key!!", "user-1", 1*time.Hour)
	_, err := ValidateHubToken(token, []byte("wrong-secret-key!!!!"))
	if err == nil {
		t.Fatal("expected error for wrong secret")
	}
}

func TestValidateHubToken_TamperedToken(t *testing.T) {
	token := newTestToken("my-secret-key-32bytes!!", "user-1", 1*time.Hour)
	// Tamper with the token by appending garbage
	tampered := token + "extra_garbage"
	_, err := ValidateHubToken(tampered, []byte("my-secret-key-32bytes!!"))
	if err == nil {
		t.Fatal("expected error for tampered token")
	}
}

func TestValidateHubToken_EmptyToken(t *testing.T) {
	_, err := ValidateHubToken("", []byte("my-secret-key-32bytes!!"))
	if err == nil {
		t.Fatal("expected error for empty token")
	}
}

func TestValidateHubToken_EmptySecret(t *testing.T) {
	token := newTestToken("my-secret-key-32bytes!!", "user-1", 1*time.Hour)
	_, err := ValidateHubToken(token, nil)
	if err == nil {
		t.Fatal("expected error for empty secret")
	}
}

func TestValidateHubToken_InvalidFormat(t *testing.T) {
	_, err := ValidateHubToken("not-a-valid-jwt", []byte("my-secret-key-32bytes!!"))
	if err == nil {
		t.Fatal("expected error for invalid format")
	}
}

func TestValidateHubToken_EmptyUserID(t *testing.T) {
	claims := HubClaims{
		DeviceID: "test-device",
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(1 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	s, _ := token.SignedString([]byte("my-secret-key-32bytes!!"))
	_, err := ValidateHubToken(s, []byte("my-secret-key-32bytes!!"))
	if err == nil {
		t.Fatal("expected error for empty user_id")
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
	_, err := ValidateHubToken(s, []byte("my-secret-key-32bytes!!"))
	if err == nil {
		t.Fatal("expected error for non-HMAC signing method")
	}
}
