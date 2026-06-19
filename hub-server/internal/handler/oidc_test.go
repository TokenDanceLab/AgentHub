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
	if resp.Code != "ok" {
		t.Fatalf("expected ok, got %s", resp.Code)
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
	if resp.Code != "ok" {
		t.Fatalf("expected ok, got %s", resp.Code)
	}
	if !contains(w.Body.String(), "access-token-xxx") {
		t.Fatalf("expected response to contain access token, got %s", w.Body.String())
	}
}

func TestOIDCHandler_GetOIDCCallback_SuccessPageRedactsCodeAndState(t *testing.T) {
	tests := []struct {
		name           string
		acceptLanguage string
	}{
		{name: "english", acceptLanguage: "en-US,en;q=0.9"},
		{name: "chinese", acceptLanguage: "zh-CN,zh;q=0.9"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := handler.NewOIDCHandler(&mockOIDCService{})
			c, w := newGinCtxWithQuery("GET", "/client/auth/oidc/callback", "code=auth-code-secret&state=state-secret", nil)
			c.Request.Header.Set("Accept-Language", tt.acceptLanguage)

			h.GetOIDCCallback(c)

			if w.Code != 200 {
				t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
			}
			for _, forbidden := range []string{
				"auth-code-secret",
				"state-secret",
				"Authorization code",
				"授权码",
				"状态码",
				"State",
			} {
				if strings.Contains(w.Body.String(), forbidden) {
					t.Fatalf("GET OIDC callback success page leaked %q: %s", forbidden, w.Body.String())
				}
			}
		})
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

func TestOIDCHandler_PostOIDCCallback_DoesNotLeakTokenEndpointBody(t *testing.T) {
	const rawProviderBody = `{"error":"invalid_grant","error_description":"authorization code auth-code-secret returned access_token provider-access-secret","access_token":"provider-access-secret","refresh_token":"provider-refresh-secret","id_token":"provider-id-secret"}`
	var logBuf bytes.Buffer
	previousLogger := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&logBuf, &slog.HandlerOptions{Level: slog.LevelDebug})))
	t.Cleanup(func() { slog.SetDefault(previousLogger) })

	svc := &mockOIDCService{
		callbackFn: func(ctx context.Context, code, state, codeVerifier, deviceType, deviceID, redirectURI string) (*service.CallbackResult, error) {
			return nil, errcode.OIDCCodeExchangeFailed.WithMessage(rawProviderBody)
		},
	}
	h := handler.NewOIDCHandler(svc)

	c, w := newGinCtx("POST", "/client/auth/oidc/callback", map[string]string{
		"code":          "auth-code-secret",
		"state":         "state-123",
		"code_verifier": "verifier",
		"device_type":   "desktop",
		"device_id":     testDeviceID,
	})
	h.PostOIDCCallback(c)

	if w.Code != 400 {
		t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
	}
	if !contains(w.Body.String(), "oidc_code_exchange_failed") {
		t.Fatalf("expected oidc_code_exchange_failed response, got %s", w.Body.String())
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
			t.Fatalf("OIDC callback leaked %q in response/logs: %s", forbidden, combined)
		}
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

// ── Redirect URI handler-level validation ────────────────────────────

func TestOIDCHandler_PostOIDCAuthorize_RedirectURI_NotAllowed(t *testing.T) {
	t.Setenv("AGENTHUB_TOKENDANCE_ID_ALLOWED_REDIRECT_URIS", "https://hub.example.com/auth/tokendance/callback")

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
		"device_id":             testDeviceID,
		"redirect_uri":          "https://evil.com/steal-tokens",
	})
	h.PostOIDCAuthorize(c)

	if w.Code != 400 {
		t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
	}
	if called {
		t.Fatal("service should not be called for non-allowed redirect_uri")
	}
	if !contains(w.Body.String(), "redirect_uri is not allowed") {
		t.Fatalf("expected redirect_uri rejection message, got %s", w.Body.String())
	}
}

