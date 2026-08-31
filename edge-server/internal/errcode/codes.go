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
	ErrForbidden        = sharederr.ErrForbidden
	ErrUnauthorized     = sharederr.ErrUnauthorized
	ErrConflict         = sharederr.ErrConflict
)

// --- Edge domain-specific codes ---

var (
	// Workspace security
	ErrWorkspaceNotAllowed = New("workspace_not_allowed", "workDir is outside the workspace allowlist", http.StatusForbidden)
	// ErrWorkDirRequired rejects adapter runs that omit workDir. Empty workDir
	// previously fell through to DefaultWorkDir()/UserHomeDir and bypassed the
	// workspace allowlist (AH-SR-006 / #854).
	ErrWorkDirRequired = New("workdir_required", "workDir is required for adapter runs", http.StatusBadRequest)

	// Permission mode / decision
	ErrInvalidPermissionMode = New("invalid_permission_mode", "invalid permission mode", http.StatusBadRequest)
	ErrInvalidDecision       = New("invalid_decision", "decision must be allow or deny", http.StatusBadRequest)

	// Executor lifecycle
	ErrExecutorUnavailable   = New("executor_unavailable", "no executor configured", http.StatusServiceUnavailable)
	ErrExecutorStartFailed   = New("executor_start_failed", "executor failed to start", http.StatusInternalServerError)
	ErrTooManyConcurrentRuns = New("too_many_concurrent_runs", "too many concurrent runs", http.StatusTooManyRequests)

	// Run
	ErrActiveRunExists = New("active_run_exists", "thread already has an active run", http.StatusConflict)

	// Agent discovery
	ErrInvalidAgentID             = New("invalid_agent_id", "unknown agent adapter", http.StatusBadRequest)
	ErrAgentRegistryNotConfigured = New("agent_registry_not_configured", "agent registry not configured", http.StatusServiceUnavailable)
	ErrAgentInstanceNotFound      = New("agent_instance_not_found", "agent instance not found", http.StatusNotFound)

	// Permissions
	ErrPermissionRequestNotFound = New("permission_request_not_found", "permission request not found", http.StatusNotFound)

	// Validation
	ErrRunIDRequired     = New("run_id_required", "runId is required", http.StatusBadRequest)
	ErrRequestIDRequired = New("request_id_required", "requestId is required", http.StatusBadRequest)

	// Plan approval
	ErrPlanNotFound        = New("plan_not_found", "no pending plan found for this run", http.StatusNotFound)
	ErrInvalidPlanDecision = New("invalid_plan_decision", "decision must be approve or reject", http.StatusBadRequest)

	// Deploy
	ErrDeployInvalidSlug    = New("deploy_invalid_slug", "slug must be lowercase alphanumeric with hyphens, 2-63 chars", http.StatusBadRequest)
	ErrDeployNoArtifacts    = New("deploy_no_artifacts", "run has no deployable artifacts", http.StatusBadRequest)
	ErrDeployRunNotFinished = New("deploy_run_not_finished", "run must be in a terminal state before deploying", http.StatusBadRequest)

	// Capability token (dual-token auth)
	ErrCapabilityTokenInvalid = New("capability_token_invalid", "capability token is missing or invalid", http.StatusForbidden)

	// Metrics
	ErrNotConfigured = New("not_configured", "resource not configured", http.StatusServiceUnavailable)

	// MCP tool sentinels (used by edge-server/internal/mcp/tools.go)
	ErrStoreNotConfigured              = New("store_not_configured", "store is not configured", http.StatusServiceUnavailable)
	ErrExecutorNotConfigured           = New("executor_not_configured", "executor is not configured", http.StatusServiceUnavailable)
	ErrProjectIDRequired               = New("project_id_required", "projectId is required", http.StatusBadRequest)
	ErrThreadIDRequired                = New("thread_id_required", "threadId is required", http.StatusBadRequest)
	ErrPromptRequired                  = New("prompt_required", "prompt is required", http.StatusBadRequest)
	ErrWorkspaceAllowlistNotConfigured = New("workspace_allowlist_not_configured", "workspace allowlist is not configured; cannot accept workDir", http.StatusForbidden)
	ErrPermissionRegistryNotConfigured = New("permission_registry_not_configured", "permission registry is not configured", http.StatusServiceUnavailable)
	ErrInvalidRole                     = New("invalid_role", "role must be 'user' or 'system'", http.StatusBadRequest)
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
