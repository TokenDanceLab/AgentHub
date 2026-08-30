package middleware

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"

	"github.com/agenthub/pkg/reqlog"
)

func TestAuditPermissionEnrichesDetails(t *testing.T) {
	gin.SetMode(gin.TestMode)
	var captured map[string]interface{}
	m := &AuthMiddleware{
		deps: AuthDependencies{
			PermissionAudit: func(ctx context.Context, userID string, decision string, allowed bool, details map[string]interface{}, clientIP string) {
				captured = details
			},
		},
	}

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req.Header.Set("X-AgentHub-Trace-ID", "trace-abc")
	ctx := reqlog.WithRequestID(req.Context(), "req-xyz")
	req = req.WithContext(ctx)
	c.Request = req
	c.Set("task_id", "task-1")
	c.Set("session_id", "sess-1")

	m.auditPermission(c, "user-1", "read.project", true, nil, "10.0.0.1")

	if captured == nil {
		t.Fatal("details not captured")
	}
	for _, tc := range []struct{ key, want string }{
		{"request_id", "req-xyz"},
		{"task_id", "task-1"},
		{"session_id", "sess-1"},
		{"trace_id", "trace-abc"},
	} {
		got, ok := captured[tc.key].(string)
		if !ok || got != tc.want {
			t.Errorf("details[%q] = %v, want %q", tc.key, captured[tc.key], tc.want)
		}
	}
}

func TestAuditPermissionOmitsEmptyFields(t *testing.T) {
	gin.SetMode(gin.TestMode)
	var captured map[string]interface{}
	m := &AuthMiddleware{
		deps: AuthDependencies{
			PermissionAudit: func(ctx context.Context, userID string, decision string, allowed bool, details map[string]interface{}, clientIP string) {
				captured = details
			},
		},
	}

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	c.Request = req

	m.auditPermission(c, "user-1", "read.project", true, nil, "")

	if _, ok := captured["trace_id"]; ok {
		t.Error("trace_id should be omitted when header absent")
	}
	if _, ok := captured["task_id"]; ok {
		t.Error("task_id should be omitted when gin context empty")
	}
}
