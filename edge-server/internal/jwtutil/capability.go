package jwtutil

import (
	"errors"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// CapabilityClaims carries the per-run authorization grant issued by Hub.
// It binds a specific user/device to a target project for a limited-scope
// operation (e.g., run-start).  Unlike HubClaims (which proves identity),
// CapabilityClaims represents a delegated capability that must be presented
// together with the identity JWT for dual-token verification.
type CapabilityClaims struct {
	UserID    string `json:"user_id"`
	DeviceID  string `json:"device_id"`
	ProjectID string `json:"project_id"`
	Purpose   string `json:"purpose"` // e.g. "run-start"
	jwt.RegisteredClaims
}

const (
	capabilityExpectedIssuer   = "agenthub-hub"
	capabilityExpectedAudience = "agenthub-edge"
)

var (
	ErrCapabilityTokenExpired   = errors.New("capability token has expired")
	ErrCapabilityTokenInvalid   = errors.New("capability token is invalid")
	ErrCapabilityTokenEmpty     = errors.New("capability token is empty")
	ErrCapabilitySecretEmpty    = errors.New("capability validation secret is empty")
	ErrCapabilitySecretTooShort = errors.New("capability validation secret is too short")
	errCapabilityAlgMismatch    = errors.New("capability token has invalid signing algorithm")
)

// ValidateCapabilityToken validates a Hub-issued capability JWT against the
// shared Hub JWT secret.  It returns the parsed claims on success.
//
// expectedDeviceID must match the device_id claim in the token.  This binds
// the capability to the specific Edge device that Hub authorized.
func ValidateCapabilityToken(tokenStr string, secret []byte, expectedDeviceID string) (*CapabilityClaims, error) {
	if len(secret) == 0 {
		return nil, ErrCapabilitySecretEmpty
	}
	if len(secret) < minSecretLen {
		return nil, ErrCapabilitySecretTooShort
	}
	if strings.TrimSpace(tokenStr) == "" {
		return nil, ErrCapabilityTokenEmpty
	}
	if strings.TrimSpace(expectedDeviceID) == "" {
		return nil, ErrCapabilityTokenInvalid
	}

	token, err := jwt.ParseWithClaims(tokenStr, &CapabilityClaims{}, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, errCapabilityAlgMismatch
		}
		return secret, nil
	},
		jwt.WithLeeway(30*time.Second),
		jwt.WithValidMethods([]string{"HS256"}),
		jwt.WithIssuer(capabilityExpectedIssuer),
		jwt.WithAudience(capabilityExpectedAudience),
	)
	if err != nil {
		if errors.Is(err, jwt.ErrTokenExpired) {
			return nil, ErrCapabilityTokenExpired
		}
		return nil, ErrCapabilityTokenInvalid
	}

	claims, ok := token.Claims.(*CapabilityClaims)
	if !ok || !token.Valid {
		return nil, ErrCapabilityTokenInvalid
	}
	if claims.UserID == "" || claims.DeviceID == "" || claims.ProjectID == "" {
		return nil, ErrCapabilityTokenInvalid
	}
	if claims.DeviceID != expectedDeviceID {
		return nil, ErrCapabilityTokenInvalid
	}

	return claims, nil
}
