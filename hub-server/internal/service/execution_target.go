package service

import (
	"context"
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
	db *gorm.DB
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
		return pingEdgeServer(ctx, addr, t.AuthMethod, t.ID, id, s.db)
	case "hub_relay":
		return errcode.TargetNotRoutable.WithMessage("execution target health proof is not available")
	default:
		return errcode.ErrBadRequest.WithMessage("unsupported target_type")
	}
}

// pingEdgeServer performs an actual HTTP GET /v1/health against the Edge Server
// and updates the target's online status and last_seen_at accordingly.
func pingEdgeServer(ctx context.Context, addr string, authMethod, targetID, targetOwnerID string, db *gorm.DB) error {
	scheme := "http"
	url := scheme + "://" + addr + "/v1/health"

	client := &http.Client{Timeout: 5 * time.Second}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		_ = repository.UpdateTargetOnlineStatus(db, targetID, false)
		return errcode.TargetNotRoutable.WithMessage("failed to build ping request: " + err.Error())
	}

	// If the target has an auth method configured, attach the token.
	// In practice, remote SSH Edge uses SSH tunnel auth (no HTTP auth needed),
	// Tailscale uses mTLS/networking auth (no HTTP auth needed),
	// Cloud Edge uses Hub JWT (attached by the caller).
	if authMethod != "" && authMethod != "none" {
		req.Header.Set("Authorization", "Bearer "+authMethod)
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
