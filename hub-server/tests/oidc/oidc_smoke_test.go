package oidc

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/agenthub/hub-server/internal/handler"
	"github.com/agenthub/hub-server/internal/jwtutil"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/service"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// ── Mock OIDC Service ────────────────────────────────────────────────────────

type mockOIDCService struct {
	authorizeURL string
	state        string
	accessToken  string
	refreshToken string
	user         *model.User
}

func (m *mockOIDCService) GenerateAuthorizationURL(_ context.Context, codeChallenge, codeChallengeMethod, deviceType, deviceID, redirectURI string) (*service.AuthorizationResult, error) {
	return &service.AuthorizationResult{
		State:            m.state,
		AuthorizationURL: m.authorizeURL,
	}, nil
}

func (m *mockOIDCService) HandleCallback(_ context.Context, code, state, codeVerifier, deviceType, deviceID, redirectURI string) (*service.CallbackResult, error) {
	return &service.CallbackResult{
		AccessToken:  m.accessToken,
		RefreshToken: m.refreshToken,
		ExpiresIn:    900,
		User:         *m.user,
	}, nil
}

// ── Local helpers ────────────────────────────────────────────────────────────

type apiResp struct {
	Code    string          `json:"code"`
	Message string          `json:"message"`
	Data    json.RawMessage `json:"data"`
}

func assertCode(t *testing.T, r apiResp, want string, ctx string) {
	t.Helper()
	if r.Code != want {
		t.Fatalf("%s: want code=%q, got code=%q message=%q", ctx, want, r.Code, r.Message)
	}
}

func assertContains(t *testing.T, r apiResp, substr string, ctx string) {
	t.Helper()
	if !strings.Contains(r.Code, substr) {
		t.Fatalf("%s: want code containing %q, got %q", ctx, substr, r.Code)
	}
}

func extract(data json.RawMessage, field string) string {
	var m map[string]json.RawMessage
	json.Unmarshal(data, &m)
	var s string
	json.Unmarshal(m[field], &s)
	return s
}

// ── The Smoke Test ───────────────────────────────────────────────────────────

