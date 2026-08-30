package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
)

// setupAuthzTestDB creates an in-memory SQLite DB with the agent-team tables
// needed by checkTeamAccess / resolveTeamIDFromRun / resolveTeamIDFromAssignment.
func setupAuthzTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{
		Logger: gormlogger.Default.LogMode(gormlogger.Silent),
	})
	require.NoError(t, err)
	stmts := []string{
		`CREATE TABLE agent_teams (
			id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, name TEXT NOT NULL,
			description TEXT DEFAULT '', avatar_url TEXT DEFAULT '',
			created_at DATETIME, updated_at DATETIME
		)`,
		`CREATE TABLE agent_team_members (
			id TEXT PRIMARY KEY, team_id TEXT NOT NULL, agent_profile_id TEXT,
			role TEXT NOT NULL DEFAULT 'executor', position INTEGER NOT NULL DEFAULT 0,
			created_at DATETIME
		)`,
		`CREATE TABLE custom_agents (
			id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, name TEXT NOT NULL,
			avatar_url TEXT DEFAULT '', agent_type TEXT NOT NULL,
			system_prompt TEXT NOT NULL DEFAULT '', capability_tags TEXT DEFAULT '[]',
			tool_whitelist TEXT DEFAULT '[]', model_params TEXT DEFAULT '{}',
			deleted_at DATETIME, created_at DATETIME, updated_at DATETIME,
			output_schema TEXT DEFAULT NULL
		)`,
		`CREATE TABLE agent_team_runs (
			id TEXT PRIMARY KEY, team_id TEXT NOT NULL, session_id TEXT,
			trigger_user_id TEXT NOT NULL, trigger_message TEXT DEFAULT '',
			target_id TEXT, mode TEXT NOT NULL DEFAULT 'supervisor',
			status TEXT NOT NULL DEFAULT 'queued', created_at DATETIME, updated_at DATETIME
		)`,
		`CREATE TABLE agent_team_assignments (
			id TEXT PRIMARY KEY, team_run_id TEXT NOT NULL,
			from_member_id TEXT NOT NULL, to_member_id TEXT NOT NULL,
			type TEXT NOT NULL DEFAULT 'delegate', task_prompt TEXT NOT NULL,
			context TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'pending',
			run_id TEXT, result TEXT DEFAULT '', depth INTEGER NOT NULL DEFAULT 0,
			created_at DATETIME, updated_at DATETIME
		)`,
	}
	for _, s := range stmts {
		require.NoError(t, db.Exec(s).Error)
	}
	return db
}

func seedTeamFixture(t *testing.T, db *gorm.DB) {
	t.Helper()
	// Use raw SQL to bypass BeforeCreate hooks that overwrite IDs.
	stmts := []string{
		`INSERT INTO agent_teams (id, owner_id, name) VALUES ('team-1', 'user-owner', 'T')`,
		`INSERT INTO custom_agents (id, owner_user_id, name, agent_type) VALUES ('agent-m', 'user-member', 'M', 'codex')`,
		`INSERT INTO agent_team_members (id, team_id, agent_profile_id, role) VALUES ('mem-1', 'team-1', 'agent-m', 'executor')`,
		`INSERT INTO agent_team_runs (id, team_id, trigger_user_id, status) VALUES ('run-1', 'team-1', 'user-owner', 'running')`,
		`INSERT INTO agent_team_assignments (id, team_run_id, from_member_id, to_member_id, task_prompt, status) VALUES ('asgn-1', 'run-1', 'mem-1', 'mem-1', 'x', 'pending')`,
	}
	for _, s := range stmts {
		require.NoError(t, db.Exec(s).Error)
	}
}

func newAuthzRouter(h *AgentTeamHandler, db *gorm.DB) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	// Mirrors the real routes; middleware sets user_id from header for tests.
	r.Use(func(c *gin.Context) {
		if uid := c.GetHeader("X-Test-User"); uid != "" {
			c.Set("user_id", uid)
		}
		c.Next()
	})
	r.PUT("/web/agent-teams/:id", h.UpdateTeam)
	r.DELETE("/web/agent-teams/:id", h.DeleteTeam)
	r.POST("/web/agent-teams/:id/members", h.AddMember)
	r.DELETE("/web/agent-teams/:id/members/:member_id", h.RemoveMember)
	r.POST("/web/agent-teams/:id/runs/:run_id/route-decisions", h.HandleRouteDecision)
	r.POST("/web/agent-teams/:id/runs/:run_id/approvals/:approval_id/decide", h.DecideApproval)
	r.POST("/web/agent-teams/:id/runs/:run_id/conflicts/:conflict_id/resolve", h.ResolveConflict)
	r.POST("/web/agent-teams/:id/runs/:run_id/assignments", h.CreateAssignment)
	r.POST("/web/agent-teams/:id/runs/:run_id/assignments/:assignment_id/dispatch", h.DispatchAssignment)
	r.POST("/web/agent-teams/:id/runs/:run_id/assignments/:assignment_id/complete", h.CompleteAssignment)
	r.POST("/web/agent-teams/:id/runs/:run_id/assignments/:assignment_id/fail", h.FailAssignment)
	r.POST("/team-runs/:id/review-decision", h.ReviewDecision)
	return r
}

