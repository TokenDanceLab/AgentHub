package executiontarget

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
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

// Service handles CRUD for execution targets.
type Service struct {
	db     *gorm.DB
	cache  Cache
	egress *egress.Client
}

// Cache is the subset of *cache.Client methods used by
// Service. Route proofs are device-exact (#1544): owner-level
// presence is no longer accepted for hub_relay / local_edge health.
type Cache interface {
	GetRouteForDevice(ctx context.Context, userID, deviceType, deviceID string) (string, error)
}

// ListResult holds paginated execution target results.
type ListResult struct {
	Items   []model.ExecutionTarget `json:"items"`
	HasMore bool                    `json:"has_more"`
	Cursor  string                  `json:"next_cursor,omitempty"`
}

// NewService wires the fail-closed egress policy (#1540):
// outbound pings use the canonical egress transport and refuse restricted
// networks unless the administrator allowlisted them.
func NewService(db *gorm.DB, egressCfg egress.Config) (*Service, error) {
	c, err := egress.New(egressCfg)
	if err != nil {
		return nil, fmt.Errorf("execution target service: %w", err)
	}
	return &Service{db: db, egress: c}, nil
}

// SetCache injects an optional cache client for hub_relay health checks.
func (s *Service) SetCache(cache Cache) {
	s.cache = cache
}

func (s *Service) Create(ctx context.Context, ownerID string, req *model.ExecutionTarget) (*model.ExecutionTarget, error) {
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
	if err := validateTargetTypeCombination(req); err != nil {
		return nil, err
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
		// Race with a concurrent same-name create: the DB unique index
		// (migration 0060) is the authoritative guard — map the violation
		// to the stable business error instead of a raw 500.
		if repository.IsUniqueViolation(err) {
			return nil, errcode.UserInvalidParam.WithMessage("execution target name already exists")
		}
		return nil, err
	}
	return req, nil
}

func (s *Service) UpsertLocalEdgeForDesktopDevice(ctx context.Context, device *model.Device) (*model.ExecutionTarget, error) {
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
		var err error
		result, err = s.upsertDesktopLocalEdgeTx(ctx, tx, device, name, capabilities, metadata)
		return err
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

// upsertDesktopLocalEdgeTx creates or refreshes the local_edge target for one
// desktop device check-in. The create-if-not-exists dance with conflict
// re-read stays inside the caller's transaction.
func (s *Service) upsertDesktopLocalEdgeTx(ctx context.Context, tx *gorm.DB, device *model.Device, name, capabilities, metadata string) (*model.ExecutionTarget, error) {
	if err := requireDeviceBelongsToOwner(ctx, tx, device.UserID, device.ID, "desktop"); err != nil {
		return nil, err
	}

	matches, err := findDesktopLocalEdgeTargetMatches(tx, device.UserID, device.ID, name)
	if err != nil {
		return nil, err
	}

	target, found, err := desktopLocalEdgeTargetFromMatches(matches, device.ID)
	if err != nil {
		return nil, err
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
			return nil, err
		}
		if !created {
			matches, err := findDesktopLocalEdgeTargetMatches(tx, device.UserID, device.ID, name)
			if err != nil {
				return nil, err
			}
			target, found, err = desktopLocalEdgeTargetFromMatches(matches, device.ID)
			if err != nil {
				return nil, err
			}
			if !found {
				return nil, errcode.UserInvalidParam.WithMessage("local_edge target conflict could not be resolved")
			}
			refreshDesktopLocalEdgeTarget(&target, device, name, capabilities, metadata)
			if err := repository.UpdateExecutionTarget(tx, &target); err != nil {
				return nil, err
			}
		}
	} else if err := repository.UpdateExecutionTarget(tx, &target); err != nil {
		return nil, err
	}
	result := target
	return &result, nil
}

