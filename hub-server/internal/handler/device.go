package handler

import (
	"encoding/json"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
)

type DeviceHandler struct {
	db *gorm.DB
}

func NewDeviceHandler(db *gorm.DB) *DeviceHandler {
	return &DeviceHandler{db: db}
}

type registerDeviceReq struct {
	DeviceID     string   `json:"device_id" binding:"required"`
	AppVersion   string   `json:"app_version"`
	Capabilities []string `json:"capabilities"`
}

func (h *DeviceHandler) Register(c *gin.Context) {
	var req registerDeviceReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, errcode.ErrBadRequest)
		return
	}

	userID := c.GetString("user_id")
	deviceType := c.GetString("device_type")

	capsBytes, _ := json.Marshal(req.Capabilities)

	device := &model.Device{
		ID:           req.DeviceID,
		UserID:       userID,
		DeviceType:   deviceType,
		AppVersion:   req.AppVersion,
		Capabilities: string(capsBytes),
		LastActiveAt: time.Now(),
	}

	if err := repository.UpsertDevice(h.db, device); err != nil {
		Fail(c, errcode.ErrInternal)
		return
	}

	OK(c, device)
}
