// #2067: privileged-action audit hooks for agent team operations.
package agentteam

import "context"

// PrivilegedActionAuditor is the local port for audit recording.
type PrivilegedActionAuditor interface {
	RecordPrivilegedAction(ctx context.Context, in PrivilegedActionAuditInput)
}

// PrivilegedActionAuditInput mirrors audit.PrivilegedActionInput.
type PrivilegedActionAuditInput struct {
	ActorUserID  string
	Action       string
	ResourceType string
	ResourceID   string
	Outcome      string
	AuthBasis    string
	Reason       string
}

const (
	auditOutcomeSuccess = "success"
	auditOutcomeDenied  = "denied"
	auditOutcomeError   = "error"

	auditActionApprovalDecide = "approval.decide"
	auditActionRouteDecide    = "route.decide"
	auditActionReviewDecide   = "review.decide"
)

func (s *AgentTeamService) recordTeamAudit(ctx context.Context, action, resourceID, actorUserID, outcome, reason string) {
	if s == nil || s.audit == nil || actorUserID == "" {
		return
	}
	s.audit.RecordPrivilegedAction(ctx, PrivilegedActionAuditInput{
		ActorUserID:  actorUserID,
		Action:       action,
		ResourceType: "team_run",
		ResourceID:   resourceID,
		Outcome:      outcome,
		AuthBasis:    "owner",
		Reason:       reason,
	})
}
