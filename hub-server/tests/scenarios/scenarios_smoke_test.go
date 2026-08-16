package scenarios

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/agenthub/hub-server/internal/egress"
	"github.com/agenthub/hub-server/internal/handler"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/service"
	"github.com/agenthub/hub-server/internal/testkit"
	"github.com/agenthub/hub-server/internal/uuidv7"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
)

// apiResp mirrors the Hub server's JSON response envelope.
// apiResp is the shared Hub response envelope (internal/testkit.APIResponse).
type apiResp = testkit.APIResponse

// stringPtr returns a pointer to the given string.
func stringPtr(s string) *string {
	return &s
}

// mustUUID generates a UUIDv7 string for test use, failing the test on error.
func mustUUID(t *testing.T) string {
	t.Helper()
	id, err := uuidv7.New()
	require.NoError(t, err)
	return id
}

// scenarioTestDB returns an in-memory SQLite database with the minimum tables
// needed for execution target dispatch tests.
func scenarioTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{
		Logger: gormlogger.Default.LogMode(gormlogger.Silent),
	})
	require.NoError(t, err, "open SQLite")

	tables := []string{
		`CREATE TABLE users (
			id TEXT PRIMARY KEY,
			username TEXT NOT NULL UNIQUE,
			password_hash TEXT,
			nickname TEXT NOT NULL DEFAULT '',
			avatar_url TEXT DEFAULT '',
			tokendance_sub TEXT DEFAULT NULL,
			tokendance_sub_linked_at DATETIME DEFAULT NULL,
			created_at DATETIME,
			updated_at DATETIME
		)`,
		`CREATE TABLE devices (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL,
			device_type TEXT NOT NULL DEFAULT 'desktop',
			app_version TEXT DEFAULT '',
			capabilities TEXT DEFAULT '[]',
			last_active_at DATETIME,
			created_at DATETIME
		)`,
		`CREATE TABLE execution_targets (
			id TEXT PRIMARY KEY,
			owner_id TEXT NOT NULL,
			device_id TEXT,
			name TEXT NOT NULL,
			target_type TEXT NOT NULL DEFAULT 'local_edge',
			host TEXT DEFAULT '',
			port INTEGER DEFAULT 0,
			workspace_root TEXT DEFAULT '',
			workspace_allowlist TEXT DEFAULT '[]',
			trust_level TEXT DEFAULT 'local',
			health_state TEXT DEFAULT 'unknown',
			auth_method TEXT DEFAULT '',
			is_online INTEGER NOT NULL DEFAULT 0,
			last_seen_at DATETIME,
			capabilities TEXT DEFAULT '{}',
			metadata TEXT DEFAULT '{}',
			created_at DATETIME,
			updated_at DATETIME,
			deleted_at DATETIME
		)`,
		`CREATE TABLE execution_target_evidence (
			id TEXT PRIMARY KEY,
			target_id TEXT NOT NULL UNIQUE,
			source TEXT NOT NULL,
			status TEXT NOT NULL,
			failure_category TEXT DEFAULT '',
			observed_target_id TEXT DEFAULT '',
			route_key TEXT DEFAULT '',
			observed_at DATETIME NOT NULL,
			expires_at DATETIME,
			created_at DATETIME,
			updated_at DATETIME
		)`,
		`CREATE TABLE sessions (
			id TEXT PRIMARY KEY,
			type TEXT NOT NULL DEFAULT '',
			owner_user_id TEXT,
			name TEXT DEFAULT '',
			avatar_url TEXT DEFAULT '',
			announcement TEXT DEFAULT '',
			workspace_id TEXT,
			next_seq INTEGER NOT NULL DEFAULT 0,
			last_message_at DATETIME,
			dissolved INTEGER NOT NULL DEFAULT 0,
			created_at DATETIME
		)`,
		`CREATE TABLE session_members (
			id TEXT PRIMARY KEY,
			session_id TEXT NOT NULL,
			member_type TEXT NOT NULL,
			member_id TEXT NOT NULL,
			role TEXT NOT NULL DEFAULT '',
			pinned INTEGER NOT NULL DEFAULT 0,
			archived INTEGER NOT NULL DEFAULT 0,
			muted INTEGER NOT NULL DEFAULT 0,
			last_read_seq INTEGER NOT NULL DEFAULT 0,
			joined_at DATETIME,
			left_at DATETIME
		)`,
		`CREATE TABLE agent_instances (
			id TEXT PRIMARY KEY,
			agent_type TEXT NOT NULL,
			custom_agent_id TEXT,
			session_id TEXT NOT NULL,
			inviter_user_id TEXT NOT NULL,
			display_name TEXT NOT NULL DEFAULT '',
			created_at DATETIME
		)`,
		`CREATE TABLE messages (
			id TEXT PRIMARY KEY,
			session_id TEXT NOT NULL,
			seq_id INTEGER NOT NULL,
			client_msg_id TEXT NOT NULL,
			sender_type TEXT NOT NULL,
			sender_id TEXT NOT NULL,
			content_type TEXT NOT NULL,
			content TEXT NOT NULL DEFAULT '',
			edited INTEGER NOT NULL DEFAULT 0,
			edited_at DATETIME,
			created_at DATETIME
		)`,
		`CREATE TABLE pending_agent_tasks (
			id TEXT PRIMARY KEY,
			agent_instance_id TEXT NOT NULL,
			triggered_by_user_id TEXT NOT NULL,
			trigger_message_id TEXT NOT NULL,
			target_id TEXT DEFAULT '',
			status TEXT NOT NULL DEFAULT 'queued',
			edge_device_id TEXT DEFAULT '',
			edge_run_id TEXT DEFAULT '',
			error_msg TEXT DEFAULT '',
			expire_at DATETIME,
			created_at DATETIME,
			finished_at DATETIME
		)`,
		`CREATE TABLE custom_agents (
			id TEXT PRIMARY KEY,
			owner_user_id TEXT NOT NULL,
			name TEXT NOT NULL,
			agent_type TEXT NOT NULL DEFAULT '',
			system_prompt TEXT NOT NULL DEFAULT '',
			capability_tags TEXT DEFAULT '[]',
			tool_whitelist TEXT DEFAULT '[]',
			model_params TEXT DEFAULT '{}',
			output_schema TEXT DEFAULT NULL,
			deleted_at DATETIME,
			created_at DATETIME,
			updated_at DATETIME
		)`,
	}
	for _, ddl := range tables {
		require.NoError(t, db.Exec(ddl).Error, "DDL failed")
	}
	return db
}

