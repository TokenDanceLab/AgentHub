package handler

import (
	"github.com/gin-gonic/gin"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/service"
)

type DeviceHandler struct {
	deviceService *service.DeviceService
}

func NewDeviceHandler(deviceService *service.DeviceService) *DeviceHandler {
	return &DeviceHandler{deviceService: deviceService}
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

	device, err := h.deviceService.Register(req.DeviceID, userID, deviceType, req.AppVersion, req.Capabilities)
	if err != nil {
		Fail(c, errcode.ErrInternal)
		return
	}

	OK(c, device)
}