func TestOIDCHandler_PostOIDCAuthorize_RedirectURI_Allowed_ExactMatch(t *testing.T) {
	t.Setenv("AGENTHUB_TOKENDANCE_ID_ALLOWED_REDIRECT_URIS", "https://hub.example.com/auth/tokendance/callback,http://127.0.0.1/callback")

	svc := &mockOIDCService{
		authorizeFn: func(ctx context.Context, codeChallenge, codeChallengeMethod, deviceType, deviceID, redirectURI string) (*service.AuthorizationResult, error) {
			if redirectURI != "https://hub.example.com/auth/tokendance/callback" {
				t.Errorf("service received redirect_uri=%q, want %q", redirectURI, "https://hub.example.com/auth/tokendance/callback")
			}
			return &service.AuthorizationResult{
				State:            "test-state",
				AuthorizationURL: "https://id.example.com/oidc/auth",
			}, nil
		},
	}
	h := handler.NewOIDCHandler(svc)

	c, w := newGinCtx("POST", "/client/auth/oidc/authorize", map[string]string{
		"code_challenge":        "challenge123",
		"code_challenge_method": "S256",
		"device_type":           "web",
		"device_id":             testDeviceID,
		"redirect_uri":          "https://hub.example.com/auth/tokendance/callback",
	})
	h.PostOIDCAuthorize(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestOIDCHandler_PostOIDCAuthorize_RedirectURI_Allowed_LoopbackDesktop(t *testing.T) {
	t.Setenv("AGENTHUB_TOKENDANCE_ID_ALLOWED_REDIRECT_URIS", "http://127.0.0.1/callback")

	svc := &mockOIDCService{
		authorizeFn: func(ctx context.Context, codeChallenge, codeChallengeMethod, deviceType, deviceID, redirectURI string) (*service.AuthorizationResult, error) {
			return &service.AuthorizationResult{
				State:            "test-state",
				AuthorizationURL: "https://id.example.com/oidc/auth",
			}, nil
		},
	}
	h := handler.NewOIDCHandler(svc)

	// desktop loopback with port variation should be allowed
	c, w := newGinCtx("POST", "/client/auth/oidc/authorize", map[string]string{
		"code_challenge":        "challenge123",
		"code_challenge_method": "S256",
		"device_type":           "desktop",
		"device_id":             testDeviceID,
		"redirect_uri":          "http://127.0.0.1:8400/callback",
	})
	h.PostOIDCAuthorize(c)

	if w.Code != 200 {
		t.Fatalf("expected 200 for desktop loopback, got %d: %s", w.Code, w.Body.String())
	}
}

func TestOIDCHandler_PostOIDCAuthorize_RedirectURI_LoopbackRejectedForWeb(t *testing.T) {
	t.Setenv("AGENTHUB_TOKENDANCE_ID_ALLOWED_REDIRECT_URIS", "http://127.0.0.1/callback")

	called := false
	svc := &mockOIDCService{
		authorizeFn: func(ctx context.Context, codeChallenge, codeChallengeMethod, deviceType, deviceID, redirectURI string) (*service.AuthorizationResult, error) {
			called = true
			return &service.AuthorizationResult{}, nil
		},
	}
	h := handler.NewOIDCHandler(svc)

	// web device_type should NOT get loopback matching
	c, w := newGinCtx("POST", "/client/auth/oidc/authorize", map[string]string{
		"code_challenge":        "challenge123",
		"code_challenge_method": "S256",
		"device_type":           "web",
		"device_id":             testDeviceID,
		"redirect_uri":          "http://127.0.0.1:8400/callback",
	})
	h.PostOIDCAuthorize(c)

	if w.Code != 400 {
		t.Fatalf("expected 400 for web loopback, got %d: %s", w.Code, w.Body.String())
	}
	if called {
		t.Fatal("service should not be called for non-allowed redirect_uri from web")
	}
}

func TestOIDCHandler_PostOIDCAuthorize_RedirectURI_IncludesFallback(t *testing.T) {
	// The handler should also accept URIs from AGENTHUB_TOKENDANCE_ID_REDIRECT_URI
	// (the service layer's fallback), even if not in ALLOWED_REDIRECT_URIS.
	t.Setenv("AGENTHUB_TOKENDANCE_ID_REDIRECT_URI", "https://primary.example.com/callback")
	t.Setenv("AGENTHUB_TOKENDANCE_ID_ALLOWED_REDIRECT_URIS", "http://127.0.0.1/callback")

	svc := &mockOIDCService{
		authorizeFn: func(ctx context.Context, codeChallenge, codeChallengeMethod, deviceType, deviceID, redirectURI string) (*service.AuthorizationResult, error) {
			return &service.AuthorizationResult{
				State:            "test-state",
				AuthorizationURL: "https://id.example.com/oidc/auth",
			}, nil
		},
	}
	h := handler.NewOIDCHandler(svc)

	c, w := newGinCtx("POST", "/client/auth/oidc/authorize", map[string]string{
		"code_challenge":        "challenge123",
		"code_challenge_method": "S256",
		"device_type":           "web",
		"device_id":             testDeviceID,
		"redirect_uri":          "https://primary.example.com/callback",
	})
	h.PostOIDCAuthorize(c)

	if w.Code != 200 {
		t.Fatalf("expected 200 for fallback redirect_uri, got %d: %s", w.Code, w.Body.String())
	}
}

func TestOIDCHandler_PostOIDCCallback_RedirectURI_NotAllowed(t *testing.T) {
	t.Setenv("AGENTHUB_TOKENDANCE_ID_ALLOWED_REDIRECT_URIS", "https://hub.example.com/auth/tokendance/callback")

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
		"device_id":     testDeviceID,
		"redirect_uri":  "https://evil.com/steal-tokens",
	})
	h.PostOIDCCallback(c)

	if w.Code != 400 {
		t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
	}
	if called {
		t.Fatal("service should not be called for non-allowed redirect_uri in callback")
	}
	if !contains(w.Body.String(), "redirect_uri is not allowed") {
		t.Fatalf("expected redirect_uri rejection message, got %s", w.Body.String())
	}
}

