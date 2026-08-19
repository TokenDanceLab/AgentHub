package handler

import (
	"encoding/json"
	"errors"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/jwtutil"
	"github.com/agenthub/hub-server/internal/model"
)

// DeviceService is the subset of *device.Service used by DeviceHandler.
type DeviceService interface {
	Register(deviceID, userID, deviceType, appVersion string, capabilities []string) (*model.Device, error)
	ListDevices(userID string) ([]model.Device, error)
}

type DeviceHandler struct {
	deviceService DeviceService
	jwtSecret     string
	jwtTTL        time.Duration
}

func NewDeviceHandler(deviceService DeviceService) *DeviceHandler {
	return &DeviceHandler{deviceService: deviceService}
}

// SetJWTConfig injects the JWT secret and TTL for cloud edge registration.
func (h *DeviceHandler) SetJWTConfig(secret string, ttl time.Duration) {
	h.jwtSecret = secret
	h.jwtTTL = ttl
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
		var e *errcode.Error
		if errors.As(err, &e) {
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

// cloudEdgeRegisterReq is the request body for POST /cloud/edge/register.
type cloudEdgeRegisterReq struct {
	DeviceID     string   `json:"device_id" binding:"required"`
	Name         string   `json:"name"`
	Host         string   `json:"host"`
	Port         int      `json:"port"`
	AppVersion   string   `json:"app_version"`
	Capabilities []string `json:"capabilities"`
}

// cloudEdgeRegisterResp is the response for POST /cloud/edge/register.
type cloudEdgeRegisterResp struct {
	DeviceID   string `json:"device_id"`
	DeviceType string `json:"device_type"`
	JWT        string `json:"jwt"`
}

// CloudEdgeRegister handles POST /cloud/edge/register.
// It registers a cloud-hosted Edge server and issues an Edge-scoped JWT for
// Edge API authentication.
func (h *DeviceHandler) CloudEdgeRegister(c *gin.Context) {
	if h.jwtSecret == "" {
		Fail(c, errcode.ErrInternal.WithMessage("JWT secret not configured for cloud edge registration"))
		return
	}

	var req cloudEdgeRegisterReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, errcode.ErrBadRequest)
		return
	}

	deviceID, ok := normalizeUUID(req.DeviceID)
	if !ok {
		FailWithMessage(c, errcode.ErrBadRequest, "device_id must be a UUID")
		return
	}

	userID := c.GetString("user_id")

	device, err := h.deviceService.Register(deviceID, userID, "cloud_edge", req.AppVersion, req.Capabilities)
	if err != nil {
		var e *errcode.Error
		if errors.As(err, &e) {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}

	ttl := h.jwtTTL
	if ttl == 0 {
		ttl = 24 * time.Hour
	}
	cloudJWT, err := jwtutil.GenerateEdgeToken(userID, device.ID, h.jwtSecret, ttl)
	if err != nil {
		Fail(c, errcode.ErrInternal.WithMessage("failed to generate cloud edge JWT"))
		return
	}

	OK(c, cloudEdgeRegisterResp{
		DeviceID:   device.ID,
		DeviceType: "cloud_edge",
		JWT:        cloudJWT,
	})
}
