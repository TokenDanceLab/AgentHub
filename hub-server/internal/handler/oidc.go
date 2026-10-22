package handler

import (
	"context"
	"errors"
	"log/slog"
	"net/url"
	"strings"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/middleware"
	"github.com/agenthub/hub-server/internal/service/oidc"
	"github.com/gin-gonic/gin"
)

type OIDCService interface {
	GenerateAuthorizationURL(ctx context.Context, codeChallenge, codeChallengeMethod, deviceType, deviceID, redirectURI string) (*oidc.AuthorizationResult, error)
	HandleCallback(ctx context.Context, code, state, codeVerifier, issuer, deviceType, deviceID, redirectURI string) (*oidc.CallbackResult, error)
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
		slog.Warn("account_oidc.authorize.bind_failed", "request_id", middleware.GetRequestID(c))
		Fail(c, errcode.ErrBadRequest)
		return
	}
	deviceType, ok := normalizeOIDCDeviceType(req.DeviceType)
	if !ok {
		FailWithMessage(c, errcode.ErrBadRequest, "device_type must be one of desktop, web, cli, mobile")
		return
	}
	deviceID, ok := normalizeUUID(req.DeviceID)
	if !ok {
		FailWithMessage(c, errcode.ErrBadRequest, "device_id must be a UUID")
		return
	}
	redirectURI := strings.TrimSpace(req.RedirectURI)
	if err := validateAccountRedirectURI(redirectURI); err != nil {
		FailWithMessage(c, errcode.ErrBadRequest, "redirect_uri is not allowed")
		return
	}
	result, err := h.service.GenerateAuthorizationURL(
		c.Request.Context(),
		req.CodeChallenge,
		req.CodeChallengeMethod,
		deviceType,
		deviceID,
		redirectURI,
	)
	if err != nil {
		logOIDCServiceError(c, "account_oidc.authorize.failed", err)
		handleOIDCServiceError(c, err)
		return
	}
	OK(c, result)
}

type oidcCallbackReq struct {
	Code         string `json:"code" binding:"required"`
	State        string `json:"state" binding:"required"`
	Issuer       string `json:"iss" binding:"required"`
	CodeVerifier string `json:"code_verifier" binding:"required"`
	DeviceType   string `json:"device_type" binding:"required"`
	DeviceID     string `json:"device_id" binding:"required"`
	RedirectURI  string `json:"redirect_uri"`
}

func (h *OIDCHandler) PostOIDCCallback(c *gin.Context) {
	var req oidcCallbackReq
	if err := c.ShouldBindJSON(&req); err != nil {
		slog.Warn("account_oidc.callback.bind_failed", "request_id", middleware.GetRequestID(c))
		Fail(c, errcode.ErrBadRequest)
		return
	}
	h.handleCallback(c, req)
}

func (h *OIDCHandler) handleCallback(c *gin.Context, req oidcCallbackReq) {
	deviceType, ok := normalizeOIDCDeviceType(req.DeviceType)
	if !ok {
		FailWithMessage(c, errcode.ErrBadRequest, "device_type must be one of desktop, web, cli, mobile")
		return
	}
	deviceID, ok := normalizeUUID(req.DeviceID)
	if !ok {
		FailWithMessage(c, errcode.ErrBadRequest, "device_id must be a UUID")
		return
	}
	redirectURI := strings.TrimSpace(req.RedirectURI)
	if err := validateAccountRedirectURI(redirectURI); err != nil {
		FailWithMessage(c, errcode.ErrBadRequest, "redirect_uri is not allowed")
		return
	}
	result, err := h.service.HandleCallback(
		c.Request.Context(),
		req.Code,
		req.State,
		req.CodeVerifier,
		req.Issuer,
		deviceType,
		deviceID,
		redirectURI,
	)
	if err != nil {
		logOIDCServiceError(c, "account_oidc.callback.failed", err)
		handleOIDCServiceError(c, err)
		return
	}
	OK(c, result)
}

func logOIDCServiceError(c *gin.Context, message string, err error) {
	if safeErr := safeOIDCServiceError(err); safeErr != nil {
		slog.Warn(message, "request_id", middleware.GetRequestID(c), "error_code", safeErr.Code)
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
	case errcode.OIDCIssuerInvalid.Code:
		return errcode.OIDCIssuerInvalid
	case errcode.OIDCCodeExchangeFailed.Code:
		return errcode.OIDCCodeExchangeFailed
	case errcode.OIDCIDTokenInvalid.Code:
		return errcode.OIDCIDTokenInvalid
	case errcode.OIDCSubNotFound.Code:
		return errcode.OIDCSubNotFound
	case errcode.OIDCUserInfoInvalid.Code:
		return errcode.OIDCUserInfoInvalid
	case errcode.OIDCIdentityRetired.Code:
		return errcode.OIDCIdentityRetired
	default:
		return e
	}
}

func normalizeOIDCDeviceType(value string) (string, bool) {
	switch strings.TrimSpace(value) {
	case "desktop", "web", "cli", "mobile":
		return strings.TrimSpace(value), true
	default:
		return "", false
	}
}

func validateAccountRedirectURI(redirectURI string) error {
	if redirectURI == "" {
		return nil
	}
	parsed, err := url.Parse(redirectURI)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" || parsed.User != nil || parsed.Fragment != "" {
		return errors.New("redirect_uri must be an absolute URL without credentials or fragment")
	}
	if !isHTTPSOrLoopbackHTTP(parsed.Scheme, parsed.Hostname()) {
		return errors.New("redirect_uri must use https outside loopback")
	}
	return nil
}

func isLoopbackRedirectHost(host string) bool {
	return host == "localhost" || host == "127.0.0.1" || host == "::1"
}

func isHTTPSOrLoopbackHTTP(scheme, host string) bool {
	return scheme == "https" || (scheme == "http" && isLoopbackRedirectHost(host))
}
