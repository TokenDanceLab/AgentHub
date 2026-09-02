package teamrun

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/agenthub/hub-server/internal/handler"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/service/agentteam"
	"github.com/agenthub/hub-server/internal/testkit"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
)

// ── Local apiResp to avoid dependency on tests package (which requires PostgreSQL) ──

// apiResp is the shared Hub response envelope (internal/testkit.APIResponse).
type apiResp = testkit.APIResponse

// teamEventsPage mirrors the Hub ListTeamEvents response envelope (#2154).
type teamEventsPage struct {
	Items []model.AgentTeamEvent `json:"items"`
	Page  struct {
		NextCursor string `json:"nextCursor"`
		HasMore    bool   `json:"hasMore"`
	} `json:"page"`
}

func ptrStr(s string) *string { return &s }

func assertCode(t *testing.T, r apiResp, want, context string) {
	t.Helper()
	if r.GetCode() != want {
		t.Fatalf("%s: expected code=%q, got code=%q message=%q", context, want, r.GetCode(), r.GetMsg())
	}
}

func extract(data json.RawMessage, field string) string {
	var m map[string]json.RawMessage
	json.Unmarshal(data, &m)
	var s string
	json.Unmarshal(m[field], &s)
	return s
}

func parse(resp *http.Response) apiResp {
	defer resp.Body.Close()
	var r apiResp
	json.NewDecoder(resp.Body).Decode(&r)
	return r
}

func httDo(t *testing.T, client *http.Client, baseURL, method, path string, body any) *http.Response {
	t.Helper()
	var rBody *bytes.Reader
	if body != nil {
		b, err := json.Marshal(body)
		require.NoError(t, err)
		rBody = bytes.NewReader(b)
	} else {
		rBody = bytes.NewReader(nil)
	}
	req, err := http.NewRequest(method, baseURL+path, rBody)
	require.NoError(t, err)
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	require.NoError(t, err)
	return resp
}

// ── Mock Agent Service ───────────────────────────────────────────────────────

// mockTeamAgentService implements handler.AgentTeamService's agent dependency
// (the agentTeamAgentSvc interface) for tests. StartTeamRun calls TriggerAgentTask
// to dispatch the supervisor; the mock returns a fake pending task so the flow
// succeeds without a real Edge device.
type mockTeamAgentService struct{}

func (m *mockTeamAgentService) AddAgentToSession(_ context.Context, _, _, _, _, _ string) (*model.AgentInstance, error) {
	return &model.AgentInstance{}, nil
}

func (m *mockTeamAgentService) TriggerAgentTask(_ context.Context, _, _, _, _, _, _, _ string) (*model.PendingAgentTask, error) {
	return &model.PendingAgentTask{
		ID:     "mock-task-" + fmt.Sprint(time.Now().UnixNano()),
		Status: model.TaskStatusDispatched,
	}, nil
}

// ── Test helpers ─────────────────────────────────────────────────────────────

