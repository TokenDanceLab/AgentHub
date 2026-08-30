package handler

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// authzTestDB creates an in-memory DB with user-1 owning team-1 for legacy tests.
func authzTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db := setupAuthzTestDB(t)
	require.NoError(t, db.Exec(`INSERT INTO agent_teams (id, owner_id, name) VALUES ('team-1', 'user-1', 'T')`).Error)
	require.NoError(t, db.Exec(`INSERT INTO custom_agents (id, owner_user_id, name, agent_type) VALUES ('agent-1', 'user-1', 'A', 'codex')`).Error)
	require.NoError(t, db.Exec(`INSERT INTO agent_team_members (id, team_id, agent_profile_id, role) VALUES ('mem-1', 'team-1', 'agent-1', 'executor')`).Error)
	require.NoError(t, db.Exec(`INSERT INTO agent_team_runs (id, team_id, trigger_user_id, status) VALUES ('run-1', 'team-1', 'user-1', 'running')`).Error)
	require.NoError(t, db.Exec(`INSERT INTO agent_team_assignments (id, team_run_id, from_member_id, to_member_id, task_prompt, status) VALUES ('asgn-1', 'run-1', 'mem-1', 'mem-1', 'x', 'pending')`).Error)
	require.NoError(t, db.Exec(`INSERT INTO agent_team_assignments (id, team_run_id, from_member_id, to_member_id, task_prompt, status) VALUES ('assign-1', 'run-1', 'mem-1', 'mem-1', 'x', 'pending')`).Error)
	return db
}

func TestAgentTeamHandler_UpdateTeam(t *testing.T) {
	gin.SetMode(gin.TestMode)

	called := false
	svc := &mockAgentTeamService{
		updateTeam: func(ctx context.Context, userID, teamID, name, description string) error {
			called = true
			assert.Equal(t, "user-1", userID)
			assert.Equal(t, "team-1", teamID)
			assert.Equal(t, "New Name", name)
			return nil
		},
	}
	h := NewAgentTeamHandler(svc, authzTestDB(t))

	r := gin.New()
	r.PUT("/web/agent-teams/:id", func(c *gin.Context) {
		c.Set("user_id", "user-1")
		h.UpdateTeam(c)
	})

	body := bytes.NewBufferString(`{"name":"New Name","description":"Updated desc"}`)
	req := httptest.NewRequest(http.MethodPut, "/web/agent-teams/team-1", body)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	require.True(t, called)
	assert.Equal(t, http.StatusOK, w.Code)
}

