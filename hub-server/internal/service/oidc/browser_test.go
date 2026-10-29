package oidc

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/jwtutil"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
	"github.com/agenthub/hub-server/internal/service/auth"
	"github.com/agenthub/pkg/testkit/oidcfixture"
	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/require"
)

func browserConfig() config.BrowserSessionConfig {
	return config.BrowserSessionConfig{Origin: "https://hub.example.com", RedirectURI: "https://hub.example.com/workbench/auth/account/callback", PostLogoutRedirectURI: "https://hub.example.com" + config.BrowserLogoutCallbackPath, Secure: true, TTL: 12 * time.Hour}
}

func browserAuthorize(t *testing.T, env *accountOIDCTestEnv, subject string) (*AuthorizationResult, string) {
	t.Helper()
	result, cookie, err := env.service.BeginBrowserLogin(context.Background(), browserConfig(), "22222222-2222-4222-8222-222222222222")
	require.NoError(t, err)
	uri, err := url.Parse(result.AuthorizationURL)
	require.NoError(t, err)
	env.provider.RegisterCode("browser-code", uri.Query().Get("nonce"), subject, "Browser User", "")
	return result, cookie
}

func TestBrowserLoginKeepsTokensServerSideAndBindsCookie(t *testing.T) {
	env := newAccountOIDCTestEnv(t)
	start, flow := browserAuthorize(t, env, "browser-sub")
	result, cookie, err := env.service.CompleteBrowserLogin(context.Background(), browserConfig(), "browser-code", start.State, start.Issuer, flow)
	require.NoError(t, err)
	require.NotEmpty(t, cookie)
	raw, err := json.Marshal(result)
	require.NoError(t, err)
	require.NotContains(t, string(raw), cookie)
	require.NotContains(t, string(raw), "access_token")
	require.NotContains(t, string(raw), "refresh_token")
	require.WithinDuration(t, time.Now().Add(12*time.Hour), result.ExpiresAt, time.Second)
	var refreshCount int64
	require.NoError(t, env.db.Model(&model.RefreshToken{}).Count(&refreshCount).Error)
	require.Zero(t, refreshCount)
	session, err := repository.FindBrowserSession(env.db, jwtutil.HashRefreshToken(cookie), time.Now())
	require.NoError(t, err)
	require.Equal(t, result.User.ID, session.UserID)
	require.Equal(t, testAccountClientID, session.OIDCClientID)
	_, _, err = env.service.CompleteBrowserLogin(context.Background(), browserConfig(), "browser-code", start.State, start.Issuer, flow)
	require.ErrorIs(t, err, errcode.OIDCInvalidState)
	start, _ = browserAuthorize(t, env, "browser-sub")
	_, _, err = env.service.CompleteBrowserLogin(context.Background(), browserConfig(), "browser-code", start.State, start.Issuer, "attacker-browser")
	require.ErrorIs(t, err, errcode.OIDCInvalidState)
}

