package handler_test

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/agenthub/hub-server/internal/handler"
	"github.com/agenthub/hub-server/internal/service/relay"
)

func TestRelayHandlerCreateCommandAcceptsTargetIDAlias(t *testing.T) {
	svc := &mockRelayService{
		createFn: func(ctx context.Context, targetEdgeID, commandType string, payload json.RawMessage, createdBy string) (*relay.CommandData, error) {
			require.Equal(t, "edge-1", targetEdgeID)
			require.Equal(t, "run.cancel", commandType)
			require.JSONEq(t, `{"run_id":"run-1"}`, string(payload))
			require.Equal(t, "user-1", createdBy)
			return &relay.CommandData{
				ID:           "relay-1",
				TargetEdgeID: targetEdgeID,
				CommandType:  commandType,
				Payload:      payload,
				Status:       "pending",
				CreatedBy:    createdBy,
			}, nil
		},
	}
	h := handler.NewRelayHandler(svc)
	c, w := newGinCtx("POST", "/web/relay/commands", map[string]any{
		"target_id":    "edge-1",
		"command_type": "run.cancel",
		"payload": map[string]string{
			"run_id": "run-1",
		},
	}, "user_id", "user-1")

	h.CreateCommand(c)

	assertStatus(t, w, 200)
	assertOK(t, w)
	require.True(t, svc.createCalled)
}

func TestRelayHandlerCreateCommandRejectsMissingTargetOrPayload(t *testing.T) {
	tests := []struct {
		name string
		body map[string]any
	}{
		{
			name: "missing target",
			body: map[string]any{
				"command_type": "run.cancel",
				"payload":      map[string]string{"run_id": "run-1"},
			},
		},
		{
			name: "missing payload",
			body: map[string]any{
				"target_edge_id": "edge-1",
				"command_type":   "run.cancel",
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			svc := &mockRelayService{}
			h := handler.NewRelayHandler(svc)
			c, w := newGinCtx("POST", "/web/relay/commands", tt.body, "user_id", "user-1")

			h.CreateCommand(c)

			assertStatus(t, w, 400)
			require.False(t, svc.createCalled)
		})
	}
}

type mockRelayService struct {
	createCalled bool
	createFn     func(ctx context.Context, targetEdgeID, commandType string, payload json.RawMessage, createdBy string) (*relay.CommandData, error)
	getFn        func(ctx context.Context, id string, userID string) (*relay.CommandData, error)
	ackFn        func(ctx context.Context, id string, userID string) error
}

func (m *mockRelayService) CreateCommand(ctx context.Context, targetEdgeID, commandType string, payload json.RawMessage, createdBy string) (*relay.CommandData, error) {
	m.createCalled = true
	if m.createFn != nil {
		return m.createFn(ctx, targetEdgeID, commandType, payload, createdBy)
	}
	return nil, nil
}

func (m *mockRelayService) GetCommand(ctx context.Context, id string, userID string) (*relay.CommandData, error) {
	if m.getFn != nil {
		return m.getFn(ctx, id, userID)
	}
	return nil, nil
}

func (m *mockRelayService) AckCommand(ctx context.Context, id string, userID string) error {
	if m.ackFn != nil {
		return m.ackFn(ctx, id, userID)
	}
	return nil
}
