package errcode

import (
	"net/http"

	sharederr "github.com/agenthub/pkg/errcode"
)

// Error re-exports the shared error type.
type Error = sharederr.Error

// New re-exports the shared constructor for domain-specific codes.
func New(code, message string, httpStatus int) *Error {
	return sharederr.New(code, message, httpStatus)
}

// NewTraceID generates a unique trace ID for error responses.
func NewTraceID() string {
	return sharederr.NewTraceID()
}

// --- Common codes (re-exported from shared pkg/errcode) ---

var (
	OK                  = &Error{Code: "ok", Message: "", HTTPStatus: http.StatusOK}
	ErrInternal         = sharederr.ErrInternal
	ErrBadRequest       = sharederr.ErrBadRequest
	ErrNotFound         = sharederr.ErrNotFound
	ErrMethodNotAllowed = sharederr.ErrMethodNotAllowed
	ErrTooManyRequests  = sharederr.ErrTooManyRequests
	ErrInvalidJSON      = sharederr.ErrInvalidJSON
	ErrContentRequired  = sharederr.ErrContentRequired
)

// --- Edge domain-specific codes ---

var (
	// Workspace security
	ErrWorkspaceNotAllowed = New("workspace_not_allowed", "workDir is outside the workspace allowlist", http.StatusForbidden)

	// Permission mode / decision
	ErrInvalidPermissionMode = New("invalid_permission_mode", "invalid permission mode", http.StatusBadRequest)
	ErrInvalidDecision       = New("invalid_decision", "decision must be allow or deny", http.StatusBadRequest)

	// Executor lifecycle
	ErrExecutorUnavailable    = New("executor_unavailable", "no executor configured", http.StatusServiceUnavailable)
	ErrExecutorStartFailed    = New("executor_start_failed", "executor failed to start", http.StatusInternalServerError)
	ErrTooManyConcurrentRuns  = New("too_many_concurrent_runs", "too many concurrent runs", http.StatusTooManyRequests)

	// Run
	ErrActiveRunExists = New("active_run_exists", "thread already has an active run", http.StatusConflict)

	// Agent discovery
	ErrInvalidAgentID            = New("invalid_agent_id", "unknown agent adapter", http.StatusBadRequest)
	ErrAgentRegistryNotConfigured = New("agent_registry_not_configured", "agent registry not configured", http.StatusNotFound)
	ErrAgentInstanceNotFound     = New("agent_instance_not_found", "agent instance not found", http.StatusNotFound)

	// Permissions
	ErrPermissionRequestNotFound = New("permission_request_not_found", "permission request not found", http.StatusNotFound)

	// Validation
	ErrRunIDRequired     = New("run_id_required", "runId is required", http.StatusBadRequest)
	ErrRequestIDRequired = New("request_id_required", "requestId is required", http.StatusBadRequest)

	// Plan approval
	ErrPlanNotFound      = New("plan_not_found", "no pending plan found for this run", http.StatusNotFound)
	ErrInvalidPlanDecision = New("invalid_plan_decision", "decision must be approve or reject", http.StatusBadRequest)

	// Deploy
	ErrDeployInvalidSlug    = New("deploy_invalid_slug", "slug must be lowercase alphanumeric with hyphens, 2-63 chars", http.StatusBadRequest)
	ErrDeployNoArtifacts    = New("deploy_no_artifacts", "run has no deployable artifacts", http.StatusBadRequest)
	ErrDeployRunNotFinished = New("deploy_run_not_finished", "run must be in a terminal state before deploying", http.StatusBadRequest)

	// Metrics
	ErrNotConfigured = New("not_configured", "resource not configured", http.StatusServiceUnavailable)
)

// ErrorBody returns the JSON error envelope for use with writeJSON.
// It produces the standard format:
//
//	{"error": {"code": "not_found", "message": "...", "traceId": "trace_000001"}}
func ErrorBody(e *Error) map[string]any {
	return map[string]any{
		"error": map[string]any{
			"code":    e.Code,
			"message": e.Message,
			"traceId": NewTraceID(),
		},
	}
}
