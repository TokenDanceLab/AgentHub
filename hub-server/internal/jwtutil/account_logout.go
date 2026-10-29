package jwtutil

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const BackchannelLogoutEvent = "http://schemas.openid.net/event/backchannel-logout"

var errInvalidAccountLogoutToken = errors.New("invalid Account logout token")

type AccountLogoutClaims struct {
	Events map[string]json.RawMessage `json:"events"`
	Nonce  json.RawMessage            `json:"nonce"`
	SID    json.RawMessage            `json:"sid"`
	jwt.RegisteredClaims
}

// ParseLogoutToken reuses the ID-token verifier's bounded cached JWKS, including
// its single unknown-kid refresh. The digest covers canonical claims, not the
// signature, so an identical event re-signed by a rotated key remains a retry.
func (v *AccountOIDCVerifier) ParseLogoutToken(ctx context.Context, raw, issuer, audience string) (*AccountLogoutClaims, string, error) {
	if len(raw) == 0 || len(raw) > 8192 || issuer == "" || audience == "" {
		return nil, "", errInvalidAccountLogoutToken
	}
	key, err := v.signingKey(ctx, raw)
	if err != nil {
		return nil, "", err
	}
	claims := &AccountLogoutClaims{}
	token, err := jwt.ParseWithClaims(raw, claims, func(*jwt.Token) (any, error) { return key, nil }, jwt.WithValidMethods([]string{"RS256"}), jwt.WithIssuer(issuer), jwt.WithAudience(audience), jwt.WithExpirationRequired(), jwt.WithIssuedAt(), jwt.WithLeeway(30*time.Second))
	if err != nil || !token.Valid {
		return nil, "", errInvalidAccountLogoutToken
	}
	if err := validateAccountLogoutClaims(claims); err != nil {
		return nil, "", err
	}
	hash, err := accountLogoutClaimsDigest(raw)
	if err != nil {
		return nil, "", err
	}
	return claims, hash, nil
}

func validateAccountLogoutClaims(claims *AccountLogoutClaims) error {
	if claims.Subject == "" || len(claims.Subject) > 255 || claims.ID == "" || len(claims.ID) > 512 || claims.IssuedAt == nil || claims.ExpiresAt == nil || len(claims.Nonce) != 0 || len(claims.SID) != 0 {
		return errInvalidAccountLogoutToken
	}
	if time.Since(claims.IssuedAt.Time) > 65*time.Minute || !claims.ExpiresAt.After(claims.IssuedAt.Time) || claims.ExpiresAt.Sub(claims.IssuedAt.Time) > 2*time.Hour {
		return errInvalidAccountLogoutToken
	}
	return validateBackchannelLogoutEvent(claims.Events)
}

func validateBackchannelLogoutEvent(events map[string]json.RawMessage) error {
	if len(events) != 1 {
		return errInvalidAccountLogoutToken
	}
	var event map[string]json.RawMessage
	if json.Unmarshal(events[BackchannelLogoutEvent], &event) != nil || event == nil || len(event) != 0 {
		return errInvalidAccountLogoutToken
	}
	return nil
}

func accountLogoutClaimsDigest(raw string) (string, error) {
	parts := strings.Split(raw, ".")
	if len(parts) != 3 {
		return "", errInvalidAccountLogoutToken
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return "", errInvalidAccountLogoutToken
	}
	var values map[string]json.RawMessage
	if json.Unmarshal(payload, &values) != nil {
		return "", errInvalidAccountLogoutToken
	}
	canonical, err := json.Marshal(values)
	if err != nil {
		return "", errInvalidAccountLogoutToken
	}
	digest := sha256.Sum256(canonical)
	return hex.EncodeToString(digest[:]), nil
}
