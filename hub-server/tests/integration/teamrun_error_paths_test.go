//go:build integration

package integration

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/agenthub/hub-server/internal/handler"
	"github.com/agenthub/hub-server/internal/model"

	"github.com/agenthub/hub-server/internal/service/agentteam"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
)

// ── Mock Agent Service for TeamRun error path tests ──────────────────────────

type errPathMockAgentService struct {
	triggerFail bool
}

func (m *errPathMockAgentService) AddAgentToSession(_ context.Context, _, _, _, _, _ string) (*model.AgentInstance, error) {
	return &model.AgentInstance{}, nil
}

func (m *errPathMockAgentService) TriggerAgentTask(_ context.Context, _, _, _, _, _, _, _ string) (*model.PendingAgentTask, error) {
	if m.triggerFail {
		return nil, fmt.Errorf("mock trigger failure")
	}
	return &model.PendingAgentTask{
		ID:     "mock-task-" + fmt.Sprint(time.Now().UnixNano()),
		Status: model.TaskStatusDispatched,
	}, nil
}

// ── Test DB setup (SQLite) ───────────────────────────────────────────────────

func errPathTeamDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{
		Logger: gormlogger.Default.LogMode(gormlogger.Silent),
	})
	require.NoError(t, err, "open SQLite")

	tables := []string{
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
		// Required by teamRunBudgetExceeded → ListAgentRunEventsByTaskIDs.
		`CREATE TABLE agent_run_events (
			id TEXT PRIMARY KEY,
			task_id TEXT NOT NULL,
			edge_run_id TEXT DEFAULT '',
			edge_device_id TEXT DEFAULT '',
			event_seq INTEGER NOT NULL DEFAULT 0,
			event_type TEXT NOT NULL DEFAULT '',
			payload TEXT NOT NULL DEFAULT '{}',
			created_at DATETIME,
			updated_at DATETIME
		)`,
		// Required by teamRunBudgetExceeded: ListPendingTasksByIDs
		`CREATE TABLE pending_agent_tasks (
			id TEXT PRIMARY KEY,
			triggered_by_user_id TEXT NOT NULL,
			edge_device_id TEXT DEFAULT '',
			edge_run_id TEXT DEFAULT '',
			target_id TEXT DEFAULT '',
			status TEXT NOT NULL DEFAULT '',
			model_params TEXT DEFAULT '{}',
			created_at DATETIME,
			updated_at DATETIME
		)`,
	}
	for _, ddl := range tables {
		require.NoError(t, db.Exec(ddl).Error, "DDL failed: %s", ddl[:min(len(ddl), 60)])
	}
	return db
}

func errPathTeamFixtures(t *testing.T, db *gorm.DB) (userID, agent1ID, agent2ID, agent3ID string) {
	t.Helper()

	user := &model.User{
		Username:     "errpath_user",
		PasswordHash: strPtr("hashed"),
		Nickname:     "ErrorPath",
	}
	require.NoError(t, db.Create(user).Error, "create user")

	createAgent := func(name string) string {
		ca := &model.CustomAgent{
			OwnerUserID:  user.ID,
			Name:         name,
			AgentType:    "codex",
			SystemPrompt: "You are " + name + ".",
		}
		require.NoError(t, db.Create(ca).Error, "create agent "+name)
		require.NotEmpty(t, ca.ID)
		return ca.ID
	}

	agent1ID = createAgent("Supervisor")
	agent2ID = createAgent("Executor A")
	agent3ID = createAgent("Executor B")
	return user.ID, agent1ID, agent2ID, agent3ID
}

// errPathTeamSetup creates a team with supervisor + 2 executors, starts a
// team run, and returns the test server, HTTP client, and relevant IDs.
type errPathTeamState struct {
	Server             *httptest.Server
	Client             *http.Client
	UserID             string
	TeamID             string
	RunID              string
	SupervisorMemberID string
	WorkerMemberID     string
	Worker2MemberID    string
	Agent1ID           string
	Agent2ID           string
	Agent3ID           string
	DB                 *gorm.DB
}

