package middleware

import (
	"context"
	"crypto/subtle"
	"errors"
	"net/http"
	"net/url"

	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/jwtutil"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/gin-gonic/gin"
)

type SessionChecker interface {
	BrowserSession(context.Context, string) (*model.BrowserSession, error)
	BrowserSessionByHash(context.Context, string) (*model.BrowserSession, error)
	CheckAccessSession(context.Context, *jwtutil.Claims) error
}

const BrowserCSRFHeader = "X-Hub-CSRF"

// ExactBrowserOrigin uses the configured public origin, not untrusted forwarded
// headers. The reverse proxy must preserve the original Host header.
func ExactBrowserOrigin(r *http.Request, cfg config.BrowserSessionConfig, required bool) bool {
	if !cfg.Enabled() {
		return false
	}
	origin, err := url.Parse(cfg.Origin)
	if err != nil || r.Host != origin.Host {
		return false
	}
	got := r.Header.Get("Origin")
	if got == "" {
		return !required && r.Header.Get("Sec-Fetch-Site") != "cross-site"
	}
	return got == cfg.Origin
}

// SingleCookie rejects duplicate credential names instead of trusting cookie
// ordering (including shadow cookies planted by sibling domains in dev mode).
func SingleCookie(r *http.Request, name string) (string, bool) {
	var value string
	count := 0
	for _, cookie := range r.Cookies() {
		if cookie.Name == name {
			value = cookie.Value
			count++
		}
	}
	return value, count == 1 && value != ""
}

func (m *AuthMiddleware) browserSession(c *gin.Context, websocket bool) bool {
	c.Header("Cache-Control", "no-store")
	if m.deps.Sessions == nil || !m.cfg.BrowserSession.Enabled() {
		fail(c, errcode.AuthInvalidToken)
		c.Abort()
		return false
	}
	unsafe := c.Request.Method != http.MethodGet && c.Request.Method != http.MethodHead && c.Request.Method != http.MethodOptions
	if !ExactBrowserOrigin(c.Request, m.cfg.BrowserSession, unsafe || websocket) {
		fail(c, errcode.AuthCSRFInvalid)
		c.Abort()
		return false
	}
	cookie, ok := SingleCookie(c.Request, m.cfg.BrowserSession.CookieName())
	if !ok {
		fail(c, errcode.AuthInvalidToken)
		c.Abort()
		return false
	}
	session, err := m.deps.Sessions.BrowserSession(c.Request.Context(), cookie)
	if err != nil {
		sessionFailure(c, err)
		return false
	}
	if unsafe && subtle.ConstantTimeCompare([]byte(c.GetHeader(BrowserCSRFHeader)), []byte(session.CSRFToken)) != 1 {
		fail(c, errcode.AuthCSRFInvalid)
		c.Abort()
		return false
	}
	c.Set("user_id", session.UserID)
	c.Set("device_type", "web")
	c.Set("device_id", session.DeviceID)
	c.Set("purpose", "")
	c.Set("auth_source", "hub_local")
	c.Set("browser_session", session)
	c.Set("session_identity_id", session.UserIdentityID)
	c.Set("session_generation", session.Generation)
	c.Set("session_hash", session.TokenHash)
	c.Set("session_validator", func(ctx context.Context) error {
		_, err := m.deps.Sessions.BrowserSessionByHash(ctx, session.TokenHash)
		return err
	})
	return true
}

func (m *AuthMiddleware) acceptSessionClaims(c *gin.Context, claims *jwtutil.Claims) bool {
	if m.deps.Sessions == nil {
		return m.acceptAccessClaims(c, claims)
	}
	if err := m.deps.Sessions.CheckAccessSession(c.Request.Context(), claims); err != nil {
		sessionFailure(c, err)
		return false
	}
	c.Set("session_identity_id", claims.IdentityID)
	c.Set("session_generation", claims.AuthGeneration)
	c.Set("session_validator", func(ctx context.Context) error { return m.deps.Sessions.CheckAccessSession(ctx, claims) })
	return true
}

func sessionFailure(c *gin.Context, err error) {
	var coded *errcode.Error
	if errors.As(err, &coded) {
		fail(c, coded)
	} else {
		fail(c, errcode.AuthUnavailable)
	}
	c.Abort()
}
