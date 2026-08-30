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
// Edge device via WebSocket if online.
func (s *Service) CreateCommand(ctx context.Context, targetEdgeID, commandType string, payload json.RawMessage, createdBy string) (*CommandData, error) {
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
	s.mgr.PushToUser(targetEdgeID, frame)

	return cmd, nil
}

// GetCommand retrieves a relay command by ID from Redis, verifying it belongs to userID.
func (s *Service) GetCommand(ctx context.Context, id string, userID string) (*CommandData, error) {
	key := "relay:cmd:" + id
	data, err := s.cache.GetRDB().Get(ctx, key).Result()
	if err != nil {
		return nil, errcode.UserNotFound.WithMessage("relay command not found")
	}
	var cmd CommandData
	if err := json.Unmarshal([]byte(data), &cmd); err != nil {
		return nil, fmt.Errorf("parse relay command: %w", err)
	}
	if cmd.CreatedBy != userID {
		return nil, errcode.UserNotFound.WithMessage("relay command not found")
	}
	return &cmd, nil
}

// AckCommand acknowledges a relay command and removes it from Redis. The
// command lifecycle is complete once acked; retaining the key until TTL expiry
// wastes memory and pollutes scans (P2 audit #2119). Ownership is verified
// via GetCommand before deletion to prevent unauthorized cleanup.
func (s *Service) AckCommand(ctx context.Context, id string, userID string) error {
	// Verify ownership before deleting; GetCommand returns an error if the
	// command doesn't exist or doesn't belong to userID.
	if _, err := s.GetCommand(ctx, id, userID); err != nil {
		return err
	}
	key := "relay:cmd:" + id
	return s.cache.GetRDB().Del(ctx, key).Err()
}

func generateRelayID() string {
	b := make([]byte, 12)
	rand.Read(b)
	return "relay_" + base64.RawURLEncoding.EncodeToString(b)
}