func TestOIDCHandler_PostOIDCCallback_RedirectURI_Allowed(t *testing.T) {
	t.Setenv("AGENTHUB_TOKENDANCE_ID_ALLOWED_REDIRECT_URIS", "https://hub.example.com/auth/tokendance/callback")

	svc := &mockOIDCService{
		callbackFn: func(ctx context.Context, code, state, codeVerifier, deviceType, deviceID, redirectURI string) (*service.CallbackResult, error) {
			return &service.CallbackResult{
				AccessToken:  "access-token",
				RefreshToken: "refresh-token",
				ExpiresIn:    900,
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
		"redirect_uri":  "https://hub.example.com/auth/tokendance/callback",
	})
	h.PostOIDCCallback(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestOIDCHandler_PostOIDCAuthorize_RedirectURI_InvalidURL(t *testing.T) {
	t.Setenv("AGENTHUB_TOKENDANCE_ID_ALLOWED_REDIRECT_URIS", "https://hub.example.com/callback")

	called := false
	svc := &mockOIDCService{
		authorizeFn: func(ctx context.Context, codeChallenge, codeChallengeMethod, deviceType, deviceID, redirectURI string) (*service.AuthorizationResult, error) {
			called = true
			return &service.AuthorizationResult{}, nil
		},
	}
	h := handler.NewOIDCHandler(svc)

	c, w := newGinCtx("POST", "/client/auth/oidc/authorize", map[string]string{
		"code_challenge":        "challenge123",
		"code_challenge_method": "S256",
		"device_type":           "desktop",
		"device_id":             testDeviceID,
		"redirect_uri":          "not-a-valid-url",
	})
	h.PostOIDCAuthorize(c)

	if w.Code != 400 {
		t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
	}
	if called {
		t.Fatal("service should not be called for invalid redirect_uri")
	}
}

func TestOIDCHandler_PostOIDCAuthorize_RedirectURI_EmptyAllowed(t *testing.T) {
	// Empty redirect_uri should always pass through (service applies fallback).
	// No env var set — defer to service layer behavior.
	svc := &mockOIDCService{
		authorizeFn: func(ctx context.Context, codeChallenge, codeChallengeMethod, deviceType, deviceID, redirectURI string) (*service.AuthorizationResult, error) {
			if redirectURI != "" {
				t.Errorf("service received redirect_uri=%q, want empty", redirectURI)
			}
			return &service.AuthorizationResult{
				State:            "test-state",
				AuthorizationURL: "https://id.example.com/oidc/auth",
			}, nil
		},
	}
	h := handler.NewOIDCHandler(svc)

	c, w := newGinCtx("POST", "/client/auth/oidc/authorize", map[string]string{
		"code_challenge":        "challenge123",
		"code_challenge_method": "S256",
		"device_type":           "desktop",
		"device_id":             testDeviceID,
		// redirect_uri intentionally omitted
	})
	h.PostOIDCAuthorize(c)

	if w.Code != 200 {
		t.Fatalf("expected 200 for empty redirect_uri, got %d: %s", w.Code, w.Body.String())
	}
}