func doReq(r *gin.Engine, method, path, userID string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, nil)
	if userID != "" {
		req.Header.Set("X-Test-User", userID)
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

// TestAuthz_NonMemberForbidden verifies that a user who is neither owner nor
// member receives 403 on every gated endpoint.
func TestAuthz_NonMemberForbidden(t *testing.T) {
	db := setupAuthzTestDB(t)
	seedTeamFixture(t, db)
	svc := &mockAgentTeamService{} // service never reached on 403
	h := NewAgentTeamHandler(svc, db)
	r := newAuthzRouter(h, db)

	endpoints := []struct{ method, path string }{
		{"PUT", "/web/agent-teams/team-1"},
		{"DELETE", "/web/agent-teams/team-1"},
		{"POST", "/web/agent-teams/team-1/members"},
		{"DELETE", "/web/agent-teams/team-1/members/mem-1"},
		{"POST", "/web/agent-teams/team-1/runs/run-1/route-decisions"},
		{"POST", "/web/agent-teams/team-1/runs/run-1/approvals/ap-1/decide"},
		{"POST", "/web/agent-teams/team-1/runs/run-1/conflicts/cf-1/resolve"},
		{"POST", "/web/agent-teams/team-1/runs/run-1/assignments"},
		{"POST", "/web/agent-teams/team-1/runs/run-1/assignments/asgn-1/dispatch"},
		{"POST", "/web/agent-teams/team-1/runs/run-1/assignments/asgn-1/complete"},
		{"POST", "/web/agent-teams/team-1/runs/run-1/assignments/asgn-1/fail"},
		{"POST", "/team-runs/run-1/review-decision"},
	}
	for _, ep := range endpoints {
		w := doReq(r, ep.method, ep.path, "user-outsider")
		assert.Equal(t, http.StatusForbidden, w.Code, "%s %s should be 403 for non-member", ep.method, ep.path)
		assert.Contains(t, w.Body.String(), "forbidden")
	}
}

// TestAuthz_MemberBlockedOnOwnerEndpoints verifies that a team member (not
// owner) is rejected with 403 on owner-only endpoints.
func TestAuthz_MemberBlockedOnOwnerEndpoints(t *testing.T) {
	db := setupAuthzTestDB(t)
	seedTeamFixture(t, db)
	svc := &mockAgentTeamService{}
	h := NewAgentTeamHandler(svc, db)
	r := newAuthzRouter(h, db)

	ownerOnly := []struct{ method, path string }{
		{"PUT", "/web/agent-teams/team-1"},
		{"DELETE", "/web/agent-teams/team-1"},
		{"POST", "/web/agent-teams/team-1/members"},
		{"DELETE", "/web/agent-teams/team-1/members/mem-1"},
		{"POST", "/web/agent-teams/team-1/runs/run-1/route-decisions"},
		{"POST", "/web/agent-teams/team-1/runs/run-1/approvals/ap-1/decide"},
		{"POST", "/web/agent-teams/team-1/runs/run-1/conflicts/cf-1/resolve"},
	}
	for _, ep := range ownerOnly {
		w := doReq(r, ep.method, ep.path, "user-member")
		assert.Equal(t, http.StatusForbidden, w.Code, "%s %s should be 403 for member on owner-only", ep.method, ep.path)
	}
}

// TestAuthz_OwnerPasses verifies owner reaches the service layer (service
// returns nil → 200 or bind error → 400, but never 403).
func TestAuthz_OwnerPasses(t *testing.T) {
	db := setupAuthzTestDB(t)
	seedTeamFixture(t, db)
	svc := &mockAgentTeamService{
		updateTeam: func(ctx context.Context, userID, teamID, name, description string) error {
			return nil
		},
		deleteTeam: func(ctx context.Context, userID, teamID string) error {
			return nil
		},
	}
	h := NewAgentTeamHandler(svc, db)
	r := newAuthzRouter(h, db)

	// UpdateTeam: owner passes → service returns nil → 200
	w := doReq(r, "PUT", "/web/agent-teams/team-1", "user-owner")
	assert.NotEqual(t, http.StatusForbidden, w.Code, "owner must not be 403 on UpdateTeam")

	// DeleteTeam: owner passes
	w = doReq(r, "DELETE", "/web/agent-teams/team-1", "user-owner")
	assert.NotEqual(t, http.StatusForbidden, w.Code, "owner must not be 403 on DeleteTeam")
}

// TestAuthz_UnknownTeamReturns404 preserves the existing behaviour that
// unknown team IDs surface as 404 (not 403) so clients cannot probe.
func TestAuthz_UnknownTeamReturns404(t *testing.T) {
	db := setupAuthzTestDB(t)
	svc := &mockAgentTeamService{}
	h := NewAgentTeamHandler(svc, db)
	r := newAuthzRouter(h, db)

	w := doReq(r, "DELETE", "/web/agent-teams/no-such-team", "user-owner")
	assert.Equal(t, http.StatusNotFound, w.Code)
}
