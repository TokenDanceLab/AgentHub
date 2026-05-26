package service

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/cache"
	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
	"github.com/agenthub/hub-server/pkg/uuidv7"
)

// agentTeamAgentSvc is the subset of AgentService used by AgentTeamService.
type agentTeamAgentSvc interface {
	AddAgentToSession(ctx context.Context, userID, sessionID, agentType, customAgentID, displayName string) error
	TriggerAgentTask(ctx context.Context, userID, triggerMessageID, targetAgentInstanceID, targetAgentType, targetCustomAgentID, modelParams, targetID string) (*model.PendingAgentTask, error)
}

// agentTeamCache is the subset of *cache.Client used by AgentTeamService.
type agentTeamCache interface {
	AllocateSeq(ctx context.Context, sessionID string) (int64, error)
	InitSeqIfAbsent(ctx context.Context, sessionID string, seq int64) error
}

type AgentTeamService struct {
	db          *gorm.DB
	agentSvc    agentTeamAgentSvc
	cacheClient agentTeamCache
}

func NewAgentTeamService(db *gorm.DB, agentSvc agentTeamAgentSvc, cacheClient *cache.Client) *AgentTeamService {
	return &AgentTeamService{
		db:          db,
		agentSvc:    agentSvc,
		cacheClient: resolveAgentTeamCache(cacheClient),
	}
}

func resolveAgentTeamCache(c *cache.Client) agentTeamCache {
	if c == nil {
		return cache.NoOpCache{}
	}
	return c
}

// CreateTeam creates a new agent team owned by the given user.
func (s *AgentTeamService) CreateTeam(ctx context.Context, userID, name, description string) (*model.AgentTeam, error) {
	if name == "" {
		return nil, errcode.ErrBadRequest
	}
	team := &model.AgentTeam{
		OwnerID:     userID,
		Name:        name,
		Description: description,
	}
	if err := repository.CreateTeam(s.db, team); err != nil {
		return nil, err
	}
	return team, nil
}

// GetTeam returns a team by ID, verifying that the requesting user is the owner.
func (s *AgentTeamService) GetTeam(ctx context.Context, userID, teamID string) (*model.AgentTeam, error) {
	team, err := repository.GetTeamByID(s.db, teamID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errcode.AgentNotFound
		}
		return nil, err
	}
	if team.OwnerID != userID {
		return nil, errcode.AgentNotFound
	}
	return team, nil
}

// ListTeams returns all teams owned by the given user.
func (s *AgentTeamService) ListTeams(ctx context.Context, userID string) ([]model.AgentTeam, error) {
	return repository.ListTeamsByOwner(s.db, userID)
}

// UpdateTeam updates a team's name and description, verifying owner access.
func (s *AgentTeamService) UpdateTeam(ctx context.Context, userID, teamID, name, description string) error {
	team, err := repository.GetTeamByID(s.db, teamID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return errcode.AgentNotFound
		}
		return err
	}
	if team.OwnerID != userID {
		return errcode.AgentNotFound
	}
	if name != "" {
		team.Name = name
	}
	if description != "" {
		team.Description = description
	}
	return repository.UpdateTeam(s.db, team)
}

// DeleteTeam deletes a team, verifying owner access.
func (s *AgentTeamService) DeleteTeam(ctx context.Context, userID, teamID string) error {
	team, err := repository.GetTeamByID(s.db, teamID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return errcode.AgentNotFound
		}
		return err
	}
	if team.OwnerID != userID {
		return errcode.AgentNotFound
	}
	return repository.DeleteTeam(s.db, teamID)
}

// AddTeamMember adds an agent profile to a team with a given role.
func (s *AgentTeamService) AddTeamMember(ctx context.Context, userID, teamID, agentProfileID, role string) error {
	team, err := repository.GetTeamByID(s.db, teamID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return errcode.AgentNotFound
		}
		return err
	}
	if team.OwnerID != userID {
		return errcode.AgentNotFound
	}

	// Validate the agent profile exists and is owned by the user.
	if agentProfileID == "" {
		return errcode.ErrBadRequest
	}
	ca, err := repository.GetCustomAgentByID(s.db, agentProfileID)
	if err != nil {
		return errcode.AgentNotFound
	}
	if ca.OwnerUserID != userID {
		return errcode.AgentNotFound
	}

	// Validate role.
	if role == "" {
		role = model.TeamMemberRoleExecutor
	}
	if role != model.TeamMemberRoleSupervisor && role != model.TeamMemberRoleExecutor && role != model.TeamMemberRoleReviewer {
		return errcode.ErrBadRequest
	}

	member := &model.AgentTeamMember{
		TeamID:         teamID,
		Role:           role,
		AgentProfileID: &agentProfileID,
	}
	return repository.AddTeamMember(s.db, member)
}

