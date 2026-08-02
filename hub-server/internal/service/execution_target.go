package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"strings"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/agenthub/hub-server/internal/egress"
	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
	"github.com/agenthub/hub-server/internal/service/dispatch"
)

// ExecutionTargetService handles CRUD for execution targets.
type ExecutionTargetService struct {
	db     *gorm.DB
	cache  ExecutionTargetCache
	egress *egress.Client
}

// ExecutionTargetCache is the subset of *cache.Client methods used by ExecutionTargetService.
type ExecutionTargetCache interface {
	IsOnline(ctx context.Context, userID string) (bool, error)
}

// TargetListResult holds paginated execution target results.
type TargetListResult struct {
	Items   []model.ExecutionTarget `json:"items"`
	HasMore bool                    `json:"has_more"`
	Cursor  string                  `json:"next_cursor,omitempty"`
}

// NewExecutionTargetService wires the fail-closed egress policy (#1540):
// outbound pings use the canonical egress transport and refuse restricted
// networks unless the administrator allowlisted them.
func NewExecutionTargetService(db *gorm.DB, egressCfg egress.Config) (*ExecutionTargetService, error) {
	c, err := egress.New(egressCfg)
	if err != nil {
		return nil, fmt.Errorf("execution target service: %w", err)
	}
	return &ExecutionTargetService{db: db, egress: c}, nil
}

// SetCache injects an optional cache client for hub_relay health checks.
func (s *ExecutionTargetService) SetCache(cache ExecutionTargetCache) {
	s.cache = cache
}

func (s *ExecutionTargetService) Create(ctx context.Context, ownerID string, req *model.ExecutionTarget) (*model.ExecutionTarget, error) {
	if req.Name == "" {
		return nil, errcode.ErrBadRequest
	}
	if healthState := strings.TrimSpace(req.HealthState); healthState != "" && healthState != "unknown" {
		return nil, errcode.ErrBadRequest.WithMessage("health_state is system-managed")
	}
	normalizeExecutionTargetDefaults(req)
	if err := req.Validate(); err != nil {
		return nil, errcode.ErrBadRequest.WithMessage(err.Error())
	}
	if req.DeviceID != nil {
		if err := requireDeviceBelongsToOwner(ctx, s.db, ownerID, *req.DeviceID, ""); err != nil {
			return nil, err
		}
	}

	existing, err := repository.FindTargetByOwnerAndName(s.db, ownerID, req.Name)
	if err == nil && existing != nil {
		return nil, errcode.UserInvalidParam.WithMessage("execution target name already exists")
	}
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}

	req.OwnerID = ownerID
	req.ID = ""
	if err := repository.CreateExecutionTarget(s.db, req); err != nil {
		return nil, err
	}
	return req, nil
}

func (s *ExecutionTargetService) UpsertLocalEdgeForDesktopDevice(ctx context.Context, device *model.Device) (*model.ExecutionTarget, error) {
	if device == nil || strings.TrimSpace(device.ID) == "" || strings.TrimSpace(device.UserID) == "" || device.DeviceType != "desktop" {
		return nil, errcode.ErrBadRequest
	}

	now := time.Now()
	capabilities, metadata := desktopDeviceTargetFields(device)
	name := desktopDeviceTargetName(device.ID)

	var result *model.ExecutionTarget
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := requireDeviceBelongsToOwner(ctx, tx, device.UserID, device.ID, "desktop"); err != nil {
			return err
		}

		matches, err := findDesktopLocalEdgeTargetMatches(tx, device.UserID, device.ID, name)
		if err != nil {
			return err
		}

		target, found, err := desktopLocalEdgeTargetFromMatches(matches, device.ID)
		if err != nil {
			return err
		}
		if !found {
			target = model.ExecutionTarget{
				OwnerID:    device.UserID,
				TargetType: "local_edge",
			}
		}

		refreshDesktopLocalEdgeTarget(&target, device, name, capabilities, metadata, now)
		if target.ID == "" {
			created, err := repository.CreateExecutionTargetIfNotExists(tx, &target)
			if err != nil {
				return err
			}
			if !created {
				matches, err := findDesktopLocalEdgeTargetMatches(tx, device.UserID, device.ID, name)
				if err != nil {
					return err
				}
				target, found, err = desktopLocalEdgeTargetFromMatches(matches, device.ID)
				if err != nil {
					return err
				}
				if !found {
					return errcode.UserInvalidParam.WithMessage("local_edge target conflict could not be resolved")
				}
				refreshDesktopLocalEdgeTarget(&target, device, name, capabilities, metadata, now)
				if err := repository.UpdateExecutionTarget(tx, &target); err != nil {
					return err
				}
			}
		} else if err := repository.UpdateExecutionTarget(tx, &target); err != nil {
			return err
		}

		result = &target
		return nil
	})
	if err != nil {
		return nil, err
	}
	return result, nil
}

