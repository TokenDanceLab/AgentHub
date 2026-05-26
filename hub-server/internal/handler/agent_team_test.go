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

type mockAgentTeamService struct {
	handleRouteDecision func(ctx context.Context, userID, teamID, runID string, decision model.CoordinatorRouteDecision) (*model.AgentTeamAssignment, error)
}

func (m *mockAgentTeamService) CreateTeam(ctx context.Context, userID, name, description string) (*model.AgentTeam, error) {
	return nil, nil
}

func (m *mockAgentTeamService) GetTeam(ctx context.Context, userID, teamID string) (*model.AgentTeam, error) {
	return nil, nil
}

func (m *mockAgentTeamService) GetTeamWithMembers(ctx context.Context, userID, teamID string) (*model.TeamDetail, error) {
	return nil, nil
}

func (m *mockAgentTeamService) ListTeams(ctx context.Context, userID string) ([]model.AgentTeam, error) {
	return nil, nil
}

func (m *mockAgentTeamService) UpdateTeam(ctx context.Context, userID, teamID, name, description string) error {
	return nil
}

func (m *mockAgentTeamService) DeleteTeam(ctx context.Context, userID, teamID string) error {
	return nil
}

func (m *mockAgentTeamService) AddTeamMember(ctx context.Context, userID, teamID, agentProfileID, role string) error {
	return nil
}

func (m *mockAgentTeamService) RemoveTeamMember(ctx context.Context, userID, teamID, memberID string) error {
	return nil
}

func (m *mockAgentTeamService) StartTeamRun(ctx context.Context, userID, teamID, triggerMessage string) (*model.AgentTeamRun, error) {
	return nil, nil
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
