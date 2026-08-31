package errcode

import (
	"encoding/json"
	"net/http"
	"testing"
)

// TestNew tests the re-exported New constructor.
func TestNew(t *testing.T) {
	e := New("test_code", "test message", http.StatusTeapot)
	if e.Code != "test_code" {
		t.Fatalf("Code = %q, want %q", e.Code, "test_code")
	}
	if e.Message != "test message" {
		t.Fatalf("Message = %q, want %q", e.Message, "test message")
	}
	if e.HTTPStatus != http.StatusTeapot {
		t.Fatalf("HTTPStatus = %d, want %d", e.HTTPStatus, http.StatusTeapot)
	}
}

// TestNewTraceID tests the re-exported NewTraceID.
func TestNewTraceID(t *testing.T) {
	id := NewTraceID()
	if id == "" {
		t.Fatal("NewTraceID should not return empty string")
	}
	if len(id) < 7 { // "trace_X" minimum
		t.Fatalf("NewTraceID too short: %q", id)
	}
}

// TestOK tests the OK sentinel error.
func TestOK(t *testing.T) {
	if OK.Code != "ok" {
		t.Fatalf("OK.Code = %q, want %q", OK.Code, "ok")
	}
	if OK.Message != "" {
		t.Fatalf("OK.Message = %q, want empty", OK.Message)
	}
	if OK.HTTPStatus != http.StatusOK {
		t.Fatalf("OK.HTTPStatus = %d, want %d", OK.HTTPStatus, http.StatusOK)
	}
}

// TestCommonErrorCodes tests the re-exported common error codes.
func TestCommonErrorCodes(t *testing.T) {
	cases := []struct {
		err      *Error
		wantCode string
		wantHTTP int
	}{
		{ErrInternal, "internal_error", http.StatusInternalServerError},
		{ErrBadRequest, "bad_request", http.StatusBadRequest},
		{ErrNotFound, "not_found", http.StatusNotFound},
		{ErrMethodNotAllowed, "method_not_allowed", http.StatusMethodNotAllowed},
		{ErrTooManyRequests, "too_many_requests", http.StatusTooManyRequests},
		{ErrInvalidJSON, "invalid_json", http.StatusBadRequest},
		{ErrContentRequired, "content_required", http.StatusBadRequest},
		{ErrForbidden, "forbidden", http.StatusForbidden},
		{ErrUnauthorized, "unauthorized", http.StatusUnauthorized},
		{ErrConflict, "conflict", http.StatusConflict},
	}
	for _, tc := range cases {
		t.Run(tc.wantCode, func(t *testing.T) {
			if tc.err == nil {
				t.Fatal("error should not be nil")
			}
			if tc.err.Code != tc.wantCode {
				t.Errorf("Code = %q, want %q", tc.err.Code, tc.wantCode)
			}
			if tc.err.HTTPStatus != tc.wantHTTP {
				t.Errorf("HTTPStatus = %d, want %d", tc.err.HTTPStatus, tc.wantHTTP)
			}
		})
	}
}

