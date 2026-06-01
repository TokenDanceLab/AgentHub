package handler

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/agenthub/hub-server/internal/model"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestAgentTeamHandler_HandleRouteDecision(t *testing.T) {
	gin.SetMode(gin.TestMode)

	called := false
	svc := &mockAgentTeamService{
		handleRouteDecision: func(ctx context.Context, userID, teamID, runID string, decision model.CoordinatorRouteDecision) (*model.AgentTeamAssignment, error) {
			called = true
			assert.Equal(t, "user-1", userID)
			assert.Equal(t, "team-1", teamID)
			assert.Equal(t, "run-1", runID)
			assert.Equal(t, "delegate", decision.Action)
			assert.Equal(t, "member-2", decision.NextWorker)
			assert.Equal(t, "Build the task board", decision.Instructions)
			return &model.AgentTeamAssignment{ID: "assignment-1", TeamRunID: runID}, nil
		},
	}
	h := NewAgentTeamHandler(svc)

	r := gin.New()
	r.POST("/web/agent-teams/:id/runs/:run_id/route-decisions", func(c *gin.Context) {
		c.Set("user_id", "user-1")
		h.HandleRouteDecision(c)
	})

	body := bytes.NewBufferString(`{"action":"delegate","next_worker":"member-2","instructions":"Build the task board","reasoning":"UI worker is available"}`)
	req := httptest.NewRequest(http.MethodPost, "/web/agent-teams/team-1/runs/run-1/route-decisions", body)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	require.True(t, called)
	assert.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Body.String(), "assignment-1")
}

func TestAgentTeamHandler_ListTeamEvents(t *testing.T) {
	gin.SetMode(gin.TestMode)

	called := false
	svc := &mockAgentTeamService{
		listTeamEvents: func(ctx context.Context, userID, teamID, runID string) ([]model.AgentTeamEvent, error) {
			called = true
			assert.Equal(t, "user-1", userID)
			assert.Equal(t, "team-1", teamID)
			assert.Equal(t, "run-1", runID)
			return []model.AgentTeamEvent{{ID: "event-1", TeamRunID: runID, Type: model.TeamEventRouteRejected}}, nil
		},
	}
	h := NewAgentTeamHandler(svc)

	r := gin.New()
	r.GET("/web/agent-teams/:id/runs/:run_id/events", func(c *gin.Context) {
		c.Set("user_id", "user-1")
		h.ListTeamEvents(c)
	})

	req := httptest.NewRequest(http.MethodGet, "/web/agent-teams/team-1/runs/run-1/events", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	require.True(t, called)
	assert.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Body.String(), "event-1")
}

func TestAgentTeamHandler_ListTeamTasks(t *testing.T) {
	gin.SetMode(gin.TestMode)

	called := false
	svc := &mockAgentTeamService{
		listTeamTasks: func(ctx context.Context, userID, teamID, runID string) ([]model.AgentTeamTask, error) {
			called = true
			assert.Equal(t, "user-1", userID)
			assert.Equal(t, "team-1", teamID)
			assert.Equal(t, "run-1", runID)
			return []model.AgentTeamTask{{ID: "task-1", TeamRunID: runID, Objective: "Build task board"}}, nil
		},
	}
	h := NewAgentTeamHandler(svc)

	r := gin.New()
	r.GET("/web/agent-teams/:id/runs/:run_id/tasks", func(c *gin.Context) {
		c.Set("user_id", "user-1")
		h.ListTeamTasks(c)
	})

	req := httptest.NewRequest(http.MethodGet, "/web/agent-teams/team-1/runs/run-1/tasks", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	require.True(t, called)
	assert.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Body.String(), "task-1")
}