func findDesktopLocalEdgeTargetMatches(tx *gorm.DB, ownerID, deviceID, name string) ([]model.ExecutionTarget, error) {
	var matches []model.ExecutionTarget
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("owner_id = ? AND target_type = ? AND deleted_at IS NULL AND (device_id = ? OR name = ?)", ownerID, "local_edge", deviceID, name).
		Order("id ASC").
		Find(&matches).Error; err != nil {
		return nil, err
	}
	return matches, nil
}

func desktopLocalEdgeTargetFromMatches(matches []model.ExecutionTarget, deviceID string) (model.ExecutionTarget, bool, error) {
	if len(matches) > 1 {
		return model.ExecutionTarget{}, false, errcode.UserInvalidParam.WithMessage("multiple local_edge targets match desktop device registration")
	}
	if len(matches) == 0 {
		return model.ExecutionTarget{}, false, nil
	}

	target := matches[0]
	if target.DeviceID != nil && *target.DeviceID != deviceID {
		return model.ExecutionTarget{}, false, errcode.UserInvalidParam.WithMessage("generated local_edge target name is bound to another desktop device")
	}
	return target, true, nil
}

func refreshDesktopLocalEdgeTarget(target *model.ExecutionTarget, device *model.Device, name, capabilities, metadata string, now time.Time) {
	target.Name = name
	target.DeviceID = &device.ID
	target.TargetType = "local_edge"
	target.WorkspaceAllowlist = "[]"
	target.TrustLevel = "local"
	target.HealthState = "online"
	target.IsOnline = true
	target.LastSeenAt = &now
	target.Capabilities = capabilities
	target.Metadata = metadata
}

func desktopDeviceTargetName(deviceID string) string {
	shortID := strings.TrimSpace(deviceID)
	if len(shortID) > 8 {
		shortID = shortID[:8]
	}
	if shortID == "" {
		return "Desktop Local Edge"
	}
	return "Desktop Local Edge " + shortID
}

func desktopDeviceTargetFields(device *model.Device) (string, string) {
	var deviceCapabilities []string
	if strings.TrimSpace(device.Capabilities) != "" {
		_ = json.Unmarshal([]byte(device.Capabilities), &deviceCapabilities)
	}
	capabilities, _ := json.Marshal(map[string][]string{
		"device_capabilities": deviceCapabilities,
	})
	metadata, _ := json.Marshal(map[string]string{
		"source":       "desktop_device_registration",
		"device_type":  device.DeviceType,
		"app_version":  device.AppVersion,
		"health_basis": "desktop_check_in_freshness_not_ws_route",
	})
	return string(capabilities), string(metadata)
}

func requireDeviceBelongsToOwner(ctx context.Context, db *gorm.DB, ownerID, deviceID, deviceType string) error {
	deviceID = strings.TrimSpace(deviceID)
	if deviceID == "" {
		return nil
	}
	device, err := repository.GetDeviceByID(db.WithContext(ctx), deviceID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return errcode.AuthDeviceMismatch
		}
		return err
	}
	if device.UserID != ownerID {
		return errcode.AuthDeviceMismatch
	}
	if deviceType != "" && device.DeviceType != deviceType {
		return errcode.AuthDeviceMismatch
	}
	return nil
}