func TestAgentTeamHandler_UpdateTeamBadRequest(t *testing.T) {
	gin.SetMode(gin.TestMode)
	svc := &mockAgentTeamService{}
	h := NewAgentTeamHandler(svc, authzTestDB(t))

	r := gin.New()
	r.PUT("/web/agent-teams/:id", func(c *gin.Context) {
		c.Set("user_id", "user-1")
		h.UpdateTeam(c)
	})

	req := httptest.NewRequest(http.MethodPut, "/web/agent-teams/team-1", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestAgentTeamHandler_DeleteTeam(t *testing.T) {
	gin.SetMode(gin.TestMode)

	called := false
	svc := &mockAgentTeamService{
		deleteTeam: func(ctx context.Context, userID, teamID string) error {
			called = true
			assert.Equal(t, "user-1", userID)
			assert.Equal(t, "team-1", teamID)
			return nil
		},
	}
	h := NewAgentTeamHandler(svc, authzTestDB(t))

	r := gin.New()
	r.DELETE("/web/agent-teams/:id", func(c *gin.Context) {
		c.Set("user_id", "user-1")
		h.DeleteTeam(c)
	})

	req := httptest.NewRequest(http.MethodDelete, "/web/agent-teams/team-1", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	require.True(t, called)
	assert.Equal(t, http.StatusOK, w.Code)
}

func TestAgentTeamHandler_DeleteTeamNotFound(t *testing.T) {
	gin.SetMode(gin.TestMode)
	svc := &mockAgentTeamService{
		deleteTeam: func(ctx context.Context, userID, teamID string) error {
			return errcode.AgentNotFound
		},
	}
	h := NewAgentTeamHandler(svc, authzTestDB(t))

	r := gin.New()
	r.DELETE("/web/agent-teams/:id", func(c *gin.Context) {
		c.Set("user_id", "user-1")
		h.DeleteTeam(c)
	})

	req := httptest.NewRequest(http.MethodDelete, "/web/agent-teams/team-1", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusNotFound, w.Code)
}

func TestAgentTeamHandler_RemoveMember(t *testing.T) {
	gin.SetMode(gin.TestMode)

	called := false
	svc := &mockAgentTeamService{
		removeTeamMember: func(ctx context.Context, userID, teamID, memberID string) error {
			called = true
			assert.Equal(t, "user-1", userID)
			assert.Equal(t, "team-1", teamID)
			assert.Equal(t, "member-1", memberID)
			return nil
		},
	}
	h := NewAgentTeamHandler(svc, authzTestDB(t))

	r := gin.New()
	r.DELETE("/web/agent-teams/:id/members/:member_id", func(c *gin.Context) {
		c.Set("user_id", "user-1")
		h.RemoveMember(c)
	})

	req := httptest.NewRequest(http.MethodDelete, "/web/agent-teams/team-1/members/member-1", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	require.True(t, called)
	assert.Equal(t, http.StatusOK, w.Code)
}

func TestAgentTeamHandler_ListRuns(t *testing.T) {
	gin.SetMode(gin.TestMode)

	called := false
	svc := &mockAgentTeamService{
		listTeamRuns: func(ctx context.Context, userID, teamID string) ([]model.AgentTeamRun, error) {
			called = true
			assert.Equal(t, "user-1", userID)
			assert.Equal(t, "team-1", teamID)
			return []model.AgentTeamRun{{ID: "run-1", TeamID: teamID, Status: "running"}}, nil
		},
	}
	h := NewAgentTeamHandler(svc, authzTestDB(t))

	r := gin.New()
	r.GET("/web/agent-teams/:id/runs", func(c *gin.Context) {
		c.Set("user_id", "user-1")
		h.ListRuns(c)
	})

	req := httptest.NewRequest(http.MethodGet, "/web/agent-teams/team-1/runs", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	require.True(t, called)
	assert.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Body.String(), "run-1")
}

func TestAgentTeamHandler_GetRun(t *testing.T) {
	gin.SetMode(gin.TestMode)

	called := false
	svc := &mockAgentTeamService{
		getTeamRun: func(ctx context.Context, userID, teamID, runID string) (*model.AgentTeamRun, error) {
			called = true
			assert.Equal(t, "user-1", userID)
			assert.Equal(t, "team-1", teamID)
			assert.Equal(t, "run-1", runID)
			return &model.AgentTeamRun{ID: runID, TeamID: teamID, Status: "running"}, nil
		},
	}
	h := NewAgentTeamHandler(svc, authzTestDB(t))

	r := gin.New()
	r.GET("/web/agent-teams/:id/runs/:run_id", func(c *gin.Context) {
		c.Set("user_id", "user-1")
		h.GetRun(c)
	})

	req := httptest.NewRequest(http.MethodGet, "/web/agent-teams/team-1/runs/run-1", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	require.True(t, called)
	assert.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Body.String(), "run-1")
}

func TestAgentTeamHandler_GetRunState(t *testing.T) {
	gin.SetMode(gin.TestMode)

	called := false
	svc := &mockAgentTeamService{
		getTeamRunState: func(ctx context.Context, userID, teamID, runID string) (*model.TeamRunState, error) {
			called = true
			assert.Equal(t, "user-1", userID)
			assert.Equal(t, "team-1", teamID)
			assert.Equal(t, "run-1", runID)
			return &model.TeamRunState{RunID: runID, TeamID: teamID, Status: "running"}, nil
		},
	}
	h := NewAgentTeamHandler(svc, authzTestDB(t))

	r := gin.New()
	r.GET("/web/agent-teams/:id/runs/:run_id/state", func(c *gin.Context) {
		c.Set("user_id", "user-1")
		h.GetRunState(c)
	})

	req := httptest.NewRequest(http.MethodGet, "/web/agent-teams/team-1/runs/run-1/state", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	require.True(t, called)
	assert.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Body.String(), "running")
}

func TestAgentTeamHandler_CreateAssignment(t *testing.T) {
	gin.SetMode(gin.TestMode)

	called := false
	svc := &mockAgentTeamService{
		createAssignment: func(ctx context.Context, userID, teamRunID, fromMemberID, toMemberID, aType, taskPrompt, contextStr string) (*model.AgentTeamAssignment, error) {
			called = true
			assert.Equal(t, "user-1", userID)
			assert.Equal(t, "run-1", teamRunID)
			assert.Equal(t, "delegate", aType)
			return &model.AgentTeamAssignment{ID: "assign-1", TeamRunID: teamRunID, TaskPrompt: taskPrompt}, nil
		},
	}
	h := NewAgentTeamHandler(svc, authzTestDB(t))

	r := gin.New()
	r.POST("/web/agent-teams/:id/runs/:run_id/assignments", func(c *gin.Context) {
		c.Set("user_id", "user-1")
		h.CreateAssignment(c)
	})

	body := bytes.NewBufferString(`{"from_member_id":"m1","to_member_id":"m2","type":"delegate","task_prompt":"Do the thing"}`)
	req := httptest.NewRequest(http.MethodPost, "/web/agent-teams/team-1/runs/run-1/assignments", body)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	require.True(t, called)
	assert.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Body.String(), "assign-1")
}

func TestAgentTeamHandler_DispatchAssignment(t *testing.T) {
	gin.SetMode(gin.TestMode)

	called := false
	var capturedID string
	svc := &mockAgentTeamService{
		dispatchAssignment: func(ctx context.Context, userID, assignmentID string) error {
			called = true
			capturedID = assignmentID
			return nil
		},
	}
	h := NewAgentTeamHandler(svc, authzTestDB(t))

	r := gin.New()
	r.POST("/web/agent-teams/:id/runs/:run_id/assignments/:assignment_id/dispatch", func(c *gin.Context) {
		c.Set("user_id", "user-1")
		h.DispatchAssignment(c)
	})

	req := httptest.NewRequest(http.MethodPost, "/web/agent-teams/team-1/runs/run-1/assignments/assign-1/dispatch", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	require.True(t, called)
	require.NotEmpty(t, capturedID)
	assert.Equal(t, "assign-1", capturedID)
	assert.Equal(t, http.StatusOK, w.Code)
}

func TestAgentTeamHandler_CompleteAssignment(t *testing.T) {
	gin.SetMode(gin.TestMode)

	called := false
	var capturedID, capturedResult string
	svc := &mockAgentTeamService{
		completeAssignment: func(ctx context.Context, userID, assignmentID string, result string) error {
			called = true
			capturedID = assignmentID
			capturedResult = result
			return nil
		},
	}
	h := NewAgentTeamHandler(svc, authzTestDB(t))

	r := gin.New()
	r.POST("/web/agent-teams/:id/runs/:run_id/assignments/:assignment_id/complete", func(c *gin.Context) {
		c.Set("user_id", "user-1")
		h.CompleteAssignment(c)
	})

	body := bytes.NewBufferString(`{"result":"Done!"}`)
	req := httptest.NewRequest(http.MethodPost, "/web/agent-teams/team-1/runs/run-1/assignments/assign-1/complete", body)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	require.True(t, called)
	assert.Equal(t, "assign-1", capturedID)
	assert.Equal(t, "Done!", capturedResult)
	assert.Equal(t, http.StatusOK, w.Code)
}

func TestAgentTeamHandler_FailAssignment(t *testing.T) {
	gin.SetMode(gin.TestMode)

	called := false
	var capturedID, capturedReason string
	svc := &mockAgentTeamService{
		failAssignment: func(ctx context.Context, userID, assignmentID string, reason string) error {
			called = true
			capturedID = assignmentID
			capturedReason = reason
			return nil
		},
	}
	h := NewAgentTeamHandler(svc, authzTestDB(t))

	r := gin.New()
	r.POST("/web/agent-teams/:id/runs/:run_id/assignments/:assignment_id/fail", func(c *gin.Context) {
		c.Set("user_id", "user-1")
		h.FailAssignment(c)
	})

	body := bytes.NewBufferString(`{"reason":"timeout"}`)
	req := httptest.NewRequest(http.MethodPost, "/web/agent-teams/team-1/runs/run-1/assignments/assign-1/fail", body)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	require.True(t, called)
	assert.Equal(t, "assign-1", capturedID)
	assert.Equal(t, "timeout", capturedReason)
	assert.Equal(t, http.StatusOK, w.Code)
}

func TestAgentTeamHandler_ListAssignments(t *testing.T) {
	gin.SetMode(gin.TestMode)

	called := false
	svc := &mockAgentTeamService{
		listAssignments: func(ctx context.Context, userID, teamRunID string) ([]model.AgentTeamAssignment, error) {
			called = true
			assert.Equal(t, "user-1", userID)
			assert.Equal(t, "run-1", teamRunID)
			return []model.AgentTeamAssignment{{ID: "assign-1", TeamRunID: teamRunID}}, nil
		},
	}
	h := NewAgentTeamHandler(svc, authzTestDB(t))

	r := gin.New()
	r.GET("/web/agent-teams/:id/runs/:run_id/assignments", func(c *gin.Context) {
		c.Set("user_id", "user-1")
		h.ListAssignments(c)
	})

	req := httptest.NewRequest(http.MethodGet, "/web/agent-teams/team-1/runs/run-1/assignments", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	require.True(t, called)
	assert.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Body.String(), "assign-1")
}
