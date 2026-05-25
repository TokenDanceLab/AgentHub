package handler

import (
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
	deviceID, ok := normalizeUUID(req.DeviceID)
	if !ok {
		FailWithMessage(c, errcode.ErrBadRequest, "device_id must be a UUID")
		return
	}
	req.DeviceID = deviceID

	userID := c.GetString("user_id")
	deviceType := c.GetString("device_type")

	device, err := h.deviceService.Register(req.DeviceID, userID, deviceType, req.AppVersion, req.Capabilities)
	if err != nil {
		if e, ok := err.(*errcode.Error); ok {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}

	OK(c, device)
}