func (s *ExecutionTargetService) Get(ctx context.Context, id, ownerID string) (*model.ExecutionTarget, error) {
	t, err := repository.GetExecutionTargetByID(s.db, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errcode.UserNotFound
		}
		return nil, err
	}
	if t.OwnerID != ownerID {
		return nil, errcode.AuthDeviceMismatch
	}
	applyExecutionTargetHealthProjection(t, time.Now())
	return t, nil
}

func (s *ExecutionTargetService) Update(ctx context.Context, id, ownerID string, req *model.ExecutionTarget) (*model.ExecutionTarget, error) {
	t, err := repository.GetExecutionTargetByID(s.db, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errcode.UserNotFound
		}
		return nil, err
	}
	if t.OwnerID != ownerID {
		return nil, errcode.AuthDeviceMismatch
	}

	if req.Name != "" {
		t.Name = req.Name
	}
	if req.TargetType != "" {
		t.TargetType = req.TargetType
	}
	if req.Host != "" {
		t.Host = req.Host
	}
	if req.Port != 0 {
		t.Port = req.Port
	}
	if req.WorkspaceRoot != "" {
		t.WorkspaceRoot = req.WorkspaceRoot
	}
	if req.WorkspaceAllowlist != "" {
		t.WorkspaceAllowlist = req.WorkspaceAllowlist
	}
	if req.TrustLevel != "" {
		t.TrustLevel = req.TrustLevel
	}
	if strings.TrimSpace(req.HealthState) != "" {
		return nil, errcode.ErrBadRequest.WithMessage("health_state is system-managed")
	}
	if req.AuthMethod != "" {
		t.AuthMethod = req.AuthMethod
	}
	if req.DeviceID != nil {
		if err := requireDeviceBelongsToOwner(ctx, s.db, ownerID, *req.DeviceID, ""); err != nil {
			return nil, err
		}
		t.DeviceID = req.DeviceID
	}
	if req.Capabilities != "" {
		t.Capabilities = req.Capabilities
	}
	if req.Metadata != "" {
		t.Metadata = req.Metadata
	}

	if err := t.Validate(); err != nil {
		return nil, errcode.ErrBadRequest.WithMessage(err.Error())
	}
	if err := repository.UpdateExecutionTarget(s.db, t); err != nil {
		return nil, err
	}
	applyExecutionTargetHealthProjection(t, time.Now())
	return t, nil
}

func normalizeExecutionTargetDefaults(t *model.ExecutionTarget) {
	if t.TargetType == "" {
		t.TargetType = "local_edge"
	}
	if t.WorkspaceAllowlist == "" {
		t.WorkspaceAllowlist = "[]"
	}
	if t.TrustLevel == "" {
		t.TrustLevel = "local"
	}
	if t.HealthState == "" {
		t.HealthState = "unknown"
	}
	if t.Capabilities == "" {
		t.Capabilities = "{}"
	}
	if t.Metadata == "" {
		t.Metadata = "{}"
	}
}

func (s *ExecutionTargetService) Delete(ctx context.Context, id, ownerID string) error {
	t, err := repository.GetExecutionTargetByID(s.db, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return errcode.UserNotFound
		}
		return err
	}
	if t.OwnerID != ownerID {
		return errcode.AuthDeviceMismatch
	}
	return repository.SoftDeleteExecutionTarget(s.db, id, ownerID)
}

func (s *ExecutionTargetService) List(ctx context.Context, ownerID, targetType, cursor string, pageSize int) (*TargetListResult, error) {
	targets, hasMore, err := repository.ListExecutionTargets(s.db, ownerID, targetType, cursor, pageSize)
	if err != nil {
		return nil, err
	}
	now := time.Now()
	for i := range targets {
		applyExecutionTargetHealthProjection(&targets[i], now)
	}
	var nextCursor string
	if hasMore && len(targets) > 0 {
		nextCursor = targets[len(targets)-1].ID
	}
	return &TargetListResult{Items: targets, HasMore: hasMore, Cursor: nextCursor}, nil
}

