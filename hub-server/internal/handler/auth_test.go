package handler_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/handler"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/service/auth"
)

const testDeviceID = "11111111-1111-4111-8111-111111111111"

// mockAuthService implements handler.AuthService.
type mockAuthService struct {
	refreshTokenFn  func(ctx context.Context, rawRefreshToken string) (*auth.LoginResponse, error)
	logoutFn        func(ctx context.Context, userID, deviceID, deviceType, accessJTI string) error
	getMeFn         func(ctx context.Context, userID string) (*model.User, error)
	updateProfileFn func(ctx context.Context, userID, nickname, avatarURL string) (*model.User, error)
}

func (m *mockAuthService) RefreshToken(ctx context.Context, rawRefreshToken string) (*auth.LoginResponse, error) {
	return m.refreshTokenFn(ctx, rawRefreshToken)
}
func (m *mockAuthService) Logout(ctx context.Context, userID, deviceID, deviceType, accessJTI string) error {
	return m.logoutFn(ctx, userID, deviceID, deviceType, accessJTI)
}
func (m *mockAuthService) GetMe(ctx context.Context, userID string) (*model.User, error) {
	return m.getMeFn(ctx, userID)
}
func (m *mockAuthService) UpdateProfile(ctx context.Context, userID, nickname, avatarURL string) (*model.User, error) {
	return m.updateProfileFn(ctx, userID, nickname, avatarURL)
}

func newGinCtx(method, path string, body any, kv ...string) (*gin.Context, *httptest.ResponseRecorder) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)

	var reqBody []byte
	if body != nil {
		reqBody, _ = json.Marshal(body)
	}
	c.Request = httptest.NewRequest(method, path, bytes.NewReader(reqBody))
	c.Request.Header.Set("Content-Type", "application/json")

	for i := 0; i+1 < len(kv); i += 2 {
		c.Set(kv[i], kv[i+1])
	}
	return c, w
}

// newGinCtxWithQuery creates a test context with a query string.
func newGinCtxWithQuery(method, path, query string, body any, kv ...string) (*gin.Context, *httptest.ResponseRecorder) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)

	var reqBody []byte
	if body != nil {
		reqBody, _ = json.Marshal(body)
	}
	fullPath := path
	if query != "" {
		fullPath = path + "?" + query
	}
	c.Request = httptest.NewRequest(method, fullPath, bytes.NewReader(reqBody))
	c.Request.Header.Set("Content-Type", "application/json")

	for i := 0; i+1 < len(kv); i += 2 {
		c.Set(kv[i], kv[i+1])
	}
	return c, w
}

func parseResponse[T any](t *testing.T, w *httptest.ResponseRecorder) handler.Response {
	t.Helper()
	var resp handler.Response
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to unmarshal response: %v", err)
	}
	return resp
}

// ── Refresh ─────────────────────────────────────────────────────────

