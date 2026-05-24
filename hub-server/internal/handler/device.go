package handler

import (
<<<<<<< HEAD
	"encoding/json"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"github.com/agenthub/server-hub/internal/errcode"
	"github.com/agenthub/server-hub/internal/model"
	"github.com/agenthub/server-hub/internal/repository"
)

type DeviceHandler struct {
	db *gorm.DB
}

func NewDeviceHandler(db *gorm.DB) *DeviceHandler {
	return &DeviceHandler{db: db}
=======
	"github.com/gin-gonic/gin"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
)

// DeviceService is the subset of *service.DeviceService used by DeviceHandler.
type DeviceService interface {
	Register(deviceID, userID, deviceType, appVersion string, capabilities []string) (*model.Device, error)
}

type DeviceHandler struct {
	deviceService DeviceService
}

func NewDeviceHandler(deviceService DeviceService) *DeviceHandler {
	return &DeviceHandler{deviceService: deviceService}
>>>>>>> origin/master
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

<<<<<<< HEAD
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
=======
	device, err := h.deviceService.Register(req.DeviceID, userID, deviceType, req.AppVersion, req.Capabilities)
	if err != nil {
		if e, ok := err.(*errcode.Error); ok {
			Fail(c, e)
			return
		}
>>>>>>> origin/master
		Fail(c, errcode.ErrInternal)
		return
	}

	OK(c, device)
}