// TestDomainErrorCodes tests all edge-specific error codes for correctness.
func TestDomainErrorCodes(t *testing.T) {
	cases := []struct {
		err      *Error
		wantCode string
		wantMsg  string
		wantHTTP int
	}{
		// Workspace security
		{ErrWorkspaceNotAllowed, "workspace_not_allowed", "workDir is outside the workspace allowlist", http.StatusForbidden},
		{ErrWorkDirRequired, "workdir_required", "workDir is required for adapter runs", http.StatusBadRequest},

		// Permission mode / decision
		{ErrInvalidPermissionMode, "invalid_permission_mode", "invalid permission mode", http.StatusBadRequest},
		{ErrInvalidDecision, "invalid_decision", "decision must be allow or deny", http.StatusBadRequest},

		// Executor lifecycle
		{ErrExecutorUnavailable, "executor_unavailable", "no executor configured", http.StatusServiceUnavailable},
		{ErrExecutorStartFailed, "executor_start_failed", "executor failed to start", http.StatusInternalServerError},
		{ErrTooManyConcurrentRuns, "too_many_concurrent_runs", "too many concurrent runs", http.StatusTooManyRequests},

		// Run
		{ErrActiveRunExists, "active_run_exists", "thread already has an active run", http.StatusConflict},

		// Agent discovery
		{ErrInvalidAgentID, "invalid_agent_id", "unknown agent adapter", http.StatusBadRequest},
		{ErrAgentRegistryNotConfigured, "agent_registry_not_configured", "agent registry not configured", http.StatusServiceUnavailable},
		{ErrAgentInstanceNotFound, "agent_instance_not_found", "agent instance not found", http.StatusNotFound},

		// Permissions
		{ErrPermissionRequestNotFound, "permission_request_not_found", "permission request not found", http.StatusNotFound},

		// Validation
		{ErrRunIDRequired, "run_id_required", "runId is required", http.StatusBadRequest},
		{ErrRequestIDRequired, "request_id_required", "requestId is required", http.StatusBadRequest},

		// Plan approval
		{ErrPlanNotFound, "plan_not_found", "no pending plan found for this run", http.StatusNotFound},
		{ErrInvalidPlanDecision, "invalid_plan_decision", "decision must be approve or reject", http.StatusBadRequest},

		// Deploy
		{ErrDeployInvalidSlug, "deploy_invalid_slug", "slug must be lowercase alphanumeric with hyphens, 2-63 chars", http.StatusBadRequest},
		{ErrDeployNoArtifacts, "deploy_no_artifacts", "run has no deployable artifacts", http.StatusBadRequest},
		{ErrDeployRunNotFinished, "deploy_run_not_finished", "run must be in a terminal state before deploying", http.StatusBadRequest},

		// Capability token
		{ErrCapabilityTokenInvalid, "capability_token_invalid", "capability token is missing or invalid", http.StatusForbidden},

		// Metrics
		{ErrNotConfigured, "not_configured", "resource not configured", http.StatusServiceUnavailable},

		// MCP tool sentinels
		{ErrStoreNotConfigured, "store_not_configured", "store is not configured", http.StatusServiceUnavailable},
		{ErrExecutorNotConfigured, "executor_not_configured", "executor is not configured", http.StatusServiceUnavailable},
		{ErrProjectIDRequired, "project_id_required", "projectId is required", http.StatusBadRequest},
		{ErrThreadIDRequired, "thread_id_required", "threadId is required", http.StatusBadRequest},
		{ErrPromptRequired, "prompt_required", "prompt is required", http.StatusBadRequest},
		{ErrWorkspaceAllowlistNotConfigured, "workspace_allowlist_not_configured", "workspace allowlist is not configured; cannot accept workDir", http.StatusForbidden},
		{ErrPermissionRegistryNotConfigured, "permission_registry_not_configured", "permission registry is not configured", http.StatusServiceUnavailable},
		{ErrInvalidRole, "invalid_role", "role must be 'user' or 'system'", http.StatusBadRequest},
	}
	for _, tc := range cases {
		t.Run(tc.wantCode, func(t *testing.T) {
			if tc.err == nil {
				t.Fatal("error should not be nil")
			}
			if tc.err.Code != tc.wantCode {
				t.Errorf("Code = %q, want %q", tc.err.Code, tc.wantCode)
			}
			if tc.err.Message != tc.wantMsg {
				t.Errorf("Message = %q, want %q", tc.err.Message, tc.wantMsg)
			}
			if tc.err.HTTPStatus != tc.wantHTTP {
				t.Errorf("HTTPStatus = %d, want %d", tc.err.HTTPStatus, tc.wantHTTP)
			}
			if tc.err.Error() != tc.wantCode+": "+tc.wantMsg {
				t.Errorf("Error() = %q, want %q", tc.err.Error(), tc.wantCode+": "+tc.wantMsg)
			}
		})
	}
}