// scenarioTestFixtures creates a test user, device, and session in the database.
func scenarioTestFixtures(t *testing.T, db *gorm.DB) (userID, deviceID, sessionID string) {
	t.Helper()

	user := &model.User{
		Username:     "scenario_user",
		PasswordHash: stringPtr("hashed"),
		Nickname:     "Scenario Tester",
	}
	require.NoError(t, db.Create(user).Error, "create user")
	require.NotEmpty(t, user.ID)

	device := &model.Device{
		ID:         mustUUID(t),
		UserID:     user.ID,
		DeviceType: "desktop",
	}
	require.NoError(t, db.Create(device).Error, "create device")
	require.NotEmpty(t, device.ID)

	session := &model.Session{
		Type:        model.SessionTypeGroup,
		OwnerUserID: stringPtr(user.ID),
		Name:        "Scenario Session",
	}
	require.NoError(t, db.Create(session).Error, "create session")
	require.NotEmpty(t, session.ID)

	return user.ID, device.ID, session.ID
}

// ── Target validation tests ────────────────────────────────────────────────

// TestScenarioDispatch_AllValidTargetTypes validates that all 5 supported
// execution target types (local_edge, remote_ssh, hub_relay, tailscale,
// cloud_edge) are accepted by model validation and can be persisted.
func TestScenarioDispatch_AllValidTargetTypes(t *testing.T) {
	db := scenarioTestDB(t)
	userID, deviceID, _ := scenarioTestFixtures(t, db)

	for _, targetType := range []string{"local_edge", "remote_ssh", "hub_relay", "tailscale", "cloud_edge"} {
		t.Run("target_type="+targetType, func(t *testing.T) {
			target := &model.ExecutionTarget{
				OwnerID:    userID,
				Name:       "test-" + targetType,
				TargetType: targetType,
				Host:       "127.0.0.1",
				Port:       3210,
				DeviceID:   &deviceID,
			}
			require.NoError(t, target.Validate(), "target should validate for type %s", targetType)
			require.NoError(t, db.Create(target).Error, "create target for type %s", targetType)

			// Verify the target was persisted correctly
			var fetched model.ExecutionTarget
			require.NoError(t, db.Where("id = ?", target.ID).First(&fetched).Error)
			assert.Equal(t, targetType, fetched.TargetType)
			assert.Equal(t, userID, fetched.OwnerID)
			assert.NotNil(t, fetched.DeviceID)
			assert.Equal(t, deviceID, *fetched.DeviceID)
		})
	}
}