// recordRegistrationEvidence persists the desktop check-in evidence for a
// local_edge target (#1544).
func (s *Service) recordRegistrationEvidence(ctx context.Context, target *model.ExecutionTarget, device *model.Device, now time.Time) {
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

func (s *Service) Get(ctx context.Context, id, ownerID string) (*model.ExecutionTarget, error) {
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
func (s *Service) loadEvidence(ctx context.Context, targetID string) (*model.ExecutionTargetEvidence, error) {
	ev, err := repository.GetExecutionTargetEvidence(s.db.WithContext(ctx), targetID)
	if err != nil {
		if repository.IsEvidenceNotFound(err) {
			return nil, nil
		}
		return nil, err
	}
	return ev, nil
}

// Update applies an explicit PATCH to an execution target (#1545).
// Three-state semantics: absent = keep, value = set, null = clear (nullable
// fields only). target_type is fixed at creation and health_state is
// system-managed — neither can be patched. Port reset to 0 and device_id
// unbind (null) are now expressible, which the old "non-zero means provided"
// convention made impossible.
func (s *Service) Update(ctx context.Context, id, ownerID string, patch *model.ExecutionTargetPatch) (*model.ExecutionTarget, error) {
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

	if err := applyExecutionTargetPatch(ctx, s.db, ownerID, t, patch); err != nil {
		return nil, err
	}

	if err := t.Validate(); err != nil {
		return nil, errcode.ErrBadRequest.WithMessage(err.Error())
	}
	if err := validateTargetTypeCombination(t); err != nil {
		return nil, err
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

// validateTargetTypeCombination enforces the type × host/device invariants
// (#1545, service layer): device-routed types (local_edge, hub_relay) must
// not carry a host, and host-configured types (remote_ssh, tailscale,
// cloud_edge) require one. Kept out of the DB schema to avoid breaking
// historical rows; the service returns a stable business error.
func validateTargetTypeCombination(t *model.ExecutionTarget) error {
	switch t.TargetType {
	case "local_edge", "hub_relay":
		if strings.TrimSpace(t.Host) != "" {
			return errcode.ErrBadRequest.WithMessage("target_type " + t.TargetType + " cannot configure a host (device-routed)")
		}
	case "remote_ssh", "tailscale", "cloud_edge":
		if strings.TrimSpace(t.Host) == "" {
			return errcode.ErrBadRequest.WithMessage("target_type " + t.TargetType + " requires a host")
		}
	}
	return nil
}

// applyExecutionTargetPatch mutates target per the PATCH semantics (#1545).
// JSON fields are stored as canonical JSON strings; clearing a JSON field
// resets it to its documented default ([] for workspace_allowlist, {} for
// capabilities/metadata), clearing a text field sets it to "".
func applyExecutionTargetPatch(ctx context.Context, db *gorm.DB, ownerID string, target *model.ExecutionTarget, patch *model.ExecutionTargetPatch) error {
	if patch == nil {
		return nil
	}
	// target_type / health_state are not patchable: type is fixed at
	// creation and health is system-managed. Reject rather than ignore so
	// callers cannot believe the update took effect (#1545).
	if patch.TargetType.Present() {
		return errcode.ErrBadRequest.WithMessage("target_type is fixed at creation and cannot be updated")
	}
	if patch.HealthState.Present() {
		return errcode.ErrBadRequest.WithMessage("health_state is system-managed")
	}
	// Text fields: absent = keep, value = set, null = clear to "".
	textFields := []struct {
		f   *model.PatchField[string]
		dst *string
	}{
		{&patch.Name, &target.Name},
		{&patch.Host, &target.Host},
		{&patch.WorkspaceRoot, &target.WorkspaceRoot},
		{&patch.TrustLevel, &target.TrustLevel},
		{&patch.AuthMethod, &target.AuthMethod},
	}
	for _, tf := range textFields {
		if !tf.f.Present() {
			continue
		}
		if tf.f.Null() {
			*tf.dst = ""
			continue
		}
		*tf.dst = tf.f.Value()
	}
	if patch.Port.Present() {
		if patch.Port.Null() {
			// port is not nullable — 0 is the valid "default port" value,
			// so absent ≠ reset and null is a contract error.
			return errcode.ErrBadRequest.WithMessage("port cannot be null")
		}
		target.Port = patch.Port.Value()
	}
	if patch.DeviceID.Present() {
		if patch.DeviceID.Null() {
			// Unbind the device.
			target.DeviceID = nil
		} else {
			deviceID := strings.TrimSpace(patch.DeviceID.Value())
			if deviceID == "" {
				// Empty string is treated as explicit unbind as well.
				target.DeviceID = nil
			} else {
				if err := requireDeviceBelongsToOwner(ctx, db, ownerID, deviceID, ""); err != nil {
					return err
				}
				target.DeviceID = &deviceID
			}
		}
	}
	// JSON fields: absent = keep, value = set (canonical JSON), null = reset
	// to the documented default ([] for allowlist, {} for the object fields).
	jsonFields := []struct {
		f          *model.PatchField[json.RawMessage]
		dst        *string
		name       string
		wantArray  bool
		defaultVal string
	}{
		{&patch.WorkspaceAllowlist, &target.WorkspaceAllowlist, "workspace_allowlist", true, "[]"},
		{&patch.Capabilities, &target.Capabilities, "capabilities", false, "{}"},
		{&patch.Metadata, &target.Metadata, "metadata", false, "{}"},
	}
	for _, jf := range jsonFields {
		if !jf.f.Present() {
			continue
		}
		if jf.f.Null() {
			*jf.dst = jf.defaultVal
			continue
		}
		canonical, err := canonicalJSONValue(jf.f.Value(), jf.wantArray)
		if err != nil {
			return errcode.ErrBadRequest.WithMessage(jf.name + " must be a JSON " + map[bool]string{true: "array", false: "object"}[jf.wantArray])
		}
		*jf.dst = canonical
	}
	return nil
}

// canonicalJSONValue normalizes a raw JSON payload to a canonical JSON string;
// wantArray requires a JSON array, otherwise a JSON object.
func canonicalJSONValue(raw json.RawMessage, wantArray bool) (string, error) {
	var value any
	if wantArray {
		var arr []any
		if err := json.Unmarshal(raw, &arr); err != nil {
			return "", err
		}
		value = arr
	} else {
		var obj map[string]any
		if err := json.Unmarshal(raw, &obj); err != nil {
			return "", err
		}
		value = obj
	}
	canonical, err := json.Marshal(value)
	if err != nil {
		return "", err
	}
	return string(canonical), nil
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

func (s *Service) Delete(ctx context.Context, id, ownerID string) error {
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

func (s *Service) List(ctx context.Context, ownerID, targetType, cursor string, pageSize int) (*ListResult, error) {
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
	return &ListResult{Items: targets, HasMore: hasMore, Cursor: nextCursor}, nil
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
