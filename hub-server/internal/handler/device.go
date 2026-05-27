package handler

import (
	"encoding/json"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
)

// DeviceService is the subset of *service.DeviceService used by DeviceHandler.
type DeviceService interface {
	Register(deviceID, userID, deviceType, appVersion string, capabilities []string) (*model.Device, error)
	ListDevices(userID string) ([]model.Device, error)
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

type deviceResponse struct {
	ID           string    `json:"id"`
	UserID       string    `json:"user_id"`
	DeviceType   string    `json:"device_type"`
	AppVersion   string    `json:"app_version"`
	Capabilities []string  `json:"capabilities"`
	LastActiveAt time.Time `json:"last_active_at"`
	CreatedAt    time.Time `json:"created_at"`
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
	jwtDeviceID := c.GetString("device_id")

	// Cross-validate that the JWT's device_id matches the registration request.
	// A JWT issued for device X must not be abused to register device Y.
	if jwtDeviceID != "" && jwtDeviceID != req.DeviceID {
		FailWithMessage(c, errcode.ErrBadRequest, "device_id does not match JWT claims")
		return
	}

	device, err := h.deviceService.Register(req.DeviceID, userID, deviceType, req.AppVersion, req.Capabilities)
	if err != nil {
		if e, ok := err.(*errcode.Error); ok {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}

	OK(c, newDeviceResponse(device))
}

// ListDevices returns all devices belonging to the authenticated user,
// including their capability metadata.
func (h *DeviceHandler) ListDevices(c *gin.Context) {
	userID := c.GetString("user_id")

	devices, err := h.deviceService.ListDevices(userID)
	if err != nil {
		Fail(c, errcode.ErrInternal)
		return
	}

	// Always return a non-null array
	if devices == nil {
		devices = []model.Device{}
	}

	resp := make([]deviceResponse, 0, len(devices))
	for i := range devices {
		resp = append(resp, newDeviceResponse(&devices[i]))
	}
	OK(c, resp)
}

func newDeviceResponse(device *model.Device) deviceResponse {
	capabilities := []string{}
	if device.Capabilities != "" {
		_ = json.Unmarshal([]byte(device.Capabilities), &capabilities)
	}
	return deviceResponse{
		ID:           device.ID,
		UserID:       device.UserID,
		DeviceType:   device.DeviceType,
		AppVersion:   device.AppVersion,
		Capabilities: capabilities,
		LastActiveAt: device.LastActiveAt,
		CreatedAt:    device.CreatedAt,
	}
}
