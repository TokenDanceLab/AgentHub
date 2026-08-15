// Package jwtutil hosts the shared capability-token contract between Hub and
// Edge (AH-SR-046 dual-token auth): Hub mints, Edge validates. This was
// previously duplicated as hub-server/internal/jwtutil/capability.go (issue
// side) and edge-server/internal/jwtutil/capability.go (validate side) with
// divergent constant names — one authoritative definition prevents wire-contract
// drift between the two servers.
package jwtutil

import (
	"errors"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// CapabilityClaims is the per-run capability grant issued by Hub and
// validated by Edge. It binds a specific user/device to a target project for
// a limited-scope operation (e.g. run-start). Unlike an identity JWT, it is a
// delegated capability presented together with the identity JWT.
type CapabilityClaims struct {
	UserID    string `json:"user_id"`
	DeviceID  string `json:"device_id"`
	ProjectID string `json:"project_id"`
	Purpose   string `json:"purpose"` // e.g. "run-start" (action family)
	// Optional fine-grained bindings (AH-SR-046). Empty means unbound.
	Action   string `json:"action,omitempty"`    // must equal purpose when set
	TargetID string `json:"target_id,omitempty"` // execution target id
	ThreadID string `json:"thread_id,omitempty"` // workspace/thread binding
	jwt.RegisteredClaims
}

const (
	CapabilityIssuer   = "agenthub-hub"
	CapabilityAudience = "agenthub-edge"
	CapabilityMinTTL   = 30 * time.Second
	CapabilityMaxTTL   = 15 * time.Minute
	// CapabilityMinSecretLen is the minimum HMAC-SHA256 secret length.
	CapabilityMinSecretLen = 32
)

var (
	ErrCapabilitySecretEmpty    = errors.New("capability secret is empty")
	ErrCapabilitySecretTooShort = errors.New("capability secret is too short")
	ErrCapabilityClaimsInvalid  = errors.New("capability claims are invalid")
	ErrCapabilityTokenExpired   = errors.New("capability token has expired")
	ErrCapabilityTokenInvalid   = errors.New("capability token is invalid")
	ErrCapabilityTokenEmpty     = errors.New("capability token is empty")
)

// CapabilityIssueOptions carries optional route-scoped bindings for a
// capability grant (AH-SR-046).
type CapabilityIssueOptions struct {
	Action   string
	TargetID string
	ThreadID string
}

// IssueCapabilityToken mints a short-lived HS256 capability JWT for Edge
// dual-token auth (Hub side). TTL is clamped to [CapabilityMinTTL,
// CapabilityMaxTTL]; optional bindings (action/target/thread) tighten
// route-scoped authorization.
func IssueCapabilityToken(secret []byte, userID, deviceID, projectID, purpose string, ttl time.Duration, opts ...CapabilityIssueOptions) (string, error) {
	if len(secret) == 0 {
		return "", ErrCapabilitySecretEmpty
	}
	if len(secret) < CapabilityMinSecretLen {
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
	var opt CapabilityIssueOptions
	if len(opts) > 0 {
		opt = opts[0]
	}
	action := strings.TrimSpace(opt.Action)
	if action == "" {
		action = purpose
	}
	if action != purpose {
		return "", ErrCapabilityClaimsInvalid
	}
	if ttl < CapabilityMinTTL {
		ttl = CapabilityMinTTL
	}
	if ttl > CapabilityMaxTTL {
		ttl = CapabilityMaxTTL
	}
	now := time.Now()
	claims := CapabilityClaims{
		UserID:    userID,
		DeviceID:  deviceID,
		ProjectID: projectID,
		Purpose:   purpose,
		Action:    action,
		TargetID:  strings.TrimSpace(opt.TargetID),
		ThreadID:  strings.TrimSpace(opt.ThreadID),
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    CapabilityIssuer,
			Audience:  []string{CapabilityAudience},
			IssuedAt:  jwt.NewNumericDate(now),
			NotBefore: jwt.NewNumericDate(now.Add(-5 * time.Second)),
			ExpiresAt: jwt.NewNumericDate(now.Add(ttl)),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(secret)
}

// ValidateCapabilityToken validates a Hub-issued capability JWT against the
// shared Hub JWT secret (Edge side). expectedDeviceID must match the
// device_id claim — this binds the capability to the specific Edge device
// that Hub authorized.
func ValidateCapabilityToken(tokenStr string, secret []byte, expectedDeviceID string) (*CapabilityClaims, error) {
	if len(secret) == 0 {
		return nil, ErrCapabilitySecretEmpty
	}
	if len(secret) < CapabilityMinSecretLen {
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
			return nil, ErrCapabilityTokenInvalid
		}
		return secret, nil
	},
		jwt.WithLeeway(30*time.Second),
		jwt.WithValidMethods([]string{"HS256"}),
		jwt.WithIssuer(CapabilityIssuer),
		jwt.WithAudience(CapabilityAudience),
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
