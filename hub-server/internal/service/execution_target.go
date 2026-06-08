package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"time"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
)

// ExecutionTargetService handles CRUD for execution targets.
type ExecutionTargetService struct {
	db    *gorm.DB
	cache ExecutionTargetCache
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

func NewExecutionTargetService(db *gorm.DB) *ExecutionTargetService {
	return &ExecutionTargetService{db: db}
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

	var conflicting model.ExecutionTarget
	err := s.db.WithContext(ctx).
		Where("device_id = ? AND target_type = ? AND owner_id <> ? AND deleted_at IS NULL", device.ID, "local_edge", device.UserID).
		First(&conflicting).Error
	if err == nil {
		return nil, errcode.AuthDeviceMismatch
	}
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}

	now := time.Now()
	capabilities, metadata := desktopDeviceTargetFields(device)
	name := desktopDeviceTargetName(device.ID)

	var target model.ExecutionTarget
	err = s.db.WithContext(ctx).
		Where("owner_id = ? AND device_id = ? AND target_type = ? AND deleted_at IS NULL", device.UserID, device.ID, "local_edge").
		Order("id ASC").
		First(&target).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	if errors.Is(err, gorm.ErrRecordNotFound) {
		target = model.ExecutionTarget{
			OwnerID:            device.UserID,
			DeviceID:           &device.ID,
			Name:               name,
			TargetType:         "local_edge",
			WorkspaceAllowlist: "[]",
			TrustLevel:         "local",
			HealthState:        "healthy",
			IsOnline:           true,
			LastSeenAt:         &now,
			Capabilities:       capabilities,
			Metadata:           metadata,
		}
		if err := repository.CreateExecutionTarget(s.db.WithContext(ctx), &target); err != nil {
			return nil, err
		}
		return &target, nil
	}

	target.Name = name
	target.DeviceID = &device.ID
	target.TargetType = "local_edge"
	target.WorkspaceAllowlist = "[]"
	target.TrustLevel = "local"
	target.HealthState = "healthy"
	target.IsOnline = true
	target.LastSeenAt = &now
	target.Capabilities = capabilities
	target.Metadata = metadata
	if err := repository.UpdateExecutionTarget(s.db.WithContext(ctx), &target); err != nil {
		return nil, err
	}
	return &target, nil
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
		"source":      "desktop_device_registration",
		"device_type": device.DeviceType,
		"app_version": device.AppVersion,
	})
	return string(capabilities), string(metadata)
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
	var nextCursor string
	if hasMore && len(targets) > 0 {
		nextCursor = targets[len(targets)-1].ID
	}
	return &TargetListResult{Items: targets, HasMore: hasMore, Cursor: nextCursor}, nil
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
		return pingEdgeServer(ctx, addr, t.AuthCredential, t.ID, id, s.db)
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

// pingEdgeServer performs an actual HTTP GET /v1/health against the Edge Server
// and updates the target's online status and last_seen_at accordingly.
func pingEdgeServer(ctx context.Context, addr string, authCredential, targetID, targetOwnerID string, db *gorm.DB) error {
	scheme := "http"
	url := scheme + "://" + addr + "/v1/health"

	client := &http.Client{Timeout: 5 * time.Second}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		_ = repository.UpdateTargetOnlineStatus(db, targetID, false)
		return errcode.TargetNotRoutable.WithMessage("failed to build ping request: " + err.Error())
	}

	// auth_method is a public strategy enum; only a trusted internal credential
	// value may become an Authorization header.
	if authCredential != "" {
		req.Header.Set("Authorization", "Bearer "+authCredential)
	}

	resp, err := client.Do(req)
	if err != nil {
		slog.Debug("execution target ping failed", "target_id", targetOwnerID, "addr", addr, "err", err)
		_ = repository.UpdateTargetOnlineStatus(db, targetID, false)
		return errcode.TargetNotRoutable.WithMessage("ping failed: " + err.Error())
	}
	resp.Body.Close()

	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		_ = repository.UpdateTargetOnlineStatus(db, targetID, true)
		return nil
	}

	_ = repository.UpdateTargetOnlineStatus(db, targetID, false)
	return errcode.TargetNotRoutable.WithMessage(fmt.Sprintf("ping returned HTTP %d", resp.StatusCode))
}
