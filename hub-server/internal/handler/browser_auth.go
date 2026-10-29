package handler

import (
	"errors"
	"mime"
	"net/http"
	"time"

	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/middleware"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/service/auth"
	"github.com/agenthub/hub-server/internal/service/oidc"
	"github.com/agenthub/hub-server/internal/ws"
	"github.com/gin-gonic/gin"
)

type BrowserAuthHandler struct {
	cfg     config.BrowserSessionConfig
	oidc    *oidc.Service
	auth    *auth.Service
	manager *ws.Manager
}

func NewBrowserAuthHandler(cfg config.BrowserSessionConfig, oidcService *oidc.Service, authService *auth.Service, manager *ws.Manager) *BrowserAuthHandler {
	return &BrowserAuthHandler{cfg: cfg, oidc: oidcService, auth: authService, manager: manager}
}

func (h *BrowserAuthHandler) Enabled() bool { return h.cfg.Enabled() }

func (h *BrowserAuthHandler) Authorize(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	if !middleware.ExactBrowserOrigin(c.Request, h.cfg, true) {
		Fail(c, errcode.AuthCSRFInvalid)
		return
	}
	var req struct {
		DeviceID string `json:"device_id" binding:"required"`
	}
	if c.ShouldBindJSON(&req) != nil {
		Fail(c, errcode.ErrBadRequest)
		return
	}
	id, valid := normalizeUUID(req.DeviceID)
	if !valid {
		Fail(c, errcode.ErrBadRequest)
		return
	}
	result, cookie, err := h.oidc.BeginBrowserLogin(c.Request.Context(), h.cfg, id)
	if err != nil {
		browserAuthFailure(c, err)
		return
	}
	h.setCookie(c, h.cfg.FlowCookieName(), cookie, 10*time.Minute)
	OK(c, result)
}

func (h *BrowserAuthHandler) Callback(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	if !middleware.ExactBrowserOrigin(c.Request, h.cfg, true) {
		Fail(c, errcode.AuthCSRFInvalid)
		return
	}
	var req struct {
		Code   string `json:"code" binding:"required"`
		State  string `json:"state" binding:"required"`
		Issuer string `json:"iss" binding:"required"`
	}
	if c.ShouldBindJSON(&req) != nil {
		Fail(c, errcode.ErrBadRequest)
		return
	}
	cookie, valid := middleware.SingleCookie(c.Request, h.cfg.FlowCookieName())
	if !valid {
		Fail(c, errcode.OIDCInvalidState)
		return
	}
	h.setCookie(c, h.cfg.FlowCookieName(), "", -time.Second)
	result, token, err := h.oidc.CompleteBrowserLogin(c.Request.Context(), h.cfg, req.Code, req.State, req.Issuer, cookie)
	if err != nil {
		browserAuthFailure(c, err)
		return
	}
	h.setCookie(c, h.cfg.CookieName(), token, h.cfg.TTL)
	OK(c, result)
}

func (h *BrowserAuthHandler) Session(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	session := browserSessionFromContext(c)
	if session == nil {
		return
	}
	user, err := h.auth.GetMe(c.Request.Context(), session.UserID)
	if err != nil {
		browserAuthFailure(c, err)
		return
	}
	OK(c, oidc.BrowserSessionResponse{User: *user, ExpiresAt: session.ExpiresAt, CSRFToken: session.CSRFToken})
}

func browserSessionFromContext(c *gin.Context) *model.BrowserSession {
	value, _ := c.Get("browser_session")
	session, ok := value.(*model.BrowserSession)
	if !ok {
		Fail(c, errcode.AuthInvalidToken)
		return nil
	}
	return session
}

func (h *BrowserAuthHandler) revoke(c *gin.Context) bool {
	c.Header("Cache-Control", "no-store")
	session := browserSessionFromContext(c)
	if session == nil {
		return false
	}
	if err := h.auth.RevokeBrowserSession(c.Request.Context(), session.TokenHash); err != nil {
		browserAuthFailure(c, err)
		return false
	}
	h.setCookie(c, h.cfg.CookieName(), "", -time.Second)
	if h.manager != nil {
		h.manager.RevalidateSessions(session.UserIdentityID)
	}
	return true
}

func (h *BrowserAuthHandler) Logout(c *gin.Context) {
	if h.revoke(c) {
		OK(c, nil)
	}
}

func (h *BrowserAuthHandler) AccountLogout(c *gin.Context) {
	if !h.revoke(c) {
		return
	}
	logoutURL, cookie, err := h.oidc.BeginAccountLogout(c.Request.Context(), h.cfg)
	if err != nil {
		browserAuthFailure(c, err)
		return
	}
	h.setCookie(c, h.cfg.LogoutCookieName(), cookie, 10*time.Minute)
	OK(c, gin.H{"logout_url": logoutURL})
}

func (h *BrowserAuthHandler) AccountLogoutCallback(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	cookie, valid := middleware.SingleCookie(c.Request, h.cfg.LogoutCookieName())
	h.setCookie(c, h.cfg.LogoutCookieName(), "", -time.Second)
	if !valid || len(c.Request.URL.Query()["state"]) != 1 {
		Fail(c, errcode.OIDCInvalidState)
		return
	}
	if err := h.oidc.CompleteAccountLogout(c.Request.Context(), c.Query("state"), cookie); err != nil {
		browserAuthFailure(c, err)
		return
	}
	c.Redirect(http.StatusSeeOther, h.cfg.Origin+"/")
}

func (h *BrowserAuthHandler) BackchannelLogout(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	mediaType, _, err := mime.ParseMediaType(c.GetHeader("Content-Type"))
	if err != nil || mediaType != "application/x-www-form-urlencoded" {
		Fail(c, errcode.ErrBadRequest)
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 8192)
	if err := c.Request.ParseForm(); err != nil {
		Fail(c, errcode.ErrBadRequest)
		return
	}
	values := c.Request.PostForm["logout_token"]
	if len(values) != 1 || values[0] == "" {
		Fail(c, errcode.ErrBadRequest)
		return
	}
	identity, _, err := h.oidc.ApplyBackchannelLogout(c.Request.Context(), values[0])
	if err != nil {
		browserAuthFailure(c, err)
		return
	}
	if identity != "" && h.manager != nil {
		h.manager.RevalidateSessions(identity)
	}
	c.Status(http.StatusNoContent)
}

func (h *BrowserAuthHandler) setCookie(c *gin.Context, name, value string, ttl time.Duration) {
	// #nosec G124 -- Config.validateBrowserSession requires Secure for public/production origins; false is permitted only for explicit loopback development.
	http.SetCookie(c.Writer, &http.Cookie{Name: name, Value: value, Path: "/", Secure: h.cfg.Secure, HttpOnly: true, SameSite: http.SameSiteLaxMode, MaxAge: int(ttl.Seconds()), Expires: time.Now().Add(ttl).UTC()})
}

func browserAuthFailure(c *gin.Context, err error) {
	var coded *errcode.Error
	if errors.As(err, &coded) {
		Fail(c, coded)
		return
	}
	Fail(c, errcode.AuthUnavailable)
}
