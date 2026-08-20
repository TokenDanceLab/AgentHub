package agent

import (
	"github.com/agenthub/hub-server/internal/model"
)

// RouteDecisionPayload carries the data needed to process a coordinator route
// decision emitted by a supervisor agent stream.
type RouteDecisionPayload struct {
	UserID   string                         `json:"user_id"`
	TeamID   string                         `json:"team_id"`
	RunID    string                         `json:"run_id"`
	Decision model.CoordinatorRouteDecision `json:"decision"`
}
