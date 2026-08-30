// #2067: privileged-action audit hooks for session member mutations.
package session

import "context"

// Outcome constants mirror audit.Outcome* so this package stays decoupled.
const (
	auditOutcomeSuccess = "success"
	auditOutcomeDenied  = "denied"
	auditOutcomeError   = "error"
)

// Action constants mirror the audit.Event* values relevant to session members.
const (
	auditActionMemberAdd    = "member.add"
	auditActionMemberRemove = "member.remove"
)

func (s *Service) recordMemberAudit(ctx context.Context, action, sessionID, actorUserID, outcome, reason string) {
	if s == nil || s.audit == nil || actorUserID == "" {
		return
	}
	s.audit.RecordPrivilegedAction(ctx, PrivilegedActionAuditInput{
		ActorUserID:  actorUserID,
		Action:       action,
		ResourceType: "session_member",
		ResourceID:   sessionID,
		Outcome:      outcome,
		AuthBasis:    "member-role-owner",
		Reason:       reason,
	})
}
