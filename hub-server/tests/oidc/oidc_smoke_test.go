package oidc

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/handler"
	"github.com/agenthub/hub-server/internal/jwtutil"
	"github.com/agenthub/hub-server/internal/middleware"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/service/oidc"
)

const (
	smokeIssuer     = "https://account.example"
	smokeJWTSecret  = "smoke-hub-secret-minimum-32-characters"
	smokeDeviceType = "web"
)

type mockOIDCService struct {
	state        string
	accessToken  string
	refreshToken string
	user         model.User
}

func (m *mockOIDCService) GenerateAuthorizationURL(_ context.Context, _, _, _, _, _ string) (*oidc.AuthorizationResult, error) {
	return &oidc.AuthorizationResult{
		State:            m.state,
		AuthorizationURL: smokeIssuer + "/oauth/authorize?response_type=code",
	}, nil
}

func (m *mockOIDCService) HandleCallback(_ context.Context, _, _, _, issuer, _, _, _ string) (*oidc.CallbackResult, error) {
	if issuer != smokeIssuer {
		return nil, oidcErrIssuer
	}
	return &oidc.CallbackResult{
		AccessToken:  m.accessToken,
		RefreshToken: m.refreshToken,
		ExpiresIn:    900,
		User:         m.user,
	}, nil
}

// A tiny local sentinel keeps this integration smoke independent from the
// handler package's unexported error-mapping helpers.
var oidcErrIssuer = &smokeOIDCError{}

type smokeOIDCError struct{}

func (*smokeOIDCError) Error() string { return "issuer invalid" }

func TestAccountOIDCSmokeThroughHubSessionMiddleware(t *testing.T) {
	userID := uuid.NewString()
	deviceID := uuid.NewString()
	accessToken, err := jwtutil.GenerateAccessToken(
		userID,
		smokeDeviceType,
		deviceID,
		smokeJWTSecret,
		15*time.Minute,
	)
	require.NoError(t, err)

	mockSvc := &mockOIDCService{
		state:        "state-" + uuid.NewString(),
		accessToken:  accessToken,
		refreshToken: "refresh-" + uuid.NewString(),
		user: model.User{
			ID:       userID,
			Username: "account-user",
			Nickname: "Account User",
		},
	}
	h := handler.NewOIDCHandler(mockSvc)

	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.POST("/client/auth/oidc/authorize", h.PostOIDCAuthorize)
	r.POST("/client/auth/oidc/callback", h.PostOIDCCallback)

	authMW := middleware.NewAuthMiddleware(&config.Config{
		JWT: config.JWTConfig{Secret: smokeJWTSecret},
	}, middleware.AuthDependencies{})
	api := r.Group("/client")
	api.Use(authMW.Handler(), authMW.RequireHubSession())
	api.GET("/auth/me", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"code":    "ok",
			"user_id": c.GetString("user_id"),
		})
	})

	server := httptest.NewServer(r)
	defer server.Close()
	client := server.Client()

	authorizeResp := doJSON(t, client, server.URL+"/client/auth/oidc/authorize", map[string]any{
		"code_challenge":        "challenge",
		"code_challenge_method": "S256",
		"device_type":           smokeDeviceType,
		"device_id":             deviceID,
	})
	require.Equal(t, http.StatusOK, authorizeResp.StatusCode)
	var authorizeEnvelope struct {
		Code string `json:"code"`
		Data struct {
			State string `json:"state"`
		} `json:"data"`
	}
	require.NoError(t, json.NewDecoder(authorizeResp.Body).Decode(&authorizeEnvelope))
	_ = authorizeResp.Body.Close()
	assert.Equal(t, "ok", authorizeEnvelope.Code)
	assert.Equal(t, mockSvc.state, authorizeEnvelope.Data.State)

	callbackResp := doJSON(t, client, server.URL+"/client/auth/oidc/callback", map[string]any{
		"code":          "code-1",
		"state":         mockSvc.state,
		"iss":           smokeIssuer,
		"code_verifier": "verifier",
		"device_type":   smokeDeviceType,
		"device_id":     deviceID,
	})
	require.Equal(t, http.StatusOK, callbackResp.StatusCode)
	var callbackEnvelope struct {
		Code string `json:"code"`
		Data struct {
			AccessToken  string `json:"access_token"`
			RefreshToken string `json:"refresh_token"`
		} `json:"data"`
	}
	require.NoError(t, json.NewDecoder(callbackResp.Body).Decode(&callbackEnvelope))
	_ = callbackResp.Body.Close()
	assert.Equal(t, "ok", callbackEnvelope.Code)
	assert.Equal(t, accessToken, callbackEnvelope.Data.AccessToken)
	assert.Equal(t, mockSvc.refreshToken, callbackEnvelope.Data.RefreshToken)

	req, err := http.NewRequest(http.MethodGet, server.URL+"/client/auth/me", nil)
	require.NoError(t, err)
	req.Header.Set("Authorization", "Bearer "+callbackEnvelope.Data.AccessToken)
	meResp, err := client.Do(req)
	require.NoError(t, err)
	defer meResp.Body.Close()
	require.Equal(t, http.StatusOK, meResp.StatusCode)
	var me struct {
		UserID string `json:"user_id"`
	}
	require.NoError(t, json.NewDecoder(meResp.Body).Decode(&me))
	assert.Equal(t, userID, me.UserID)

	// Missing iss is rejected before the service is called.
	missingIss := doJSON(t, client, server.URL+"/client/auth/oidc/callback", map[string]any{
		"code":          "code-1",
		"state":         mockSvc.state,
		"code_verifier": "verifier",
		"device_type":   smokeDeviceType,
		"device_id":     deviceID,
	})
	defer missingIss.Body.Close()
	assert.Equal(t, http.StatusBadRequest, missingIss.StatusCode)
}

func doJSON(t *testing.T, client *http.Client, url string, body any) *http.Response {
	t.Helper()
	raw, err := json.Marshal(body)
	require.NoError(t, err)
	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(raw))
	require.NoError(t, err)
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	require.NoError(t, err)
	return resp
}
