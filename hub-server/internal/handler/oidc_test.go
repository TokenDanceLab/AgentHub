package handler_test

import (
	"bytes"
	"context"
	"log/slog"
	"strings"
	"testing"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/handler"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/service/oidc"
)

type mockOIDCService struct {
	authorizeFn func(ctx context.Context, codeChallenge, codeChallengeMethod, deviceType, deviceID, redirectURI string) (*oidc.AuthorizationResult, error)
	callbackFn  func(ctx context.Context, code, state, codeVerifier, issuer, deviceType, deviceID, redirectURI string) (*oidc.CallbackResult, error)
}

func (m *mockOIDCService) GenerateAuthorizationURL(ctx context.Context, codeChallenge, codeChallengeMethod, deviceType, deviceID, redirectURI string) (*oidc.AuthorizationResult, error) {
	return m.authorizeFn(ctx, codeChallenge, codeChallengeMethod, deviceType, deviceID, redirectURI)
}

func (m *mockOIDCService) HandleCallback(ctx context.Context, code, state, codeVerifier, issuer, deviceType, deviceID, redirectURI string) (*oidc.CallbackResult, error) {
	return m.callbackFn(ctx, code, state, codeVerifier, issuer, deviceType, deviceID, redirectURI)
}

func TestOIDCHandlerAuthorizeSuccess(t *testing.T) {
	svc := &mockOIDCService{
		authorizeFn: func(ctx context.Context, codeChallenge, codeChallengeMethod, deviceType, deviceID, redirectURI string) (*oidc.AuthorizationResult, error) {
			if redirectURI != "http://127.0.0.1:53682/callback" {
				t.Fatalf("redirect_uri = %q", redirectURI)
			}
			return &oidc.AuthorizationResult{
				State:            "test-state-123",
				AuthorizationURL: "https://account.example/oauth/authorize?response_type=code",
				Issuer:           "https://account.example",
			}, nil
		},
	}
	h := handler.NewOIDCHandler(svc)

	c, w := newGinCtx("POST", "/client/auth/oidc/authorize", map[string]string{
		"code_challenge":        "challenge-valid-base64url",
		"code_challenge_method": "S256",
		"device_type":           "desktop",
		"device_id":             testDeviceID,
		"redirect_uri":          "http://127.0.0.1:53682/callback",
	})
	h.PostOIDCAuthorize(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "test-state-123") {
		t.Fatalf("response missing state: %s", w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "https://account.example") {
		t.Fatalf("response missing pinned issuer: %s", w.Body.String())
	}
}

func TestOIDCHandlerAuthorizeRejectsMalformedRedirectBeforeService(t *testing.T) {
	called := false
	svc := &mockOIDCService{
		authorizeFn: func(ctx context.Context, codeChallenge, codeChallengeMethod, deviceType, deviceID, redirectURI string) (*oidc.AuthorizationResult, error) {
			called = true
			return &oidc.AuthorizationResult{}, nil
		},
	}
	h := handler.NewOIDCHandler(svc)

	c, w := newGinCtx("POST", "/client/auth/oidc/authorize", map[string]string{
		"code_challenge":        "challenge",
		"code_challenge_method": "S256",
		"device_type":           "desktop",
		"device_id":             testDeviceID,
		"redirect_uri":          "not-a-url",
	})
	h.PostOIDCAuthorize(c)

	if w.Code != 400 {
		t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
	}
	if called {
		t.Fatal("service must not receive a malformed redirect URI")
	}
}

func TestOIDCHandlerCallbackSuccessForwardsIssuer(t *testing.T) {
	svc := &mockOIDCService{
		callbackFn: func(ctx context.Context, code, state, codeVerifier, issuer, deviceType, deviceID, redirectURI string) (*oidc.CallbackResult, error) {
			if issuer != "https://account.example" {
				t.Fatalf("issuer = %q", issuer)
			}
			return &oidc.CallbackResult{
				AccessToken:  "hub-" + "access-token",
				RefreshToken: "hub-" + "refresh-token",
				ExpiresIn:    900,
				User:         model.User{Username: "testuser", Nickname: "Test"},
			}, nil
		},
	}
	h := handler.NewOIDCHandler(svc)

	c, w := newGinCtx("POST", "/client/auth/oidc/callback", map[string]string{
		"code":          "auth-code",
		"state":         "state-123",
		"iss":           "https://account.example",
		"code_verifier": "verifier",
		"device_type":   "desktop",
		"device_id":     testDeviceID,
		"redirect_uri":  "http://127.0.0.1:53682/callback",
	})
	h.PostOIDCCallback(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "hub-access-token") {
		t.Fatalf("response missing Hub access token: %s", w.Body.String())
	}
}

func TestOIDCHandlerCallbackRequiresIssuer(t *testing.T) {
	called := false
	svc := &mockOIDCService{
		callbackFn: func(ctx context.Context, code, state, codeVerifier, issuer, deviceType, deviceID, redirectURI string) (*oidc.CallbackResult, error) {
			called = true
			return &oidc.CallbackResult{}, nil
		},
	}
	h := handler.NewOIDCHandler(svc)
	c, w := newGinCtx("POST", "/client/auth/oidc/callback", map[string]string{
		"code":          "auth-code",
		"state":         "state-123",
		"code_verifier": "verifier",
		"device_type":   "desktop",
		"device_id":     testDeviceID,
	})
	h.PostOIDCCallback(c)

	if w.Code != 400 {
		t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
	}
	if called {
		t.Fatal("service must not be called without the RFC 9207 iss parameter")
	}
}

func TestOIDCHandlerCallbackRejectsMalformedDeviceBeforeService(t *testing.T) {
	called := false
	svc := &mockOIDCService{
		callbackFn: func(ctx context.Context, code, state, codeVerifier, issuer, deviceType, deviceID, redirectURI string) (*oidc.CallbackResult, error) {
			called = true
			return &oidc.CallbackResult{}, nil
		},
	}
	h := handler.NewOIDCHandler(svc)
	c, w := newGinCtx("POST", "/client/auth/oidc/callback", map[string]string{
		"code":          "auth-code",
		"state":         "state-123",
		"iss":           "https://account.example",
		"code_verifier": "verifier",
		"device_type":   "desktop",
		"device_id":     "not-a-uuid",
	})
	h.PostOIDCCallback(c)

	if w.Code != 400 {
		t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
	}
	if called {
		t.Fatal("service must not be called for a malformed device")
	}
}

func TestOIDCHandlerCallbackDoesNotLeakProviderBody(t *testing.T) {
	const rawProviderBody = `{"error":"invalid_grant","error_description":"authorization code auth-code-secret returned access_token provider-access-secret","access_token":"provider-access-secret","refresh_token":"provider-refresh-secret","id_token":"provider-id-secret"}`
	var logBuf bytes.Buffer
	previousLogger := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&logBuf, &slog.HandlerOptions{Level: slog.LevelDebug})))
	t.Cleanup(func() { slog.SetDefault(previousLogger) })

	svc := &mockOIDCService{
		callbackFn: func(ctx context.Context, code, state, codeVerifier, issuer, deviceType, deviceID, redirectURI string) (*oidc.CallbackResult, error) {
			return nil, errcode.OIDCCodeExchangeFailed.WithMessage(rawProviderBody)
		},
	}
	h := handler.NewOIDCHandler(svc)
	c, w := newGinCtx("POST", "/client/auth/oidc/callback", map[string]string{
		"code":          "auth-code-secret",
		"state":         "state-123",
		"iss":           "https://account.example",
		"code_verifier": "verifier",
		"device_type":   "desktop",
		"device_id":     testDeviceID,
	})
	h.PostOIDCCallback(c)

	if w.Code != 400 || !strings.Contains(w.Body.String(), "oidc_code_exchange_failed") {
		t.Fatalf("unexpected response %d: %s", w.Code, w.Body.String())
	}
	combined := w.Body.String() + "\n" + logBuf.String()
	for _, forbidden := range []string{
		rawProviderBody,
		"auth-code-secret",
		"provider-access-secret",
		"provider-refresh-secret",
		"provider-id-secret",
		"access_token",
		"refresh_token",
		"id_token",
	} {
		if strings.Contains(combined, forbidden) {
			t.Fatalf("callback leaked %q: %s", forbidden, combined)
		}
	}
}