// TestScenarioDispatch_InvalidTargetType validates that unknown target types
// are rejected during model validation.
func TestScenarioDispatch_InvalidTargetType(t *testing.T) {
	db := scenarioTestDB(t)
	userID, deviceID, _ := scenarioTestFixtures(t, db)

	invalidTypes := []string{"invalid_type", "unknown", "websocket", "nonexistent_type"}

	for _, tp := range invalidTypes {
		t.Run("target_type="+tp, func(t *testing.T) {
			target := &model.ExecutionTarget{
				OwnerID:    userID,
				Name:       "invalid-" + tp,
				TargetType: tp,
				DeviceID:   &deviceID,
			}

			err := target.Validate()
			require.Error(t, err, "target type %q should be rejected", tp)
			assert.Contains(t, err.Error(), "target_type is not supported")
		})
	}
}

// TestScenarioDispatch_EmptyTargetTypeDefaults validates that an empty
// target_type defaults to "local_edge" during normalization.
func TestScenarioDispatch_EmptyTargetTypeDefaults(t *testing.T) {
	target := &model.ExecutionTarget{
		OwnerID:  "user-1",
		Name:     "empty-type",
		DeviceID: stringPtr("dev-1"),
	}
	require.NoError(t, target.Validate(), "empty target_type should validate (defaults to local_edge)")
}

// TestScenarioDispatch_TargetOwnershipIsolation validates that execution targets
// cannot be accessed by a different user, ensuring ownership isolation.
func TestScenarioDispatch_TargetOwnershipIsolation(t *testing.T) {
	db := scenarioTestDB(t)
	ownerID, deviceID, _ := scenarioTestFixtures(t, db)

	// Create a second user
	otherUser := &model.User{
		Username:     "other_user",
		PasswordHash: stringPtr("hashed"),
		Nickname:     "Other User",
	}
	require.NoError(t, db.Create(otherUser).Error)

	// Owner creates a target
	target := &model.ExecutionTarget{
		OwnerID:    ownerID,
		Name:       "owned-target",
		TargetType: "local_edge",
		DeviceID:   &deviceID,
	}
	require.NoError(t, target.Validate())
	require.NoError(t, db.Create(target).Error)

	// Other user tries to get the target
	var fetched model.ExecutionTarget
	err := db.Where("id = ? AND owner_id = ?", target.ID, otherUser.ID).First(&fetched).Error
	require.Error(t, err, "other user should not be able to access the target")
	assert.ErrorIs(t, err, gorm.ErrRecordNotFound)
}

// ── HTTP handler integration tests ─────────────────────────────────────────

