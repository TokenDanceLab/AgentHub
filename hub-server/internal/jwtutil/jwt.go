package jwtutil

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

type Claims struct {
	UserID     string `json:"user_id"`
	DeviceType string `json:"device_type"`
	DeviceID   string `json:"device_id"`
	jwt.RegisteredClaims
}

func GenerateAccessToken(userID, deviceType, deviceID, secret string, ttl time.Duration) (string, error) {
	now := time.Now()
	claims := Claims{
		UserID:     userID,
		DeviceType: deviceType,
		DeviceID:   deviceID,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    "agenthub-hub",
			Audience:  jwt.ClaimStrings{"agenthub-api"},
			Subject:   userID,
			ExpiresAt: jwt.NewNumericDate(now.Add(ttl)),
			IssuedAt:  jwt.NewNumericDate(now),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(secret))
}

func ParseToken(tokenString, secret string) (*Claims, error) {
	token, err := jwt.ParseWithClaims(tokenString, &Claims{}, func(t *jwt.Token) (interface{}, error) {
		return []byte(secret), nil
	},
		jwt.WithValidMethods([]string{"HS256"}),
	)
	if err != nil {
		return nil, err
	}
	claims, ok := token.Claims.(*Claims)
	if !ok || !token.Valid {
		return nil, jwt.ErrSignatureInvalid
	}
	// Lenient iss/aud validation: only check when claims are present, so
	// tokens issued before R08 (without iss/aud) are not rejected.
	if claims.Issuer != "" && claims.Issuer != "agenthub-hub" {
		return nil, fmt.Errorf("jwt issuer mismatch: got %q, want agenthub-hub", claims.Issuer)
	}
	if len(claims.Audience) > 0 {
		found := false
		for _, a := range claims.Audience {
			if a == "agenthub-api" {
				found = true
				break
			}
		}
		if !found {
			return nil, fmt.Errorf("jwt audience does not contain agenthub-api")
		}
	}
	return claims, nil
}

func GenerateRefreshToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

func HashRefreshToken(token string) string {
	h := sha256.Sum256([]byte(token))
	return hex.EncodeToString(h[:])
}
