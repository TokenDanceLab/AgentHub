package jwtutil

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/agenthub/pkg/testkit/oidcfixture"
	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/require"
)

func logoutClaims() jwt.MapClaims {
	now := time.Now()
	return jwt.MapClaims{"iss": "https://account.example", "aud": "hub-client", "sub": "test-subject", "jti": "logout-1", "iat": now.Unix(), "exp": now.Add(time.Hour).Unix(), "events": map[string]any{BackchannelLogoutEvent: map[string]any{}}}
}

func signLogout(t *testing.T, key *oidcfixture.Key, claims jwt.MapClaims, method jwt.SigningMethod) string {
	t.Helper()
	token := jwt.NewWithClaims(method, claims)
	token.Header["kid"] = key.Kid
	raw, err := token.SignedString(key.Private)
	require.NoError(t, err)
	return raw
}

func TestLogoutTokenStrictClaimsAndCanonicalDigest(t *testing.T) {
	key := oidcfixture.NewKey(t)
	server := jwksServer(t, key.JWKS)
	v := NewAccountOIDCVerifier(server.URL, VerifierConfig{})
	valid := signLogout(t, key, logoutClaims(), jwt.SigningMethodRS256)
	claims, hash, err := v.ParseLogoutToken(context.Background(), valid, "https://account.example", "hub-client")
	require.NoError(t, err)
	require.Equal(t, "test-subject", claims.Subject)
	require.Len(t, hash, 64)
	for name, mutate := range map[string]func(jwt.MapClaims){
		"issuer":       func(c jwt.MapClaims) { c["iss"] = "https://other.example" },
		"audience":     func(c jwt.MapClaims) { c["aud"] = "other-client" },
		"missing-sub":  func(c jwt.MapClaims) { delete(c, "sub") },
		"missing-jti":  func(c jwt.MapClaims) { delete(c, "jti") },
		"missing-iat":  func(c jwt.MapClaims) { delete(c, "iat") },
		"missing-exp":  func(c jwt.MapClaims) { delete(c, "exp") },
		"expired":      func(c jwt.MapClaims) { c["exp"] = time.Now().Add(-time.Minute).Unix() },
		"future":       func(c jwt.MapClaims) { c["iat"] = time.Now().Add(time.Minute).Unix() },
		"old":          func(c jwt.MapClaims) { c["iat"] = time.Now().Add(-2 * time.Hour).Unix() },
		"too-long":     func(c jwt.MapClaims) { c["exp"] = time.Now().Add(3 * time.Hour).Unix() },
		"nonce-empty":  func(c jwt.MapClaims) { c["nonce"] = "" },
		"nonce-null":   func(c jwt.MapClaims) { c["nonce"] = nil },
		"sid-empty":    func(c jwt.MapClaims) { c["sid"] = "" },
		"event-absent": func(c jwt.MapClaims) { delete(c, "events") },
		"event-null":   func(c jwt.MapClaims) { c["events"] = map[string]any{BackchannelLogoutEvent: nil} },
		"event-content": func(c jwt.MapClaims) {
			c["events"] = map[string]any{BackchannelLogoutEvent: map[string]any{"unexpected": true}}
		},
	} {
		t.Run(name, func(t *testing.T) {
			c := logoutClaims()
			mutate(c)
			_, _, err := v.ParseLogoutToken(context.Background(), signLogout(t, key, c, jwt.SigningMethodRS256), "https://account.example", "hub-client")
			require.Error(t, err)
		})
	}
	_, _, err = v.ParseLogoutToken(context.Background(), signLogout(t, key, logoutClaims(), jwt.SigningMethodRS384), "https://account.example", "hub-client")
	require.Error(t, err)
}

func TestLogoutUnknownKIDRefreshAndUnavailableClassification(t *testing.T) {
	oldKey, newKey := oidcfixture.NewKey(t), oidcfixture.NewKey(t)
	var useNew atomic.Bool
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		requests.Add(1)
		if useNew.Load() {
			_, _ = w.Write([]byte(newKey.JWKS))
		} else {
			_, _ = w.Write([]byte(oldKey.JWKS))
		}
	}))
	v := NewAccountOIDCVerifier(server.URL, VerifierConfig{})
	_, _, err := v.ParseLogoutToken(context.Background(), signLogout(t, oldKey, logoutClaims(), jwt.SigningMethodRS256), "https://account.example", "hub-client")
	require.NoError(t, err)
	useNew.Store(true)
	_, _, err = v.ParseLogoutToken(context.Background(), signLogout(t, newKey, logoutClaims(), jwt.SigningMethodRS256), "https://account.example", "hub-client")
	require.NoError(t, err)
	require.Equal(t, int32(2), requests.Load())
	server.Close()
	v.cache.invalidate()
	_, _, err = v.ParseLogoutToken(context.Background(), signLogout(t, newKey, logoutClaims(), jwt.SigningMethodRS256), "https://account.example", "hub-client")
	require.ErrorIs(t, err, ErrAccountKeysUnavailable)
}
