// #2067: privileged-action audit hooks for execution target mutations.
package executiontarget

import "context"

// PrivilegedActionAuditor is the subset of *audit.Service used by this package.
// Local port keeps executiontarget decoupled from service/audit.
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

	auditActionTargetCreate = "target.create"
	auditActionTargetUpdate = "target.update"
	auditActionTargetDelete = "target.delete"
)

func (s *Service) recordTargetAudit(ctx context.Context, action, targetID, actorUserID, outcome, reason string) {
	if s == nil || s.audit == nil || actorUserID == "" {
		return
	}
	s.audit.RecordPrivilegedAction(ctx, PrivilegedActionAuditInput{
		ActorUserID:  actorUserID,
		Action:       action,
		ResourceType: "execution_target",
		ResourceID:   targetID,
		Outcome:      outcome,
		AuthBasis:    "owner",
		Reason:       reason,
	})
}
