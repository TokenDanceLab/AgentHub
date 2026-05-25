package handler

import (
	"context"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/service"
	"github.com/gin-gonic/gin"
)

// OIDCService is the subset of *service.OIDCService used by OIDCHandler.
type OIDCService interface {
	GenerateAuthorizationURL(ctx context.Context, codeChallenge, codeChallengeMethod, deviceType, deviceID string) (*service.AuthorizationResult, error)
	HandleCallback(ctx context.Context, code, state, codeVerifier, deviceType, deviceID string) (*service.CallbackResult, error)
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
}

func (h *OIDCHandler) PostOIDCAuthorize(c *gin.Context) {
	var req oidcAuthorizeReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, errcode.ErrBadRequest)
		return
	}
	result, err := h.svc.GenerateAuthorizationURL(c.Request.Context(),
		req.CodeChallenge, req.CodeChallengeMethod, req.DeviceType, req.DeviceID)
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
}

func (h *OIDCHandler) PostOIDCCallback(c *gin.Context) {
	var req oidcCallbackReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, errcode.ErrBadRequest)
		return
	}
	result, err := h.svc.HandleCallback(c.Request.Context(),
		req.Code, req.State, req.CodeVerifier, req.DeviceType, req.DeviceID)
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
