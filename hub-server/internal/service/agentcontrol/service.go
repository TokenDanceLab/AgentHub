package agentcontrol

import (
	"context"
	"encoding/json"
	"log/slog"
	"strings"

	"github.com/agenthub/hub-server/internal/cache"
	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/ws"
)

// CachePort is the subset of *cache.Client used for routing and queuing
// Hub control commands to desktop/edge devices.
type CachePort interface {
	GetRouteForDevice(ctx context.Context, userID, deviceType, deviceID string) (string, error)
	PushPendingAgentControl(ctx context.Context, userID, deviceID, controlJSON string) error
}

// Service delivers Hub control commands to the exact Desktop/Edge
// device that owns the local Edge run.
type Service struct {
	cacheClient CachePort
	mgr         *ws.Manager
}

func NewService(cacheClient CachePort, mgr *ws.Manager) *Service {
	return &Service{
		cacheClient: resolveAgentControlCache(cacheClient),
		mgr:         mgr,
	}
}

func resolveAgentControlCache(c CachePort) CachePort {
	if c == nil {
		return cache.NoOpCache{}
	}
	return c
}

func (s *Service) DeliverToDesktopDevice(ctx context.Context, userID, deviceID string, payload model.AgentControlPayload) error {
	userID = strings.TrimSpace(userID)
	deviceID = strings.TrimSpace(deviceID)
	if userID == "" || deviceID == "" || strings.TrimSpace(payload.Kind) == "" {
		return errcode.ErrBadRequest
	}
	payload.EdgeDeviceID = deviceID

	payloadJSON, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	queueControl := func(reason string, routeErr error) error {
		if err := s.cacheClient.PushPendingAgentControl(ctx, userID, deviceID, string(payloadJSON)); err != nil {
			slog.Error("failed to queue agent control", "user_id", userID, "device_id", deviceID, "kind", payload.Kind, "reason", reason, "error", err)
			return err
		}
		if routeErr != nil {
			slog.Info("queued agent control", "user_id", userID, "device_id", deviceID, "kind", payload.Kind, "reason", reason, "error", routeErr)
		}
		return nil
	}

	connID, err := s.cacheClient.GetRouteForDevice(ctx, userID, "desktop", deviceID)
	if err != nil || connID == "" || s.mgr == nil {
		return queueControl("route unavailable", err)
	}
	conn := s.mgr.FindByConnID(connID)
	if conn == nil || conn.UserID != userID || conn.DeviceType != "desktop" || conn.DeviceID != deviceID {
		return queueControl("connection mismatch", nil)
	}
	result := s.mgr.PushToConn(connID, ws.NewFrame(ws.TypeAgentControl, json.RawMessage(payloadJSON)))
	if !result.Queued {
		slog.Warn("agent control delivery not queued; preserving pending control", "user_id", userID, "device_id", deviceID, "conn_id", connID, "kind", payload.Kind, "delivery_status", result.Status, "error", result.Err)
		return queueControl("delivery not queued", result.Err)
	}
	return nil
}