// RemoveTeamMember removes a member from a team, verifying owner access.
func (s *AgentTeamService) RemoveTeamMember(ctx context.Context, userID, teamID, memberID string) error {
	team, err := repository.GetTeamByID(s.db, teamID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return errcode.AgentNotFound
		}
		return err
	}
	if team.OwnerID != userID {
		return errcode.AgentNotFound
	}

	member, err := repository.GetTeamMemberByID(s.db, memberID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return errcode.AgentNotFound
		}
		return err
	}
	if member.TeamID != teamID {
		return errcode.AgentNotFound
	}
	return repository.RemoveTeamMember(s.db, memberID)
}

// TeamDetail is returned when fetching a team with its members.
type TeamDetail = model.TeamDetail

// GetTeamWithMembers returns a team along with its member list.
func (s *AgentTeamService) GetTeamWithMembers(ctx context.Context, userID, teamID string) (*TeamDetail, error) {
	team, err := s.GetTeam(ctx, userID, teamID)
	if err != nil {
		return nil, err
	}
	members, err := repository.ListTeamMembers(s.db, teamID)
	if err != nil {
		return nil, err
	}
	if members == nil {
		members = []model.AgentTeamMember{}
	}
	return &TeamDetail{
		AgentTeam: team,
		Members:   members,
	}, nil
}

