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
	"github.com/agenthub/hub-server/internal/service"
)

const testDeviceID = "11111111-1111-4111-8111-111111111111"

// mockAuthService implements handler.AuthService.
type mockAuthService struct {
	registerFn       func(ctx context.Context, username, password, nickname string) (*model.User, error)
	loginFn          func(ctx context.Context, username, password, deviceType, deviceID string) (*service.LoginResponse, error)
	refreshTokenFn   func(ctx context.Context, rawRefreshToken string) (*service.LoginResponse, error)
	logoutFn         func(ctx context.Context, userID, deviceID, deviceType string) error
	getMeFn          func(ctx context.Context, userID string) (*model.User, error)
	updateProfileFn  func(ctx context.Context, userID, nickname, avatarURL string) (*model.User, error)
	changePasswordFn func(ctx context.Context, userID, oldPassword, newPassword string) error
}

func (m *mockAuthService) Register(ctx context.Context, username, password, nickname string) (*model.User, error) {
	return m.registerFn(ctx, username, password, nickname)
}
func (m *mockAuthService) Login(ctx context.Context, username, password, deviceType, deviceID string) (*service.LoginResponse, error) {
	return m.loginFn(ctx, username, password, deviceType, deviceID)
}
func (m *mockAuthService) RefreshToken(ctx context.Context, rawRefreshToken string) (*service.LoginResponse, error) {
	return m.refreshTokenFn(ctx, rawRefreshToken)
}
func (m *mockAuthService) Logout(ctx context.Context, userID, deviceID, deviceType string) error {
	return m.logoutFn(ctx, userID, deviceID, deviceType)
}
func (m *mockAuthService) GetMe(ctx context.Context, userID string) (*model.User, error) {
	return m.getMeFn(ctx, userID)
}
func (m *mockAuthService) UpdateProfile(ctx context.Context, userID, nickname, avatarURL string) (*model.User, error) {
	return m.updateProfileFn(ctx, userID, nickname, avatarURL)
}
func (m *mockAuthService) ChangePassword(ctx context.Context, userID, oldPassword, newPassword string) error {
	return m.changePasswordFn(ctx, userID, oldPassword, newPassword)
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

// ── Register ────────────────────────────────────────────────────────

func TestAuthHandler_Register_Success(t *testing.T) {
	svc := &mockAuthService{
		registerFn: func(ctx context.Context, username, password, nickname string) (*model.User, error) {
			return &model.User{ID: "u1", Username: username, Nickname: nickname}, nil
		},
	}
	h := handler.NewAuthHandler(svc)

	c, w := newGinCtx("POST", "/client/auth/register", map[string]string{
		"username": "testuser",
		"password": "password123",
		"nickname": "Test User",
	})
	h.Register(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	resp := parseResponse[any](t, w)
	if resp.Code != "OK" {
		t.Fatalf("expected OK, got %s", resp.Code)
	}
}

func TestAuthHandler_Register_InvalidJSON(t *testing.T) {
	svc := &mockAuthService{registerFn: func(ctx context.Context, username, password, nickname string) (*model.User, error) {
		return nil, errcode.ErrInternal
	}}
	h := handler.NewAuthHandler(svc)

	c, w := newGinCtx("POST", "/client/auth/register", nil)
	h.Register(c)

	if w.Code != 400 {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestAuthHandler_Register_UsernameTaken(t *testing.T) {
	svc := &mockAuthService{
		registerFn: func(ctx context.Context, username, password, nickname string) (*model.User, error) {
			return nil, errcode.UserUsernameTaken
		},
	}
	h := handler.NewAuthHandler(svc)

	c, w := newGinCtx("POST", "/client/auth/register", map[string]string{
		"username": "existing",
		"password": "password123",
		"nickname": "Test",
	})
	h.Register(c)

	if w.Code != 409 {
		t.Fatalf("expected 409, got %d: %s", w.Code, w.Body.String())
	}
}

// ── Login ───────────────────────────────────────────────────────────

func TestAuthHandler_Login_Success(t *testing.T) {
	svc := &mockAuthService{
		loginFn: func(ctx context.Context, username, password, deviceType, deviceID string) (*service.LoginResponse, error) {
			return &service.LoginResponse{
				AccessToken:  "access-token",
				RefreshToken: "refresh-token",
				ExpiresIn:    3600,
			}, nil
		},
	}
	h := handler.NewAuthHandler(svc)

	c, w := newGinCtx("POST", "/client/auth/login", map[string]string{
		"username":    "testuser",
		"password":    "password123",
		"device_type": "web",
		"device_id":   testDeviceID,
	})
	h.Login(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestAuthHandler_Login_InvalidCredentials(t *testing.T) {
	svc := &mockAuthService{
		loginFn: func(ctx context.Context, username, password, deviceType, deviceID string) (*service.LoginResponse, error) {
			return nil, errcode.AuthInvalidCredentials
		},
	}
	h := handler.NewAuthHandler(svc)

	c, w := newGinCtx("POST", "/client/auth/login", map[string]string{
		"username":    "testuser",
		"password":    "wrong",
		"device_type": "web",
		"device_id":   testDeviceID,
	})
	h.Login(c)

	if w.Code != 401 {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestAuthHandler_Login_BadRequest(t *testing.T) {
	svc := &mockAuthService{loginFn: func(ctx context.Context, username, password, deviceType, deviceID string) (*service.LoginResponse, error) {
		return nil, errcode.ErrInternal
	}}
	h := handler.NewAuthHandler(svc)

	c, w := newGinCtx("POST", "/client/auth/login", map[string]string{
		"username": "testuser",
		// missing password, device_type, device_id
	})
	h.Login(c)

	if w.Code != 400 {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestAuthHandler_Login_InvalidDeviceID(t *testing.T) {
	called := false
	svc := &mockAuthService{
		loginFn: func(ctx context.Context, username, password, deviceType, deviceID string) (*service.LoginResponse, error) {
			called = true
			return nil, errcode.ErrInternal
		},
	}
	h := handler.NewAuthHandler(svc)

	c, w := newGinCtx("POST", "/client/auth/login", map[string]string{
		"username":    "testuser",
		"password":    "password123",
		"device_type": "web",
		"device_id":   "dev1",
	})
	h.Login(c)

	if called {
		t.Fatal("service should not be called for malformed device_id")
	}
	if w.Code != 400 {
		t.Fatalf("expected 400, got %d", w.Code)
	}
	resp := parseResponse[any](t, w)
	if resp.Code != "BAD_REQUEST" {
		t.Fatalf("expected BAD_REQUEST, got %s", resp.Code)
	}
	if resp.Message != "device_id must be a UUID" {
		t.Fatalf("unexpected message %q", resp.Message)
	}
}


// #161: Handler passes device_type from request body to service.
// Actual enum validation is done in the service layer.
func TestAuthHandler_Login_InvalidDeviceType(t *testing.T) {
	capturedDeviceType := ""
	svc := &mockAuthService{
		loginFn: func(ctx context.Context, username, password, deviceType, deviceID string) (*service.LoginResponse, error) {
			capturedDeviceType = deviceType
			return nil, errcode.ErrBadRequest
		},
	}
	h := handler.NewAuthHandler(svc)

	c, w := newGinCtx("POST", "/client/auth/login", map[string]string{
		"username":    "testuser",
		"password":    "password123",
		"device_type": "invalid_type",
		"device_id":   testDeviceID,
	})
	h.Login(c)

	if capturedDeviceType != "invalid_type" {
		t.Fatalf("expected device_type=invalid_type to be passed to service, got %q", capturedDeviceType)
	}
	// Service rejects invalid device_type with 400.
	if w.Code != 400 {
		t.Fatalf("expected 400 for invalid device_type, got %d", w.Code)
	}
}// ── Refresh ─────────────────────────────────────────────────────────

func TestAuthHandler_Refresh_Success(t *testing.T) {
	svc := &mockAuthService{
		refreshTokenFn: func(ctx context.Context, rawRefreshToken string) (*service.LoginResponse, error) {
			return &service.LoginResponse{AccessToken: "new-access", RefreshToken: "new-refresh", ExpiresIn: 3600}, nil
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
		refreshTokenFn: func(ctx context.Context, rawRefreshToken string) (*service.LoginResponse, error) {
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
	svc := &mockAuthService{refreshTokenFn: func(ctx context.Context, rawRefreshToken string) (*service.LoginResponse, error) {
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
		logoutFn: func(ctx context.Context, userID, deviceID, deviceType string) error {
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

// #149: Logout with device_type query parameter.
func TestAuthHandler_Logout_WithDeviceType(t *testing.T) {
	capturedDeviceType := ""
	svc := &mockAuthService{
		logoutFn: func(ctx context.Context, userID, deviceID, deviceType string) error {
			capturedDeviceType = deviceType
			return nil
		},
	}
	h := handler.NewAuthHandler(svc)

	c, w := newGinCtxWithQuery("POST", "/client/auth/logout", "device_type=desktop", nil,
		"user_id", "u1", "device_id", "d1")
	h.Logout(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	if capturedDeviceType != "desktop" {
		t.Fatalf("expected device_type=desktop, got %q", capturedDeviceType)
	}
}

func TestAuthHandler_Logout_Error(t *testing.T) {
	svc := &mockAuthService{
		logoutFn: func(ctx context.Context, userID, deviceID, deviceType string) error {
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

// ── ChangePassword ──────────────────────────────────────────────────

func TestAuthHandler_ChangePassword_Success(t *testing.T) {
	svc := &mockAuthService{
		changePasswordFn: func(ctx context.Context, userID, oldPassword, newPassword string) error {
			return nil
		},
	}
	h := handler.NewAuthHandler(svc)

	c, w := newGinCtx("PUT", "/client/auth/password", map[string]string{
		"old_password": "oldpass",
		"new_password": "newpass123",
	}, "user_id", "u1")
	h.ChangePassword(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestAuthHandler_ChangePassword_InvalidCredentials(t *testing.T) {
	svc := &mockAuthService{
		changePasswordFn: func(ctx context.Context, userID, oldPassword, newPassword string) error {
			return errcode.AuthInvalidCredentials
		},
	}
	h := handler.NewAuthHandler(svc)

	c, w := newGinCtx("PUT", "/client/auth/password", map[string]string{
		"old_password": "wrong",
		"new_password": "newpass123",
	}, "user_id", "u1")
	h.ChangePassword(c)

	if w.Code != 401 {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestAuthHandler_ChangePassword_BadRequest(t *testing.T) {
	svc := &mockAuthService{changePasswordFn: func(ctx context.Context, userID, oldPassword, newPassword string) error {
		return nil
	}}
	h := handler.NewAuthHandler(svc)

	c, w := newGinCtx("PUT", "/client/auth/password", map[string]string{}, "user_id", "u1")
	h.ChangePassword(c)

	if w.Code != 400 {
		t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
	}
}
