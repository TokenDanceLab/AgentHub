package jwtutil

import "github.com/golang-jwt/jwt/v5"

// HubSessionClaims carries the user identity of a Hub-issued HS256 JWT.
//
// Single source of truth (#1675): hub-server signs these claims
// (internal/jwtutil.Claims = alias) and edge-server verifies them
// (internal/jwtutil.HubClaims = alias).
//
// Purpose is omitempty: empty purpose (product sessions) is not written
// into the token payload.
type HubSessionClaims struct {
	UserID         string `json:"user_id"`
	DeviceID       string `json:"device_id"`
	DeviceType     string `json:"device_type"`
	Purpose        string `json:"purpose,omitempty"`
	IdentityID     string `json:"identity_id,omitempty"`
	OIDCClientID   string `json:"oidc_client_id,omitempty"`
	AuthGeneration int64  `json:"auth_generation,omitempty"`
	jwt.RegisteredClaims
}
