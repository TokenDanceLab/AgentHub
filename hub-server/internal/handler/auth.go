package handler

import (
	"github.com/gin-gonic/gin"
	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/service"
)

type AuthHandler struct {
	service *service.AuthService
}

func NewAuthHandler(s *service.AuthService) *AuthHandler {
	return &AuthHandler{service: s}
}

type registerReq struct {
	Username string `json:"username" binding:"required"`
	Password string `json:"password" binding:"required"`
	Nickname string `json:"nickname" binding:"required"`
}

func (h *AuthHandler) Register(c *gin.Context) {
	var req registerReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, errcode.ErrBadRequest)
		return
	}
	user, err := h.service.Register(c.Request.Context(), req.Username, req.Password, req.Nickname)
	if err != nil {
		if e, ok := err.(*errcode.Error); ok {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, gin.H{"user_id": user.ID})
}

type loginReq struct {
	Username   string `json:"username" binding:"required"`
	Password   string `json:"password" binding:"required"`
	DeviceType string `json:"device_type" binding:"required"`
	DeviceID   string `json:"device_id" binding:"required"`
}

func (h *AuthHandler) Login(c *gin.Context) {
	var req loginReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, errcode.ErrBadRequest)
		return
	}
	resp, err := h.service.Login(c.Request.Context(), req.Username, req.Password, req.DeviceType, req.DeviceID)
	if err != nil {
		if e, ok := err.(*errcode.Error); ok {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, resp)
}

type refreshReq struct {
	RefreshToken string `json:"refresh_token" binding:"required"`
}

func (h *AuthHandler) Refresh(c *gin.Context) {
	var req refreshReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, errcode.ErrBadRequest)
		return
	}
	resp, err := h.service.RefreshToken(c.Request.Context(), req.RefreshToken)
	if err != nil {
		if e, ok := err.(*errcode.Error); ok {
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
	if err := h.service.Logout(c.Request.Context(), userID, deviceID); err != nil {
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, nil)
}

func (h *AuthHandler) Me(c *gin.Context) {
	userID := c.GetString("user_id")
	user, err := h.service.GetMe(c.Request.Context(), userID)
	if err != nil {
		if e, ok := err.(*errcode.Error); ok {
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
		Fail(c, errcode.ErrBadRequest)
		return
	}
	userID := c.GetString("user_id")
	user, err := h.service.UpdateProfile(c.Request.Context(), userID, req.Nickname, req.AvatarURL)
	if err != nil {
		if e, ok := err.(*errcode.Error); ok {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, user)
}

type changePasswordReq struct {
	OldPassword string `json:"old_password" binding:"required"`
	NewPassword string `json:"new_password" binding:"required"`
}

func (h *AuthHandler) ChangePassword(c *gin.Context) {
	var req changePasswordReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, errcode.ErrBadRequest)
		return
	}
	userID := c.GetString("user_id")
	if err := h.service.ChangePassword(c.Request.Context(), userID, req.OldPassword, req.NewPassword); err != nil {
		if e, ok := err.(*errcode.Error); ok {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, nil)
}