// TestOIDCSmoke tests the OIDC PKCE flow end-to-end using a mock OIDC service.
// This verifies the handler → service → JWT → protected endpoint chain without
// requiring an external OIDC provider.
func TestOIDCSmoke(t *testing.T) {
	userID := uuid.NewString()
	deviceID := uuid.NewString()
	jwtSecret := "test-secret-at-least-32-bytes-long!!"

	mockSvc := &mockOIDCService{
		authorizeURL: "https://id.vectorcontrol.tech/oidc/authorize",
		state:        "test-state-" + uuid.NewString(),
		accessToken:  "",
		refreshToken: "mock-refresh-" + uuid.NewString(),
		user: &model.User{
			Username:     "test-user",
			Nickname:     "Test User",
			PasswordHash: "hashed",
		},
	}
	// Set user ID manually (normally set by GORM)
	mockSvc.user.ID = userID

	// Pre-generate a valid Hub JWT for the mock service to return.
	validAccessToken, err := jwtutil.GenerateAccessToken(userID, "web", deviceID, jwtSecret, 15*time.Minute)
	require.NoError(t, err, "generate test access token")
	mockSvc.accessToken = validAccessToken

	oidcHandler := handler.NewOIDCHandler(mockSvc)

	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.POST("/oidc/authorize", oidcHandler.PostOIDCAuthorize)
	r.POST("/oidc/callback", oidcHandler.PostOIDCCallback)

	// Protected endpoint using the same JWT validation as production.
	authGroup := r.Group("/api/v1")
	authGroup.Use(func(c *gin.Context) {
		tok := strings.TrimPrefix(c.GetHeader("Authorization"), "Bearer ")
		if tok == "" {
			tok = c.Query("access_token")
		}
		if tok == "" {
			c.JSON(401, gin.H{"code": "AUTH_INVALID_TOKEN", "message": "missing"})
			c.Abort()
			return
		}
		claims, err := jwtutil.ParseToken(tok, jwtSecret)
		if err != nil {
			c.JSON(401, gin.H{"code": "AUTH_INVALID_TOKEN", "message": err.Error()})
			c.Abort()
			return
		}
		c.Set("user_id", claims.UserID)
		c.Set("device_type", claims.DeviceType)
		c.Set("device_id", claims.DeviceID)
		c.Next()
	})
	authGroup.GET("/me", func(c *gin.Context) {
		c.JSON(200, gin.H{"user_id": c.GetString("user_id"), "ok": true})
	})

	ts := httptest.NewServer(r)
	defer ts.Close()
	httpClient := ts.Client()

	// ── 1. Authorize ─────────────────────────────────────────────────────────
	var state, authURL string
	t.Run("Authorize", func(t *testing.T) {
		resp := doJSON(t, httpClient, ts.URL, "POST", "/oidc/authorize", map[string]string{
			"code_challenge":        "test-challenge-base64url",
			"code_challenge_method": "S256",
			"device_type":           "web",
			"device_id":             deviceID,
		})
		r := parseAndAssertCode(t, resp, "OK", "authorize")
		state = extract(r.Data, "state")
		authURL = extract(r.Data, "authorization_url")
		assert.NotEmpty(t, state)
		assert.NotEmpty(t, authURL)
	})

	// ── 2. Callback (receives access_token) ──────────────────────────────────
	var accessToken string
	t.Run("Callback", func(t *testing.T) {
		resp := doJSON(t, httpClient, ts.URL, "POST", "/oidc/callback", map[string]string{
			"code":          "mock-code-123",
			"state":         state,
			"code_verifier": "test-verifier-32-bytes-long-ok",
			"device_type":   "web",
			"device_id":     deviceID,
		})
		r := parseAndAssertCode(t, resp, "OK", "callback")
		accessToken = extract(r.Data, "access_token")
		refreshToken := extract(r.Data, "refresh_token")
		assert.NotEmpty(t, accessToken)
		assert.NotEmpty(t, refreshToken)
	})

	// ── 3. Protected endpoint with valid token ──────────────────────────────
	t.Run("ProtectedEndpoint_ValidToken", func(t *testing.T) {
		req, _ := http.NewRequest("GET", ts.URL+"/api/v1/me", nil)
		req.Header.Set("Authorization", "Bearer "+accessToken)
		resp, err := httpClient.Do(req)
		require.NoError(t, err)
		assert.Equal(t, 200, resp.StatusCode)
		var body map[string]interface{}
		json.Unmarshal(readBody(resp), &body)
		assert.Equal(t, true, body["ok"])
		assert.Equal(t, userID, body["user_id"])
	})

	// ── 4. Invalid / no token → 401 ─────────────────────────────────────────
	t.Run("ProtectedEndpoint_InvalidToken", func(t *testing.T) {
		req, _ := http.NewRequest("GET", ts.URL+"/api/v1/me", nil)
		req.Header.Set("Authorization", "Bearer garbage.token.here")
		resp, _ := httpClient.Do(req)
		assert.Equal(t, 401, resp.StatusCode)
	})
	t.Run("ProtectedEndpoint_NoToken", func(t *testing.T) {
		resp, _ := httpClient.Get(ts.URL + "/api/v1/me")
		assert.Equal(t, 401, resp.StatusCode)
	})

	// ── 5. Expired token → 401 ──────────────────────────────────────────────
	t.Run("ProtectedEndpoint_ExpiredToken", func(t *testing.T) {
		expiredToken, _ := jwtutil.GenerateAccessToken(
			userID, "web", deviceID, jwtSecret, -1*time.Hour)
		req, _ := http.NewRequest("GET", ts.URL+"/api/v1/me", nil)
		req.Header.Set("Authorization", "Bearer "+expiredToken)
		resp, _ := httpClient.Do(req)
		assert.Equal(t, 401, resp.StatusCode)
	})

	// ── 6. Tampered token → 401 ─────────────────────────────────────────────
	t.Run("ProtectedEndpoint_TamperedToken", func(t *testing.T) {
		// Token signed with a different secret
		wrongToken, _ := jwtutil.GenerateAccessToken(
			userID, "web", deviceID, "wrong-secret-32-bytes-long-xxx", 15*time.Minute)
		req, _ := http.NewRequest("GET", ts.URL+"/api/v1/me", nil)
		req.Header.Set("Authorization", "Bearer "+wrongToken)
		resp, _ := httpClient.Do(req)
		assert.Equal(t, 401, resp.StatusCode)
	})

	// ── 7. JWT claims verification ──────────────────────────────────────────
	t.Run("JWT_Claims", func(t *testing.T) {
		claims, err := jwtutil.ParseToken(accessToken, jwtSecret)
		require.NoError(t, err)
		assert.Equal(t, userID, claims.UserID)
		assert.Equal(t, "web", claims.DeviceType)
		assert.Equal(t, deviceID, claims.DeviceID)
		assert.Equal(t, "agenthub-hub", claims.Issuer)
		assert.Contains(t, claims.Audience, "agenthub-api")
	})

	// ── 8. WebSocket query-param auth ───────────────────────────────────────
	t.Run("WS_Auth_QueryParam", func(t *testing.T) {
		req, _ := http.NewRequest("GET", ts.URL+"/api/v1/me?access_token="+accessToken, nil)
		resp, _ := httpClient.Do(req)
		assert.Equal(t, 200, resp.StatusCode)
	})
	t.Run("WS_Auth_NoToken", func(t *testing.T) {
		resp, _ := httpClient.Get(ts.URL + "/api/v1/me")
		assert.Equal(t, 401, resp.StatusCode)
	})

	// ── 9. Error cases — invalid input validation ────────────────────────────
	t.Run("Authorize_NoChallenge_Fails", func(t *testing.T) {
		resp := doJSON(t, httpClient, ts.URL, "POST", "/oidc/authorize", map[string]string{
			"code_challenge_method": "S256",
			"device_type":           "web",
			"device_id":             deviceID,
		})
		var r apiResp
		json.Unmarshal(readBody(resp), &r)
		assertContains(t, r, "BAD", "no challenge")
	})
	t.Run("Authorize_InvalidDeviceType_Fails", func(t *testing.T) {
		resp := doJSON(t, httpClient, ts.URL, "POST", "/oidc/authorize", map[string]string{
			"code_challenge":        "xxx",
			"code_challenge_method": "S256",
			"device_type":           "phone",
			"device_id":             deviceID,
		})
		var r apiResp
		json.Unmarshal(readBody(resp), &r)
		assertCode(t, r, "BAD_REQUEST", "bad device type")
	})
	t.Run("Callback_NoCode_Fails", func(t *testing.T) {
		resp := doJSON(t, httpClient, ts.URL, "POST", "/oidc/callback", map[string]string{
			"state":         "s",
			"code_verifier": "v",
			"device_type":   "web",
			"device_id":     deviceID,
		})
		var r apiResp
		json.Unmarshal(readBody(resp), &r)
		assertContains(t, r, "BAD", "no code")
	})

	// ── 10. Second device login works ────────────────────────────────────────
	t.Run("SecondDevice_Login", func(t *testing.T) {
		id2 := uuid.NewString()

		// Authorize
		resp := doJSON(t, httpClient, ts.URL, "POST", "/oidc/authorize", map[string]string{
			"code_challenge":        "c2",
			"code_challenge_method": "S256",
			"device_type":           "desktop",
			"device_id":             id2,
		})
		r := parseAndAssertCode(t, resp, "OK", "2nd auth")
		s2 := extract(r.Data, "state")

		// Callback — mock service returns a different token with the same userID.
		tok2, _ := jwtutil.GenerateAccessToken(userID, "desktop", id2, jwtSecret, 15*time.Minute)
		mockSvc.accessToken = tok2

		resp = doJSON(t, httpClient, ts.URL, "POST", "/oidc/callback", map[string]string{
			"code":          "c2", "state": s2, "code_verifier": "v2",
			"device_type":   "desktop", "device_id": id2,
		})
		r = parseAndAssertCode(t, resp, "OK", "2nd cb")
		tok2FromResp := extract(r.Data, "access_token")
		assert.NotEmpty(t, tok2FromResp)

		// Verify it works on protected endpoint
		req, _ := http.NewRequest("GET", ts.URL+"/api/v1/me", nil)
		req.Header.Set("Authorization", "Bearer "+tok2)
		resp2, _ := httpClient.Do(req)
		assert.Equal(t, 200, resp2.StatusCode)

		// Same user across devices
		c1, _ := jwtutil.ParseToken(validAccessToken, jwtSecret)
		c2c, _ := jwtutil.ParseToken(tok2, jwtSecret)
		assert.Equal(t, c1.UserID, c2c.UserID, "same user across devices")
		assert.Equal(t, "desktop", c2c.DeviceType)

		// Restore original token
		mockSvc.accessToken = validAccessToken
	})
}

// ── Helpers ──────────────────────────────────────────────────────────────────

func parseAndAssertCode(t *testing.T, resp *http.Response, want, ctx string) apiResp {
	t.Helper()
	var r apiResp
	require.NoError(t, json.Unmarshal(readBody(resp), &r), ctx)
	assertCode(t, r, want, ctx)
	return r
}

func doJSON(t *testing.T, client *http.Client, baseURL, method, path string, body interface{}) *http.Response {
	t.Helper()
	b, _ := json.Marshal(body)
	req, _ := http.NewRequest(method, baseURL+path, strings.NewReader(string(b)))
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	require.NoError(t, err)
	return resp
}

func readBody(resp *http.Response) []byte {
	defer resp.Body.Close()
	var buf []byte
	b := make([]byte, 1024)
	for {
		n, _ := resp.Body.Read(b)
		if n == 0 {
			break
		}
		buf = append(buf, b[:n]...)
	}
	return buf
}