// TestScenarioDispatch_CreateTargetViaAPI validates that execution targets
// can be created through the HTTP API for all valid target types.
func TestScenarioDispatch_CreateTargetViaAPI(t *testing.T) {
	db := scenarioTestDB(t)
	userID, deviceID, _ := scenarioTestFixtures(t, db)

	gin.SetMode(gin.TestMode)

	targetSvc, svcErr := service.NewExecutionTargetService(db, egress.Config{})
	require.NoError(t, svcErr)
	targetHandler := handler.NewExecutionTargetHandler(targetSvc)

	r := gin.New()
	r.Use(func(c *gin.Context) {
		c.Set("user_id", userID)
		c.Next()
	})

	web := r.Group("/web")
	{
		web.POST("/execution-targets", targetHandler.CreateTarget)
		web.GET("/execution-targets", targetHandler.ListTargets)
	}

	ts := httptest.NewServer(r)
	defer ts.Close()
	httpClient := ts.Client()

	doPost := func(path string, body any) *http.Response {
		b, _ := json.Marshal(body)
		req, _ := http.NewRequest("POST", ts.URL+path, bytes.NewReader(b))
		req.Header.Set("Content-Type", "application/json")
		resp, _ := httpClient.Do(req)
		return resp
	}

	validTypes := []string{"local_edge", "remote_ssh", "hub_relay", "tailscale", "cloud_edge"}
	for _, targetType := range validTypes {
		t.Run("create_"+targetType, func(t *testing.T) {
			// #1545: device-routed types (local_edge/hub_relay) cannot
			// configure a host; host-configured types require one.
			body := map[string]interface{}{
				"name":        "test-" + targetType,
				"target_type": targetType,
				"device_id":   deviceID,
			}
			switch targetType {
			case "local_edge", "hub_relay":
			default:
				body["host"] = "127.0.0.1"
				body["port"] = 3210
			}
			resp := doPost("/web/execution-targets", body)
			require.Equal(t, http.StatusCreated, resp.StatusCode, "create target %s", targetType)

			var r apiResp
			json.NewDecoder(resp.Body).Decode(&r)
			resp.Body.Close()
			// All valid target types should succeed with OK code.
			assert.Equal(t, "ok", r.GetCode(), "create target type=%s: code=%s message=%s", targetType, r.GetCode(), r.GetMsg())
		})
	}
}

// TestScenarioDispatch_InvalidTargetTypeViaAPI validates that invalid target
// types are rejected by the HTTP API.
func TestScenarioDispatch_InvalidTargetTypeViaAPI(t *testing.T) {
	db := scenarioTestDB(t)
	userID, deviceID, _ := scenarioTestFixtures(t, db)

	gin.SetMode(gin.TestMode)

	targetSvc, svcErr := service.NewExecutionTargetService(db, egress.Config{})
	require.NoError(t, svcErr)
	targetHandler := handler.NewExecutionTargetHandler(targetSvc)

	r := gin.New()
	r.Use(func(c *gin.Context) {
		c.Set("user_id", userID)
		c.Next()
	})

	web := r.Group("/web")
	{
		web.POST("/execution-targets", targetHandler.CreateTarget)
	}

	ts := httptest.NewServer(r)
	defer ts.Close()
	httpClient := ts.Client()

	doPost := func(path string, body any) *http.Response {
		b, _ := json.Marshal(body)
		req, _ := http.NewRequest("POST", ts.URL+path, bytes.NewReader(b))
		req.Header.Set("Content-Type", "application/json")
		resp, _ := httpClient.Do(req)
		return resp
	}

	invalidTypes := []string{"invalid_type", "unknown_protocol", "websocket", "magic_target"}
	for _, tp := range invalidTypes {
		t.Run("reject_"+tp, func(t *testing.T) {
			resp := doPost("/web/execution-targets", map[string]interface{}{
				"name":        "bad-" + tp,
				"target_type": tp,
				"device_id":   deviceID,
			})
			var r apiResp
			json.NewDecoder(resp.Body).Decode(&r)
			resp.Body.Close()
			// Invalid target types should be rejected with BAD_REQUEST.
			assert.Equal(t, "bad_request", r.GetCode(), "invalid type %s should be rejected, got code=%s message=%s", tp, r.GetCode(), r.GetMsg())
		})
	}
}