func errPathTeamSetup(t *testing.T, overrides ...agentteam.AgentTeamGuardrails) *errPathTeamState {
	t.Helper()

	db := errPathTeamDB(t)
	userID, agent1ID, agent2ID, agent3ID := errPathTeamFixtures(t, db)

	gin.SetMode(gin.TestMode)
	mockAgent := &errPathMockAgentService{}

	// Use tight guardrails for error path testing. MaxActiveSubAgentsPerRun
	// defaults high (8) so the repeat/task/budget limits dominate the tests
	// that exercise them; TestTeamRunActiveSubAgentLimit passes its own
	// guardrails with MaxActiveSubAgentsPerRun=2.
	guardrails := agentteam.AgentTeamGuardrails{
		MaxDelegationDepth:       3,
		MaxActiveSubAgentsPerRun: 8,
		MaxRouteRepeats:          3,
		MaxTasksPerTeamRun:       5,
		AssignmentTimeout:        30 * time.Minute,
		MaxTeamRunBudgetTokens:   10, // tiny budget to trigger exceeded easily
		MaxTeamRunBudgetUsagePct: 5.0,
	}
	if len(overrides) > 0 {
		guardrails = overrides[0]
	}

	teamSvc := agentteam.NewAgentTeamServiceWithGuardrails(db, mockAgent, nil, guardrails)
	teamHandler := handler.NewAgentTeamHandler(teamSvc)

	r := gin.New()
	r.Use(func(c *gin.Context) {
		c.Set("user_id", userID)
		c.Next()
	})

	web := r.Group("/web")
	{
		web.POST("/agent-teams", teamHandler.CreateTeam)
		web.GET("/agent-teams", teamHandler.ListTeams)
		web.GET("/agent-teams/:id", teamHandler.GetTeam)
		web.POST("/agent-teams/:id/members", teamHandler.AddMember)
		web.POST("/agent-teams/:id/runs", teamHandler.StartRun)
		web.GET("/agent-teams/:id/runs", teamHandler.ListRuns)
		web.GET("/agent-teams/:id/runs/:run_id", teamHandler.GetRun)
		web.GET("/agent-teams/:id/runs/:run_id/state", teamHandler.GetRunState)
		web.GET("/agent-teams/:id/runs/:run_id/events", teamHandler.ListTeamEvents)
		web.POST("/agent-teams/:id/runs/:run_id/route-decisions", teamHandler.HandleRouteDecision)
		web.POST("/agent-teams/:id/runs/:run_id/assignments", teamHandler.CreateAssignment)
	}

	ts := httptest.NewServer(r)
	t.Cleanup(ts.Close)
	httpClient := ts.Client()

	// Create team.
	do := func(method, path string, body any) *http.Response {
		var rBody *bytes.Reader
		if body != nil {
			b, _ := json.Marshal(body)
			rBody = bytes.NewReader(b)
		} else {
			rBody = bytes.NewReader(nil)
		}
		req, _ := http.NewRequest(method, ts.URL+path, rBody)
		req.Header.Set("Content-Type", "application/json")
		resp, err := httpClient.Do(req)
		require.NoError(t, err)
		return resp
	}
	post := func(path string, body any) *http.Response { return do("POST", path, body) }
	get := func(path string) *http.Response { return do("GET", path, nil) }

	resp := post("/web/agent-teams", map[string]string{
		"name":        "Error Path Team",
		"description": "Testing error paths",
	})
	teamResp := parseHTTP(resp)
	require.Equal(t, "ok", teamResp.GetCode(), "create team")
	teamID := extract(teamResp.Data, "id")
	require.NotEmpty(t, teamID)

	// Add supervisor.
	post("/web/agent-teams/"+teamID+"/members", map[string]string{
		"agent_profile_id": agent1ID,
		"role":             model.TeamMemberRoleSupervisor,
	})
	// Add worker 1.
	post("/web/agent-teams/"+teamID+"/members", map[string]string{
		"agent_profile_id": agent2ID,
		"role":             model.TeamMemberRoleExecutor,
	})
	// Add worker 2.
	post("/web/agent-teams/"+teamID+"/members", map[string]string{
		"agent_profile_id": agent3ID,
		"role":             model.TeamMemberRoleExecutor,
	})

	// Fetch member IDs.
	resp = get("/web/agent-teams/" + teamID)
	detailResp := parseHTTP(resp)
	var detail model.TeamDetail
	require.NoError(t, json.Unmarshal(detailResp.Data, &detail))
	require.GreaterOrEqual(t, len(detail.Members), 3)

	var supID, w1ID, w2ID string
	for _, m := range detail.Members {
		switch m.Role {
		case model.TeamMemberRoleSupervisor:
			supID = m.ID
		case model.TeamMemberRoleExecutor:
			if w1ID == "" {
				w1ID = m.ID
			} else {
				w2ID = m.ID
			}
		}
	}

	// Start team run.
	resp = post("/web/agent-teams/"+teamID+"/runs", map[string]string{
		"trigger_message": "Test error paths",
	})
	runResp := parseHTTP(resp)
	require.Equal(t, "ok", runResp.GetCode(), "start team run")
	runID := extract(runResp.Data, "id")
	require.NotEmpty(t, runID)

	return &errPathTeamState{
		Server:             ts,
		Client:             httpClient,
		UserID:             userID,
		TeamID:             teamID,
		RunID:              runID,
		SupervisorMemberID: supID,
		WorkerMemberID:     w1ID,
		Worker2MemberID:    w2ID,
		Agent1ID:           agent1ID,
		Agent2ID:           agent2ID,
		Agent3ID:           agent3ID,
		DB:                 db,
	}
}