// TestDomainErrorCodesAreDistinct checks that no two domain error codes collide.
func TestDomainErrorCodesAreDistinct(t *testing.T) {
	errs := []*Error{
		ErrWorkspaceNotAllowed,
		ErrWorkDirRequired,
		ErrInvalidPermissionMode,
		ErrInvalidDecision,
		ErrExecutorUnavailable,
		ErrExecutorStartFailed,
		ErrTooManyConcurrentRuns,
		ErrActiveRunExists,
		ErrInvalidAgentID,
		ErrAgentRegistryNotConfigured,
		ErrAgentInstanceNotFound,
		ErrPermissionRequestNotFound,
		ErrRunIDRequired,
		ErrRequestIDRequired,
		ErrPlanNotFound,
		ErrInvalidPlanDecision,
		ErrDeployInvalidSlug,
		ErrDeployNoArtifacts,
		ErrDeployRunNotFinished,
		ErrCapabilityTokenInvalid,
		ErrNotConfigured,
		ErrStoreNotConfigured,
		ErrExecutorNotConfigured,
		ErrProjectIDRequired,
		ErrThreadIDRequired,
		ErrPromptRequired,
		ErrWorkspaceAllowlistNotConfigured,
		ErrPermissionRegistryNotConfigured,
		ErrInvalidRole,
	}
	seen := make(map[string]bool)
	for _, e := range errs {
		if seen[e.Code] {
			t.Errorf("duplicate error code: %q", e.Code)
		}
		seen[e.Code] = true
	}
}

// TestErrorBody tests the ErrorBody function's output format.
func TestErrorBody(t *testing.T) {
	e := New("test_code", "test message", http.StatusBadRequest)
	body := ErrorBody(e)

	errObj, ok := body["error"].(map[string]any)
	if !ok {
		t.Fatal("ErrorBody should have 'error' key with map value")
	}
	if errObj["code"] != "test_code" {
		t.Errorf("code = %v, want test_code", errObj["code"])
	}
	if errObj["message"] != "test message" {
		t.Errorf("message = %v, want test message", errObj["message"])
	}
	traceID, ok := errObj["traceId"].(string)
	if !ok || traceID == "" {
		t.Error("traceId should be a non-empty string")
	}
}

// TestErrorBodyJSONSerializable checks that ErrorBody output can be marshaled to JSON.
func TestErrorBodyJSONSerializable(t *testing.T) {
	e := New("test_code", "test message", http.StatusBadRequest)
	body := ErrorBody(e)
	data, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("ErrorBody result should be JSON serializable: %v", err)
	}
	var parsed map[string]any
	if err := json.Unmarshal(data, &parsed); err != nil {
		t.Fatalf("ErrorBody JSON should be parseable: %v", err)
	}
	inner := parsed["error"].(map[string]any)
	if inner["code"] != "test_code" {
		t.Errorf("roundtrip code = %v", inner["code"])
	}
}

// TestErrorBodyMultipleCallsGeneratesDifferentTraceIDs checks that each call to
// ErrorBody generates a unique trace ID.
func TestErrorBodyMultipleCallsGeneratesDifferentTraceIDs(t *testing.T) {
	e := New("code", "msg", http.StatusBadRequest)
	body1 := ErrorBody(e)
	body2 := ErrorBody(e)
	trace1 := body1["error"].(map[string]any)["traceId"].(string)
	trace2 := body2["error"].(map[string]any)["traceId"].(string)
	if trace1 == trace2 {
		t.Error("each ErrorBody call should generate a unique traceId")
	}
}

// TestErrorTypeAlias tests that the Error type alias works with the shared Error type.
func TestErrorTypeAlias(t *testing.T) {
	// Error is a type alias for sharederr.Error
	e := &Error{Code: "alias_test", Message: "test", HTTPStatus: 418}
	_ = e // compile-time check that Error is the Error pointer type
	if e.Code != "alias_test" {
		t.Errorf("Error type alias should behave as sharederr.Error")
	}
}

// TestNewTraceIDProducesUniqueValues tests that sequential NewTraceID calls produce unique values.
func TestNewTraceIDProducesUniqueValues(t *testing.T) {
	seen := make(map[string]bool)
	for i := 0; i < 100; i++ {
		id := NewTraceID()
		if seen[id] {
			t.Errorf("duplicate trace ID: %q", id)
		}
		seen[id] = true
	}
}
