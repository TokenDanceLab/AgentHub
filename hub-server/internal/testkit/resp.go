// Package testkit holds Hub-only shared test fixtures. The generic
// deterministic-wait helpers (WaitFor/Eventually) live in pkg/testkit (#1550);
// this package keeps just the Hub response envelope shared by tests/integration,
// tests/oidc, tests/scenarios and tests/teamrun.
package testkit

import (
	"encoding/json"
	"testing"
)

// APIResponse is the shared Hub response envelope shape used by the smoke and
// integration test packages (success code/data + error code/message/traceId).
// Previously duplicated verbatim in tests/integration, tests/oidc,
// tests/scenarios and tests/teamrun.
type APIResponse struct {
	Code    string          `json:"code"`
	Message string          `json:"message"`
	Data    json.RawMessage `json:"data"`
	Error   *APIError       `json:"error"`
}

// APIError is the error sub-envelope of APIResponse.
type APIError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	TraceID string `json:"traceId"`
}

// GetCode returns the response code from either success or error envelope.
func (r APIResponse) GetCode() string {
	if r.Error != nil {
		return r.Error.Code
	}
	return r.Code
}

// GetMsg returns the message from either success or error envelope.
func (r APIResponse) GetMsg() string {
	if r.Error != nil {
		return r.Error.Message
	}
	return r.Message
}

// AssertCode fails the test when the response code differs from want.
func AssertCode(t *testing.T, r APIResponse, want string, ctx string) {
	t.Helper()
	if got := r.GetCode(); got != want {
		t.Fatalf("%s: code = %q, want %q (msg=%q)", ctx, got, want, r.GetMsg())
	}
}
