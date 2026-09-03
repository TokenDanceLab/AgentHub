package agentteam

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/agenthub/hub-server/internal/model"
)

// Pure route/decision/mapper helpers for the agent team routing residual
// (#842): supervisor schema and prompt constants plus value mapping, with no
// DB, dispatch or event access. Orchestration — reading a supervisor decision,
// persisting the assignment it asks for and publishing for it — belongs in the
// service's run/decision path in this package, not here. Described by
// responsibility on purpose: this comment used to name a file that does not
// exist, and a package directory is the only file list that stays true (#2246).

const supervisorRouteDecisionSchema = `{"type":"object","additionalProperties":false,"required":["action"],"properties":{"action":{"type":"string","enum":["delegate","review","approve","finish"]},"next_worker":{"type":"string","description":"AgentTeamMember id to receive delegate/review/approve work"},"instructions":{"type":"string","description":"Concrete task prompt for the next worker"},"reasoning":{"type":"string","description":"Why this route is appropriate"},"context":{"type":"string","description":"Additional context for the next worker"},"approved":{"type":"boolean"},"feedback":{"type":"string"},"summary":{"type":"string","description":"Final TeamRun summary for action=finish"},"blocked_reason":{"type":"string","description":"Why the TeamRun cannot continue"},"correlation_id":{"type":"string","description":"Optional id linking this route to prior work"}}}`

const supervisorRoutePrompt = "AgentHub TeamRun supervisor mode: decide the next team step with the structured output schema. Use action=delegate/review/approve with next_worker set to an AgentTeamMember id and instructions set to the next task, or action=finish with summary/blocked_reason when the TeamRun is done or blocked. Do not start sub-agents locally; Hub will create TeamAssignment and dispatch them."

func supervisorRouteModelParams() string {
	data, err := json.Marshal(map[string]string{
		"structured_output_schema": supervisorRouteDecisionSchema,
		"append_system_prompt":     supervisorRoutePrompt,
	})
	if err != nil {
		return ""
	}
	return string(data)
}

func normalizeRouteAction(action string) string {
	return strings.ToLower(strings.TrimSpace(action))
}

func routeAssignmentType(action string) string {
	switch normalizeRouteAction(action) {
	case "review":
		return model.AssignmentTypeReview
	case "approve":
		return model.AssignmentTypeApprove
	default:
		return model.AssignmentTypeDelegate
	}
}

// resolveTeamSupervisor returns the first member with role=supervisor.
// Fallback: when no explicit supervisor role exists and members is non-empty,
// returns &members[0]. This unifies the three historical variants (#1385):
// StartTeamRun (fallback), findSupervisorAndWorker (fallback), and the old
// findTeamSupervisor (no fallback) used by fault escalation.
func resolveTeamSupervisor(members []model.AgentTeamMember) *model.AgentTeamMember {
	for i := range members {
		if members[i].Role == model.TeamMemberRoleSupervisor {
			return &members[i]
		}
	}
	if len(members) > 0 {
		return &members[0]
	}
	return nil
}

// findTeamSupervisor is kept as a thin alias for resolveTeamSupervisor so
// existing call sites and tests keep working with the unified fallback.
func findTeamSupervisor(members []model.AgentTeamMember) *model.AgentTeamMember {
	return resolveTeamSupervisor(members)
}

func findSupervisorAndWorker(members []model.AgentTeamMember, workerID string) (*model.AgentTeamMember, *model.AgentTeamMember) {
	supervisor := resolveTeamSupervisor(members)
	var worker *model.AgentTeamMember
	for i := range members {
		if members[i].ID == workerID {
			worker = &members[i]
			break
		}
	}
	return supervisor, worker
}