func TestAgentTeamHandler_ResolveConflict(t *testing.T) {
	gin.SetMode(gin.TestMode)

	called := false
	svc := &mockAgentTeamService{
		resolveConflict: func(ctx context.Context, userID, teamID, runID string, resolution model.TeamConflictResolution) (*model.TeamConflictState, error) {
			called = true
			assert.Equal(t, "user-1", userID)
			assert.Equal(t, "team-1", teamID)
			assert.Equal(t, "run-1", runID)
			assert.Equal(t, "file:shared.txt", resolution.ConflictID)
			assert.Equal(t, model.TeamConflictResolutionAcceptAgentTask, resolution.Resolution)
			assert.Equal(t, "task-1", resolution.SelectedAgentTaskID)
			assert.Equal(t, "Reviewed diff", resolution.Reason)
			return &model.TeamConflictState{
				ConflictID:   resolution.ConflictID,
				Path:         "shared.txt",
				Status:       model.TeamConflictStatusResolved,
				Resolution:   resolution.Resolution,
				SelectedTask: resolution.SelectedAgentTaskID,
			}, nil
		},
	}
	h := NewAgentTeamHandler(svc)

	r := gin.New()
	r.POST("/web/agent-teams/:id/runs/:run_id/conflicts/:conflict_id/resolve", func(c *gin.Context) {
		c.Set("user_id", "user-1")
		h.ResolveConflict(c)
	})

	body := bytes.NewBufferString(`{"resolution":"accept_agent_task","selected_agent_task_id":"task-1","reason":"Reviewed diff"}`)
	req := httptest.NewRequest(http.MethodPost, "/web/agent-teams/team-1/runs/run-1/conflicts/file:shared.txt/resolve", body)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	require.True(t, called)
	assert.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Body.String(), model.TeamConflictStatusResolved)
}

func TestAgentTeamHandler_DecideApproval(t *testing.T) {
	gin.SetMode(gin.TestMode)

	called := false
	svc := &mockAgentTeamService{
		decideApproval: func(ctx context.Context, userID, teamID, runID, approvalID string, decision model.TeamApprovalDecision) (*model.TeamApprovalState, error) {
			called = true
			assert.Equal(t, "user-1", userID)
			assert.Equal(t, "team-1", teamID)
			assert.Equal(t, "run-1", runID)
			assert.Equal(t, "req-1", approvalID)
			assert.Equal(t, "allow", decision.Decision)
			assert.Equal(t, "Reviewed command", decision.Reason)
			return &model.TeamApprovalState{
				ApprovalID: approvalID,
				RequestID:  approvalID,
				Status:     decision.Decision,
				Reason:     decision.Reason,
				EdgeControl: &model.TeamApprovalEdgeControl{
					RunID:     "edge-run-1",
					RequestID: approvalID,
					Decision:  decision.Decision,
					Reason:    decision.Reason,
				},
			}, nil
		},
	}
	h := NewAgentTeamHandler(svc)

	r := gin.New()
	r.POST("/web/agent-teams/:id/runs/:run_id/approvals/:approval_id/decide", func(c *gin.Context) {
		c.Set("user_id", "user-1")
		h.DecideApproval(c)
	})

	body := bytes.NewBufferString(`{"decision":"allow","reason":"Reviewed command"}`)
	req := httptest.NewRequest(http.MethodPost, "/web/agent-teams/team-1/runs/run-1/approvals/req-1/decide", body)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	require.True(t, called)
	assert.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Body.String(), "edge-run-1")
	assert.Contains(t, w.Body.String(), "allow")
}

type mockAgentTeamService struct {
	createTeam          func(ctx context.Context, userID, name, description string) (*model.AgentTeam, error)
	listTeams           func(ctx context.Context, userID string) ([]model.AgentTeam, error)
	getTeamWithMembers  func(ctx context.Context, userID, teamID string) (*model.TeamDetail, error)
	addTeamMember       func(ctx context.Context, userID, teamID, agentProfileID, role string) error
	startTeamRun        func(ctx context.Context, userID, teamID, triggerMessage string) (*model.AgentTeamRun, error)
	handleRouteDecision func(ctx context.Context, userID, teamID, runID string, decision model.CoordinatorRouteDecision) (*model.AgentTeamAssignment, error)
	listTeamTasks       func(ctx context.Context, userID, teamID, runID string) ([]model.AgentTeamTask, error)
	listTeamEvents      func(ctx context.Context, userID, teamID, runID string) ([]model.AgentTeamEvent, error)
	resolveConflict     func(ctx context.Context, userID, teamID, runID string, resolution model.TeamConflictResolution) (*model.TeamConflictState, error)
	decideApproval      func(ctx context.Context, userID, teamID, runID, approvalID string, decision model.TeamApprovalDecision) (*model.TeamApprovalState, error)
}

func (m *mockAgentTeamService) CreateTeam(ctx context.Context, userID, name, description string) (*model.AgentTeam, error) {
	if m.createTeam == nil {
		return nil, nil
	}
	return m.createTeam(ctx, userID, name, description)
}

func (m *mockAgentTeamService) GetTeam(ctx context.Context, userID, teamID string) (*model.AgentTeam, error) {
	return nil, nil
}

