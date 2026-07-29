package service

import (
	"github.com/agenthub/hub-server/internal/bus"
	"github.com/agenthub/hub-server/internal/model"
)

// Bus is a type alias for bus.Bus. It exists for backward compatibility —
// new code should import internal/bus directly.
type Bus = bus.Bus

// Event is a type alias for bus.Event.
type Event = bus.Event

// EventHandler is a type alias for bus.EventHandler.
type EventHandler = bus.EventHandler

// NewBus delegates to bus.New. Prefer bus.New in new code.
var NewBus = bus.New

// RouteDecisionPayload carries the data needed to process a coordinator route
// decision emitted by a supervisor agent stream.
type RouteDecisionPayload struct {
	UserID   string                         `json:"user_id"`
	TeamID   string                         `json:"team_id"`
	RunID    string                         `json:"run_id"`
	Decision model.CoordinatorRouteDecision `json:"decision"`
}