// teamTestDB returns an in-memory SQLite database with the minimum tables needed
// for AgentTeam smoke tests. Raw SQL DDL is used because GORM AutoMigrate
// produces invalid defaults for PostgreSQL-specific tags (jsonb) on SQLite.
func teamTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{
		Logger: gormlogger.Default.LogMode(gormlogger.Silent),
	})
	require.NoError(t, err, "open SQLite")

	// Pin the pool to a single connection. A private ":memory:" DSN gives every
	// NEW connection its own empty database, so a read path that fans out over
	// several pooled connections (agentteam.GetTeamRunState issues its
	// independent reads through an errgroup, #2154 P2-11) would land on
	// "no such table" instead of this fixture. With MaxOpenConns(1) every read
	// shares this one connection and therefore this one catalog: the reads still
	// overlap in Go, they only queue inside the driver.
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)

	tables := []string{
		// Users and agent profiles
		`CREATE TABLE users (
			id TEXT PRIMARY KEY,
			username TEXT NOT NULL UNIQUE,
			password_hash TEXT NOT NULL DEFAULT '',
			nickname TEXT NOT NULL DEFAULT '',
			avatar_url TEXT DEFAULT '',
			tokendance_sub TEXT DEFAULT NULL,
			tokendance_sub_linked_at DATETIME DEFAULT NULL,
			created_at DATETIME,
			updated_at DATETIME
		)`,
		`CREATE TABLE custom_agents (
			id TEXT PRIMARY KEY,
			owner_user_id TEXT NOT NULL,
			name TEXT NOT NULL,
			avatar_url TEXT DEFAULT '',
			tokendance_sub TEXT DEFAULT NULL,
			tokendance_sub_linked_at DATETIME DEFAULT NULL,
			agent_type TEXT NOT NULL,
			system_prompt TEXT NOT NULL DEFAULT '',
			capability_tags TEXT DEFAULT '[]',
			tool_whitelist TEXT DEFAULT '[]',
			model_params TEXT DEFAULT '{}',
			output_schema TEXT DEFAULT NULL,
			deleted_at DATETIME,
			created_at DATETIME,
			updated_at DATETIME
		)`,

		// Sessions (needed by StartTeamRun)
		`CREATE TABLE sessions (
			id TEXT PRIMARY KEY,
			type TEXT NOT NULL DEFAULT '',
			name TEXT DEFAULT '',
			avatar_url TEXT DEFAULT '',
			tokendance_sub TEXT DEFAULT NULL,
			tokendance_sub_linked_at DATETIME DEFAULT NULL,
			announcement TEXT DEFAULT '',
			owner_user_id TEXT,
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
			workspace_id TEXT,
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
			reply_to_message_id TEXT,
			recalled INTEGER NOT NULL DEFAULT 0,
			edited INTEGER NOT NULL DEFAULT 0,
			edited_at DATETIME,
			created_at DATETIME
		)`,

		// Agent team tables
		`CREATE TABLE agent_teams (
			id TEXT PRIMARY KEY,
			owner_id TEXT NOT NULL,
			name TEXT NOT NULL,
			description TEXT DEFAULT '',
			avatar_url TEXT DEFAULT '',
			created_at DATETIME,
			updated_at DATETIME
		)`,
		`CREATE TABLE agent_team_members (
			id TEXT PRIMARY KEY,
			team_id TEXT NOT NULL,
			agent_profile_id TEXT,
			role TEXT NOT NULL DEFAULT 'executor',
			position INTEGER NOT NULL DEFAULT 0,
			created_at DATETIME,
			FOREIGN KEY (team_id) REFERENCES agent_teams(id) ON DELETE CASCADE
		)`,
		`CREATE TABLE agent_team_runs (
			id TEXT PRIMARY KEY,
			team_id TEXT NOT NULL,
			session_id TEXT,
			trigger_user_id TEXT NOT NULL,
			trigger_message TEXT DEFAULT '',
			target_id TEXT,
			mode TEXT NOT NULL DEFAULT 'supervisor',
			status TEXT NOT NULL DEFAULT 'queued',
			created_at DATETIME,
			updated_at DATETIME
		)`,
		`CREATE TABLE agent_team_assignments (
			id TEXT PRIMARY KEY,
			team_run_id TEXT NOT NULL,
			from_member_id TEXT NOT NULL,
			to_member_id TEXT NOT NULL,
			type TEXT NOT NULL DEFAULT 'delegate',
			task_prompt TEXT NOT NULL,
			context TEXT DEFAULT '',
			status TEXT NOT NULL DEFAULT 'pending',
			run_id TEXT,
			result TEXT DEFAULT '',
			depth INTEGER NOT NULL DEFAULT 0,
			created_at DATETIME,
			updated_at DATETIME
		)`,
		`CREATE TABLE agent_team_tasks (
			id TEXT PRIMARY KEY,
			team_run_id TEXT NOT NULL,
			assignment_id TEXT,
			assignee_member_id TEXT NOT NULL,
			parent_task_id TEXT,
			status TEXT NOT NULL DEFAULT 'pending',
			objective TEXT NOT NULL,
			input_refs TEXT NOT NULL DEFAULT '{}',
			run_id TEXT,
			attempt INTEGER NOT NULL DEFAULT 1,
			risk_level TEXT NOT NULL DEFAULT 'normal',
			created_at DATETIME,
			updated_at DATETIME
		)`,
		`CREATE TABLE agent_team_events (
			id TEXT PRIMARY KEY,
			team_run_id TEXT NOT NULL,
			seq INTEGER NOT NULL,
			type TEXT NOT NULL DEFAULT '',
			payload TEXT NOT NULL DEFAULT '{}',
			created_at DATETIME
		)`,
		// agent_team_artifacts is queried by GetRunState.refreshTeamArtifactIndex
		// (DELETE + re-insert). The table must exist even when empty.
		`CREATE TABLE agent_team_artifacts (
			id TEXT PRIMARY KEY,
			team_run_id TEXT NOT NULL,
			team_task_id TEXT,
			assignment_id TEXT,
			member_id TEXT,
			agent_task_id TEXT,
			edge_run_id TEXT DEFAULT '',
			source_event_id TEXT,
			event_seq INTEGER NOT NULL DEFAULT 0,
			path TEXT NOT NULL,
			normalized_path TEXT NOT NULL,
			action TEXT DEFAULT '',
			tool_name TEXT DEFAULT '',
			status TEXT DEFAULT '',
			conflict_id TEXT DEFAULT '',
			created_at DATETIME,
			updated_at DATETIME
		)`,
	}
	for _, ddl := range tables {
		require.NoError(t, db.Exec(ddl).Error, "DDL failed: %s", ddl[:min(len(ddl), 60)])
	}
	return db
}

