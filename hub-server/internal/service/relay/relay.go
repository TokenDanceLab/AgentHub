package relay

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"time"

	"github.com/agenthub/hub-server/internal/cache"
	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/metrics"
	"github.com/agenthub/hub-server/internal/ws"
)

// CommandData represents a relay command stored in Redis.
type CommandData struct {
	ID           string          `json:"id"`
	TargetEdgeID string          `json:"target_edge_id"`
	CommandType  string          `json:"command_type"`
	Payload      json.RawMessage `json:"payload"`
	Status       string          `json:"status"`
	CreatedBy    string          `json:"created_by"`
	AckedAt      *time.Time      `json:"acked_at,omitempty"`
	CreatedAt    time.Time       `json:"created_at"`
}

// CreateResult carries the outcome of CreateCommand, including whether the
// WebSocket push reached at least one active connection.
type CreateResult struct {
	Command     *CommandData
	PushReached bool // true when PushToUser queued the frame on ≥1 active conn
}

// Service manages relay commands between Hub and Edge devices.
type Service struct {
	cache *cache.Client
	mgr   *ws.Manager
}

// NewService creates a new Service.
func NewService(cache *cache.Client, mgr *ws.Manager) *Service {
	return &Service{cache: cache, mgr: mgr}
}

// CreateCommand stores a new relay command in Redis and pushes it to the target
// Edge device via WebSocket if online. The returned CreateResult reports
// whether the push reached at least one active connection so callers can
// distinguish live delivery from fire-and-forget persistence.
func (s *Service) CreateCommand(ctx context.Context, targetEdgeID, commandType string, payload json.RawMessage, createdBy string) (*CreateResult, error) {
	id := generateRelayID()
	cmd := &CommandData{
		ID:           id,
		TargetEdgeID: targetEdgeID,
		CommandType:  commandType,
		Payload:      payload,
		Status:       "pending",
		CreatedBy:    createdBy,
		CreatedAt:    time.Now(),
	}
	data, _ := json.Marshal(cmd)
	key := "relay:cmd:" + id
	if err := s.cache.GetRDB().Set(ctx, key, string(data), 24*time.Hour).Err(); err != nil {
		return nil, fmt.Errorf("store relay command: %w", err)
	}

	// Push to Edge via WebSocket if online
	frame := ws.NewFrame(ws.TypeAgentDispatch, map[string]interface{}{
		"relay_command_id": id,
		"command_type":     commandType,
		"payload":          string(payload),
	})
	fanout := s.mgr.PushToUser(targetEdgeID, frame)

	if metrics.RelayCommandsCreated != nil {
		metrics.RelayCommandsCreated.Inc()
	}

	return &CreateResult{
		Command:     cmd,
		PushReached: fanout.Queued > 0,
	}, nil
}

// GetCommand retrieves a relay command by ID from Redis, verifying it belongs to userID.
func (s *Service) GetCommand(ctx context.Context, id string, userID string) (*CommandData, error) {
	cmd, err := s.getCommand(ctx, id)
	if err != nil {
		return nil, err
	}
	if cmd.CreatedBy != userID {
		return nil, errcode.UserNotFound.WithMessage("relay command not found")
	}
	return cmd, nil
}

// AckCommand marks a relay command as acknowledged by the creator, verifying it belongs to userID.
func (s *Service) AckCommand(ctx context.Context, id string, userID string) error {
	cmd, err := s.GetCommand(ctx, id, userID)
	if err != nil {
		return err
	}
	now := time.Now()
	cmd.Status = "acked"
	cmd.AckedAt = &now
	data, _ := json.Marshal(cmd)
	key := "relay:cmd:" + id
	return s.cache.GetRDB().Set(ctx, key, string(data), 24*time.Hour).Err()
}

// getCommand retrieves a relay command by ID from Redis without ownership check.
func (s *Service) getCommand(ctx context.Context, id string) (*CommandData, error) {
	key := "relay:cmd:" + id
	data, err := s.cache.GetRDB().Get(ctx, key).Result()
	if err != nil {
		return nil, errcode.UserNotFound.WithMessage("relay command not found")
	}
	var cmd CommandData
	if err := json.Unmarshal([]byte(data), &cmd); err != nil {
		return nil, fmt.Errorf("parse relay command: %w", err)
	}
	return &cmd, nil
}

// DeviceAckCommand acknowledges a relay command using device identity.
// It verifies that deviceID matches the command's TargetEdgeID and is idempotent:
// repeating an ack on an already-acked command returns success without mutating state.
func (s *Service) DeviceAckCommand(ctx context.Context, id string, deviceID string) error {
	cmd, err := s.getCommand(ctx, id)
	if err != nil {
		return err
	}
	if cmd.TargetEdgeID != deviceID {
		return errcode.ErrForbidden.WithMessage("device does not own this relay command")
	}
	// Idempotent: already acked → success without rewrite.
	if cmd.Status == "acked" {
		return nil
	}
	now := time.Now()
	cmd.Status = "acked"
	cmd.AckedAt = &now
	raw, _ := json.Marshal(cmd)
	key := "relay:cmd:" + id
	return s.cache.GetRDB().Set(ctx, key, string(raw), 24*time.Hour).Err()
}

func generateRelayID() string {
	b := make([]byte, 12)
	rand.Read(b)
	return "relay_" + base64.RawURLEncoding.EncodeToString(b)
}
