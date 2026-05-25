package jwtutil

import (
	"errors"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// HubClaims carries the user identity extracted from a Hub-issued HS256 JWT.
// It mirrors the Claims struct from hub-server/internal/jwtutil, consuming
// only the fields that Edge needs for request authentication.
type HubClaims struct {
	UserID   string `json:"user_id"`
	DeviceID string `json:"device_id"`
	jwt.RegisteredClaims
}

var (
	ErrTokenExpired = errors.New("hub token has expired")
	ErrTokenInvalid = errors.New("hub token is invalid")
	ErrSecretEmpty  = errors.New("hub jwt secret is empty")
	ErrTokenEmpty   = errors.New("hub token is empty")
)

// ValidateHubToken validates a Hub-issued HS256 JWT against the shared secret.
// This allows Edge to trust requests that were authenticated via TokenDance ID -> Hub.
//
// It returns the parsed claims on success, or a sentinel error on failure.
// Callers can use errors.Is to distinguish expired vs. other invalid tokens.
func ValidateHubToken(tokenStr string, secret []byte) (*HubClaims, error) {
	if len(secret) == 0 {
		return nil, ErrSecretEmpty
	}
	if tokenStr == "" {
		return nil, ErrTokenEmpty
	}

	token, err := jwt.ParseWithClaims(tokenStr, &HubClaims{}, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, errors.New("unexpected signing method in hub token")
		}
		return secret, nil
	},
		jwt.WithLeeway(30*time.Second),
	)
	if err != nil {
		if errors.Is(err, jwt.ErrTokenExpired) {
			return nil, ErrTokenExpired
		}
		return nil, ErrTokenInvalid
	}

	claims, ok := token.Claims.(*HubClaims)
	if !ok || !token.Valid {
		return nil, ErrTokenInvalid
	}
	if claims.UserID == "" {
		return nil, ErrTokenInvalid
	}

	return claims, nil
}