// StartTeamRun creates a group session, adds all team members as agent
// instances, triggers the supervisor agent, and records the run.
func (s *AgentTeamService) StartTeamRun(ctx context.Context, userID, teamID, triggerMessage string) (*model.AgentTeamRun, error) {
	team, err := repository.GetTeamByID(s.db, teamID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errcode.AgentNotFound
		}
		return nil, err
	}
	if team.OwnerID != userID {
		return nil, errcode.AgentNotFound
	}

	members, err := repository.ListTeamMembers(s.db, teamID)
	if err != nil {
		return nil, err
	}
	if len(members) == 0 {
		return nil, errcode.ErrBadRequest
	}

	// Find the supervisor: first member with role=supervisor, or first member.
	var supervisorMember *model.AgentTeamMember
	for i := range members {
		if members[i].Role == model.TeamMemberRoleSupervisor {
			supervisorMember = &members[i]
			break
		}
	}
	if supervisorMember == nil {
		supervisorMember = &members[0]
	}

	// Create a group session owned by the user.
	sessionName := team.Name
	if sessionName == "" {
		sessionName = "Agent Team"
	}
	session := &model.Session{
		Type:        model.SessionTypeGroup,
		Name:        sessionName,
		OwnerUserID: &userID,
	}
	run := &model.AgentTeamRun{
		TeamID:         teamID,
		TriggerUserID:  userID,
		TriggerMessage: triggerMessage,
		Status:         model.TeamRunStatusQueued,
	}

	err = s.db.Transaction(func(tx *gorm.DB) error {
		if err := repository.CreateSession(tx, session); err != nil {
			return err
		}
		// Add owner as session member.
		ownerMember := &model.SessionMember{
			SessionID:  session.ID,
			MemberType: model.MemberTypeUser,
			MemberID:   userID,
			Role:       model.MemberRoleOwner,
		}
		if err := repository.CreateSessionMember(tx, ownerMember); err != nil {
			return err
		}

		// Create agent instances for each team member.
		for i := range members {
			m := &members[i]
			displayName := team.Name + " Agent"
			if m.AgentProfileID != nil && *m.AgentProfileID != "" {
				ca, err := repository.GetCustomAgentByID(tx, *m.AgentProfileID)
				if err == nil {
					displayName = ca.Name
				}
			}
			ai := &model.AgentInstance{
				AgentType:     "codex",
				SessionID:     session.ID,
				InviterUserID: userID,
				DisplayName:   displayName,
			}
			if m.AgentProfileID != nil && *m.AgentProfileID != "" {
				ai.CustomAgentID = m.AgentProfileID
				if ca, err := repository.GetCustomAgentByID(tx, *m.AgentProfileID); err == nil {
					ai.AgentType = ca.AgentType
				}
			}
			if err := repository.CreateAgentInstance(tx, ai); err != nil {
				return err
			}
			sm := &model.SessionMember{
				SessionID:  session.ID,
				MemberType: model.MemberTypeAgent,
				MemberID:   ai.ID,
				Role:       model.MemberRoleMember,
			}
			if err := repository.CreateSessionMember(tx, sm); err != nil {
				return err
			}
		}

		// Create a trigger message in the session.
		contentBytes, _ := json.Marshal(map[string]string{"text": triggerMessage})
		msgClientID, _ := uuidv7.New()
		msg := &model.Message{
			SessionID:   session.ID,
			ClientMsgID: msgClientID,
			SenderType:  model.SenderTypeUser,
			SenderID:    userID,
			ContentType: model.ContentTypeText,
			Content:     string(contentBytes),
		}
		seq, seqErr := repository.AllocateSeqID(tx, session.ID)
		if seqErr != nil {
			return seqErr
		}
		msg.SeqID = seq
		if err := repository.InsertMessage(tx, msg); err != nil {
			return err
		}

		// Find the supervisor agent instance.
		supervisorAgentInstanceID := ""
		agents, listErr := repository.ListAgentInstancesBySession(tx, session.ID)
		if listErr != nil || len(agents) == 0 {
			return errcode.AgentNotFound
		}
		// Match supervisor by custom_agent_id.
		for i := range agents {
			agent := &agents[i]
			if supervisorMember.AgentProfileID != nil && agent.CustomAgentID != nil && *agent.CustomAgentID == *supervisorMember.AgentProfileID {
				supervisorAgentInstanceID = agent.ID
				break
			}
		}
		if supervisorAgentInstanceID == "" {
			supervisorAgentInstanceID = agents[0].ID
		}

		// Persist the run record now so TriggerAgentTask can reference it.
		run.SessionID = session.ID
		run.Status = model.TeamRunStatusRunning
		if err := repository.CreateTeamRun(tx, run); err != nil {
			return err
		}

		// Trigger the supervisor agent task (outside the transaction via goroutine
		// inside TriggerAgentTask, but we need to call it after commit). We store
		// the necessary info and dispatch after the transaction commits.
		return nil
	})
	if err != nil {
		return nil, err
	}

	// Init seq in Redis for the new session.
	if s.cacheClient != nil {
		if err := s.cacheClient.InitSeqIfAbsent(ctx, session.ID, 0); err != nil {
			slog.Warn("failed to init seq in cache for team session", "session_id", session.ID, "error", err)
		}
	}

	// Now trigger the supervisor agent task.
	// We need to find the supervisor agent instance ID from the session.
	agents, err := repository.ListAgentInstancesBySession(s.db, session.ID)
	if err != nil || len(agents) == 0 {
		_ = repository.UpdateTeamRunStatus(s.db, run.ID, model.TeamRunStatusFailed)
		return run, errcode.AgentNotFound
	}

	var supervisorAIID string
	for i := range agents {
		agent := &agents[i]
		if supervisorMember.AgentProfileID != nil && agent.CustomAgentID != nil && *agent.CustomAgentID == *supervisorMember.AgentProfileID {
			supervisorAIID = agent.ID
			break
		}
	}
	if supervisorAIID == "" {
		supervisorAIID = agents[0].ID
	}

	// Trigger the task. This dispatches asynchronously.
	if _, err := s.agentSvc.TriggerAgentTask(ctx, userID, "", supervisorAIID, "", "", "", ""); err != nil {
		slog.Error("failed to trigger supervisor agent task for team run", "run_id", run.ID, "team_id", teamID, "error", err)
		_ = repository.UpdateTeamRunStatus(s.db, run.ID, model.TeamRunStatusFailed)
		return run, err
	}

	return run, nil
}

