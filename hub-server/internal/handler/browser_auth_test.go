package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/agenthub/hub-server/internal/cache"
	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/jwtutil"
	"github.com/agenthub/hub-server/internal/middleware"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/service/auth"
	"github.com/agenthub/hub-server/internal/service/oidc"
	"github.com/agenthub/hub-server/internal/testkit"
	"github.com/agenthub/hub-server/internal/ws"
	"github.com/agenthub/pkg/testkit/oidcfixture"
	"github.com/alicebob/miniredis/v2"
	"github.com/coder/websocket"
	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

type browserHTTPFixture struct {
	router   *gin.Engine
	server   *httptest.Server
	handler  *BrowserAuthHandler
	provider *oidcfixture.Provider
	db       *gorm.DB
	jwt      config.JWTConfig
}

func newBrowserHTTPFixture(t *testing.T) *browserHTTPFixture {
	t.Helper()
	gin.SetMode(gin.TestMode)
	r := gin.New()
	server := httptest.NewUnstartedServer(r)
	origin := "http://" + server.Listener.Addr().String()
	db := testkit.NewAuthDB(t)
	provider := oidcfixture.NewServer(t)
	provider.ConfigureClient("hub-fixture", "fixture-secret")
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })
	cc := cache.NewClient(rdb)
	cfg := &config.Config{BrowserSession: config.BrowserSessionConfig{Origin: origin, RedirectURI: origin + "/callback", PostLogoutRedirectURI: origin + config.BrowserLogoutCallbackPath, TTL: time.Hour}, JWT: config.JWTConfig{Secret: "fixture-hub-secret-32-characters-long", AccessTTL: time.Hour, RefreshTTL: time.Hour}, AccountOIDC: config.AccountOIDCConfig{IssuerURL: provider.Server.URL, ClientID: "hub-fixture", ClientSecret: "fixture-secret", RedirectURI: origin + "/callback"}}
	authService := auth.NewService(db, cfg.JWT, cc)
	authService.SetBrowserSessionsEnabled(true)
	authService.SetAccountClientID(cfg.AccountOIDC.ClientID)
	oidcService := oidc.NewService(db, cfg.AccountOIDC, cfg.JWT, cc)
	mgr := ws.NewManager()
	h := NewBrowserAuthHandler(cfg.BrowserSession, oidcService, authService, mgr)
	mw := middleware.NewAuthMiddleware(cfg, middleware.AuthDependencies{Sessions: authService, BlacklistChecker: cc})
	r.POST("/client/auth/browser/authorize", h.Authorize)
	r.POST("/client/auth/browser/callback", h.Callback)
	r.POST("/client/auth/oidc/backchannel-logout", h.BackchannelLogout)
	r.GET("/client/auth/browser/session", mw.Handler(), mw.RequireHubSession(), h.Session)
	r.POST("/client/auth/browser/logout", mw.Handler(), mw.RequireHubSession(), h.Logout)
	r.POST("/client/auth/browser/logout/account", mw.Handler(), mw.RequireHubSession(), h.AccountLogout)
	r.GET(config.BrowserLogoutCallbackPath, h.AccountLogoutCallback)
	wsHandler := NewWebSocketHandler(mgr, "test")
	r.GET("/client/ws", mw.WSHandler(), mw.RequireHubSession(), wsHandler.ServeWS)
	server.Start()
	t.Cleanup(func() { mgr.Shutdown(); server.Close() })
	return &browserHTTPFixture{router: r, server: server, handler: h, provider: provider, db: db, jwt: cfg.JWT}
}

