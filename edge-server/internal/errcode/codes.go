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
	OK                  = &Error{Code: "OK", Message: "", HTTPStatus: http.StatusOK}
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
	ErrWorkspaceNotAllowed = New("WORKSPACE_NOT_ALLOWED", "workDir is outside the workspace allowlist", http.StatusForbidden)

	// Permission mode / decision
	ErrInvalidPermissionMode = New("INVALID_PERMISSION_MODE", "invalid permission mode", http.StatusBadRequest)
	ErrInvalidDecision       = New("INVALID_DECISION", "decision must be allow or deny", http.StatusBadRequest)

	// Executor lifecycle
	ErrExecutorUnavailable    = New("EXECUTOR_UNAVAILABLE", "no executor configured", http.StatusServiceUnavailable)
	ErrExecutorStartFailed    = New("EXECUTOR_START_FAILED", "executor failed to start", http.StatusInternalServerError)
	ErrTooManyConcurrentRuns  = New("TOO_MANY_CONCURRENT_RUNS", "too many concurrent runs", http.StatusTooManyRequests)

	// Run
	ErrActiveRunExists = New("ACTIVE_RUN_EXISTS", "thread already has an active run", http.StatusConflict)

	// Agent discovery
	ErrInvalidAgentID            = New("INVALID_AGENT_ID", "unknown agent adapter", http.StatusBadRequest)
	ErrAgentRegistryNotConfigured = New("AGENT_REGISTRY_NOT_CONFIGURED", "agent registry not configured", http.StatusNotFound)
	ErrAgentInstanceNotFound     = New("AGENT_INSTANCE_NOT_FOUND", "agent instance not found", http.StatusNotFound)

	// Permissions
	ErrPermissionRequestNotFound = New("PERMISSION_REQUEST_NOT_FOUND", "permission request not found", http.StatusNotFound)

	// Validation
	ErrRunIDRequired     = New("RUN_ID_REQUIRED", "runId is required", http.StatusBadRequest)
	ErrRequestIDRequired = New("REQUEST_ID_REQUIRED", "requestId is required", http.StatusBadRequest)

	// Metrics
	ErrNotConfigured = New("NOT_CONFIGURED", "resource not configured", http.StatusServiceUnavailable)
)

// ErrorBody returns the JSON error envelope for use with writeJSON.
// It produces the standard format:
//
//	{"error": {"code": "NOT_FOUND", "message": "...", "traceId": "trace_000001"}}
func ErrorBody(e *Error) map[string]any {
	return map[string]any{
		"error": map[string]any{
			"code":    e.Code,
			"message": e.Message,
			"traceId": NewTraceID(),
		},
	}
}
