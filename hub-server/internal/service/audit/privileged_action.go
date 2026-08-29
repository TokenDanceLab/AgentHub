package audit

import (
	"context"
	"log/slog"
)

// Privileged-action event_type constants. Each value fits varchar(64) on
// audit_events and is the canonical key for per-action audit trails (#2067).
const (
	EventTaskDispatch      = "task.dispatch"
	EventTaskCancel        = "task.cancel"
	EventTaskRegenerate    = "task.regenerate"
	EventApprovalDecide    = "approval.decide"
	EventMemberAdd         = "member.add"
	EventMemberRemove      = "member.remove"
	EventTargetCreate      = "target.create"
	EventTargetUpdate      = "target.update"
	EventTargetDelete      = "target.delete"
	EventReviewDecide      = "review.decide"
	EventRouteDecide       = "route.decide"
)

// Outcome values recorded in details.outcome. Kept as plain strings so
// callers don't import a sub-package just to spell success/denied/error.
const (
	OutcomeSuccess = "success"
	OutcomeDenied  = "denied"
	OutcomeError   = "error"
)

// PrivilegedActionInput carries the fields common to every privileged-action
// audit record. Callers fill what applies; zero values are omitted from the
// persisted details map to keep rows compact and secret-free.
type PrivilegedActionInput struct {
	ActorUserID  string // required — maps to audit_events.user_id
	Action       string // one of the Event* constants above
	ResourceType string // e.g. "task", "approval", "session_member", "execution_target", "team_run"
	ResourceID   string // domain ID of the acted-upon resource
	Outcome      string // OutcomeSuccess / OutcomeDenied / OutcomeError
	AuthBasis    string // e.g. "owner", "admin", "member-role-owner", "inviter"
	Reason       string // short human-readable reason (denial/error paths); truncated by caller if needed
}

// RecordPrivilegedAction writes a synchronous audit row for a privileged
// action. Nil receiver is a no-op so services can hold an optional *Service
// without nil-checking at every call site. Failure logs via slog.Error but
// never returns an error — audit must not block or fail the business path,
// matching the existing RecordPermissionDecision contract.
//
// Details are restricted to actor/resource/outcome/auth_basis/reason on
// purpose: input payloads and response bodies may carry secrets or PII and
// must never enter the audit chain.
func (s *Service) RecordPrivilegedAction(ctx context.Context, in PrivilegedActionInput) {
	if s == nil {
		return
	}
	if in.ActorUserID == "" || in.Action == "" {
		slog.Error("audit: privileged action record missing required fields",
			"action", in.Action, "actor_user_id_present", in.ActorUserID != "")
		return
	}
	details := map[string]interface{}{
		"action": in.Action,
	}
	if in.ResourceType != "" {
		details["resource_type"] = in.ResourceType
	}
	if in.ResourceID != "" {
		details["resource_id"] = in.ResourceID
	}
	if in.Outcome != "" {
		details["outcome"] = in.Outcome
	}
	if in.AuthBasis != "" {
		details["auth_basis"] = in.AuthBasis
	}
	if in.Reason != "" {
		details["reason"] = in.Reason
	}

	severity := "info"
	summary := in.Action + "." + defaultOutcomeSuffix(in.Outcome)
	switch in.Outcome {
	case OutcomeDenied:
		severity = "warn"
	case OutcomeError:
		severity = "error"
	}

	var targetID *string
	if in.ResourceID != "" {
		targetID = &in.ResourceID
	}
	if err := s.RecordSync(ctx, in.ActorUserID, in.Action, severity, summary, details, nil, targetID, ""); err != nil {
		slog.Error("audit: failed to record privileged action",
			"action", in.Action, "actor_user_id", in.ActorUserID, "resource_id", in.ResourceID, "error", err)
	}
}

func defaultOutcomeSuffix(outcome string) string {
	switch outcome {
	case OutcomeSuccess:
		return "ok"
	case OutcomeDenied:
		return "denied"
	case OutcomeError:
		return "err"
	default:
		return "recorded"
	}
}