func (f *browserHTTPFixture) request(method, path string, body any, cookie *http.Cookie, csrf string) *httptest.ResponseRecorder {
	var encoded []byte
	if body != nil {
		encoded, _ = json.Marshal(body)
	}
	req := httptest.NewRequest(method, f.handler.cfg.Origin+path, bytes.NewReader(encoded))
	req.Header.Set("Origin", f.handler.cfg.Origin)
	req.Header.Set("Content-Type", "application/json")
	if cookie != nil {
		req.AddCookie(cookie)
	}
	if csrf != "" {
		req.Header.Set(middleware.BrowserCSRFHeader, csrf)
	}
	w := httptest.NewRecorder()
	f.router.ServeHTTP(w, req)
	return w
}

func (f *browserHTTPFixture) login(t *testing.T) (*http.Cookie, oidc.BrowserSessionResponse) {
	t.Helper()
	w := f.request("POST", "/client/auth/browser/authorize", map[string]string{"device_id": "11111111-1111-4111-8111-111111111111"}, nil, "")
	require.Equal(t, 200, w.Code, w.Body.String())
	var start struct {
		Data oidc.AuthorizationResult `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &start))
	uri, err := url.Parse(start.Data.AuthorizationURL)
	require.NoError(t, err)
	f.provider.RegisterCode("fixture-code", uri.Query().Get("nonce"), "http-fixture-subject", "Test Person", "")
	flow := w.Result().Cookies()[0]
	require.True(t, flow.HttpOnly)
	require.Empty(t, flow.Domain)
	require.Equal(t, http.SameSiteLaxMode, flow.SameSite)
	w = f.request("POST", "/client/auth/browser/callback", map[string]string{"code": "fixture-code", "state": start.Data.State, "iss": start.Data.Issuer}, flow, "")
	require.Equal(t, 200, w.Code, w.Body.String())
	var result struct {
		Data oidc.BrowserSessionResponse `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &result))
	var cookie *http.Cookie
	for _, c := range w.Result().Cookies() {
		if c.Name == f.handler.cfg.CookieName() {
			cookie = c
		}
	}
	require.NotNil(t, cookie)
	require.True(t, cookie.HttpOnly)
	require.Equal(t, "/", cookie.Path)
	require.Empty(t, cookie.Domain)
	require.NotContains(t, w.Body.String(), cookie.Value)
	require.NotContains(t, w.Body.String(), "access_token")
	require.NotContains(t, w.Body.String(), "refresh_token")
	return cookie, result.Data
}

func TestBrowserHTTPLoginRestoreLogoutAndCookieFlags(t *testing.T) {
	f := newBrowserHTTPFixture(t)
	cookie, session := f.login(t)
	var stored []model.BrowserSession
	require.NoError(t, f.db.Find(&stored).Error)
	require.Len(t, stored, 1)
	require.Equal(t, stored[0].TokenHash, jwtutil.HashRefreshToken(cookie.Value))
	require.True(t, stored[0].ExpiresAt.After(time.Now()), "stored expiry %v now %v", stored[0].ExpiresAt, time.Now())
	_, checkErr := f.handler.auth.BrowserSession(context.Background(), cookie.Value)
	require.NoError(t, checkErr)
	w := f.request("GET", "/client/auth/browser/session", nil, cookie, "")
	require.Equal(t, 200, w.Code, w.Body.String())
	require.Contains(t, w.Body.String(), session.User.ID)
	require.Equal(t, "no-store", w.Header().Get("Cache-Control"))
	w = f.request("POST", "/client/auth/browser/logout", nil, cookie, "")
	require.Equal(t, 403, w.Code)
	w = f.request("POST", "/client/auth/browser/logout", nil, cookie, session.CSRFToken)
	require.Equal(t, 200, w.Code, w.Body.String())
	require.Equal(t, -1, w.Result().Cookies()[0].MaxAge)
	w = f.request("GET", "/client/auth/browser/session", nil, cookie, "")
	require.Equal(t, 401, w.Code)
	// Production cookie properties are controlled by validated config, not
	// request-supplied forwarded headers.
	f.handler.cfg.Secure = true
	w = httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	f.handler.setCookie(c, f.handler.cfg.CookieName(), "opaque", time.Hour)
	secure := w.Result().Cookies()[0]
	require.Equal(t, "__Host-agenthub_session", secure.Name)
	require.True(t, secure.Secure)
	require.True(t, secure.HttpOnly)
}

