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

// ExecutionTargetCache is the subset of *cache.Client methods used by
// ExecutionTargetService. Route proofs are device-exact (#1544): owner-level
// presence is no longer accepted for hub_relay / local_edge health.
type ExecutionTargetCache interface {
	GetRouteForDevice(ctx context.Context, userID, deviceType, deviceID string) (string, error)
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

	// UpsertLocalEdgeForDesktopDevice 在桌面设备注册（check-in）时同步
	// 创建/刷新 local_edge target，并写入 registration evidence（#1544）：
	// 注册即一次 check-in，健康由 evidence 投影，不再直接写 online。
	// 设备存在性与绑定在事务内保证（requireDeviceBelongsToOwner）。
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

		refreshDesktopLocalEdgeTarget(&target, device, name, capabilities, metadata)
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
				refreshDesktopLocalEdgeTarget(&target, device, name, capabilities, metadata)
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
	// Registration evidence (check-in freshness window) — written after the
	// transaction so the target ID is final. Failure is observable but does
	// not fail the device registration: the target still exists, just without
	// live evidence until the next check-in / route probe.
	s.recordRegistrationEvidence(ctx, result, device, now)
	return result, nil
}

// recordRegistrationEvidence persists the desktop check-in evidence for a
// local_edge target (#1544).
func (s *ExecutionTargetService) recordRegistrationEvidence(ctx context.Context, target *model.ExecutionTarget, device *model.Device, now time.Time) {
	expires := now.Add(dispatch.DesktopTargetStaleAfter)
	ev := &model.ExecutionTargetEvidence{
		TargetID:   target.ID,
		Source:     dispatch.EvidenceSourceRegistration,
		Status:     dispatch.EvidenceStatusOnline,
		RouteKey:   targetRouteKey(device.UserID, "desktop", device.ID),
		ObservedAt: now,
		ExpiresAt:  &expires,
	}
	if err := repository.UpsertExecutionTargetEvidence(s.db.WithContext(ctx), ev); err != nil {
		slog.Error("execution target: failed to record registration evidence", "target_id", target.ID, "error", err)
	}
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

// refreshDesktopLocalEdgeTarget updates the identity/binding fields of a
// local_edge target from a desktop device check-in. It deliberately does NOT
// touch health fields (#1544): health is a projection of
// execution_target_evidence (written by the registration check-in), never a
// direct field write here.
func refreshDesktopLocalEdgeTarget(target *model.ExecutionTarget, device *model.Device, name, capabilities, metadata string) {
	target.Name = name
	target.DeviceID = &device.ID
	target.TargetType = "local_edge"
	target.WorkspaceAllowlist = "[]"
	target.TrustLevel = "local"
	target.Capabilities = capabilities
	target.Metadata = metadata
}

// targetRouteKey builds the route identity for evidence (user + device,
// never user alone — #1544).
func targetRouteKey(userID, deviceType, deviceID string) string {
	return userID + ":" + deviceType + ":" + deviceID
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
	evidence, err := s.loadEvidence(ctx, t.ID)
	if err != nil {
		return nil, err
	}
	applyExecutionTargetHealthProjection(t, evidence, time.Now())
	return t, nil
}

// loadEvidence fetches the latest health evidence for a target; a missing
// row yields nil evidence (no evidence recorded yet).
func (s *ExecutionTargetService) loadEvidence(ctx context.Context, targetID string) (*model.ExecutionTargetEvidence, error) {
	ev, err := repository.GetExecutionTargetEvidence(s.db.WithContext(ctx), targetID)
	if err != nil {
		if repository.IsEvidenceNotFound(err) {
			return nil, nil
		}
		return nil, err
	}
	return ev, nil
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
	evidence, err := s.loadEvidence(ctx, t.ID)
	if err != nil {
		return nil, err
	}
	applyExecutionTargetHealthProjection(t, evidence, time.Now())
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
	// Batch-load evidence to avoid an N+1 projection query per target.
	ids := make([]string, 0, len(targets))
	for i := range targets {
		ids = append(ids, targets[i].ID)
	}
	evidenceMap, err := repository.GetExecutionTargetEvidenceByTargetIDs(s.db.WithContext(ctx), ids)
	if err != nil {
		return nil, err
	}
	for i := range targets {
		var evidence *model.ExecutionTargetEvidence
		if ev, ok := evidenceMap[targets[i].ID]; ok {
			evidence = &ev
		}
		applyExecutionTargetHealthProjection(&targets[i], evidence, now)
	}
	var nextCursor string
	if hasMore && len(targets) > 0 {
		nextCursor = targets[len(targets)-1].ID
	}
	return &TargetListResult{Items: targets, HasMore: hasMore, Cursor: nextCursor}, nil
}

// applyExecutionTargetHealthProjection overwrites the readable health fields
// (health_state / is_online / last_seen_at) as a pure function of the latest
// evidence (#1544). These fields are no longer written directly anywhere —
// this is the single projection used by API reads.
func applyExecutionTargetHealthProjection(target *model.ExecutionTarget, evidence *model.ExecutionTargetEvidence, now time.Time) {
	if target == nil {
		return
	}
	state := dispatch.ResolveExecutionTargetHealthState(target, evidence, now)
	target.HealthState = state
	target.IsOnline = dispatch.ResolveIsOnline(state)
	if dispatch.EvidenceFresh(evidence, now) {
		observed := evidence.ObservedAt
		target.LastSeenAt = &observed
	} else {
		target.LastSeenAt = nil
	}
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

	// Per-type health strategy (#1544): each target type proves its health
	// differently and records evidence; no strategy writes online on its own.
	switch t.TargetType {
	case "local_edge":
		return s.pingLocalEdge(ctx, t)
	case "remote_ssh", "tailscale", "cloud_edge":
		return s.pingRemote(ctx, t)
	case "hub_relay":
		return s.pingHubRelay(ctx, t)
	default:
		return errcode.ErrBadRequest.WithMessage("unsupported target_type")
	}
}

// pingLocalEdge triggers a route probe for a local_edge target (#1544).
// A manual ping is never online evidence on its own: the probe checks the
// bound desktop device's live WS route (device-exact), and only a real route
// produces online evidence. Unbound targets cannot be proven and stay
// registered/unknown.
func (s *ExecutionTargetService) pingLocalEdge(ctx context.Context, t *model.ExecutionTarget) error {
	if t.DeviceID == nil || strings.TrimSpace(*t.DeviceID) == "" {
		_ = s.recordEvidence(ctx, t.ID, dispatch.EvidenceSourceProbe, dispatch.EvidenceStatusOffline, "missing_device_binding", "", "")
		return errcode.TargetNotRoutable.WithMessage("local edge is not bound to a device")
	}
	if s.cache == nil {
		_ = s.recordEvidence(ctx, t.ID, dispatch.EvidenceSourceProbe, dispatch.EvidenceStatusUnknown, "route_proof_unavailable", "", "")
		return errcode.TargetNotRoutable.WithMessage("execution target health proof is not available")
	}
	deviceType := "desktop"
	routeKey := targetRouteKey(t.OwnerID, deviceType, *t.DeviceID)
	_, err := s.cache.GetRouteForDevice(ctx, t.OwnerID, deviceType, *t.DeviceID)
	if err != nil {
		_ = s.recordEvidence(ctx, t.ID, dispatch.EvidenceSourceProbe, dispatch.EvidenceStatusOffline, "no_route", "", routeKey)
		return errcode.TargetNotRoutable.WithMessage("local edge route not found: bound desktop device has no live connection")
	}
	_ = s.recordEvidence(ctx, t.ID, dispatch.EvidenceSourceProbe, dispatch.EvidenceStatusOnline, "", "", routeKey)
	return nil
}

// pingRemote probes a remote_ssh / tailscale / cloud_edge target over HTTP
// through the fail-closed egress transport (#1540) and records probe
// evidence (protocol-independent: observed target id + failure category).
func (s *ExecutionTargetService) pingRemote(ctx context.Context, t *model.ExecutionTarget) error {
	if t.Host == "" {
		_ = s.recordEvidence(ctx, t.ID, dispatch.EvidenceSourceProbe, dispatch.EvidenceStatusOffline, "no_host", "", "")
		return errcode.TargetNotRoutable.WithMessage("execution target has no host configured")
	}
	port := t.Port
	if port == 0 {
		port = 3210
	}
	addr := net.JoinHostPort(t.Host, fmt.Sprintf("%d", port))
	return s.pingEdgeServer(ctx, addr, t)
}

// pingHubRelay proves an exact device route for a hub_relay target (#1544).
// The owner having any WebSocket connection is no longer sufficient — the
// bound device itself must have a live route (user + device identity).
func (s *ExecutionTargetService) pingHubRelay(ctx context.Context, t *model.ExecutionTarget) error {
	if s.cache == nil {
		_ = s.recordEvidence(ctx, t.ID, dispatch.EvidenceSourceRelayRoute, dispatch.EvidenceStatusUnknown, "route_proof_unavailable", "", "")
		return errcode.TargetNotRoutable.WithMessage("execution target health proof is not available")
	}
	if t.DeviceID == nil || strings.TrimSpace(*t.DeviceID) == "" {
		_ = s.recordEvidence(ctx, t.ID, dispatch.EvidenceSourceRelayRoute, dispatch.EvidenceStatusOffline, "missing_device_binding", "", "")
		return errcode.TargetNotRoutable.WithMessage("relay route proof requires a bound device")
	}
	device, err := repository.GetDeviceByID(s.db.WithContext(ctx), *t.DeviceID)
	if err != nil {
		_ = s.recordEvidence(ctx, t.ID, dispatch.EvidenceSourceRelayRoute, dispatch.EvidenceStatusOffline, "bound_device_missing", "", "")
		return errcode.TargetNotRoutable.WithMessage("bound device not found")
	}
	routeKey := targetRouteKey(t.OwnerID, device.DeviceType, device.ID)
	_, err = s.cache.GetRouteForDevice(ctx, t.OwnerID, device.DeviceType, device.ID)
	if err != nil {
		_ = s.recordEvidence(ctx, t.ID, dispatch.EvidenceSourceRelayRoute, dispatch.EvidenceStatusOffline, "no_route", "", routeKey)
		return errcode.TargetNotRoutable.WithMessage("relay route not available: target device has no live connection")
	}
	_ = s.recordEvidence(ctx, t.ID, dispatch.EvidenceSourceRelayRoute, dispatch.EvidenceStatusOnline, "", "", routeKey)
	return nil
}

// recordEvidence persists the latest health evidence for a target (#1544).
// Every health state change funnels through here; the readable health fields
// are projections only. Persistence failure is logged (the probe itself
// succeeded — the caller's error, if any, is the probe verdict, not this).
func (s *ExecutionTargetService) recordEvidence(ctx context.Context, targetID, source, status, failureCategory, observedTargetID, routeKey string) error {
	now := time.Now()
	expires := now.Add(dispatch.DesktopTargetStaleAfter)
	ev := &model.ExecutionTargetEvidence{
		TargetID:         targetID,
		Source:           source,
		Status:           status,
		FailureCategory:  failureCategory,
		ObservedTargetID: observedTargetID,
		RouteKey:         routeKey,
		ObservedAt:       now,
		ExpiresAt:        &expires,
	}
	if err := repository.UpsertExecutionTargetEvidence(s.db.WithContext(ctx), ev); err != nil {
		slog.Error("execution target: failed to record health evidence", "target_id", targetID, "source", source, "status", status, "error", err)
		return err
	}
	return nil
}

// pingEdgeServer performs an HTTP GET /v1/health against the Edge Server
// through the fail-closed egress transport (#1540): default-deny on
// restricted networks (loopback/private/link-local/metadata) unless an
// administrator allowlist covers the address. No credential is attached —
// AuthCredential is not persisted (no secret source), and hub-initiated
// pings must not carry secrets to arbitrary targets.
func (s *ExecutionTargetService) pingEdgeServer(ctx context.Context, addr string, t *model.ExecutionTarget) error {
	// Scheme comes from the egress policy: https default, plain http only
	// with explicit egress.allow_plain_http (trusted local policy).
	url := s.egress.Scheme() + "://" + addr + "/v1/health"

	resp, err := s.egress.Get(ctx, url)
	if err != nil {
		slog.Debug("execution target ping failed", "target_id", t.ID, "addr", addr, "error", err)
		_ = s.recordEvidence(ctx, t.ID, dispatch.EvidenceSourceProbe, dispatch.EvidenceStatusOffline, "connect", "", "")
		return errcode.TargetNotRoutable.WithMessage("ping failed: " + err.Error())
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 64*1024))
		if observedTargetID := observedTargetIDFromHealthBody(body); observedTargetID != "" && observedTargetID != t.ID {
			_ = s.recordEvidence(ctx, t.ID, dispatch.EvidenceSourceProbe, dispatch.EvidenceStatusMismatch, "mismatch", observedTargetID, "")
			return errcode.TargetNotRoutable.WithMessage("execution target health mismatch")
		}
		_ = s.recordEvidence(ctx, t.ID, dispatch.EvidenceSourceProbe, dispatch.EvidenceStatusOnline, "", "", "")
		return nil
	}

	_ = s.recordEvidence(ctx, t.ID, dispatch.EvidenceSourceProbe, dispatch.EvidenceStatusOffline, fmt.Sprintf("http_%d", resp.StatusCode), "", "")
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