func routeAuditStateFromDecision(status string, decision model.CoordinatorRouteDecision, fallbackReason string, createdAt time.Time) model.TeamRouteAuditState {
	return model.TeamRouteAuditState{
		Status:        status,
		Action:        decision.Action,
		SubtaskID:     decision.SubtaskID,
		ParentTaskID:  decision.ParentTaskID,
		AgentID:       firstNonEmptyString(decision.AgentID, decision.NextWorker),
		Reason:        firstNonEmptyString(decision.Reason, fallbackReason),
		CorrelationID: decision.CorrelationID,
		CreatedAt:     createdAt,
	}
}

func routeDecisionMatches(previous, target model.CoordinatorRouteDecision) bool {
	return normalizeRouteAction(previous.Action) == normalizeRouteAction(target.Action) &&
		strings.TrimSpace(previous.NextWorker) == strings.TrimSpace(target.NextWorker) &&
		strings.TrimSpace(previous.Instructions) == strings.TrimSpace(target.Instructions)
}

// countMatchingRouteDecisionsInEvents counts prior accepted route decisions that
// match action + next_worker + instructions (used for MaxRouteRepeats guardrails).
func countMatchingRouteDecisionsInEvents(events []model.AgentTeamEvent, decision model.CoordinatorRouteDecision) int {
	count := 0
	scanTeamEventPayloads[model.CoordinatorRouteDecision](events, model.TeamEventRouteDecided, func(previous model.CoordinatorRouteDecision, _ model.AgentTeamEvent) bool {
		if routeDecisionMatches(previous, decision) {
			count++
		}
		return false
	})
	return count
}

// finishRouteOutcome maps a finish action to run status, event type, and payload.
func finishRouteOutcome(decision model.CoordinatorRouteDecision) (status, eventType string, payload map[string]string) {
	status = model.TeamRunStatusCompleted
	eventType = model.TeamEventRunCompleted
	payload = map[string]string{"summary": decision.Summary}
	if strings.TrimSpace(decision.BlockedReason) != "" {
		status = model.TeamRunStatusFailed
		eventType = model.TeamEventRunFailed
		payload = map[string]string{"blocked_reason": decision.BlockedReason}
	}
	return status, eventType, payload
}

// isTerminalTeamRunStatus reports whether a team run status is terminal and
// must never be overwritten by later route decisions or finish outcomes.
func isTerminalTeamRunStatus(status string) bool {
	switch status {
	case model.TeamRunStatusCompleted, model.TeamRunStatusFailed, model.TeamRunStatusCancelled:
		return true
	default:
		return false
	}
}

func assignmentDispatchPrompt(a *model.AgentTeamAssignment) string {
	if a == nil {
		return ""
	}
	prompt := strings.TrimSpace(a.TaskPrompt)
	contextStr := strings.TrimSpace(a.Context)
	if contextStr == "" {
		return prompt
	}
	return prompt + "\n\nContext:\n" + contextStr
}

func canDispatchAssignmentStatus(status string) bool {
	return status == model.AssignmentStatusPending || status == model.AssignmentStatusDispatched
}

func assignmentAlreadyBound(a *model.AgentTeamAssignment) bool {
	return a != nil && a.RunID != nil && strings.TrimSpace(*a.RunID) != ""
}

// findAgentInstanceIDForMember resolves the session agent instance whose custom
// agent profile matches the team member profile.
func findAgentInstanceIDForMember(agents []model.AgentInstance, member *model.AgentTeamMember) string {
	if member == nil || member.AgentProfileID == nil {
		return ""
	}
	profileID := *member.AgentProfileID
	for i := range agents {
		agent := &agents[i]
		if agent.CustomAgentID != nil && *agent.CustomAgentID == profileID {
			return agent.ID
		}
	}
	return ""
}

func newTeamTaskFromRoute(runID, assignmentID, workerID string, decision model.CoordinatorRouteDecision) *model.AgentTeamTask {
	return &model.AgentTeamTask{
		TeamRunID:        runID,
		AssignmentID:     &assignmentID,
		AssigneeMemberID: workerID,
		ParentTaskID:     stringPtrOrNil(strings.TrimSpace(decision.ParentTaskID)),
		Status:           model.TeamTaskStatusPending,
		Objective:        decision.Instructions,
		InputRefs:        "{}",
		Attempt:          1,
		RiskLevel:        model.TeamTaskRiskNormal,
	}
}