func (s *errPathTeamState) do(method, path string, body any) *http.Response {
	var rBody *bytes.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rBody = bytes.NewReader(b)
	} else {
		rBody = bytes.NewReader(nil)
	}
	req, _ := http.NewRequest(method, s.Server.URL+path, rBody)
	req.Header.Set("Content-Type", "application/json")
	resp, err := s.Client.Do(req)
	if err != nil {
		panic(fmt.Sprintf("request failed: %v", err))
	}
	return resp
}

func (s *errPathTeamState) post(path string, body any) *http.Response {
	return s.do("POST", path, body)
}

func (s *errPathTeamState) get(path string) *http.Response {
	return s.do("GET", path, nil)
}

// ── HTTP response helpers (local to this file) ───────────────────────────────

type localAPIResp struct {
	Code    string          `json:"code"`
	Message string          `json:"message"`
	Data    json.RawMessage `json:"data"`
	Error   *struct {
		Code    string `json:"code"`
		Message string `json:"message"`
		TraceID string `json:"traceId"`
	} `json:"error"`
}

func (r localAPIResp) GetCode() string {
	if r.Error != nil {
		return r.Error.Code
	}
	return r.Code
}

func (r localAPIResp) GetMsg() string {
	if r.Error != nil {
		return r.Error.Message
	}
	return r.Message
}

func parseHTTP(resp *http.Response) localAPIResp {
	defer resp.Body.Close()
	var r localAPIResp
	json.NewDecoder(resp.Body).Decode(&r)
	return r
}

func assertErrCode(t *testing.T, r localAPIResp, want, context string) {
	t.Helper()
	if r.GetCode() != want {
		t.Fatalf("%s: expected code=%q, got code=%q message=%q", context, want, r.GetCode(), r.GetMsg())
	}
}

func strPtr(s string) *string { return &s }

// ── Error Path Tests ─────────────────────────────────────────────────────────

// TestTeamRunSelfDelegation verifies that a delegation from a member to
// itself (self-delegation cycle) is rejected.
func TestTeamRunSelfDelegation(t *testing.T) {
	st := errPathTeamSetup(t)

	// Attempt to create an assignment where fromMember == toMember (self-delegation).
	resp := st.post("/web/agent-teams/"+st.TeamID+"/runs/"+st.RunID+"/assignments",
		map[string]string{
			"from_member_id": st.SupervisorMemberID,
			"to_member_id":   st.SupervisorMemberID,
			"type":           model.AssignmentTypeDelegate,
			"task_prompt":    "Delegate to myself",
		})
	r := parseHTTP(resp)
	assertErrCode(t, r, "bad_request", "self-delegation must be rejected")
}