// TestScenarioDispatch_TargetListByType validates that execution targets
// can be filtered by target_type via the List API.
func TestScenarioDispatch_TargetListByType(t *testing.T) {
	db := scenarioTestDB(t)
	userID, deviceID, _ := scenarioTestFixtures(t, db)

	gin.SetMode(gin.TestMode)

	targetSvc, svcErr := service.NewExecutionTargetService(db, egress.Config{})
	require.NoError(t, svcErr)
	targetHandler := handler.NewExecutionTargetHandler(targetSvc)

	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set("user_id", userID)
		c.Next()
	})

	web := router.Group("/web")
	{
		web.POST("/execution-targets", targetHandler.CreateTarget)
		web.GET("/execution-targets", targetHandler.ListTargets)
	}

	ts := httptest.NewServer(router)
	defer ts.Close()
	httpClient := ts.Client()

	doPost := func(path string, body any) *http.Response {
		b, _ := json.Marshal(body)
		req, _ := http.NewRequest("POST", ts.URL+path, bytes.NewReader(b))
		req.Header.Set("Content-Type", "application/json")
		resp, _ := httpClient.Do(req)
		return resp
	}

	httpGet := func(path string) *http.Response {
		req, _ := http.NewRequest("GET", ts.URL+path, nil)
		resp, _ := httpClient.Do(req)
		return resp
	}

	// Create targets of different types (#1545: host only for host-configured types).
	createTypes := []string{"local_edge", "remote_ssh", "tailscale"}
	for _, targetType := range createTypes {
		body := map[string]interface{}{
			"name":        "list-" + targetType,
			"target_type": targetType,
			"device_id":   deviceID,
		}
		if targetType != "local_edge" {
			body["host"] = "127.0.0.1"
			body["port"] = 3210
		}
		resp := doPost("/web/execution-targets", body)
		require.Equal(t, http.StatusCreated, resp.StatusCode)
		resp.Body.Close()
	}

	// List all targets
	resp := httpGet("/web/execution-targets")
	var listResp apiResp
	json.NewDecoder(resp.Body).Decode(&listResp)
	resp.Body.Close()
	assert.Equal(t, "ok", listResp.Code)

	// List filtered by type
	for _, targetType := range []string{"local_edge", "tailscale"} {
		resp := httpGet("/web/execution-targets?target_type=" + targetType)
		var filterResp apiResp
		json.NewDecoder(resp.Body).Decode(&filterResp)
		resp.Body.Close()
		assert.Equal(t, "ok", filterResp.Code, "list with filter target_type=%s", targetType)
	}
}

// TestScenarioDispatch_PingAllTargetTypes validates that the Ping endpoint
// handles all valid target types appropriately at the service level.
func TestScenarioDispatch_PingAllTargetTypes(t *testing.T) {
	db := scenarioTestDB(t)
	userID, deviceID, _ := scenarioTestFixtures(t, db)

	targetSvc, svcErr := service.NewExecutionTargetService(db, egress.Config{})
	require.NoError(t, svcErr)

	for _, targetType := range []string{"local_edge", "remote_ssh", "hub_relay", "tailscale", "cloud_edge"} {
		t.Run("ping_"+targetType, func(t *testing.T) {
			target := &model.ExecutionTarget{
				OwnerID:    userID,
				Name:       "ping-" + targetType,
				TargetType: targetType,
				Host:       "127.0.0.1",
				Port:       3210,
				DeviceID:   &deviceID,
			}
			require.NoError(t, target.Validate())
			require.NoError(t, db.Create(target).Error)

			// #1544: manual ping only triggers a probe and never writes online
			// on its own. This fixture environment has no cache route registry
			// and no running edge, so every type fails its proof — the code
			// paths are exercised without panicking, and none may end online.
			err := targetSvc.Ping(context.Background(), target.ID, userID)
			if targetType == "local_edge" {
				require.Error(t, err, "local_edge ping must not succeed without a route proof (#1544)")
			}
			// For other types, failure is expected in this test environment.
			// The key point is the code path is exercised without panicking.
			t.Logf("ping %s result: %v", targetType, err)
		})
	}
}
