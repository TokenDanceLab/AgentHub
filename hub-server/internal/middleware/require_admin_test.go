package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
)

func TestRequireAdminBlocksWhenUserIDMissing(t *testing.T) {
	gin.SetMode(gin.TestMode)
	c, w := ginRequest(http.MethodGet, "/admin/something", "")
	newTestAuthMW(testConfig(), AuthDependencies{}, nil).RequireAdmin()(c)

	assert.True(t, c.IsAborted())
	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

func TestRequireAdminAllowsConfiguredAdmin(t *testing.T) {
	gin.SetMode(gin.TestMode)
	t.Setenv("AGENTHUB_ADMIN_USERS", "admin-1,admin-2")

	// The instance reads AGENTHUB_ADMIN_USERS at construction (#1551) —
	// no package global to reset.
	c, w := ginRequest(http.MethodGet, "/admin/something", "")
	c.Set("user_id", "admin-1")
	newTestAuthMW(testConfig(), AuthDependencies{}, nil).RequireAdmin()(c)

	assert.False(t, c.IsAborted())
	assert.Equal(t, http.StatusOK, w.Code)
}

func TestRequireAdminBlocksNonAdminUser(t *testing.T) {
	gin.SetMode(gin.TestMode)
	t.Setenv("AGENTHUB_ADMIN_USERS", "admin-1")

	c, w := ginRequest(http.MethodGet, "/admin/something", "")
	c.Set("user_id", "regular-user")
	newTestAuthMW(testConfig(), AuthDependencies{}, nil).RequireAdmin()(c)

	assert.True(t, c.IsAborted())
	assert.Equal(t, http.StatusForbidden, w.Code)
}

func TestGetAdminUsersParsesEnvVar(t *testing.T) {
	// parseAdminUsers reads AGENTHUB_ADMIN_USERS per call (instance-owned,
	// #1551) — a fresh parse picks up the env set here.
	t.Setenv("AGENTHUB_ADMIN_USERS", "u1, u2 ,,u3")
	got := parseAdminUsers()
	assert.Equal(t, []string{"u1", "u2", "u3"}, got)

	t.Setenv("AGENTHUB_ADMIN_USERS", "")
	assert.Nil(t, parseAdminUsers())
}

func TestAuditPermissionNoopWhenFnNil(t *testing.T) {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodGet, "/api/test", nil)
	newTestAuthMW(testConfig(), AuthDependencies{}, nil).auditPermission(c, "user-1", "admin_access", false, nil, "127.0.0.1")
}

func TestGlobalRateLimitPanicsOnNilClient(t *testing.T) {
	gin.SetMode(gin.TestMode)
	assert.Panics(t, func() {
		c, _ := ginRequest(http.MethodGet, "/api/test", "")
		GlobalRateLimit(nil)(c)
	})
}

func TestRateLimitPanicsOnNilClient(t *testing.T) {
	// Passing nil to RateLimit causes a nil pointer dereference because
	// GetRDB() is unsafe on nil *Client. This test documents the current
	// behavior — production code always passes a real client.
	gin.SetMode(gin.TestMode)
	assert.Panics(t, func() {
		c, _ := ginRequest(http.MethodGet, "/api/test", "")
		RateLimit(nil, 5, 0, IPKey)(c)
	})
}

func TestResponseBodyStructure(t *testing.T) {
	e := errcode.New("TEST_CODE", "test message", 400)
	assert.Equal(t, "TEST_CODE", e.Code)
	assert.Equal(t, "test message", e.Message)
}

func TestFailWithErrcodeError(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/test", nil)

	fail(c, errcode.ErrBadRequest)

	assert.True(t, c.IsAborted())
	assert.Equal(t, http.StatusBadRequest, w.Code)
	assert.Contains(t, w.Body.String(), "bad_request")
}