func TestBackchannelClosesCookieAndNativeSocketsWithTypedRevocation(t *testing.T) {
	f := newBrowserHTTPFixture(t)
	cookie, session := f.login(t)
	var identity model.UserIdentity
	require.NoError(t, f.db.First(&identity, "user_id = ?", session.User.ID).Error)
	native, err := jwtutil.GenerateIdentityAccessToken(session.User.ID, "desktop", "native-device", identity.ID, 0, f.jwt.Secret, time.Hour, "hub-fixture")
	require.NoError(t, err)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	open := func(headers http.Header) *websocket.Conn {
		header := headers.Clone()
		header.Set("Origin", f.handler.cfg.Origin)
		conn, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(f.server.URL, "http")+"/client/ws", &websocket.DialOptions{HTTPHeader: header})
		require.NoError(t, err)
		t.Cleanup(func() { _ = conn.CloseNow() })
		_, data, err := conn.Read(ctx)
		require.NoError(t, err)
		require.Contains(t, string(data), "auth.ok")
		return conn
	}
	browserWS := open(http.Header{"Cookie": []string{cookie.Name + "=" + cookie.Value}})
	nativeWS := open(http.Header{"Authorization": []string{"Bearer " + native}})
	now := time.Now()
	claims := jwt.MapClaims{"iss": f.provider.Server.URL, "aud": "hub-fixture", "sub": "http-fixture-subject", "iat": now.Unix(), "exp": now.Add(time.Hour).Unix(), "jti": "http-logout-1", "events": map[string]any{jwtutil.BackchannelLogoutEvent: map[string]any{}}}
	token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	token.Header["kid"] = f.provider.Key.Kid
	raw, err := token.SignedString(f.provider.Key.Private)
	require.NoError(t, err)
	done := make(chan *httptest.ResponseRecorder, 1)
	go func() {
		req := httptest.NewRequest("POST", f.server.URL+"/client/auth/oidc/backchannel-logout", strings.NewReader(url.Values{"logout_token": {raw}}.Encode()))
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		w := httptest.NewRecorder()
		f.router.ServeHTTP(w, req)
		done <- w
	}()
	// Read both concurrently: each server close waits for its peer close.
	readDone := make(chan error, 2)
	for _, conn := range []*websocket.Conn{browserWS, nativeWS} {
		go func(c *websocket.Conn) {
			_, data, err := c.Read(ctx)
			if err == nil && !strings.Contains(string(data), "auth.revoked") {
				err = bytes.ErrTooLarge
			}
			if err == nil {
				_, _, _ = c.Read(ctx)
			}
			readDone <- err
		}(conn)
	}
	for i := 0; i < 2; i++ {
		require.NoError(t, <-readDone)
	}
	require.Equal(t, 204, (<-done).Code)
	require.Equal(t, 401, f.request("GET", "/client/auth/browser/session", nil, cookie, "").Code)
	_, response, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(f.server.URL, "http")+"/client/ws", &websocket.DialOptions{HTTPHeader: http.Header{"Cookie": []string{cookie.Name + "=" + cookie.Value}, "Origin": []string{f.handler.cfg.Origin}}})
	require.Error(t, err)
	require.Equal(t, 401, response.StatusCode)
}

func TestBackchannelHTTPRejectsDuplicateAndOversizeForms(t *testing.T) {
	f := newBrowserHTTPFixture(t)
	for _, body := range []string{"logout_token=one&logout_token=two", "logout_token=" + strings.Repeat("a", 9000)} {
		req := httptest.NewRequest("POST", f.server.URL+"/client/auth/oidc/backchannel-logout", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		w := httptest.NewRecorder()
		f.router.ServeHTTP(w, req)
		require.Equal(t, 400, w.Code)
	}
}