func newTeamTaskFromAssignment(a *model.AgentTeamAssignment) *model.AgentTeamTask {
	if a == nil {
		return nil
	}
	assignmentID := a.ID
	return &model.AgentTeamTask{
		TeamRunID:        a.TeamRunID,
		AssignmentID:     &assignmentID,
		AssigneeMemberID: a.ToMemberID,
		Status:           model.TeamTaskStatusPending,
		Objective:        a.TaskPrompt,
		InputRefs:        "{}",
		Attempt:          1,
		RiskLevel:        model.TeamTaskRiskNormal,
	}
}

func assignmentDispatchedEventPayload(assignmentID, teamTaskID, agentTaskID string) map[string]string {
	return map[string]string{
		"assignment_id": assignmentID,
		"team_task_id":  teamTaskID,
		"agent_task_id": agentTaskID,
	}
}

// parseFaultEscalationReason extracts structured metadata from a fault
// escalation reason string produced by the Edge server.
//
// Expected format: "[fault_escalation] retries=N maxRetries=M error=..."
func parseFaultEscalationReason(reason string) map[string]string {
	result := map[string]string{
		"retries":    "0",
		"maxRetries": "1",
		"error":      reason,
	}
	if idx := strings.Index(reason, "[fault_escalation]"); idx >= 0 {
		rest := reason[idx+len("[fault_escalation]"):]
		for _, part := range strings.Fields(rest) {
			if kv := strings.SplitN(part, "=", 2); len(kv) == 2 {
				result[kv[0]] = kv[1]
			}
		}
	}
	return result
}

func buildFaultEscalationReviewInstructions(assignmentID string, escalationCtx map[string]string) string {
	return fmt.Sprintf(
		"Fault escalation: review the following run failure and decide next steps.\n\n"+
			"Failed assignment: %s\n"+
			"Error context: %s\n"+
			"Retry count: %s (max: %s)\n\n"+
			"Actions:\n"+
			"- If the error is recoverable (e.g., fixable bug), suggest a fix and reassign.\n"+
			"- If a different agent would be better suited, suggest reassignment.\n"+
			"- If the error is not recoverable, respond with action=finish and blocked_reason.",
		assignmentID, escalationCtx["error"], escalationCtx["retries"], escalationCtx["maxRetries"],
	)
}

func buildFaultEscalationReviewDecision(assignmentID, supervisorMemberID string, escalationCtx map[string]string) model.CoordinatorRouteDecision {
	return model.CoordinatorRouteDecision{
		Action:        "review",
		NextWorker:    supervisorMemberID,
		Instructions:  buildFaultEscalationReviewInstructions(assignmentID, escalationCtx),
		Reasoning:     fmt.Sprintf("Fault escalation Layer 2 triggered: assignment %s failed after %s retries", assignmentID, escalationCtx["retries"]),
		CorrelationID: assignmentID,
	}
}

func faultEscalationReviewEventPayload(assignmentID string, escalationCtx map[string]string) map[string]any {
	return map[string]any{
		"assignment_id": assignmentID,
		"phase":         "review",
		"error":         escalationCtx["error"],
		"retries":       escalationCtx["retries"],
		"maxRetries":    escalationCtx["maxRetries"],
	}
}

type routeDecisionRejection struct {
	reason string
}

func (e *routeDecisionRejection) Error() string {
	return e.reason
}

func rejectRoute(reason string) error {
	return &routeDecisionRejection{reason: reason}
}

func routeRejectionReason(err error) (string, bool) {
	var rejection *routeDecisionRejection
	if !errors.As(err, &rejection) {
		return "", false
	}
	return rejection.reason, true
}
