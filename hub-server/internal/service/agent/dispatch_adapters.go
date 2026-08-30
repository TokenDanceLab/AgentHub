package agent

import (
	"context"
	"encoding/json"

	"github.com/agenthub/hub-server/internal/service/dispatchsvc"
	"github.com/agenthub/hub-server/internal/ws"
)

// ── dispatchsvc transport adapters ─────────────────────────────────────────
//
// The dispatch package defines wire-free ports (ManagerPort / RelayPort); the
// service layer adapts the concrete ws.Manager and relay.Service onto them so
// the dispatch flow never imports transport or sibling-service types.
// Full dispatch layering map (helpers / orchestration / adapters / facade):
// see the dispatchsvc package doc.

// wsManagerAdapter adapts *ws.Manager onto dispatchsvc.ManagerPort.
type wsManagerAdapter struct {
	manager *ws.Manager
}

func (a wsManagerAdapter) FindByConnID(connID string) *dispatchsvc.ConnPort {
	conn := a.manager.FindByConnID(connID)
	if conn == nil {
		return nil
	}
	return &dispatchsvc.ConnPort{
		ID:         conn.ID,
		UserID:     conn.UserID,
		DeviceType: conn.DeviceType,
		DeviceID:   conn.DeviceID,
	}
}

func (a wsManagerAdapter) PushToConn(connID string, frame dispatchsvc.FramePort) dispatchsvc.DeliveryResultPort {
	result := a.manager.PushToConn(connID, ws.Frame{Type: frame.Type, Payload: frame.Payload})
	return dispatchsvc.DeliveryResultPort{
		Queued: result.Queued,
		Status: string(result.Status),
		Err:    result.Err,
	}
}

// relayServiceAdapter adapts relayDispatcher (relay.Service subset) onto
// dispatchsvc.RelayPort. PushReached is forwarded so the dispatch flow can
// distinguish live delivery from fire-and-forget persistence.
type relayServiceAdapter struct {
	relay relayDispatcher
}

func (a relayServiceAdapter) CreateCommand(ctx context.Context, targetEdgeID, commandType string, payload json.RawMessage, createdBy string) (bool, error) {
	res, err := a.relay.CreateCommand(ctx, targetEdgeID, commandType, payload, createdBy)
	if err != nil {
		return false, err
	}
	return res.PushReached, nil
}
