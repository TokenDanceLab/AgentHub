package service

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

// RelayCommandData represents a relay command stored in Redis.
type RelayCommandData struct {
	ID           string          `json:"id"`
	TargetEdgeID string          `json:"target_edge_id"`
	CommandType  string          `json:"command_type"`
	Payload      json.RawMessage `json:"payload"`
	Status       string          `json:"status"`
	CreatedBy    string          `json:"created_by"`
	AckedAt      *time.Time      `json:"acked_at,omitempty"`
	CreatedAt    time.Time       `json:"created_at"`
}

// RelayService manages relay commands between Hub and Edge devices.
type RelayService struct {
	cache *cache.Client
	mgr   *ws.Manager
}

// NewRelayService creates a new RelayService.
func NewRelayService(cache *cache.Client, mgr *ws.Manager) *RelayService {
	return &RelayService{cache: cache, mgr: mgr}
}

// CreateCommand stores a new relay command in Redis and pushes it to the target
// Edge device via WebSocket if online.
func (s *RelayService) CreateCommand(ctx context.Context, targetEdgeID, commandType string, payload json.RawMessage, createdBy string) (*RelayCommandData, error) {
	id := generateRelayID()
	cmd := &RelayCommandData{
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

// GetCommand retrieves a relay command by ID from Redis.
func (s *RelayService) GetCommand(ctx context.Context, id string) (*RelayCommandData, error) {
	key := "relay:cmd:" + id
	data, err := s.cache.GetRDB().Get(ctx, key).Result()
	if err != nil {
		return nil, errcode.UserNotFound.WithMessage("relay command not found")
	}
	var cmd RelayCommandData
	if err := json.Unmarshal([]byte(data), &cmd); err != nil {
		return nil, fmt.Errorf("parse relay command: %w", err)
	}
	return &cmd, nil
}

// AckCommand marks a relay command as acknowledged by the Edge device.
func (s *RelayService) AckCommand(ctx context.Context, id string) error {
	cmd, err := s.GetCommand(ctx, id)
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

func generateRelayID() string {
	b := make([]byte, 12)
	rand.Read(b)
	return "relay_" + base64.RawURLEncoding.EncodeToString(b)
}
