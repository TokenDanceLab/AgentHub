// #2067: privileged-action audit hooks for agent run events.
package agent

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
)

func (s *RunEventService) recordApprovalAudit(ctx context.Context, taskID, actorUserID, outcome, reason string) {
	if s == nil || s.audit == nil || actorUserID == "" {
		return
	}
	s.audit.RecordPrivilegedAction(ctx, PrivilegedActionAuditInput{
		ActorUserID:  actorUserID,
		Action:       auditActionApprovalDecide,
		ResourceType: "task",
		ResourceID:   taskID,
		Outcome:      outcome,
		AuthBasis:    "owner",
		Reason:       reason,
	})
}
