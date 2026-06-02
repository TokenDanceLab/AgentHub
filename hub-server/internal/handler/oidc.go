package handler

import (
	"context"
	"fmt"
	"strings"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/service"
	"github.com/gin-gonic/gin"
)

// OIDCService is the subset of *service.OIDCService used by OIDCHandler.
type OIDCService interface {
	GenerateAuthorizationURL(ctx context.Context, codeChallenge, codeChallengeMethod, deviceType, deviceID, redirectURI string) (*service.AuthorizationResult, error)
	HandleCallback(ctx context.Context, code, state, codeVerifier, deviceType, deviceID, redirectURI string) (*service.CallbackResult, error)
}

type OIDCHandler struct {
	svc OIDCService
}

func NewOIDCHandler(svc OIDCService) *OIDCHandler {
	return &OIDCHandler{svc: svc}
}

type oidcAuthorizeReq struct {
	CodeChallenge       string `json:"code_challenge" binding:"required"`
	CodeChallengeMethod string `json:"code_challenge_method"`
	DeviceType          string `json:"device_type" binding:"required"`
	DeviceID            string `json:"device_id" binding:"required"`
	RedirectURI         string `json:"redirect_uri"`
}

func (h *OIDCHandler) PostOIDCAuthorize(c *gin.Context) {
	var req oidcAuthorizeReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, errcode.ErrBadRequest)
		return
	}
	deviceType, ok := normalizeOIDCDeviceType(req.DeviceType)
	if !ok {
		FailWithMessage(c, errcode.ErrBadRequest, "device_type must be one of desktop, web, cli")
		return
	}
	deviceID, ok := normalizeUUID(req.DeviceID)
	if !ok {
		FailWithMessage(c, errcode.ErrBadRequest, "device_id must be a UUID")
		return
	}
	result, err := h.svc.GenerateAuthorizationURL(c.Request.Context(),
		req.CodeChallenge, req.CodeChallengeMethod, deviceType, deviceID, strings.TrimSpace(req.RedirectURI))
	if err != nil {
		if e, ok := err.(*errcode.Error); ok {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, result)
}

type oidcCallbackReq struct {
	Code         string `json:"code" binding:"required"`
	State        string `json:"state" binding:"required"`
	CodeVerifier string `json:"code_verifier" binding:"required"`
	DeviceType   string `json:"device_type" binding:"required"`
	DeviceID     string `json:"device_id" binding:"required"`
	RedirectURI  string `json:"redirect_uri"`
}

func (h *OIDCHandler) PostOIDCCallback(c *gin.Context) {
	var req oidcCallbackReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, errcode.ErrBadRequest)
		return
	}
	h.handleCallback(c, req.Code, req.State, req.CodeVerifier, req.DeviceType, req.DeviceID, req.RedirectURI)
}

// GetOIDCCallback handles the GET redirect from TokenDance ID after authorization.
// This is the standard OIDC Authorization Code flow: TokenDance ID 302s the user's
// browser here with ?code=xxx&state=yyy. The Desktop app receives the code via
// the local Tauri callback server or manual entry.
func (h *OIDCHandler) GetOIDCCallback(c *gin.Context) {
	code := c.Query("code")
	state := c.Query("state")
	if code == "" || state == "" {
		// Return a friendly HTML page so the user sees something useful
		c.Header("Content-Type", "text/html; charset=utf-8")
		const missing = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>AgentHub — Missing Parameters</title></head><body style="font-family:system-ui;max-width:480px;margin:60px auto"><h2>Missing OIDC Parameters</h2><p>The callback is missing <code>code</code> or <code>state</code>. This usually means the login flow was interrupted or the URL was truncated.</p><p><a href="https://hub.vectorcontrol.tech">Back to AgentHub</a></p></body></html>`
		c.String(400, missing)
		return
	}
	// Return a simple HTML page that shows the code for the Desktop app.
	// The local Tauri callback server and/or manual entry will pick this up.
	c.Header("Content-Type", "text/html; charset=utf-8")
	success := fmt.Sprintf(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>AgentHub — Login Successful</title></head><body style="font-family:system-ui;max-width:480px;margin:60px auto;text-align:center"><h2 style="color:#2563EB">Login Successful ✓</h2><p>You can close this page and return to the AgentHub desktop app.</p><p style="color:#6B7280;font-size:13px">Authorization code: <code>%s</code></p><p style="color:#6B7280;font-size:13px">State: <code>%s</code></p></body></html>`, code, state)
	c.String(200, success)
}

func (h *OIDCHandler) handleCallback(c *gin.Context, code, state, codeVerifier, deviceType, deviceID, redirectURI string) {
	dt, ok := normalizeOIDCDeviceType(deviceType)
	if !ok {
		FailWithMessage(c, errcode.ErrBadRequest, "device_type must be one of desktop, web, cli")
		return
	}
	did, ok := normalizeUUID(deviceID)
	if !ok {
		FailWithMessage(c, errcode.ErrBadRequest, "device_id must be a UUID")
		return
	}
	result, err := h.svc.HandleCallback(c.Request.Context(),
		code, state, codeVerifier, dt, did, strings.TrimSpace(redirectURI))
	if err != nil {
		if e, ok := err.(*errcode.Error); ok {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, result)
}

func normalizeOIDCDeviceType(value string) (string, bool) {
	switch strings.TrimSpace(value) {
	case "desktop", "web", "cli":
		return strings.TrimSpace(value), true
	default:
		return "", false
	}
}