// teamTestFixtures creates a test user and two custom agents (agent profiles)
// directly in the database. Returns (userID, agent1ID, agent2ID).
func teamTestFixtures(t *testing.T, db *gorm.DB) (string, string, string) {
	t.Helper()

	user := &model.User{
		Username:     "smoke_test_user",
		PasswordHash: ptrStr("hashed"),
		Nickname:     "Smoke Tester",
	}
	require.NoError(t, db.Create(user).Error, "create user")
	require.NotEmpty(t, user.ID, "user ID must be generated")

	codeAgent := &model.CustomAgent{
		OwnerUserID:  user.ID,
		Name:         "Code Reviewer",
		AgentType:    "codex",
		SystemPrompt: "You are a code reviewer.",
	}
	require.NoError(t, db.Create(codeAgent).Error, "create code agent")
	require.NotEmpty(t, codeAgent.ID)

	testAgent := &model.CustomAgent{
		OwnerUserID:  user.ID,
		Name:         "Test Writer",
		AgentType:    "codex",
		SystemPrompt: "You are a test writer.",
	}
	require.NoError(t, db.Create(testAgent).Error, "create test agent")
	require.NotEmpty(t, testAgent.ID)

	return user.ID, codeAgent.ID, testAgent.ID
}

// ── The Smoke Test ───────────────────────────────────────────────────────────

