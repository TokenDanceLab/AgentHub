package handler_test

import (
	"context"
	"testing"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/handler"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/service"
)

type mockOIDCService struct {
	authorizeFn func(ctx context.Context, codeChallenge, codeChallengeMethod, deviceType, deviceID, redirectURI string) (*service.AuthorizationResult, error)
	callbackFn  func(ctx context.Context, code, state, codeVerifier, deviceType, deviceID, redirectURI string) (*service.CallbackResult, error)
}

func (m *mockOIDCService) GenerateAuthorizationURL(ctx context.Context, codeChallenge, codeChallengeMethod, deviceType, deviceID, redirectURI string) (*service.AuthorizationResult, error) {
	return m.authorizeFn(ctx, codeChallenge, codeChallengeMethod, deviceType, deviceID, redirectURI)
}

func (m *mockOIDCService) HandleCallback(ctx context.Context, code, state, codeVerifier, deviceType, deviceID, redirectURI string) (*service.CallbackResult, error) {
	return m.callbackFn(ctx, code, state, codeVerifier, deviceType, deviceID, redirectURI)
}

func TestOIDCHandler_PostOIDCAuthorize_Success(t *testing.T) {
	svc := &mockOIDCService{
		authorizeFn: func(ctx context.Context, codeChallenge, codeChallengeMethod, deviceType, deviceID, redirectURI string) (*service.AuthorizationResult, error) {
			return &service.AuthorizationResult{
				State:            "test-state-123",
				AuthorizationURL: "https://id.example.com/oidc/auth?response_type=code",
			}, nil
		},
	}
	h := handler.NewOIDCHandler(svc)

	c, w := newGinCtx("POST", "/client/auth/oidc/authorize", map[string]string{
		"code_challenge":        "challenge123",
		"code_challenge_method": "S256",
		"device_type":           "desktop",
		"device_id":             testDeviceID,
	})
	h.PostOIDCAuthorize(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	resp := parseResponse[any](t, w)
	if resp.Code != "OK" {
		t.Fatalf("expected OK, got %s", resp.Code)
	}
	if !contains(w.Body.String(), "test-state-123") {
		t.Fatalf("expected response to contain state, got %s", w.Body.String())
	}
}

func TestOIDCHandler_PostOIDCAuthorize_MissingFields(t *testing.T) {
	svc := &mockOIDCService{
		authorizeFn: func(ctx context.Context, codeChallenge, codeChallengeMethod, deviceType, deviceID, redirectURI string) (*service.AuthorizationResult, error) {
			return nil, errcode.ErrInternal
		},
	}
	h := handler.NewOIDCHandler(svc)

	c, w := newGinCtx("POST", "/client/auth/oidc/authorize", map[string]string{
		"code_challenge": "challenge123",
		// missing device_type and device_id
	})
	h.PostOIDCAuthorize(c)

	if w.Code != 400 {
		t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
	}
}

func TestOIDCHandler_PostOIDCAuthorize_InvalidDeviceIDDoesNotCallService(t *testing.T) {
	called := false
	svc := &mockOIDCService{
		authorizeFn: func(ctx context.Context, codeChallenge, codeChallengeMethod, deviceType, deviceID, redirectURI string) (*service.AuthorizationResult, error) {
			called = true
			return &service.AuthorizationResult{State: "bad", AuthorizationURL: "https://id.example/oidc/authorize"}, nil
		},
	}
	h := handler.NewOIDCHandler(svc)

	c, w := newGinCtx("POST", "/client/auth/oidc/authorize", map[string]string{
		"code_challenge":        "challenge123",
		"code_challenge_method": "S256",
		"device_type":           "desktop",
		"device_id":             "not-a-uuid",
	})
	h.PostOIDCAuthorize(c)

	if w.Code != 400 {
		t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
	}
	if called {
		t.Fatal("service should not be called for malformed device_id")
	}
}

func TestOIDCHandler_PostOIDCAuthorize_InvalidDeviceTypeDoesNotCallService(t *testing.T) {
	called := false
	svc := &mockOIDCService{
		authorizeFn: func(ctx context.Context, codeChallenge, codeChallengeMethod, deviceType, deviceID, redirectURI string) (*service.AuthorizationResult, error) {
			called = true
			return &service.AuthorizationResult{State: "bad", AuthorizationURL: "https://id.example/oidc/authorize"}, nil
		},
	}
	h := handler.NewOIDCHandler(svc)

	c, w := newGinCtx("POST", "/client/auth/oidc/authorize", map[string]string{
		"code_challenge":        "challenge123",
		"code_challenge_method": "S256",
		"device_type":           "tokendance_bearer",
		"device_id":             testDeviceID,
	})
	h.PostOIDCAuthorize(c)

	if w.Code != 400 {
		t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
	}
	if called {
		t.Fatal("service should not be called for invalid device_type")
	}
}

func TestOIDCHandler_PostOIDCCallback_Success(t *testing.T) {
	svc := &mockOIDCService{
		callbackFn: func(ctx context.Context, code, state, codeVerifier, deviceType, deviceID, redirectURI string) (*service.CallbackResult, error) {
			return &service.CallbackResult{
				AccessToken:  "access-token-xxx",
				RefreshToken: "refresh-token-xxx",
				ExpiresIn:    900,
				User:         model.User{Username: "testuser", Nickname: "Test"},
			}, nil
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

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	resp := parseResponse[any](t, w)
	if resp.Code != "OK" {
		t.Fatalf("expected OK, got %s", resp.Code)
	}
	if !contains(w.Body.String(), "access-token-xxx") {
		t.Fatalf("expected response to contain access token, got %s", w.Body.String())
	}
}

func TestOIDCHandler_PostOIDCCallback_InvalidDeviceIDDoesNotCallService(t *testing.T) {
	called := false
	svc := &mockOIDCService{
		callbackFn: func(ctx context.Context, code, state, codeVerifier, deviceType, deviceID, redirectURI string) (*service.CallbackResult, error) {
			called = true
			return &service.CallbackResult{AccessToken: "bad"}, nil
		},
	}
	h := handler.NewOIDCHandler(svc)

	c, w := newGinCtx("POST", "/client/auth/oidc/callback", map[string]string{
		"code":          "auth-code",
		"state":         "state-123",
		"code_verifier": "verifier",
		"device_type":   "desktop",
		"device_id":     "not-a-uuid",
	})
	h.PostOIDCCallback(c)

	if w.Code != 400 {
		t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
	}
	if called {
		t.Fatal("service should not be called for malformed device_id")
	}
}

func TestOIDCHandler_PostOIDCCallback_InvalidState(t *testing.T) {
	svc := &mockOIDCService{
		callbackFn: func(ctx context.Context, code, state, codeVerifier, deviceType, deviceID, redirectURI string) (*service.CallbackResult, error) {
			return nil, errcode.OIDCInvalidState
		},
	}
	h := handler.NewOIDCHandler(svc)

	c, w := newGinCtx("POST", "/client/auth/oidc/callback", map[string]string{
		"code":          "auth-code",
		"state":         "bad-state",
		"code_verifier": "verifier",
		"device_type":   "desktop",
		"device_id":     testDeviceID,
	})
	h.PostOIDCCallback(c)

	if w.Code != 400 {
		t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
	}
}

func TestOIDCHandler_PostOIDCCallback_MissingFields(t *testing.T) {
	svc := &mockOIDCService{
		callbackFn: func(ctx context.Context, code, state, codeVerifier, deviceType, deviceID, redirectURI string) (*service.CallbackResult, error) {
			return nil, errcode.ErrInternal
		},
	}
	h := handler.NewOIDCHandler(svc)

	c, w := newGinCtx("POST", "/client/auth/oidc/callback", map[string]string{
		"code": "auth-code",
		// missing state, code_verifier, device_type, device_id
	})
	h.PostOIDCCallback(c)

	if w.Code != 400 {
		t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
	}
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && searchSubstring(s, substr)
}

func searchSubstring(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