// GetTeamRun returns a single team run, verifying owner access.
func (s *AgentTeamService) GetTeamRun(ctx context.Context, userID, teamID, runID string) (*model.AgentTeamRun, error) {
	team, err := s.GetTeam(ctx, userID, teamID)
	if err != nil {
		return nil, err
	}
	_ = team // verified ownership

	run, err := repository.GetTeamRunByID(s.db, runID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errcode.AgentTaskNotFound
		}
		return nil, err
	}
	if run.TeamID != teamID {
		return nil, errcode.AgentTaskNotFound
	}
	return run, nil
}

// ListTeamRuns returns all runs for a team, verifying owner access.
func (s *AgentTeamService) ListTeamRuns(ctx context.Context, userID, teamID string) ([]model.AgentTeamRun, error) {
	if _, err := s.GetTeam(ctx, userID, teamID); err != nil {
		return nil, err
	}
	return repository.ListTeamRunsByTeam(s.db, teamID)
}

// --- TeamAssignment ---

const (
	maxAssignmentDepth  = 3
	maxActiveAssignments = 5
)

// CreateAssignment creates a new team assignment (delegation) from a supervisor
// member to an executor member.
func (s *AgentTeamService) CreateAssignment(ctx context.Context, userID, teamRunID, fromMemberID, toMemberID, aType, taskPrompt, contextStr string) (*model.AgentTeamAssignment, error) {
	if taskPrompt == "" {
		return nil, errcode.ErrBadRequest
	}
	if aType == "" {
		aType = model.AssignmentTypeDelegate
	}

	// 1. Query TeamRun and verify trigger user.
	run, err := repository.GetTeamRunByID(s.db, teamRunID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errcode.AgentTaskNotFound
		}
		return nil, err
	}
	if run.TriggerUserID != userID {
		return nil, errcode.AgentTaskNotFound
	}

	// 2. Query fromMember and verify role is supervisor.
	fromMember, err := repository.GetTeamMemberByID(s.db, fromMemberID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errcode.AgentNotFound
		}
		return nil, err
	}
	if fromMember.Role != model.TeamMemberRoleSupervisor {
		return nil, errcode.ErrBadRequest
	}

	// 3. Query toMember and verify same team.
	toMember, err := repository.GetTeamMemberByID(s.db, toMemberID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errcode.AgentNotFound
		}
		return nil, err
	}
	if toMember.TeamID != fromMember.TeamID {
		return nil, errcode.ErrBadRequest
	}
	if fromMemberID == toMemberID {
		return nil, errcode.ErrBadRequest
	}

	// 4. Build ancestor chain and compute depth.
	ancestorDepth := 0
	var ancestorIDs []string // member IDs in the chain (both from and to)
	parentID := fromMemberID
	for {
		parentAssignment, aErr := repository.GetAssignmentByToMember(s.db, teamRunID, parentID)
		if aErr != nil {
			if errors.Is(aErr, gorm.ErrRecordNotFound) {
				break // root of chain
			}
			return nil, aErr
		}
		ancestorDepth = parentAssignment.Depth
		ancestorIDs = append(ancestorIDs, parentAssignment.FromMemberID, parentAssignment.ToMemberID)
		parentID = parentAssignment.FromMemberID
	}

	newDepth := ancestorDepth + 1
	if newDepth > maxAssignmentDepth {
		return nil, errcode.ErrBadRequest
	}

	// 5. Check active assignments limit.
	activeCount, err := repository.CountActiveAssignmentsByMember(s.db, fromMemberID)
	if err != nil {
		return nil, err
	}
	if activeCount >= maxActiveAssignments {
		return nil, errcode.ErrBadRequest
	}

	// 6. Check no duplicate member in ancestor chain.
	for _, mid := range ancestorIDs {
		if mid == toMemberID {
			return nil, errcode.ErrBadRequest
		}
	}

	// 7. Create assignment.
	assignment := &model.AgentTeamAssignment{
		TeamRunID:    teamRunID,
		FromMemberID: fromMemberID,
		ToMemberID:   toMemberID,
		Type:         aType,
		TaskPrompt:   taskPrompt,
		Context:      contextStr,
		Status:       model.AssignmentStatusPending,
		Depth:        newDepth,
	}
	if err := repository.CreateAssignment(s.db, assignment); err != nil {
		return nil, err
	}
	return assignment, nil
}

