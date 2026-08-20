package handler

import (
	"context"
	"errors"
	"log/slog"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/middleware"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/service/auth"
	"github.com/gin-gonic/gin"
)

// AuthService is the subset of *auth.Service used by AuthHandler.
type AuthService interface {
	RefreshToken(ctx context.Context, rawRefreshToken string) (*auth.LoginResponse, error)
	Logout(ctx context.Context, userID, deviceID, deviceType, accessJTI string) error
	GetMe(ctx context.Context, userID string) (*model.User, error)
	UpdateProfile(ctx context.Context, userID, nickname, avatarURL string) (*model.User, error)
}

type AuthHandler struct {
	service AuthService
}

func NewAuthHandler(s AuthService) *AuthHandler {
	return &AuthHandler{service: s}
}

type refreshReq struct {
	RefreshToken string `json:"refresh_token" binding:"required"`
}

func (h *AuthHandler) Refresh(c *gin.Context) {
	var req refreshReq
	if err := c.ShouldBindJSON(&req); err != nil {
		slog.Error("auth refresh bind error", "request_id", middleware.GetRequestID(c), "error", err)
		Fail(c, errcode.ErrBadRequest)
		return
	}
	resp, err := h.service.RefreshToken(c.Request.Context(), req.RefreshToken)
	if err != nil {
		slog.Error("auth refresh token error", "request_id", middleware.GetRequestID(c), "error", err)
		var e *errcode.Error
		if errors.As(err, &e) {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, resp)
}

func (h *AuthHandler) Logout(c *gin.Context) {
	userID := c.GetString("user_id")
	deviceID := c.GetString("device_id")
	// Scope revocation by device_type if provided as a query parameter (#149).
	deviceType := c.Query("device_type")
	// access_jti is set by AuthMiddleware after ParseToken (#888).
	accessJTI := c.GetString("access_jti")
	if err := h.service.Logout(c.Request.Context(), userID, deviceID, deviceType, accessJTI); err != nil {
		slog.Error("auth logout error", "request_id", middleware.GetRequestID(c), "error", err)
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, nil)
}

func (h *AuthHandler) Me(c *gin.Context) {
	userID := c.GetString("user_id")
	user, err := h.service.GetMe(c.Request.Context(), userID)
	if err != nil {
		slog.Error("auth get me error", "request_id", middleware.GetRequestID(c), "error", err)
		var e *errcode.Error
		if errors.As(err, &e) {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, user)
}

type updateProfileReq struct {
	Nickname  string `json:"nickname"`
	AvatarURL string `json:"avatar_url"`
}

func (h *AuthHandler) UpdateProfile(c *gin.Context) {
	var req updateProfileReq
	if err := c.ShouldBindJSON(&req); err != nil {
		slog.Error("auth update profile bind error", "request_id", middleware.GetRequestID(c), "error", err)
		Fail(c, errcode.ErrBadRequest)
		return
	}
	userID := c.GetString("user_id")
	user, err := h.service.UpdateProfile(c.Request.Context(), userID, req.Nickname, req.AvatarURL)
	if err != nil {
		slog.Error("auth update profile error", "request_id", middleware.GetRequestID(c), "error", err)
		var e *errcode.Error
		if errors.As(err, &e) {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, user)
}