func TestAuthHandler_Refresh_Success(t *testing.T) {
	svc := &mockAuthService{
		refreshTokenFn: func(ctx context.Context, rawRefreshToken string) (*auth.LoginResponse, error) {
			return &auth.LoginResponse{AccessToken: "new-access", RefreshToken: "new-refresh", ExpiresIn: 3600}, nil
		},
	}
	h := handler.NewAuthHandler(svc)

	c, w := newGinCtx("POST", "/client/auth/refresh", map[string]string{
		"refresh_token": "old-refresh-token",
	})
	h.Refresh(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestAuthHandler_Refresh_Invalid(t *testing.T) {
	svc := &mockAuthService{
		refreshTokenFn: func(ctx context.Context, rawRefreshToken string) (*auth.LoginResponse, error) {
			return nil, errcode.AuthRefreshInvalid
		},
	}
	h := handler.NewAuthHandler(svc)

	c, w := newGinCtx("POST", "/client/auth/refresh", map[string]string{
		"refresh_token": "bad-token",
	})
	h.Refresh(c)

	if w.Code != 401 {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestAuthHandler_Refresh_BadRequest(t *testing.T) {
	svc := &mockAuthService{refreshTokenFn: func(ctx context.Context, rawRefreshToken string) (*auth.LoginResponse, error) {
		return nil, errcode.ErrInternal
	}}
	h := handler.NewAuthHandler(svc)

	c, w := newGinCtx("POST", "/client/auth/refresh", map[string]string{})
	h.Refresh(c)

	if w.Code != 400 {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

// ── Logout ──────────────────────────────────────────────────────────

func TestAuthHandler_Logout_Success(t *testing.T) {
	capturedDeviceType := ""
	svc := &mockAuthService{
		logoutFn: func(ctx context.Context, userID, deviceID, deviceType, accessJTI string) error {
			capturedDeviceType = deviceType
			return nil
		},
	}
	h := handler.NewAuthHandler(svc)

	c, w := newGinCtx("POST", "/client/auth/logout", nil, "user_id", "u1", "device_id", "d1")
	h.Logout(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	if capturedDeviceType != "" {
		t.Fatalf("expected empty device_type from context (no query param), got %q", capturedDeviceType)
	}
}

// Logout scope must come from the authenticated token's claim-derived
// device_type (set by AuthMiddleware), never from the client query: the old
// #149 query knob let a client write a blacklist key the refresh path never
// checks (session-revival window, #2154 Lorentz P3-2).
func TestAuthHandler_Logout_DeviceTypeFromClaims(t *testing.T) {
	capturedDeviceType := ""
	svc := &mockAuthService{
		logoutFn: func(ctx context.Context, userID, deviceID, deviceType, accessJTI string) error {
			capturedDeviceType = deviceType
			return nil
		},
	}
	h := handler.NewAuthHandler(svc)

	// Claim-derived context value wins; a conflicting query value is ignored.
	c, w := newGinCtxWithQuery("POST", "/client/auth/logout", "device_type=attacker", nil,
		"user_id", "u1", "device_id", "d1", "device_type", "desktop")
	h.Logout(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	if capturedDeviceType != "desktop" {
		t.Fatalf("expected claim-derived device_type=desktop, got %q", capturedDeviceType)
	}
}

func TestAuthHandler_Logout_Error(t *testing.T) {
	svc := &mockAuthService{
		logoutFn: func(ctx context.Context, userID, deviceID, deviceType, accessJTI string) error {
			return context.DeadlineExceeded
		},
	}
	h := handler.NewAuthHandler(svc)

	c, w := newGinCtx("POST", "/client/auth/logout", nil, "user_id", "u1", "device_id", "d1")
	h.Logout(c)

	if w.Code != 500 {
		t.Fatalf("expected 500, got %d", w.Code)
	}
}

// ── Me ──────────────────────────────────────────────────────────────

func TestAuthHandler_Me_Success(t *testing.T) {
	svc := &mockAuthService{
		getMeFn: func(ctx context.Context, userID string) (*model.User, error) {
			return &model.User{ID: "u1", Username: "testuser", Nickname: "Test User"}, nil
		},
	}
	h := handler.NewAuthHandler(svc)

	c, w := newGinCtx("GET", "/client/auth/me", nil, "user_id", "u1")
	h.Me(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestAuthHandler_Me_NotFound(t *testing.T) {
	svc := &mockAuthService{
		getMeFn: func(ctx context.Context, userID string) (*model.User, error) {
			return nil, errcode.UserNotFound
		},
	}
	h := handler.NewAuthHandler(svc)

	c, w := newGinCtx("GET", "/client/auth/me", nil, "user_id", "u1")
	h.Me(c)

	if w.Code != 404 {
		t.Fatalf("expected 404, got %d", w.Code)
	}
}

// ── UpdateProfile ───────────────────────────────────────────────────

func TestAuthHandler_UpdateProfile_Success(t *testing.T) {
	svc := &mockAuthService{
		updateProfileFn: func(ctx context.Context, userID, nickname, avatarURL string) (*model.User, error) {
			return &model.User{ID: userID, Nickname: nickname, AvatarURL: avatarURL}, nil
		},
	}
	h := handler.NewAuthHandler(svc)

	c, w := newGinCtx("PUT", "/client/auth/profile", map[string]string{
		"nickname":   "New Name",
		"avatar_url": "https://example.com/avatar.png",
	}, "user_id", "u1")
	h.UpdateProfile(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestAuthHandler_UpdateProfile_BadRequest(t *testing.T) {
	svc := &mockAuthService{updateProfileFn: func(ctx context.Context, userID, nickname, avatarURL string) (*model.User, error) {
		return nil, errcode.ErrInternal
	}}
	h := handler.NewAuthHandler(svc)

	c, w := newGinCtx("PUT", "/client/auth/profile", "not-json", "user_id", "u1")
	h.UpdateProfile(c)

	if w.Code != 400 {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}
