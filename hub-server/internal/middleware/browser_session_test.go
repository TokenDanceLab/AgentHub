package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/agenthub/hub-server/internal/cache"
	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/jwtutil"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
	"github.com/agenthub/hub-server/internal/service/auth"
	"github.com/agenthub/hub-server/internal/testkit"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestBrowserCookieOriginCSRFAndUnavailable(t *testing.T) {
	db := testkit.NewAuthDB(t)
	const cookie, csrf = "opaque-cookie-fixture", "csrf-fixture"
	cfg := &config.Config{BrowserSession: config.BrowserSessionConfig{Origin: "https://hub.example.com", Secure: true}, JWT: config.JWTConfig{Secret: "test-jwt-secret-at-least-32-characters"}}
	input := repository.BoundAccountSessionInput{AccountSessionInput: repository.AccountSessionInput{Issuer: "https://account.example", Subject: "sub", Name: "Test", DeviceType: "web", DeviceID: "device-1"}, ProofIssuedAt: time.Now().Unix(), Browser: &model.BrowserSession{TokenHash: jwtutil.HashRefreshToken(cookie), CSRFToken: csrf, CreatedAt: time.Now(), ExpiresAt: time.Now().Add(time.Hour)}}
	_, err := repository.CreateBoundAccountSession(db, input)
	require.NoError(t, err)
	mw := NewAuthMiddleware(cfg, AuthDependencies{Sessions: auth.NewService(db, cfg.JWT, cache.NoOpCache{})})
	router := gin.New()
	router.Any("/product", mw.Handler(), mw.RequireHubSession(), func(c *gin.Context) { c.Status(http.StatusNoContent) })
	for _, tc := range []struct {
		name, method, origin, proof, auth string
		duplicate                         bool
		want                              int
	}{
		{name: "restore", method: "GET", want: 204},
		{name: "mutation", method: "POST", origin: cfg.BrowserSession.Origin, proof: csrf, want: 204},
		{name: "missing-origin", method: "POST", proof: csrf, want: 403},
		{name: "missing-csrf", method: "POST", origin: cfg.BrowserSession.Origin, want: 403},
		{name: "sibling-origin", method: "POST", origin: "https://other.example.com", proof: csrf, want: 403},
		{name: "wrong-scheme", method: "POST", origin: "http://hub.example.com", proof: csrf, want: 403},
		{name: "duplicate-cookie", method: "GET", duplicate: true, want: 401},
		{name: "invalid-bearer-no-cookie-fallback", method: "GET", auth: "Bearer invalid", want: 401},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(tc.method, cfg.BrowserSession.Origin+"/product", nil)
			req.AddCookie(&http.Cookie{Name: cfg.BrowserSession.CookieName(), Value: cookie})
			if tc.duplicate {
				req.AddCookie(&http.Cookie{Name: cfg.BrowserSession.CookieName(), Value: "second"})
			}
			if tc.origin != "" {
				req.Header.Set("Origin", tc.origin)
			}
			if tc.proof != "" {
				req.Header.Set(BrowserCSRFHeader, tc.proof)
			}
			if tc.auth != "" {
				req.Header.Set("Authorization", tc.auth)
			}
			w := httptest.NewRecorder()
			router.ServeHTTP(w, req)
			require.Equal(t, tc.want, w.Code, w.Body.String())
		})
	}
	require.NoError(t, db.Migrator().DropTable(&model.OIDCSubjectEpoch{}))
	req := httptest.NewRequest("GET", cfg.BrowserSession.Origin+"/product", nil)
	req.AddCookie(&http.Cookie{Name: cfg.BrowserSession.CookieName(), Value: cookie})
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	require.Equal(t, 503, w.Code)
	require.Contains(t, w.Body.String(), "auth_unavailable")
}