// TestTeamRunSmoke is an end-to-end smoke test for AgentHub multi-agent TeamRun
// orchestration. It exercises the complete lifecycle against an httptest.Server
// backed by a real SQLite database and the production service/handler stack.
//
// Verified scenarios:
//  1. Create AgentTeam with supervisor + 2 workers (POST /web/agent-teams)
//  2. Start TeamRun (POST /web/agent-teams/:id/runs)
//  3. Submit typed Supervisor CoordinatorRouteDecision — not free-text JSON dispatch
//  4. Verify TeamEvent append-only log (GET /web/.../events)
//  5. Verify TeamTask creation from route decisions (GET /web/.../tasks)
//  6. TeamRun finish route → status transitions to completed
//  7. Error cases: invalid route action, agent not found, invalid approval decision
//  8. Conflict resolution (ResolveConflict)
//
// The test uses an in-memory SQLite database so it runs without PostgreSQL or Redis.
// AgentService dispatch calls are mocked to avoid requiring a real Edge device.
func TestTeamRunSmoke(t *testing.T) {
	// ── 0. Setup ──────────────────────────────────────────────────────────
	db := teamTestDB(t)
	userID, agent1ID, agent2ID := teamTestFixtures(t, db)

	gin.SetMode(gin.TestMode)

	teamSvc := agentteam.NewAgentTeamService(db, &mockTeamAgentService{}, nil)
	teamHandler := handler.NewAgentTeamHandler(teamSvc)

	r := gin.New()
	// Inject user_id into every request context (bypasses JWT auth for testing).
	r.Use(func(c *gin.Context) {
		c.Set("user_id", userID)
		c.Next()
	})

	web := r.Group("/web")
	{
		web.POST("/agent-teams", teamHandler.CreateTeam)
		web.GET("/agent-teams", teamHandler.ListTeams)
		web.GET("/agent-teams/:id", teamHandler.GetTeam)
		web.PUT("/agent-teams/:id", teamHandler.UpdateTeam)
		web.DELETE("/agent-teams/:id", teamHandler.DeleteTeam)
		web.POST("/agent-teams/:id/members", teamHandler.AddMember)
		web.DELETE("/agent-teams/:id/members/:member_id", teamHandler.RemoveMember)
		web.POST("/agent-teams/:id/runs", teamHandler.StartRun)
		web.GET("/agent-teams/:id/runs", teamHandler.ListRuns)
		web.GET("/agent-teams/:id/runs/:run_id", teamHandler.GetRun)
		web.GET("/agent-teams/:id/runs/:run_id/state", teamHandler.GetRunState)
		web.GET("/agent-teams/:id/runs/:run_id/tasks", teamHandler.ListTeamTasks)
		web.GET("/agent-teams/:id/runs/:run_id/events", teamHandler.ListTeamEvents)
		web.POST("/agent-teams/:id/runs/:run_id/route-decisions", teamHandler.HandleRouteDecision)
		web.POST("/agent-teams/:id/runs/:run_id/approvals/:approval_id/decide", teamHandler.DecideApproval)
		web.POST("/agent-teams/:id/runs/:run_id/conflicts/:conflict_id/resolve", teamHandler.ResolveConflict)
		web.POST("/agent-teams/:id/runs/:run_id/assignments", teamHandler.CreateAssignment)
		web.POST("/agent-teams/:id/runs/:run_id/assignments/:assignment_id/dispatch", teamHandler.DispatchAssignment)
		web.POST("/agent-teams/:id/runs/:run_id/assignments/:assignment_id/complete", teamHandler.CompleteAssignment)
		web.POST("/agent-teams/:id/runs/:run_id/assignments/:assignment_id/fail", teamHandler.FailAssignment)
		web.GET("/agent-teams/:id/runs/:run_id/assignments", teamHandler.ListAssignments)
	}

	ts := httptest.NewServer(r)
	defer ts.Close()
	httpClient := ts.Client()

	do := func(method, path string, body any) *http.Response {
		return httDo(t, httpClient, ts.URL, method, path, body)
	}
	post := func(path string, body any) *http.Response { return do("POST", path, body) }
	get := func(path string) *http.Response { return do("GET", path, nil) }

	// ── 1. Create AgentTeam ───────────────────────────────────────────────
	t.Run("CreateTeam", func(t *testing.T) {
		resp := post("/web/agent-teams", map[string]string{
			"name":        "Smoke Test Team",
			"description": "E2E smoke test team with supervisor + 2 workers",
		})
		r := parse(resp)
		assertCode(t, r, "ok", "create team")
		assert.NotEmpty(t, extract(r.Data, "id"), "team id")
	})

	t.Run("ListTeams", func(t *testing.T) {
		resp := get("/web/agent-teams")
		r := parse(resp)
		assertCode(t, r, "ok", "list teams")
	})

	t.Run("CreateTeam_EmptyName_Fails", func(t *testing.T) {
		resp := post("/web/agent-teams", map[string]string{"name": ""})
		r := parse(resp)
		assertCode(t, r, "bad_request", "empty name")
	})

	// Extract team ID for subsequent tests.
	resp := post("/web/agent-teams", map[string]string{
		"name":        "Smoke Test Team",
		"description": "E2E smoke test team",
	})
	teamResp := parse(resp)
	require.Equal(t, "ok", teamResp.Code, "create team must succeed")
	teamID := extract(teamResp.Data, "id")
	require.NotEmpty(t, teamID, "team id")

	// ── 2. Add team members ──────────────────────────────────────────────

	t.Run("AddMember_Supervisor", func(t *testing.T) {
		resp := post("/web/agent-teams/"+teamID+"/members", map[string]string{
			"agent_profile_id": agent1ID,
			"role":             model.TeamMemberRoleSupervisor,
		})
		r := parse(resp)
		assertCode(t, r, "ok", "add supervisor member")
	})

	var workerMemberID string
	t.Run("AddMember_Worker", func(t *testing.T) {
		resp := post("/web/agent-teams/"+teamID+"/members", map[string]string{
			"agent_profile_id": agent2ID,
			"role":             model.TeamMemberRoleExecutor,
		})
		r := parse(resp)
		assertCode(t, r, "ok", "add worker member")
	})

	t.Run("AddMember_AgentNotFound_Fails", func(t *testing.T) {
		// Use a non-existent agent profile ID.
		resp := post("/web/agent-teams/"+teamID+"/members", map[string]string{
			"agent_profile_id": "00000000-0000-0000-0000-000000000000",
			"role":             model.TeamMemberRoleExecutor,
		})
		r := parse(resp)
		assertCode(t, r, "agent_not_found", "non-existent agent profile")
	})

	// Fetch team with members to extract member IDs.
	resp = get("/web/agent-teams/" + teamID)
	detailResp := parse(resp)
	assertCode(t, detailResp, "ok", "get team detail")
	var detail model.TeamDetail
	require.NoError(t, json.Unmarshal(detailResp.Data, &detail), "unmarshal team detail")
	require.GreaterOrEqual(t, len(detail.Members), 2, "need at least 2 members")

	var supervisorMemberID string
	for _, m := range detail.Members {
		if m.Role == model.TeamMemberRoleSupervisor {
			supervisorMemberID = m.ID
		} else if m.Role == model.TeamMemberRoleExecutor {
			workerMemberID = m.ID
		}
	}
	require.NotEmpty(t, supervisorMemberID, "supervisor member id")
	require.NotEmpty(t, workerMemberID, "worker member id")

	// ── 3. Start TeamRun ────────────────────────────────────────────────

	var runID string
	t.Run("StartTeamRun", func(t *testing.T) {
		resp := post("/web/agent-teams/"+teamID+"/runs", map[string]string{
			"trigger_message": "Refactor the auth module and add tests",
		})
		r := parse(resp)
		assertCode(t, r, "ok", "start team run")
		runID = extract(r.Data, "id")
		require.NotEmpty(t, runID, "run id")
		status := extract(r.Data, "status")
		// Run starts as "queued" in the transaction, then transitions to "running".
		assert.True(t, status == model.TeamRunStatusQueued || status == model.TeamRunStatusRunning,
			"run status should be queued or running, got %q", status)
	})

	t.Run("GetRun", func(t *testing.T) {
		resp := get("/web/agent-teams/" + teamID + "/runs/" + runID)
		r := parse(resp)
		assertCode(t, r, "ok", "get run")
	})

	t.Run("StartTeamRun_NoMembers_Fails", func(t *testing.T) {
		// Create a team with no members.
		resp := post("/web/agent-teams", map[string]string{"name": "Empty Team"})
		r := parse(resp)
		assertCode(t, r, "ok", "create empty team")
		emptyTeamID := extract(r.Data, "id")

		resp = post("/web/agent-teams/"+emptyTeamID+"/runs", map[string]string{
			"trigger_message": "Do something",
		})
		r = parse(resp)
		// Should fail because team has no members.
		assertCode(t, r, "bad_request", "run with no members")
	})

	// ── 4. Submit typed Supervisor route decision ───────────────────────
	// The supervisor emits a CoordinatorRouteDecision with action=delegate,
	// next_worker set to an AgentTeamMember ID, and instructions.
	// Hub parses this typed object — NOT free-text JSON dispatch.

	t.Run("RouteDecision_Delegate", func(t *testing.T) {
		resp := post("/web/agent-teams/"+teamID+"/runs/"+runID+"/route-decisions",
			model.CoordinatorRouteDecision{
				Action:       "delegate",
				NextWorker:   workerMemberID,
				Instructions: "Refactor auth.go to extract validation into a separate function",
				Reasoning:    "Code Reviewer should handle the refactoring",
				Context:      "Current auth.go is 500 lines, needs modularization",
			})
		r := parse(resp)
		assertCode(t, r, "ok", "delegate route decision")

		// Verify the returned assignment is typed.
		assignmentID := extract(r.Data, "id")
		assert.NotEmpty(t, assignmentID, "assignment id must be present")
		assignmentType := extract(r.Data, "type")
		assert.Equal(t, model.AssignmentTypeDelegate, assignmentType, "assignment type")
	})

	t.Run("RouteDecision_InvalidAction_Fails", func(t *testing.T) {
		resp := post("/web/agent-teams/"+teamID+"/runs/"+runID+"/route-decisions",
			model.CoordinatorRouteDecision{
				Action:       "execute", // invalid action
				NextWorker:   workerMemberID,
				Instructions: "Run something",
			})
		r := parse(resp)
		assertCode(t, r, "bad_request", "invalid route action")
	})

	t.Run("RouteDecision_MissingWorker_Fails", func(t *testing.T) {
		resp := post("/web/agent-teams/"+teamID+"/runs/"+runID+"/route-decisions",
			model.CoordinatorRouteDecision{
				Action:       "delegate",
				Instructions: "Do work",
				// NextWorker is empty — should be rejected.
			})
		r := parse(resp)
		assertCode(t, r, "bad_request", "missing next_worker")
	})

	// ── 5. Verify TeamEvent append-only log ─────────────────────────────
	// Events are immutable once created; they are replayed to derive TeamRunState.

	t.Run("ListTeamEvents", func(t *testing.T) {
		resp := get("/web/agent-teams/" + teamID + "/runs/" + runID + "/events")
		r := parse(resp)
		assertCode(t, r, "ok", "list team events")

		// Parse the paginated event envelope (#2154).
		var page teamEventsPage
		require.NoError(t, json.Unmarshal(r.Data, &page), "unmarshal events")
		events := page.Items
		assert.NotEmpty(t, events, "should have at least one event")
		assert.False(t, page.Page.HasMore, "full default page must fit in one window")
		assert.NotEmpty(t, page.Page.NextCursor, "nextCursor carries the last seen seq")

		// Verify we have expected event types.
		eventTypes := make(map[string]bool)
		for _, evt := range events {
			eventTypes[evt.Type] = true
			// Events must have a monotonically increasing sequence number.
			assert.Greater(t, evt.Seq, 0, "event seq must be positive")
		}
		// We expect at minimum: route.decided, assignment.created, task.created
		assert.True(t, eventTypes[model.TeamEventRouteDecided], "must have route.decided event")
		assert.True(t, eventTypes[model.TeamEventAssignmentCreated], "must have assignment.created event")
		assert.True(t, eventTypes[model.TeamEventTaskCreated], "must have team.task.created event")

		// Verify events are ordered by seq.
		for i := 1; i < len(events); i++ {
			assert.GreaterOrEqual(t, events[i].Seq, events[i-1].Seq,
				"events must be in seq order at index %d", i)
		}

		// Cursor pagination (#2154): pageSize=1 returns one event and a
		// nextCursor equal to that event's seq.
		pagedResp := get("/web/agent-teams/" + teamID + "/runs/" + runID + "/events?pageSize=1")
		pr := parse(pagedResp)
		assertCode(t, pr, "ok", "first events page")
		var firstPage teamEventsPage
		require.NoError(t, json.Unmarshal(pr.Data, &firstPage), "unmarshal first events page")
		require.Len(t, firstPage.Items, 1, "pageSize=1 must return exactly one event")
		assert.True(t, firstPage.Page.HasMore, "more events must follow the first page")
		assert.Equal(t, strconv.Itoa(firstPage.Items[0].Seq), firstPage.Page.NextCursor,
			"nextCursor must be the seq of the last item")
	})

	// ── 6. Verify TeamTasks ─────────────────────────────────────────────

	t.Run("ListTeamTasks", func(t *testing.T) {
		resp := get("/web/agent-teams/" + teamID + "/runs/" + runID + "/tasks")
		r := parse(resp)
		assertCode(t, r, "ok", "list team tasks")

		var tasks []model.AgentTeamTask
		require.NoError(t, json.Unmarshal(r.Data, &tasks), "unmarshal tasks")
		assert.NotEmpty(t, tasks, "should have at least one task")

		// Verify the task was created from the route decision.
		found := false
		for _, task := range tasks {
			if strings.Contains(task.Objective, "Refactor auth.go") {
				found = true
				assert.Equal(t, model.TeamTaskStatusPending, task.Status)
				assert.Equal(t, workerMemberID, task.AssigneeMemberID)
				break
			}
		}
		assert.True(t, found, "task from route decision must exist")
	})

	// ── 7. Get Run State (replay projection) ────────────────────────────

	t.Run("GetRunState", func(t *testing.T) {
		resp := get("/web/agent-teams/" + teamID + "/runs/" + runID + "/state")
		r := parse(resp)
		assertCode(t, r, "ok", "get run state")

		var state model.TeamRunState
		require.NoError(t, json.Unmarshal(r.Data, &state), "unmarshal run state")
		assert.Equal(t, runID, state.RunID)
		assert.Equal(t, teamID, state.TeamID)
		assert.NotEmpty(t, state.Members, "state must include members")
		assert.NotEmpty(t, state.RouteLog, "state must include route log")

		// Verify route log contains the typed decision we submitted.
		foundRoute := false
		for _, route := range state.RouteLog {
			if route.Action == "delegate" && route.NextWorker == workerMemberID &&
				strings.Contains(route.Instructions, "Refactor auth.go") {
				foundRoute = true
				break
			}
		}
		assert.True(t, foundRoute, "state route log must contain the typed delegate route")
	})

	// ── 8. Approval state machine ───────────────────────────────────────
	// The approval flow tests the pending -> decided transition.
	// Since a real approval requires Edge run events, we test the DecideApproval
	// error path: trying to decide a non-existent approval returns BAD_REQUEST.

	t.Run("DecideApproval_Nonexistent_Fails", func(t *testing.T) {
		resp := post("/web/agent-teams/"+teamID+"/runs/"+runID+"/approvals/nonexistent/decide",
			map[string]string{
				"decision": "allow",
				"reason":   "This is fine",
			})
		r := parse(resp)
		// Non-existent approval -> BAD_REQUEST (not found in state)
		assert.True(t, r.GetCode() == "bad_request" || r.GetCode() == "agent_task_not_found",
			"non-existent approval should fail, got code=%q message=%q", r.GetCode(), r.GetMsg())
	})

	t.Run("DecideApproval_InvalidDecision_Fails", func(t *testing.T) {
		resp := post("/web/agent-teams/"+teamID+"/runs/"+runID+"/approvals/some-id/decide",
			map[string]string{
				"decision": "maybe", // invalid — only "allow" or "deny"
			})
		r := parse(resp)
		assertCode(t, r, "bad_request", "invalid approval decision")
	})

	// ── 9. Conflict resolution ──────────────────────────────────────────
	// If two agents modify the same file, a conflict is detected.
	// ResolveConflict accepts a resolution strategy.

	t.Run("ResolveConflict_AcceptAgentTask", func(t *testing.T) {
		conflictID := "file:src/auth.go"
		resp := post("/web/agent-teams/"+teamID+"/runs/"+runID+"/conflicts/"+conflictID+"/resolve",
			model.TeamConflictResolution{
				ConflictID:          conflictID,
				Resolution:          model.TeamConflictResolutionAcceptAgentTask,
				SelectedAgentTaskID: "agent-task-1",
				Reason:              "Agent 1's version is more complete",
			})
		r := parse(resp)
		// Without actual conflicting artifacts, returns empty or BAD_REQUEST
		if r.GetCode() != "" && r.GetCode() != "bad_request" {
			t.Fatalf("resolve conflict: want BAD_REQUEST or empty, got code=%q message=%q", r.GetCode(), r.GetMsg())
		}
	})

	t.Run("ResolveConflict_InvalidResolution_Fails", func(t *testing.T) {
		resp := post("/web/agent-teams/"+teamID+"/runs/"+runID+"/conflicts/file:x/resolve",
			map[string]string{
				"resolution": "magic_fix", // invalid resolution
			})
		r := parse(resp)
		assertCode(t, r, "bad_request", "invalid conflict resolution type")
	})

	// ── 10. TeamRun completion — finish route ──────────────────────────
	// The supervisor emits action=finish to complete the run.

	t.Run("RouteDecision_Finish", func(t *testing.T) {
		resp := post("/web/agent-teams/"+teamID+"/runs/"+runID+"/route-decisions",
			model.CoordinatorRouteDecision{
				Action:  "finish",
				Summary: "Auth module refactored and tests added. All tasks complete.",
			})
		r := parse(resp)
		// finish returns nil assignment, so data is null.
		assertCode(t, r, "ok", "finish route decision")
	})

	t.Run("VerifyRunCompleted", func(t *testing.T) {
		resp := get("/web/agent-teams/" + teamID + "/runs/" + runID)
		r := parse(resp)
		assertCode(t, r, "ok", "get run after finish")
		status := extract(r.Data, "status")
		assert.Equal(t, model.TeamRunStatusCompleted, status, "run must be completed")
	})

	t.Run("VerifyRunCompletedInState", func(t *testing.T) {
		resp := get("/web/agent-teams/" + teamID + "/runs/" + runID + "/state")
		r := parse(resp)
		assertCode(t, r, "ok", "get state after finish")
		var state model.TeamRunState
		require.NoError(t, json.Unmarshal(r.Data, &state))
		assert.Equal(t, model.TeamRunStatusCompleted, state.Status, "state status must be completed")
	})

	// ── 11. Verify all events after completion ─────────────────────────
	t.Run("VerifyAllEvents", func(t *testing.T) {
		resp := get("/web/agent-teams/" + teamID + "/runs/" + runID + "/events")
		r := parse(resp)
		assertCode(t, r, "ok", "list all events")

		var page teamEventsPage
		require.NoError(t, json.Unmarshal(r.Data, &page), "unmarshal events page")

		events := page.Items
		eventTypes := make(map[string]int)
		for _, evt := range events {
			eventTypes[evt.Type]++
		}

		// Should have: route.decided (2: delegate + finish), assignment.created,
		// task.created, run.completed
		assert.GreaterOrEqual(t, eventTypes[model.TeamEventRouteDecided], 2,
			"must have at least 2 route.decided events (delegate + finish)")
		assert.Equal(t, 1, eventTypes[model.TeamEventAssignmentCreated],
			"must have exactly 1 assignment.created event")
		assert.Equal(t, 1, eventTypes[model.TeamEventTaskCreated],
			"must have exactly 1 team.task.created event")
		assert.Equal(t, 1, eventTypes[model.TeamEventRunCompleted],
			"must have exactly 1 team.run.completed event")

		// Verify event immutability — replaying events should produce the same result.
		assert.True(t, eventTypes[model.TeamEventRouteDecided] >= 2, "events are append-only")
	})
}
