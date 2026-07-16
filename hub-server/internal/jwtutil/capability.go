package jwtutil

import (
	"errors"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// CapabilityClaims is the Hub-issued per-run capability grant validated by Edge.
// Keep claim JSON tags aligned with edge-server/internal/jwtutil.CapabilityClaims.
type CapabilityClaims struct {
	UserID    string `json:"user_id"`
	DeviceID  string `json:"device_id"`
	ProjectID string `json:"project_id"`
	Purpose   string `json:"purpose"`
	jwt.RegisteredClaims
}

const (
	capabilityIssuer   = "agenthub-hub"
	capabilityAudience = "agenthub-edge"
	capabilityMinTTL   = 30 * time.Second
	capabilityMaxTTL   = 15 * time.Minute
)

var (
	ErrCapabilitySecretEmpty    = errors.New("capability secret is empty")
	ErrCapabilitySecretTooShort = errors.New("capability secret is too short")
	ErrCapabilityClaimsInvalid  = errors.New("capability claims are invalid")
)

// IssueCapabilityToken mints a short-lived HS256 capability JWT for Edge dual-token auth.
func IssueCapabilityToken(secret []byte, userID, deviceID, projectID, purpose string, ttl time.Duration) (string, error) {
	if len(secret) == 0 {
		return "", ErrCapabilitySecretEmpty
	}
	if len(secret) < 32 {
		return "", ErrCapabilitySecretTooShort
	}
	userID = strings.TrimSpace(userID)
	deviceID = strings.TrimSpace(deviceID)
	projectID = strings.TrimSpace(projectID)
	purpose = strings.TrimSpace(purpose)
	if userID == "" || deviceID == "" || projectID == "" {
		return "", ErrCapabilityClaimsInvalid
	}
	if purpose == "" {
		purpose = "run-start"
	}
	if ttl < capabilityMinTTL {
		ttl = capabilityMinTTL
	}
	if ttl > capabilityMaxTTL {
		ttl = capabilityMaxTTL
	}
	now := time.Now()
	claims := CapabilityClaims{
		UserID:    userID,
		DeviceID:  deviceID,
		ProjectID: projectID,
		Purpose:   purpose,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    capabilityIssuer,
			Audience:  []string{capabilityAudience},
			IssuedAt:  jwt.NewNumericDate(now),
			NotBefore: jwt.NewNumericDate(now.Add(-5 * time.Second)),
			ExpiresAt: jwt.NewNumericDate(now.Add(ttl)),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(secret)
}