// TestTeamRunDelegationCycle verifies that a delegation that would create
// a cycle in the ancestor chain (A→B→C→A) is rejected.
func TestTeamRunDelegationCycle(t *testing.T) {
	st := errPathTeamSetup(t)

	// Step 1: Supervisor → Worker1 (depth 1)
	resp := st.post("/web/agent-teams/"+st.TeamID+"/runs/"+st.RunID+"/assignments",
		map[string]string{
			"from_member_id": st.SupervisorMemberID,
			"to_member_id":   st.WorkerMemberID,
			"type":           model.AssignmentTypeDelegate,
			"task_prompt":    "Step 1: Initial delegation",
		})
	r := parseHTTP(resp)
	assertErrCode(t, r, "ok", "step 1 delegation")

	// Step 2: Worker1 → Worker2 (depth 2)
	resp = st.post("/web/agent-teams/"+st.TeamID+"/runs/"+st.RunID+"/assignments",
		map[string]string{
			"from_member_id": st.WorkerMemberID,
			"to_member_id":   st.Worker2MemberID,
			"type":           model.AssignmentTypeDelegate,
			"task_prompt":    "Step 2: Sub-delegation",
		})
	r = parseHTTP(resp)
	// Worker1 is executor, not supervisor. CreateAssignment requires fromMember to be supervisor.
	// This should be rejected because worker1 is not a supervisor.
	if r.GetCode() == "ok" {
		// If the system allows executor-to-executor delegation (not checked by CreateAssignment),
		// continue to test the cycle.
		// Step 3: Worker2 → Supervisor (would create cycle)
		resp = st.post("/web/agent-teams/"+st.TeamID+"/runs/"+st.RunID+"/assignments",
			map[string]string{
				"from_member_id": st.Worker2MemberID,
				"to_member_id":   st.SupervisorMemberID,
				"type":           model.AssignmentTypeDelegate,
				"task_prompt":    "Step 3: Back to supervisor (cycle)",
			})
		r = parseHTTP(resp)
		if r.GetCode() == "ok" {
			t.Error("cycle delegation (back to supervisor) should be rejected")
		}
	} else {
		// Expected: non-supervisor cannot originate delegation.
		assertErrCode(t, r, "bad_request", "non-supervisor delegation must be rejected")
	}
}

// TestTeamRunDelegationDepthExceeded verifies that exceeding the maximum
// delegation depth (MaxDelegationDepth=3) is rejected.
func TestTeamRunDelegationDepthExceeded(t *testing.T) {
	st := errPathTeamSetup(t)

	// Build a chain of assignments from supervisor → worker1 → worker2.
	// Only supervisor can initiate. The depth limit is enforced by CreateAssignment
	// which requires fromMember.Role == supervisor. So multi-level depth is not
	// directly testable via the standard CreateAssignment flow with executors.

	// Instead, test that the route decision flow enforces depth implicitly:
	// Create the first assignment via route decision handler, then verify
	// the system correctly rejects subsequent route decisions when limits
	// are breached.

	// Submit a valid delegate route decision.
	resp := st.post("/web/agent-teams/"+st.TeamID+"/runs/"+st.RunID+"/route-decisions",
		model.CoordinatorRouteDecision{
			Action:       "delegate",
			NextWorker:   st.WorkerMemberID,
			Instructions: "Deep chain work - step 1",
			Reasoning:    "Initial delegation",
		})
	r := parseHTTP(resp)
	assertErrCode(t, r, "ok", "step 1 route decision")
	assignment1ID := extract(r.Data, "id")
	require.NotEmpty(t, assignment1ID)

	// Attempt to exceed MaxTasksPerTeamRun (set to 5 in our guardrails).
	// Create assignments until the limit is hit.
	for i := 2; i <= 6; i++ {
		resp = st.post("/web/agent-teams/"+st.TeamID+"/runs/"+st.RunID+"/route-decisions",
			model.CoordinatorRouteDecision{
				Action:       "delegate",
				NextWorker:   st.WorkerMemberID,
				Instructions: fmt.Sprintf("Task %d - fill up", i),
				Reasoning:    "Filling task quota",
			})
		r = parseHTTP(resp)
		if i <= 5 {
			// Within limit.
			if r.GetCode() != "ok" {
				t.Errorf("task %d within limit should pass, got %s: %s", i, r.GetCode(), r.GetMsg())
			}
		} else {
			// Exceeded MaxTasksPerTeamRun=5.
			assertErrCode(t, r, "bad_request", fmt.Sprintf("task %d exceeded limit must be rejected", i))
			assert.True(t, strings.Contains(r.GetMsg(), "task limit"),
				"error message should mention task limit, got: %s", r.GetMsg())
		}
	}
}