func applyExecutionTargetHealthProjection(target *model.ExecutionTarget, now time.Time) {
	if target == nil {
		return
	}
	target.HealthState = dispatch.ResolveExecutionTargetHealthState(target, now)
	target.IsOnline = target.HealthState == "online" || target.HealthState == "healthy"
}

func (s *ExecutionTargetService) Ping(ctx context.Context, id, ownerID string) error {
	t, err := repository.GetExecutionTargetByID(s.db, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return errcode.UserNotFound
		}
		return err
	}
	if t.OwnerID != ownerID {
		return errcode.AuthDeviceMismatch
	}

	switch t.TargetType {
	case "local_edge":
		return repository.UpdateTargetOnlineStatus(s.db, id, true)
	case "remote_ssh", "tailscale", "cloud_edge":
		if t.Host == "" {
			return errcode.TargetNotRoutable.WithMessage("execution target has no host configured")
		}
		port := t.Port
		if port == 0 {
			port = 3210
		}
		addr := net.JoinHostPort(t.Host, fmt.Sprintf("%d", port))
		return s.pingEdgeServer(ctx, addr, t.ID)
	case "hub_relay":
		// hub_relay health depends on whether the owner has an active
		// WebSocket connection that can relay tasks.
		if s.cache == nil {
			return errcode.TargetNotRoutable.WithMessage("execution target health proof is not available")
		}
		online, err := s.cache.IsOnline(ctx, t.OwnerID)
		if err != nil || !online {
			_ = repository.UpdateTargetOnlineStatus(s.db, id, false)
			return errcode.TargetNotRoutable.WithMessage("relay route not available: target owner is offline")
		}
		_ = repository.UpdateTargetOnlineStatus(s.db, id, true)
		return nil
	default:
		return errcode.ErrBadRequest.WithMessage("unsupported target_type")
	}
}

// pingEdgeServer performs an HTTP GET /v1/health against the Edge Server
// through the fail-closed egress transport (#1540): default-deny on
// restricted networks (loopback/private/link-local/metadata) unless an
// administrator allowlist covers the address. No credential is attached —
// AuthCredential is not persisted (no secret source), and hub-initiated
// pings must not carry secrets to arbitrary targets.
func (s *ExecutionTargetService) pingEdgeServer(ctx context.Context, addr, targetID string) error {
	// Scheme comes from the egress policy: https default, plain http only
	// with explicit egress.allow_plain_http (trusted local policy).
	url := s.egress.Scheme() + "://" + addr + "/v1/health"

	resp, err := s.egress.Get(ctx, url)
	if err != nil {
		slog.Debug("execution target ping failed", "target_id", targetID, "addr", addr, "error", err)
		_ = repository.UpdateTargetOnlineStatus(s.db, targetID, false)
		return errcode.TargetNotRoutable.WithMessage("ping failed: " + err.Error())
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 64*1024))
		if observedTargetID := observedTargetIDFromHealthBody(body); observedTargetID != "" && observedTargetID != targetID {
			_ = repository.UpdateTargetHealthState(s.db, targetID, "mismatch", false)
			return errcode.TargetNotRoutable.WithMessage("execution target health mismatch")
		}
		_ = repository.UpdateTargetOnlineStatus(s.db, targetID, true)
		return nil
	}

	_ = repository.UpdateTargetOnlineStatus(s.db, targetID, false)
	return errcode.TargetNotRoutable.WithMessage(fmt.Sprintf("ping returned HTTP %d", resp.StatusCode))
}

func observedTargetIDFromHealthBody(body []byte) string {
	if len(body) == 0 {
		return ""
	}
	var raw map[string]any
	if err := json.Unmarshal(body, &raw); err != nil {
		return ""
	}
	for _, key := range []string{"target_id", "targetId"} {
		if value, ok := raw[key].(string); ok && strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	data, ok := raw["data"].(map[string]any)
	if !ok {
		return ""
	}
	for _, key := range []string{"target_id", "targetId"} {
		if value, ok := data[key].(string); ok && strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