func (m *mockAgentTeamService) GetTeamWithMembers(ctx context.Context, userID, teamID string) (*model.TeamDetail, error) {
	if m.getTeamWithMembers == nil {
		return nil, nil
	}
	return m.getTeamWithMembers(ctx, userID, teamID)
}

func (m *mockAgentTeamService) ListTeams(ctx context.Context, userID string) ([]model.AgentTeam, error) {
	if m.listTeams == nil {
		return nil, nil
	}
	return m.listTeams(ctx, userID)
}

func (m *mockAgentTeamService) UpdateTeam(ctx context.Context, userID, teamID, name, description string) error {
	return nil
}

func (m *mockAgentTeamService) DeleteTeam(ctx context.Context, userID, teamID string) error {
	return nil
}

func (m *mockAgentTeamService) AddTeamMember(ctx context.Context, userID, teamID, agentProfileID, role string) error {
	if m.addTeamMember == nil {
		return nil
	}
	return m.addTeamMember(ctx, userID, teamID, agentProfileID, role)
}

func (m *mockAgentTeamService) RemoveTeamMember(ctx context.Context, userID, teamID, memberID string) error {
	return nil
}

func (m *mockAgentTeamService) StartTeamRun(ctx context.Context, userID, teamID, triggerMessage string) (*model.AgentTeamRun, error) {
	if m.startTeamRun == nil {
		return nil, nil
	}
	return m.startTeamRun(ctx, userID, teamID, triggerMessage)
}

func (m *mockAgentTeamService) GetTeamRun(ctx context.Context, userID, teamID, runID string) (*model.AgentTeamRun, error) {
	return nil, nil
}

func (m *mockAgentTeamService) GetTeamRunState(ctx context.Context, userID, teamID, runID string) (*model.TeamRunState, error) {
	return nil, nil
}

func (m *mockAgentTeamService) ListTeamRuns(ctx context.Context, userID, teamID string) ([]model.AgentTeamRun, error) {
	return nil, nil
}

func (m *mockAgentTeamService) CreateAssignment(ctx context.Context, userID, teamRunID, fromMemberID, toMemberID, aType, taskPrompt, contextStr string) (*model.AgentTeamAssignment, error) {
	return nil, nil
}

func (m *mockAgentTeamService) DispatchAssignment(ctx context.Context, userID, assignmentID string) error {
	return nil
}

func (m *mockAgentTeamService) CompleteAssignment(ctx context.Context, userID, assignmentID string, result string) error {
	return nil
}

func (m *mockAgentTeamService) FailAssignment(ctx context.Context, userID, assignmentID string, reason string) error {
	return nil
}

func (m *mockAgentTeamService) ListAssignments(ctx context.Context, userID, teamRunID string) ([]model.AgentTeamAssignment, error) {
	return nil, nil
}

func (m *mockAgentTeamService) HandleRouteDecision(ctx context.Context, userID, teamID, runID string, decision model.CoordinatorRouteDecision) (*model.AgentTeamAssignment, error) {
	if m.handleRouteDecision == nil {
		return nil, nil
	}
	return m.handleRouteDecision(ctx, userID, teamID, runID, decision)
}

func (m *mockAgentTeamService) ListTeamEvents(ctx context.Context, userID, teamID, runID string) ([]model.AgentTeamEvent, error) {
	if m.listTeamEvents == nil {
		return nil, nil
	}
	return m.listTeamEvents(ctx, userID, teamID, runID)
}

func (m *mockAgentTeamService) ListTeamTasks(ctx context.Context, userID, teamID, runID string) ([]model.AgentTeamTask, error) {
	if m.listTeamTasks == nil {
		return nil, nil
	}
	return m.listTeamTasks(ctx, userID, teamID, runID)
}

func (m *mockAgentTeamService) ResolveConflict(ctx context.Context, userID, teamID, runID string, resolution model.TeamConflictResolution) (*model.TeamConflictState, error) {
	if m.resolveConflict == nil {
		return nil, nil
	}
	return m.resolveConflict(ctx, userID, teamID, runID, resolution)
}

func (m *mockAgentTeamService) DecideApproval(ctx context.Context, userID, teamID, runID, approvalID string, decision model.TeamApprovalDecision) (*model.TeamApprovalState, error) {
	if m.decideApproval == nil {
		return nil, nil
	}
	return m.decideApproval(ctx, userID, teamID, runID, approvalID, decision)
}