func TestAccountBackchannelRevokesBrowserNativeAndRefreshAndIsIdempotent(t *testing.T) {
	env := newAccountOIDCTestEnv(t)
	start, flow := browserAuthorize(t, env, "shared-sub")
	browser, cookie, err := env.service.CompleteBrowserLogin(context.Background(), browserConfig(), "browser-code", start.State, start.Issuer, flow)
	require.NoError(t, err)
	state := authorizeAccountTest(t, env, oidcfixture.CodeOptions{Subject: "shared-sub"})
	native, err := callbackAccountTest(env, state, env.provider.Server.URL)
	require.NoError(t, err)
	require.Equal(t, browser.User.ID, native.User.ID)
	checker := auth.NewService(env.db, env.service.jwtCfg, env.service.cache)
	checker.SetAccountClientID(testAccountClientID)
	claims, err := jwtutil.ParseToken(native.AccessToken, env.service.jwtCfg.Secret)
	require.NoError(t, err)
	require.Equal(t, testAccountClientID, claims.OIDCClientID)
	refresh, err := repository.FindRefreshTokenForRotation(env.db, jwtutil.HashRefreshToken(native.RefreshToken))
	require.NoError(t, err)
	require.Equal(t, testAccountClientID, refresh.OIDCClientID)
	require.NoError(t, checker.CheckAccessSession(context.Background(), claims))
	now := time.Now()
	logout := jwt.MapClaims{"iss": env.provider.Server.URL, "aud": testAccountClientID, "sub": "shared-sub", "iat": now.Unix(), "exp": now.Add(time.Hour).Unix(), "jti": "backchannel-one", "events": map[string]any{jwtutil.BackchannelLogoutEvent: map[string]any{}}}
	sign := func() string {
		token := jwt.NewWithClaims(jwt.SigningMethodRS256, logout)
		token.Header["kid"] = env.provider.Key.Kid
		raw, err := token.SignedString(env.provider.Key.Private)
		require.NoError(t, err)
		return raw
	}
	raw := sign()
	identity, generation, err := env.service.ApplyBackchannelLogout(context.Background(), raw)
	require.NoError(t, err)
	require.Equal(t, claims.IdentityID, identity)
	require.Equal(t, int64(1), generation)
	_, err = checker.BrowserSession(context.Background(), cookie)
	require.ErrorIs(t, err, errcode.AuthInvalidToken)
	require.ErrorIs(t, checker.CheckAccessSession(context.Background(), claims), errcode.AuthInvalidToken)
	_, err = checker.RefreshToken(context.Background(), native.RefreshToken)
	require.ErrorIs(t, err, errcode.AuthRefreshInvalid)
	_, generation, err = env.service.ApplyBackchannelLogout(context.Background(), raw)
	require.NoError(t, err)
	require.Equal(t, int64(1), generation)
	logout["sub"] = "different-sub"
	_, _, err = env.service.ApplyBackchannelLogout(context.Background(), sign())
	require.ErrorIs(t, err, errcode.ErrBadRequest)
}

func TestAccountLogoutDoesNotRetainIDTokenAndConsumesState(t *testing.T) {
	env := newAccountOIDCTestEnv(t)
	rawURL, cookie, err := env.service.BeginAccountLogout(context.Background(), browserConfig())
	require.NoError(t, err)
	uri, err := url.Parse(rawURL)
	require.NoError(t, err)
	require.Equal(t, "/oauth/end-session", uri.Path)
	require.Equal(t, testAccountClientID, uri.Query().Get("client_id"))
	require.Empty(t, uri.Query().Get("id_token_hint"))
	require.Equal(t, browserConfig().PostLogoutRedirectURI, uri.Query().Get("post_logout_redirect_uri"))
	require.NoError(t, env.service.CompleteAccountLogout(context.Background(), uri.Query().Get("state"), cookie))
	require.ErrorIs(t, env.service.CompleteAccountLogout(context.Background(), uri.Query().Get("state"), cookie), errcode.OIDCInvalidState)
}

func TestBrowserCallbackJWKSFailureIsUnavailable(t *testing.T) {
	env := newAccountOIDCTestEnv(t)
	start, flow := browserAuthorize(t, env, "browser-sub")
	keys := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	t.Cleanup(keys.Close)
	// Keep the genuine cached discovery and code exchange, but make its
	// signing-key dependency unavailable before the first verification.
	env.service.verifier = jwtutil.NewAccountOIDCVerifier(keys.URL, jwtutil.VerifierConfig{})
	_, _, err := env.service.CompleteBrowserLogin(context.Background(), browserConfig(), "browser-code", start.State, start.Issuer, flow)
	require.ErrorIs(t, err, errcode.AuthUnavailable)
	var sessions int64
	require.NoError(t, env.db.Model(&model.BrowserSession{}).Count(&sessions).Error)
	require.Zero(t, sessions)
}

func TestCallbackStateStoreFailureIsUnavailable(t *testing.T) {
	env := newAccountOIDCTestEnv(t)
	state := authorizeAccountTest(t, env, oidcfixture.CodeOptions{Subject: "state-sub"})
	env.redis.SetError("ERR fixture store unavailable")
	_, err := callbackAccountTest(env, state, env.provider.Server.URL)
	require.ErrorIs(t, err, errcode.AuthUnavailable)
	env.redis.SetError("")
	// The failed storage read did not misclassify or consume the valid state.
	_, err = callbackAccountTest(env, state, env.provider.Server.URL)
	require.NoError(t, err)
}
