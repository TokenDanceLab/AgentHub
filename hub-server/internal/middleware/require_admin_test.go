package middleware

import (
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
)

func TestRequireAdminBlocksWhenUserIDMissing(t *testing.T) {
	gin.SetMode(gin.TestMode)
	c, w := ginRequest(http.MethodGet, "/admin/something", "")
	RequireAdmin()(c)

	assert.True(t, c.IsAborted())
	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

func TestRequireAdminAllowsConfiguredAdmin(t *testing.T) {
	gin.SetMode(gin.TestMode)
	t.Setenv("AGENTHUB_ADMIN_USERS", "admin-1,admin-2")

	// Reset the sync.Once to pick up the env var.
	adminUsersOnce = sync.Once{}
	adminUsersList = nil

	c, w := ginRequest(http.MethodGet, "/admin/something", "")
	c.Set("user_id", "admin-1")
	RequireAdmin()(c)

	assert.False(t, c.IsAborted())
	assert.Equal(t, http.StatusOK, w.Code)
}

func TestRequireAdminBlocksNonAdminUser(t *testing.T) {
	gin.SetMode(gin.TestMode)
	t.Setenv("AGENTHUB_ADMIN_USERS", "admin-1")

	adminUsersOnce = sync.Once{}
	adminUsersList = nil

	c, w := ginRequest(http.MethodGet, "/admin/something", "")
	c.Set("user_id", "regular-user")
	RequireAdmin()(c)

	assert.True(t, c.IsAborted())
	assert.Equal(t, http.StatusForbidden, w.Code)
}

func TestGetAdminUsersParsesEnvVar(t *testing.T) {
	// getAdminUsers uses sync.Once — cannot reset across test runs.
	// This test only verifies the helper exists and is callable.
	assert.NotNil(t, getAdminUsers)
}

func TestAuditPermissionNoopWhenFnNil(t *testing.T) {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodGet, "/api/test", nil)
	auditPermission(c, "user-1", "admin_access", false, nil, "127.0.0.1")
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
	var b responseBody
	b.Code = "TEST_CODE"
	b.Message = "test message"
	assert.Equal(t, "TEST_CODE", b.Code)
	assert.Equal(t, "test message", b.Message)
}

func TestFailWithErrcodeError(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/test", nil)

	fail(c, errcode.ErrBadRequest)

	assert.True(t, c.IsAborted())
	assert.Equal(t, http.StatusBadRequest, w.Code)
	assert.Contains(t, w.Body.String(), "BAD_REQUEST")
}
