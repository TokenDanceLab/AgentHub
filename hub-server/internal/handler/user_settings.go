package handler

import (
	"errors"
	"log/slog"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/service/usersettings"
	"github.com/gin-gonic/gin"
)

// UserSettingsService is the interface used by UserSettingsHandler.
type UserSettingsService interface {
	GetSettings(userID string) (map[string]string, error)
	UpsertSettings(userID string, values map[string]string) (map[string]string, error)
}

// UserSettingsHandler handles user settings CRUD.
type UserSettingsHandler struct {
	settingsService UserSettingsService
}

// NewUserSettingsHandler creates a new handler.
func NewUserSettingsHandler(settingsService UserSettingsService) *UserSettingsHandler {
	return &UserSettingsHandler{settingsService: settingsService}
}

// GetSettings returns all settings for the authenticated user.
func (h *UserSettingsHandler) GetSettings(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		Fail(c, errcode.ErrUnauthorized)
		return
	}

	settings, err := h.settingsService.GetSettings(userID)
	if err != nil {
		slog.Error("GetSettings failed", "error", err)
		Fail(c, errcode.ErrInternal)
		return
	}

	if settings == nil {
		settings = map[string]string{}
	}
	OK(c, settings)
}

type patchSettingsRequest struct {
	Values map[string]string `json:"values" binding:"required"`
}

// PatchSettings upserts settings for the authenticated user.
func (h *UserSettingsHandler) PatchSettings(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		Fail(c, errcode.ErrUnauthorized)
		return
	}

	var req patchSettingsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, errcode.ErrBadRequest)
		return
	}

	settings, err := h.settingsService.UpsertSettings(userID, req.Values)
	if err != nil {
		var e *errcode.Error
		if errors.As(err, &e) {
			Fail(c, e)
			return
		}
		slog.Error("PatchSettings failed", "error", err)
		Fail(c, errcode.ErrInternal)
		return
	}

	if settings == nil {
		settings = map[string]string{}
	}
	OK(c, settings)
}

// Ensure UserSettingsService satisfies the interface at compile time.
var _ UserSettingsService = (*usersettings.Service)(nil)