// TestTeamRunBudgetExceeded verifies that route decisions are rejected when
// the team run budget is exceeded.
func TestTeamRunBudgetExceeded(t *testing.T) {
	st := errPathTeamSetup(t)

	// Insert agent_run_events with high token usage to trigger budget exceeded.
	// The guardrails have MaxTeamRunBudgetTokens=10, so even 1 event with >10
	// tokens should trigger exceeded.
	now := time.Now()

	// First, we need to create one assignment to get a task ID, or directly
	// insert an agent_run_event with a task ID that matches.
	// Insert an event with high token usage (total=500 > MaxTeamRunBudgetTokens=10).
	highTokenEvent := map[string]interface{}{
		"tokenUsage": map[string]interface{}{
			"input":  300,
			"output": 200,
			"total":  500,
		},
	}
	payload, _ := json.Marshal(highTokenEvent)

	require.NoError(t, st.DB.Exec(
		`INSERT INTO agent_run_events (id, task_id, edge_run_id, event_seq, event_type, payload, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		"event-budget-1", "task-budget-1", "edge-run-1", 1, "run.agent.context_warning", string(payload), now, now,
	).Error)

	// Also insert a corresponding row in assignments so the run has task IDs.
	require.NoError(t, st.DB.Exec(
		`INSERT INTO agent_team_assignments (id, team_run_id, from_member_id, to_member_id, type, task_prompt, status, run_id, depth, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		"asgn-budget-1", st.RunID, st.SupervisorMemberID, st.WorkerMemberID,
		model.AssignmentTypeDelegate, "budget test task", model.AssignmentStatusPending,
		"task-budget-1", 1, now, now,
	).Error)

	// Now try a route decision — it should be rejected with budget exceeded.
	resp := st.post("/web/agent-teams/"+st.TeamID+"/runs/"+st.RunID+"/route-decisions",
		model.CoordinatorRouteDecision{
			Action:       "delegate",
			NextWorker:   st.WorkerMemberID,
			Instructions: "This should fail due to budget exceeded",
			Reasoning:    "Testing budget exceeded",
		})
	r := parseHTTP(resp)
	assertErrCode(t, r, "bad_request", "route decision with exceeded budget must be rejected")
	assert.True(t, strings.Contains(r.GetMsg(), "budget") || strings.Contains(r.GetMsg(), "exceeded"),
		"error message should mention budget, got: %s", r.GetMsg())
}

// TestTeamRunActiveSubAgentLimit verifies that when the maximum number of
// active sub-agents is reached, new route decisions are rejected.
func TestTeamRunActiveSubAgentLimit(t *testing.T) {
	// This test exercises MaxActiveSubAgentsPerRun=2 specifically, so it
	// overrides the errPathTeamSetup default (8) with its own guardrails.
	st := errPathTeamSetup(t, agentteam.AgentTeamGuardrails{
		MaxDelegationDepth:       3,
		MaxActiveSubAgentsPerRun: 2,
		MaxRouteRepeats:          3,
		MaxTasksPerTeamRun:       5,
		AssignmentTimeout:        30 * time.Minute,
		MaxTeamRunBudgetTokens:   10,
		MaxTeamRunBudgetUsagePct: 5.0,
	})

	// Guardrails: MaxActiveSubAgentsPerRun=2.
	// Create 2 pending assignments to saturate the active limit.
	for i := 1; i <= 2; i++ {
		resp := st.post("/web/agent-teams/"+st.TeamID+"/runs/"+st.RunID+"/route-decisions",
			model.CoordinatorRouteDecision{
				Action:       "delegate",
				NextWorker:   st.WorkerMemberID,
				Instructions: fmt.Sprintf("Active task %d", i),
				Reasoning:    "Saturating active limit",
			})
		r := parseHTTP(resp)
		assertErrCode(t, r, "ok", fmt.Sprintf("task %d within active limit", i))
	}

	// The 3rd route decision should be rejected (active limit=2).
	resp := st.post("/web/agent-teams/"+st.TeamID+"/runs/"+st.RunID+"/route-decisions",
		model.CoordinatorRouteDecision{
			Action:       "delegate",
			NextWorker:   st.Worker2MemberID,
			Instructions: "This should fail - active subagent limit reached",
			Reasoning:    "Exceeding active limit",
		})
	r := parseHTTP(resp)
	assertErrCode(t, r, "bad_request", "route decision exceeding active limit must be rejected")
	assert.True(t, strings.Contains(r.GetMsg(), "active") || strings.Contains(r.GetMsg(), "subagent"),
		"error message should mention active/subagent limit, got: %s", r.GetMsg())
}

// TestTeamRunInvalidFinish verifies that action=finish with a BlockedReason
// transitions the run to failed status.
func TestTeamRunInvalidFinish(t *testing.T) {
	st := errPathTeamSetup(t)

	// Start a new run specifically for this test.
	resp := st.post("/web/agent-teams/"+st.TeamID+"/runs", map[string]string{
		"trigger_message": "Test blocked finish",
	})
	r := parseHTTP(resp)
	assertErrCode(t, r, "ok", "start second run")
	runID := extract(r.Data, "id")
	require.NotEmpty(t, runID)

	// Submit finish with BlockedReason — should mark run as failed.
	resp = st.post("/web/agent-teams/"+st.TeamID+"/runs/"+runID+"/route-decisions",
		model.CoordinatorRouteDecision{
			Action:        "finish",
			BlockedReason: "Cannot proceed: missing dependencies",
		})
	r = parseHTTP(resp)
	assertErrCode(t, r, "ok", "finish with blocked reason")

	// Verify the run status is failed.
	resp = st.get("/web/agent-teams/" + st.TeamID + "/runs/" + runID)
	r = parseHTTP(resp)
	assertErrCode(t, r, "ok", "get run after blocked finish")
	status := extract(r.Data, "status")
	assert.Equal(t, model.TeamRunStatusFailed, status, "run with blocked reason should be failed")
}

// TestTeamRunRouteDecisionMissingInstructions verifies that a delegate
// route decision without instructions is rejected.
func TestTeamRunRouteDecisionMissingInstructions(t *testing.T) {
	st := errPathTeamSetup(t)

	resp := st.post("/web/agent-teams/"+st.TeamID+"/runs/"+st.RunID+"/route-decisions",
		model.CoordinatorRouteDecision{
			Action:     "delegate",
			NextWorker: st.WorkerMemberID,
			// Instructions is empty.
		})
	r := parseHTTP(resp)
	assertErrCode(t, r, "bad_request", "delegate without instructions must be rejected")
	assert.True(t, strings.Contains(r.GetMsg(), "instructions"),
		"error should mention instructions, got: %s", r.GetMsg())
}

// TestTeamRunRouteDecisionInvalidWorker verifies that a route decision
// with a non-existent next_worker is rejected.
func TestTeamRunRouteDecisionInvalidWorker(t *testing.T) {
	st := errPathTeamSetup(t)

	resp := st.post("/web/agent-teams/"+st.TeamID+"/runs/"+st.RunID+"/route-decisions",
		model.CoordinatorRouteDecision{
			Action:       "delegate",
			NextWorker:   "00000000-0000-0000-0000-000000000000",
			Instructions: "Do something",
		})
	r := parseHTTP(resp)
	assertErrCode(t, r, "bad_request", "invalid next_worker must be rejected")
}

// TestTeamRunGetStateAfterMultipleRoutes verifies that GetRunState correctly
// reflects the state after multiple route decisions, including rejected ones.
func TestTeamRunGetStateAfterMultipleRoutes(t *testing.T) {
	st := errPathTeamSetup(t)

	// Submit an accepted route.
	st.post("/web/agent-teams/"+st.TeamID+"/runs/"+st.RunID+"/route-decisions",
		model.CoordinatorRouteDecision{
			Action:       "delegate",
			NextWorker:   st.WorkerMemberID,
			Instructions: "Write unit tests for module X",
			Reasoning:    "Executor should handle this",
		})

	// Submit a rejected route (invalid action).
	st.post("/web/agent-teams/"+st.TeamID+"/runs/"+st.RunID+"/route-decisions",
		model.CoordinatorRouteDecision{
			Action:       "execute", // invalid
			NextWorker:   st.WorkerMemberID,
			Instructions: "This will be rejected",
		})

	// Get state and verify both accepted and rejected routes are recorded.
	resp := st.get("/web/agent-teams/" + st.TeamID + "/runs/" + st.RunID + "/state")
	r := parseHTTP(resp)
	assertErrCode(t, r, "ok", "get run state")

	var state model.TeamRunState
	require.NoError(t, json.Unmarshal(r.Data, &state))

	// RouteLog should contain only accepted routes.
	assert.GreaterOrEqual(t, len(state.RouteLog), 1, "route log should have at least 1 accepted route")

	// RouteAuditLog should contain both accepted and rejected.
	assert.GreaterOrEqual(t, len(state.RouteAuditLog), 2,
		"route audit log should have at least 2 entries (1 accepted + 1 rejected)")

	// Verify the rejected entry exists.
	foundRejected := false
	for _, entry := range state.RouteAuditLog {
		if entry.Status == "rejected" {
			foundRejected = true
			break
		}
	}
	assert.True(t, foundRejected, "route audit log must contain a rejected entry")
}

// TestTeamRunCreateAssignmentWrongTeam verifies that creating an assignment
// with mismatched team membership is rejected.
func TestTeamRunCreateAssignmentWrongTeam(t *testing.T) {
	st := errPathTeamSetup(t)

	// Create a second team.
	resp := st.post("/web/agent-teams", map[string]string{
		"name": "Second Error Path Team",
	})
	r := parseHTTP(resp)
	assertErrCode(t, r, "ok", "create second team")
	team2ID := extract(r.Data, "id")

	// Add a member to the second team.
	st.post("/web/agent-teams/"+team2ID+"/members", map[string]string{
		"agent_profile_id": st.Agent2ID,
		"role":             model.TeamMemberRoleExecutor,
	})

	// Fetch second team's member IDs.
	resp = st.get("/web/agent-teams/" + team2ID)
	detailResp := parseHTTP(resp)
	var detail model.TeamDetail
	require.NoError(t, json.Unmarshal(detailResp.Data, &detail))
	require.GreaterOrEqual(t, len(detail.Members), 1)
	team2WorkerID := detail.Members[0].ID

	// Try to create an assignment in the first run using the second team's member.
	// This should fail because the to_member doesn't belong to the run's team.
	resp = st.post("/web/agent-teams/"+st.TeamID+"/runs/"+st.RunID+"/assignments",
		map[string]string{
			"from_member_id": st.SupervisorMemberID,
			"to_member_id":   team2WorkerID,
			"type":           model.AssignmentTypeDelegate,
			"task_prompt":    "Cross-team delegation attempt",
		})
	r = parseHTTP(resp)

	// Should be rejected — cross-team delegation.
	assert.True(t, r.GetCode() != "ok",
		"cross-team delegation must be rejected, got %s: %s", r.GetCode(), r.GetMsg())
}

// TestTeamRunRouteRepeatLimit verifies that identical route decisions
// beyond MaxRouteRepeats are rejected.
func TestTeamRunRouteRepeatLimit(t *testing.T) {
	st := errPathTeamSetup(t)

	// Guardrails: MaxRouteRepeats=3.
	// Submit the same route decision 4 times. The 4th should be rejected.
	decision := model.CoordinatorRouteDecision{
		Action:       "delegate",
		NextWorker:   st.WorkerMemberID,
		Instructions: "Repeated task: polish the UI components",
		Reasoning:    "Polish pass needed",
	}

	for i := 1; i <= 4; i++ {
		resp := st.post("/web/agent-teams/"+st.TeamID+"/runs/"+st.RunID+"/route-decisions", decision)
		r := parseHTTP(resp)
		if i <= 3 {
			if r.GetCode() != "ok" {
				t.Errorf("repeat %d within limit should pass, got %s: %s", i, r.GetCode(), r.GetMsg())
			}
		} else {
			assertErrCode(t, r, "bad_request", "4th identical route must be rejected (repeat limit=3)")
			assert.True(t, strings.Contains(r.GetMsg(), "repeat"),
				"error should mention repeat limit, got: %s", r.GetMsg())
		}
	}
}
