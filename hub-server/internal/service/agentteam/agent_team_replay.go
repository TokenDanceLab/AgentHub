package agentteam

import (
	"encoding/json"

	"github.com/agenthub/hub-server/internal/model"
)

// Data-driven payload decode helpers for team event replay.
//
// Audit-D §4 cluster 1 identified 10 sites across 4 files that repeated the
// pattern `for _, event := range events { if event.Type != X { continue };
// json.Unmarshal([]byte(event.Payload), &val) ... }`. Two of those live in
// agent_team_projection.go (#1385 pure projection functions) and are left
// untouched per refactor scope. The remaining 8 are deduplicated here through
// two generic helpers plus a dispatch table that replaces the GetTeamRunState
// replay switch.

// decodeTeamEventPayload unmarshals event.Payload into T. Returns the value
// and true on success; on JSON error returns the zero value and false.
//
// This preserves the two error semantics seen at the original call sites:
//   - Sites that wrote `if err := json.Unmarshal(...); err != nil { continue }`
//     now check `if !ok { continue }` — identical skip-on-error behavior.
//   - Sites that wrote `if err := json.Unmarshal(...); err == nil && fld != ""`
//     now check `if v, ok := decodeTeamEventPayload[T](event); ok && v.Fld != ""`
//     — identical skip-on-error AND skip-on-empty-field behavior.
func decodeTeamEventPayload[T any](event model.AgentTeamEvent) (T, bool) {
	var v T
	if err := json.Unmarshal([]byte(event.Payload), &v); err != nil {
		return v, false
	}
	return v, true
}

// scanTeamEventPayloads iterates events matching eventType, decoding each
// payload into T and invoking fn. Decode errors are skipped (continue),
// matching the `err != nil { continue }` semantics at the standalone query
// call sites (countMatchingRouteDecisionsInEvents, findApprovalDecision,
// findConflictResolution). fn returns true to stop early, preserving the
// early-return semantics of findApprovalDecision/findConflictResolution;
// return false to continue scanning.
func scanTeamEventPayloads[T any](events []model.AgentTeamEvent, eventType string, fn func(T, model.AgentTeamEvent) bool) {
	for _, event := range events {
		if event.Type != eventType {
			continue
		}
		v, ok := decodeTeamEventPayload[T](event)
		if !ok {
			continue
		}
		if fn(v, event) {
			return
		}
	}
}

// routeRejectedPayload is the typed counterpart of the anonymous struct
// previously inlined in the TeamEventRouteRejected case of GetTeamRunState.
// Field names and json tags are preserved verbatim.
type routeRejectedPayload struct {
	Decision model.CoordinatorRouteDecision `json:"decision"`
	Reason   string                         `json:"reason"`
}

// teamStateReplayHandler applies a single team event to the run state during
// the GetTeamRunState replay pass. Each handler encapsulates the payload
// decode (via decodeTeamEventPayload) and state mutation that was previously
// inlined as a switch case.
type teamStateReplayHandler func(state *model.TeamRunState, event model.AgentTeamEvent)

// teamStateReplayHandlers is the data-driven dispatch table replacing the
// switch statement in GetTeamRunState. Events are processed in iteration
// order (same as the switch); unmatched event types are skipped (same as a
// switch with no default). replayReviewEvents remains a separate pass after
// this table to preserve the original two-pass ordering.
var teamStateReplayHandlers = map[string]teamStateReplayHandler{
	model.TeamEventRouteDecided:     replayRouteDecidedPayload,
	model.TeamEventRouteRejected:    replayRouteRejectedPayload,
	model.TeamEventRunStarted:       replayRunStartedPayload,
	model.TeamEventRunCompleted:     replayRunCompletedPayload,
	model.TeamEventRunFailed:        replayRunFailedPayload,
	model.TeamEventConflictResolved: replayConflictResolvedPayload,
	model.TeamEventApprovalDecided:  replayApprovalDecidedPayload,
}

// replayRouteDecidedPayload handles team.route.decided.
// Original semantics: unmarshal CoordinatorRouteDecision; skip unless
// err == nil && decision.Action != "". Appends to RouteLog and RouteAuditLog.
func replayRouteDecidedPayload(state *model.TeamRunState, event model.AgentTeamEvent) {
	decision, ok := decodeTeamEventPayload[model.CoordinatorRouteDecision](event)
	if !ok || decision.Action == "" {
		return
	}
	state.RouteLog = append(state.RouteLog, decision)
	state.RouteAuditLog = append(state.RouteAuditLog, routeAuditStateFromDecision("accepted", decision, "", event.CreatedAt))
}

// replayRouteRejectedPayload handles team.route.rejected.
// Original semantics: unmarshal {Decision, Reason}; skip unless
// err == nil && payload.Decision.Action != "". Appends to RouteAuditLog.
func replayRouteRejectedPayload(state *model.TeamRunState, event model.AgentTeamEvent) {
	payload, ok := decodeTeamEventPayload[routeRejectedPayload](event)
	if !ok || payload.Decision.Action == "" {
		return
	}
	state.RouteAuditLog = append(state.RouteAuditLog, routeAuditStateFromDecision("rejected", payload.Decision, payload.Reason, event.CreatedAt))
}

// replayRunStartedPayload handles team.run.started.
// Original semantics: no payload decode; set status to Running.
func replayRunStartedPayload(state *model.TeamRunState, _ model.AgentTeamEvent) {
	state.Status = model.TeamRunStatusRunning
}

// replayRunCompletedPayload handles team.run.completed.
// Original semantics: uses payloadString (not typed unmarshal); sets status
// to Completed and terminal reason from "summary"/"reason" keys.
func replayRunCompletedPayload(state *model.TeamRunState, event model.AgentTeamEvent) {
	state.Status = model.TeamRunStatusCompleted
	state.TerminalReason = payloadString(event.Payload, "summary", "reason")
}

// replayRunFailedPayload handles team.run.failed.
// Original semantics: uses payloadString (not typed unmarshal); sets status
// to Failed and terminal reason from "reason"/"blocked_reason" keys.
func replayRunFailedPayload(state *model.TeamRunState, event model.AgentTeamEvent) {
	state.Status = model.TeamRunStatusFailed
	state.TerminalReason = payloadString(event.Payload, "reason", "blocked_reason")
}

// replayConflictResolvedPayload handles team.conflict.resolved.
// Original semantics: unmarshal TeamConflictResolution; skip unless err == nil.
// Calls applyConflictResolution to update existing conflict entries in place.
func replayConflictResolvedPayload(state *model.TeamRunState, event model.AgentTeamEvent) {
	resolution, ok := decodeTeamEventPayload[model.TeamConflictResolution](event)
	if !ok {
		return
	}
	applyConflictResolution(state.Conflicts, resolution)
}

// replayApprovalDecidedPayload handles team.approval.decided.
// Original semantics: unmarshal TeamApprovalDecision; skip unless err == nil.
// Calls applyApprovalDecision to update existing approval entries in place.
func replayApprovalDecidedPayload(state *model.TeamRunState, event model.AgentTeamEvent) {
	decision, ok := decodeTeamEventPayload[model.TeamApprovalDecision](event)
	if !ok {
		return
	}
	applyApprovalDecision(state.Approvals, decision)
}