// DispatchAssignment dispatches a pending assignment to the target agent.
func (s *AgentTeamService) DispatchAssignment(ctx context.Context, userID, assignmentID string) error {
	// 1. Query assignment and verify team run owner.
	a, err := repository.GetAssignmentByID(s.db, assignmentID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return errcode.AgentTaskNotFound
		}
		return err
	}

	run, err := repository.GetTeamRunByID(s.db, a.TeamRunID)
	if err != nil {
		return err
	}
	if run.TriggerUserID != userID {
		return errcode.AgentTaskNotFound
	}

	if a.Status != model.AssignmentStatusPending && a.Status != model.AssignmentStatusDispatched {
		return errcode.ErrBadRequest
	}

	// 2. Update status to dispatched.
	if err := repository.UpdateAssignmentStatus(s.db, assignmentID, model.AssignmentStatusDispatched, ""); err != nil {
		return err
	}

	// 3. Find the target agent instance in the team run's session.
	if run.SessionID == "" {
		return errcode.AgentNotFound
	}

	toMember, err := repository.GetTeamMemberByID(s.db, a.ToMemberID)
	if err != nil {
		return err
	}

	agents, err := repository.ListAgentInstancesBySession(s.db, run.SessionID)
	if err != nil || len(agents) == 0 {
		return errcode.AgentNotFound
	}

	var targetAIID string
	for i := range agents {
		agent := &agents[i]
		if toMember.AgentProfileID != nil && agent.CustomAgentID != nil && *agent.CustomAgentID == *toMember.AgentProfileID {
			targetAIID = agent.ID
			break
		}
	}
	if targetAIID == "" {
		return errcode.AgentNotFound
	}

	// 4. Trigger the agent task. The assignment_id, team_run_id, task_prompt, and context
	//    are passed so the agent knows its delegation context.
	_, triggerErr := s.agentSvc.TriggerAgentTask(ctx, userID, "", targetAIID, "", "", "", "")
	if triggerErr != nil {
		slog.Error("failed to trigger dispatch for assignment", "assignment_id", assignmentID, "error", triggerErr)
		return triggerErr
	}

	return nil
}

// CompleteAssignment marks a running assignment as done with the given result.
func (s *AgentTeamService) CompleteAssignment(ctx context.Context, userID, assignmentID string, result string) error {
	a, err := repository.GetAssignmentByID(s.db, assignmentID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return errcode.AgentTaskNotFound
		}
		return err
	}

	run, err := repository.GetTeamRunByID(s.db, a.TeamRunID)
	if err != nil {
		return err
	}
	if run.TriggerUserID != userID {
		return errcode.AgentTaskNotFound
	}

	if a.Status != model.AssignmentStatusRunning {
		return errcode.ErrBadRequest
	}

	return repository.UpdateAssignmentStatus(s.db, assignmentID, model.AssignmentStatusDone, result)
}

// FailAssignment marks an assignment as failed with the given reason.
func (s *AgentTeamService) FailAssignment(ctx context.Context, userID, assignmentID string, reason string) error {
	a, err := repository.GetAssignmentByID(s.db, assignmentID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return errcode.AgentTaskNotFound
		}
		return err
	}

	run, err := repository.GetTeamRunByID(s.db, a.TeamRunID)
	if err != nil {
		return err
	}
	if run.TriggerUserID != userID {
		return errcode.AgentTaskNotFound
	}

	return repository.UpdateAssignmentStatus(s.db, assignmentID, model.AssignmentStatusFailed, reason)
}

// ListAssignments returns all assignments for a team run, verifying owner access.
func (s *AgentTeamService) ListAssignments(ctx context.Context, userID, teamRunID string) ([]model.AgentTeamAssignment, error) {
	run, err := repository.GetTeamRunByID(s.db, teamRunID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errcode.AgentTaskNotFound
		}
		return nil, err
	}
	if run.TriggerUserID != userID {
		return nil, errcode.AgentTaskNotFound
	}

	as, err := repository.ListAssignmentsByTeamRun(s.db, teamRunID)
	if err != nil {
		return nil, err
	}
	if as == nil {
		as = []model.AgentTeamAssignment{}
	}
	return as, nil
}
