package handler

import (
	"context"
	"errors"
	"log/slog"
	"net"
	"net/url"
	"os"
	"strconv"
	"strings"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/middleware"
	"github.com/agenthub/hub-server/internal/service"
	"github.com/gin-gonic/gin"
)

// OIDCService is the subset of *service.OIDCService used by OIDCHandler.
type OIDCService interface {
	GenerateAuthorizationURL(ctx context.Context, codeChallenge, codeChallengeMethod, deviceType, deviceID, redirectURI string) (*service.AuthorizationResult, error)
	HandleCallback(ctx context.Context, code, state, codeVerifier, deviceType, deviceID, redirectURI string) (*service.CallbackResult, error)
}

type OIDCHandler struct {
	service OIDCService
}

func NewOIDCHandler(service OIDCService) *OIDCHandler {
	return &OIDCHandler{service: service}
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
		slog.Error("oidc authorize bind error", "request_id", middleware.GetRequestID(c), "error", err)
		Fail(c, errcode.ErrBadRequest)
		return
	}
	deviceType, ok := normalizeOIDCDeviceType(req.DeviceType)
	if !ok {
		slog.Error("oidc authorize invalid device_type", "request_id", middleware.GetRequestID(c), "device_type", req.DeviceType)
		FailWithMessage(c, errcode.ErrBadRequest, "device_type must be one of desktop, web, cli")
		return
	}
	deviceID, ok := normalizeUUID(req.DeviceID)
	if !ok {
		slog.Error("oidc authorize invalid device_id", "request_id", middleware.GetRequestID(c), "device_id", req.DeviceID)
		FailWithMessage(c, errcode.ErrBadRequest, "device_id must be a UUID")
		return
	}
	redirectURI := strings.TrimSpace(req.RedirectURI)
	if err := validateRedirectURI(redirectURI, deviceType); err != nil {
		slog.Error("oidc authorize redirect_uri validation failed", "request_id", middleware.GetRequestID(c), "redirect_uri", redirectURI, "error", err)
		FailWithMessage(c, errcode.ErrBadRequest, err.Error())
		return
	}
	result, err := h.service.GenerateAuthorizationURL(c.Request.Context(),
		req.CodeChallenge, req.CodeChallengeMethod, deviceType, deviceID, redirectURI)
	if err != nil {
		logOIDCServiceError(c, "oidc authorize service error", err)
		handleOIDCServiceError(c, err)
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
		slog.Error("oidc callback bind error", "request_id", middleware.GetRequestID(c), "error", err)
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
	lang := detectLang(c)
	c.Header("Content-Type", "text/html; charset=utf-8")

	if code == "" || state == "" {
		slog.Error("oidc callback get missing parameters", "request_id", middleware.GetRequestID(c))
		if lang == "zh" {
			const missing = `<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8"><title>AgentHub — 缺少参数</title></head><body style="font-family:system-ui;max-width:480px;margin:60px auto"><h2>缺少参数</h2><p>回调地址缺少 <code>code</code> 或 <code>state</code> 参数，这通常意味着登录流程被中断，或 URL 被截断。</p><p><a href="https://hub.vectorcontrol.tech">返回 AgentHub</a></p></body></html>`
			c.String(400, missing)
		} else {
			const missing = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>AgentHub — Missing Parameters</title></head><body style="font-family:system-ui;max-width:480px;margin:60px auto"><h2>Missing OIDC Parameters</h2><p>The callback is missing <code>code</code> or <code>state</code>. This usually means the login flow was interrupted or the URL was truncated.</p><p><a href="https://hub.vectorcontrol.tech">Back to AgentHub</a></p></body></html>`
			c.String(400, missing)
		}
		return
	}

	if lang == "zh" {
		const success = `<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8"><title>AgentHub — 登录成功</title></head><body style="font-family:system-ui;max-width:480px;margin:60px auto;text-align:center"><h2 style="color:#2563EB">登录成功 ✓</h2><p>登录流程已完成。</p><p>您可以关闭此页面并返回 AgentHub 桌面应用。</p></body></html>`
		c.String(200, success)
	} else {
		const success = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>AgentHub — Login Successful</title></head><body style="font-family:system-ui;max-width:480px;margin:60px auto;text-align:center"><h2 style="color:#2563EB">Login Successful ✓</h2><p>The login flow is complete.</p><p>You can close this page and return to the AgentHub desktop app.</p></body></html>`
		c.String(200, success)
	}
}

func (h *OIDCHandler) handleCallback(c *gin.Context, code, state, codeVerifier, deviceType, deviceID, redirectURI string) {
	dt, ok := normalizeOIDCDeviceType(deviceType)
	if !ok {
		slog.Error("oidc callback invalid device_type", "request_id", middleware.GetRequestID(c), "device_type", deviceType)
		FailWithMessage(c, errcode.ErrBadRequest, "device_type must be one of desktop, web, cli")
		return
	}
	did, ok := normalizeUUID(deviceID)
	if !ok {
		slog.Error("oidc callback invalid device_id", "request_id", middleware.GetRequestID(c), "device_id", deviceID)
		FailWithMessage(c, errcode.ErrBadRequest, "device_id must be a UUID")
		return
	}
	trimmedURI := strings.TrimSpace(redirectURI)
	if err := validateRedirectURI(trimmedURI, dt); err != nil {
		slog.Error("oidc callback redirect_uri validation failed", "request_id", middleware.GetRequestID(c), "redirect_uri", trimmedURI, "error", err)
		FailWithMessage(c, errcode.ErrBadRequest, err.Error())
		return
	}
	result, err := h.service.HandleCallback(c.Request.Context(),
		code, state, codeVerifier, dt, did, trimmedURI)
	if err != nil {
		logOIDCServiceError(c, "oidc callback service error", err)
		handleOIDCServiceError(c, err)
		return
	}
	OK(c, result)
}

func logOIDCServiceError(c *gin.Context, message string, err error) {
	if safeErr := safeOIDCServiceError(err); safeErr != nil {
		slog.Error(message, "request_id", middleware.GetRequestID(c), "error_code", safeErr.Code)
		return
	}
	slog.Error(message, "request_id", middleware.GetRequestID(c), "error_category", "service_error")
}

func handleOIDCServiceError(c *gin.Context, err error) {
	if safeErr := safeOIDCServiceError(err); safeErr != nil {
		Fail(c, safeErr)
		return
	}
	Fail(c, errcode.ErrInternal)
}

func safeOIDCServiceError(err error) *errcode.Error {
	var e *errcode.Error
	if !errors.As(err, &e) {
		return nil
	}
	switch e.Code {
	case errcode.OIDCInvalidState.Code:
		return errcode.OIDCInvalidState
	case errcode.OIDCCodeExchangeFailed.Code:
		return errcode.OIDCCodeExchangeFailed
	case errcode.OIDCIDTokenInvalid.Code:
		return errcode.OIDCIDTokenInvalid
	case errcode.OIDCSubNotFound.Code:
		return errcode.OIDCSubNotFound
	default:
		return nil
	}
}

func normalizeOIDCDeviceType(value string) (string, bool) {
	switch strings.TrimSpace(value) {
	case "desktop", "web", "cli":
		return strings.TrimSpace(value), true
	default:
		return "", false
	}
}

// detectLang inspects the Accept-Language header to determine the preferred language.
// Returns "zh" for Chinese variants, "en" otherwise.
func detectLang(c *gin.Context) string {
	al := c.GetHeader("Accept-Language")
	if strings.HasPrefix(al, "zh") {
		return "zh"
	}
	return "en"
}

// validateRedirectURI performs handler-level defense-in-depth validation of
// redirect_uri against AGENTHUB_TOKENDANCE_ID_ALLOWED_REDIRECT_URIS before
// forwarding to the service layer. Returns nil if the URI is allowed or empty
// (the service layer will apply its own fallback and comprehensive validation).
func validateRedirectURI(redirectURI, deviceType string) error {
	if redirectURI == "" {
		return nil // service layer applies fallback RedirectURI
	}

	allowedURIs := handlerAllowedRedirectURIs()
	if len(allowedURIs) == 0 {
		return nil // no allowlist configured; defer to service layer
	}

	parsed, err := url.Parse(redirectURI)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" || parsed.Fragment != "" {
		return errors.New("redirect_uri must be an absolute http(s) URL without fragment")
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return errors.New("redirect_uri must use http or https")
	}
	normalized := parsed.String()

	for _, allowed := range allowedURIs {
		if allowed == normalized {
			return nil
		}
		// For desktop and CLI, allow loopback redirect port variations.
		if (deviceType == "desktop" || deviceType == "cli") && handlerLoopbackRedirectMatch(allowed, normalized) {
			return nil
		}
	}

	return errors.New("redirect_uri is not allowed for this TokenDance ID client")
}

// handlerAllowedRedirectURIs builds the list of allowed redirect URIs from
// environment variables, matching the config-layer resolution order:
// primary AGENTHUB_TOKENDANCE_ID_REDIRECT_URI plus the comma-separated
// AGENTHUB_TOKENDANCE_ID_ALLOWED_REDIRECT_URIS (and legacy names).
func handlerAllowedRedirectURIs() []string {
	var candidates []string

	// Include the primary fallback redirect URI first.
	if fallback := os.Getenv("AGENTHUB_TOKENDANCE_ID_REDIRECT_URI"); fallback != "" {
		candidates = append(candidates, strings.TrimSpace(fallback))
	}
	if fallback := os.Getenv("AGENTHUB_TOKENDANCE_REDIRECT_URI"); fallback != "" {
		candidates = append(candidates, strings.TrimSpace(fallback))
	}

	// Include the explicitly allowed redirect URIs.
	if allowedRaw := os.Getenv("AGENTHUB_TOKENDANCE_ID_ALLOWED_REDIRECT_URIS"); allowedRaw != "" {
		candidates = append(candidates, splitCommaTrimmed(allowedRaw)...)
	} else if allowedRaw := os.Getenv("AGENTHUB_TOKENDANCE_ALLOWED_REDIRECT_URIS"); allowedRaw != "" {
		candidates = append(candidates, splitCommaTrimmed(allowedRaw)...)
	}

	// Deduplicate.
	seen := make(map[string]struct{}, len(candidates))
	result := make([]string, 0, len(candidates))
	for _, c := range candidates {
		if _, ok := seen[c]; !ok {
			seen[c] = struct{}{}
			result = append(result, c)
		}
	}
	return result
}

// splitCommaTrimmed splits a comma-separated string and trims whitespace from each part.
func splitCommaTrimmed(s string) []string {
	parts := strings.Split(s, ",")
	result := make([]string, 0, len(parts))
	for _, p := range parts {
		if trimmed := strings.TrimSpace(p); trimmed != "" {
			result = append(result, trimmed)
		}
	}
	return result
}

// handlerLoopbackRedirectMatch mirrors the service-layer oidcLoopbackRedirectMatch
// for defense-in-depth validation at the handler level. It matches a registered
// loopback redirect (e.g. http://127.0.0.1/callback) against a requested redirect
// that differs only in port number (e.g. http://127.0.0.1:8400/callback).
func handlerLoopbackRedirectMatch(registered, requested string) bool {
	regURL, err := url.Parse(registered)
	if err != nil {
		return false
	}
	reqURL, err := url.Parse(requested)
	if err != nil {
		return false
	}
	if regURL.Scheme != "http" || reqURL.Scheme != "http" {
		return false
	}
	if regURL.User != nil || reqURL.User != nil {
		return false
	}
	if regURL.Fragment != "" || reqURL.Fragment != "" {
		return false
	}
	if regURL.Port() != "" || reqURL.Port() == "" {
		return false
	}
	port, err := strconv.Atoi(reqURL.Port())
	if err != nil || port < 1 || port > 65535 {
		return false
	}
	if regURL.EscapedPath() != reqURL.EscapedPath() || regURL.RawQuery != reqURL.RawQuery {
		return false
	}
	regIP := net.ParseIP(regURL.Hostname())
	reqIP := net.ParseIP(reqURL.Hostname())
	if regIP == nil || reqIP == nil || !regIP.IsLoopback() || !reqIP.IsLoopback() {
		return false
	}
	return regIP.Equal(reqIP)
}
