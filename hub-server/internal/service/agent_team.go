package service

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"strconv"
	"strings"
	"time"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/cache"
	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
	"github.com/agenthub/hub-server/pkg/uuidv7"
)

// agentTeamAgentSvc is the subset of AgentService used by AgentTeamService.
type agentTeamAgentSvc interface {
	AddAgentToSession(ctx context.Context, userID, sessionID, agentType, customAgentID, displayName string) (*model.AgentInstance, error)
	TriggerAgentTask(ctx context.Context, userID, triggerMessageID, targetAgentInstanceID, targetAgentType, targetCustomAgentID, modelParams, targetID string) (*model.PendingAgentTask, error)
}

// agentTeamCache is the subset of *cache.Client used by AgentTeamService.
type agentTeamCache interface {
	AllocateSeq(ctx context.Context, sessionID string) (int64, error)
	InitSeqIfAbsent(ctx context.Context, sessionID string, seq int64) error
}

type agentTeamControlSvc interface {
	DeliverToDesktopDevice(ctx context.Context, userID, deviceID string, payload model.AgentControlPayload) error
}

type AgentTeamService struct {
	db          *gorm.DB
	agentSvc    agentTeamAgentSvc
	cacheClient agentTeamCache
	controlSvc  agentTeamControlSvc
	bus         *Bus
	guardrails  AgentTeamGuardrails
}

type AgentTeamGuardrails struct {
	MaxDelegationDepth       int
	MaxActiveSubAgentsPerRun int64
	MaxRouteRepeats          int
	MaxTasksPerTeamRun       int64
	AssignmentTimeout        time.Duration
	MaxTeamRunBudgetTokens   int64
	MaxTeamRunBudgetUsagePct float64
}

func DefaultAgentTeamGuardrails() AgentTeamGuardrails {
	return AgentTeamGuardrails{
		MaxDelegationDepth:       model.MaxDelegationDepth,
		MaxActiveSubAgentsPerRun: model.MaxActiveSubAgentsPerRun,
		MaxRouteRepeats:          model.MaxRouteRepeats,
		MaxTasksPerTeamRun:       model.MaxTasksPerTeamRun,
		AssignmentTimeout:        model.DefaultAssignmentTimeout,
		MaxTeamRunBudgetTokens:   model.MaxTeamRunBudgetTokens,
		MaxTeamRunBudgetUsagePct: model.MaxTeamRunBudgetUsagePct,
	}
}

func (g AgentTeamGuardrails) normalized() AgentTeamGuardrails {
	defaults := DefaultAgentTeamGuardrails()
	if g.MaxDelegationDepth <= 0 {
		g.MaxDelegationDepth = defaults.MaxDelegationDepth
	}
	if g.MaxActiveSubAgentsPerRun <= 0 {
		g.MaxActiveSubAgentsPerRun = defaults.MaxActiveSubAgentsPerRun
	}
	if g.MaxRouteRepeats <= 0 {
		g.MaxRouteRepeats = defaults.MaxRouteRepeats
	}
	if g.MaxTasksPerTeamRun <= 0 {
		g.MaxTasksPerTeamRun = defaults.MaxTasksPerTeamRun
	}
	if g.AssignmentTimeout <= 0 {
		g.AssignmentTimeout = defaults.AssignmentTimeout
	}
	if g.MaxTeamRunBudgetTokens <= 0 {
		g.MaxTeamRunBudgetTokens = defaults.MaxTeamRunBudgetTokens
	}
	if g.MaxTeamRunBudgetUsagePct <= 0 {
		g.MaxTeamRunBudgetUsagePct = defaults.MaxTeamRunBudgetUsagePct
	}
	return g
}

func NewAgentTeamService(db *gorm.DB, agentSvc agentTeamAgentSvc, cacheClient *cache.Client) *AgentTeamService {
	return NewAgentTeamServiceWithGuardrails(db, agentSvc, cacheClient, DefaultAgentTeamGuardrails())
}

func NewAgentTeamServiceWithGuardrails(db *gorm.DB, agentSvc agentTeamAgentSvc, cacheClient *cache.Client, guardrails AgentTeamGuardrails) *AgentTeamService {
	return &AgentTeamService{
		db:          db,
		agentSvc:    agentSvc,
		cacheClient: resolveAgentTeamCache(cacheClient),
		guardrails:  guardrails.normalized(),
	}
}

func (s *AgentTeamService) SetControlService(controlSvc agentTeamControlSvc) {
	s.controlSvc = controlSvc
}

func (s *AgentTeamService) SetBus(bus *Bus) {
	s.bus = bus
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

// GetTeam returns a team by ID when the requesting user owns the team or owns
// an Agent Profile installed as a team member.
func (s *AgentTeamService) GetTeam(ctx context.Context, userID, teamID string) (*model.AgentTeam, error) {
	return s.getTeamForRead(ctx, userID, teamID)
}

func (s *AgentTeamService) getTeamForRead(ctx context.Context, userID, teamID string) (*model.AgentTeam, error) {
	team, err := repository.GetTeamByID(s.db, teamID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errcode.AgentNotFound
		}
		return nil, err
	}
	if team.OwnerID == userID {
		return team, nil
	}
	isMember, err := repository.TeamHasAgentOwnedByUser(s.db, teamID, userID)
	if err != nil {
		return nil, err
	}
	if !isMember {
		return nil, errcode.AgentNotFound
	}
	return team, nil
}

func (s *AgentTeamService) requireTeamOwner(ctx context.Context, userID, teamID string) (*model.AgentTeam, error) {
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

// ListTeams returns all teams owned by the user or readable through one of the
// user's Agent Profiles installed as a team member.
func (s *AgentTeamService) ListTeams(ctx context.Context, userID string) ([]model.AgentTeam, error) {
	return repository.ListTeamsReadableByUser(s.db, userID)
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
func (s *AgentTeamService) StartTeamRun(ctx context.Context, userID, teamID, triggerMessage, targetID string) (*model.AgentTeamRun, error) {
	team, err := repository.GetTeamByID(s.db, teamID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errcode.AgentNotFound
		}
		return nil, err
	}
	members, err := repository.ListTeamMembers(s.db, teamID)
	if err != nil {
		return nil, err
	}
	if len(members) == 0 {
		return nil, errcode.ErrBadRequest
	}

	// Allow owner or team member (user who owns any agent profile in the team).
	if team.OwnerID != userID {
		// Batch query all custom agents referenced by team members.
		var authAgentIDs []string
		for _, m := range members {
			if m.AgentProfileID != nil && *m.AgentProfileID != "" {
				authAgentIDs = append(authAgentIDs, *m.AgentProfileID)
			}
		}
		authAgentMap := make(map[string]*model.CustomAgent)
		if len(authAgentIDs) > 0 {
			var authAgents []model.CustomAgent
			if err := s.db.Where("id IN ? AND deleted_at IS NULL", authAgentIDs).Find(&authAgents).Error; err == nil {
				for i := range authAgents {
					authAgentMap[authAgents[i].ID] = &authAgents[i]
				}
			}
		}
		isMember := false
		for _, m := range members {
			if m.AgentProfileID != nil && *m.AgentProfileID != "" {
				ca, ok := authAgentMap[*m.AgentProfileID]
				if ok && ca.OwnerUserID == userID {
					isMember = true
					break
				}
			}
		}
		if !isMember {
			return nil, errcode.AgentNotFound
		}
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
		TargetID:       optionalTeamRunTargetID(targetID),
		Status:         model.TeamRunStatusQueued,
	}

	// Collect custom agent IDs for batch query.
	var customAgentIDs []string
	for _, m := range members {
		if m.AgentProfileID != nil && *m.AgentProfileID != "" {
			customAgentIDs = append(customAgentIDs, *m.AgentProfileID)
		}
	}

	var supervisorAIID string
	var triggerMessageID string

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

		// Batch query all custom agents referenced by team members.
		customAgentMap := make(map[string]*model.CustomAgent)
		if len(customAgentIDs) > 0 {
			var agents []model.CustomAgent
			if err := tx.Where("id IN ? AND deleted_at IS NULL", customAgentIDs).Find(&agents).Error; err == nil {
				for i := range agents {
					customAgentMap[agents[i].ID] = &agents[i]
				}
			}
		}

		// Create agent instances for each team member.
		for i := range members {
			m := &members[i]
			displayName := team.Name + " Agent"
			if m.AgentProfileID != nil {
				if ca, ok := customAgentMap[*m.AgentProfileID]; ok {
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
				if ca, ok := customAgentMap[*m.AgentProfileID]; ok {
					ai.AgentType = ca.AgentType
				}
			}
			if err := repository.CreateAgentInstance(tx, ai); err != nil {
				return err
			}
			// Track supervisor agent instance ID.
			if m.ID == supervisorMember.ID {
				supervisorAIID = ai.ID
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
		triggerMessageID = msg.ID

		// Verify we have a supervisor agent instance.
		if supervisorAIID == "" {
			return errcode.AgentNotFound
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

	// Trigger the task. This dispatches asynchronously.
	if _, err := s.agentSvc.TriggerAgentTask(ctx, userID, triggerMessageID, supervisorAIID, "", "", supervisorRouteModelParams(), teamRunTargetID(run)); err != nil {
		slog.Error("failed to trigger supervisor agent task for team run", "run_id", run.ID, "team_id", teamID, "error", err)
		_ = repository.UpdateTeamRunStatus(s.db, run.ID, model.TeamRunStatusFailed)
		return run, err
	}
	s.publishTeamEvent(ctx, "team.run.started", map[string]interface{}{
		"team_id":    teamID,
		"run_id":     run.ID,
		"session_id": session.ID,
		"user_id":    userID,
	})

	return run, nil
}

const supervisorRouteDecisionSchema = `{"type":"object","additionalProperties":false,"required":["action"],"properties":{"action":{"type":"string","enum":["delegate","review","approve","finish"]},"next_worker":{"type":"string","description":"AgentTeamMember id to receive delegate/review/approve work"},"instructions":{"type":"string","description":"Concrete task prompt for the next worker"},"reasoning":{"type":"string","description":"Why this route is appropriate"},"context":{"type":"string","description":"Additional context for the next worker"},"approved":{"type":"boolean"},"feedback":{"type":"string"},"summary":{"type":"string","description":"Final TeamRun summary for action=finish"},"blocked_reason":{"type":"string","description":"Why the TeamRun cannot continue"},"correlation_id":{"type":"string","description":"Optional id linking this route to prior work"}}}`

const supervisorRoutePrompt = "AgentHub TeamRun supervisor mode: decide the next team step with the structured output schema. Use action=delegate/review/approve with next_worker set to an AgentTeamMember id and instructions set to the next task, or action=finish with summary/blocked_reason when the TeamRun is done or blocked. Do not start sub-agents locally; Hub will create TeamAssignment and dispatch them."

func supervisorRouteModelParams() string {
	data, err := json.Marshal(map[string]string{
		"structured_output_schema": supervisorRouteDecisionSchema,
		"append_system_prompt":     supervisorRoutePrompt,
	})
	if err != nil {
		return ""
	}
	return string(data)
}

// GetTeamRun returns a single team run, verifying owner access.
func (s *AgentTeamService) GetTeamRun(ctx context.Context, userID, teamID, runID string) (*model.AgentTeamRun, error) {
	team, err := s.getTeamForRead(ctx, userID, teamID)
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
	if _, err := s.getTeamForRead(ctx, userID, teamID); err != nil {
		return nil, err
	}
	return repository.ListTeamRunsByTeam(s.db, teamID)
}

// GetTeamRunState returns a replayable projection of a team run.
func (s *AgentTeamService) GetTeamRunState(ctx context.Context, userID, teamID, runID string) (*model.TeamRunState, error) {
	if _, err := s.getTeamForRead(ctx, userID, teamID); err != nil {
		return nil, err
	}
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

	members, err := repository.ListTeamMembers(s.db, teamID)
	if err != nil {
		return nil, err
	}
	assignments, err := repository.ListAssignmentsByTeamRun(s.db, runID)
	if err != nil {
		return nil, err
	}
	tasks, err := repository.ListTeamTasksByRun(s.db, runID)
	if err != nil {
		return nil, err
	}
	agentTaskIDs := teamAgentTaskIDs(assignments, tasks)
	pendingTaskByID, err := s.pendingTaskSnapshotByID(assignments, tasks)
	if err != nil {
		return nil, err
	}
	runEvents, err := repository.ListAgentRunEventsByTaskIDs(s.db, agentTaskIDs)
	if err != nil {
		return nil, err
	}
	events, err := repository.ListTeamEventsByRun(s.db, runID)
	if err != nil {
		return nil, err
	}

	state := &model.TeamRunState{
		RunID:        run.ID,
		TeamID:       run.TeamID,
		Status:       run.Status,
		Members:      make([]model.TeamMemberState, 0, len(members)),
		Tasks:        make([]model.TeamTaskState, 0, len(tasks)),
		Dependencies: make([]model.TeamTaskDependencyState, 0),
		Assignments:  make([]model.TeamAssignmentState, 0, len(assignments)),
		Approvals:    []model.TeamApprovalState{},
		Artifacts:    []model.TeamArtifactState{},
		Conflicts:    []model.TeamConflictState{},
		RunEvents:    make([]model.TeamRunEventState, 0, len(runEvents)),
		RouteLog:     []model.CoordinatorRouteDecision{},
	}

	memberIndex := make(map[string]int, len(members))
	for _, member := range members {
		agentProfileID := ""
		if member.AgentProfileID != nil {
			agentProfileID = *member.AgentProfileID
		}
		memberIndex[member.ID] = len(state.Members)
		state.Members = append(state.Members, model.TeamMemberState{
			MemberID:       member.ID,
			AgentProfileID: agentProfileID,
			Role:           member.Role,
		})
	}

	for _, assignment := range assignments {
		runIDValue := ""
		if assignment.RunID != nil {
			runIDValue = *assignment.RunID
		}
		status := assignment.Status
		edgeRunID := ""
		if pending, ok := pendingTaskByID[runIDValue]; ok {
			status = assignmentStatusFromPending(pending.Status)
			edgeRunID = pending.EdgeRunID
		}
		state.Assignments = append(state.Assignments, model.TeamAssignmentState{
			AssignmentID: assignment.ID,
			FromMemberID: assignment.FromMemberID,
			ToMemberID:   assignment.ToMemberID,
			Type:         assignment.Type,
			Status:       status,
			Depth:        assignment.Depth,
			RunID:        runIDValue,
			AgentTaskID:  runIDValue,
			EdgeRunID:    edgeRunID,
		})
		if idx, ok := memberIndex[assignment.ToMemberID]; ok {
			switch status {
			case model.AssignmentStatusPending, model.AssignmentStatusDispatched, model.AssignmentStatusRunning:
				state.Members[idx].ActiveTasks++
			case model.AssignmentStatusDone:
				state.Members[idx].CompletedTasks++
			}
		}
	}

	taskRefs := make(map[string]teamRuntimeTaskRef, len(tasks))
	for _, task := range tasks {
		assignmentID := ""
		if task.AssignmentID != nil {
			assignmentID = *task.AssignmentID
		}
		parentTaskID := ""
		if task.ParentTaskID != nil {
			parentTaskID = *task.ParentTaskID
		}
		runIDValue := ""
		if task.RunID != nil {
			runIDValue = *task.RunID
		}
		status := task.Status
		edgeRunID := ""
		if pending, ok := pendingTaskByID[runIDValue]; ok {
			status = teamTaskStatusFromPending(pending.Status)
			edgeRunID = pending.EdgeRunID
		}
		state.Tasks = append(state.Tasks, model.TeamTaskState{
			TaskID:           task.ID,
			AssignmentID:     assignmentID,
			AssigneeMemberID: task.AssigneeMemberID,
			ParentTaskID:     parentTaskID,
			Status:           status,
			Objective:        task.Objective,
			RunID:            runIDValue,
			AgentTaskID:      runIDValue,
			EdgeRunID:        edgeRunID,
			Attempt:          task.Attempt,
			RiskLevel:        task.RiskLevel,
		})
		if runIDValue != "" {
			taskRefs[runIDValue] = teamRuntimeTaskRef{
				TeamTaskID:   task.ID,
				AssignmentID: assignmentID,
				MemberID:     task.AssigneeMemberID,
			}
		}
		if parentTaskID != "" {
			state.Dependencies = append(state.Dependencies, model.TeamTaskDependencyState{
				TaskID:          task.ID,
				DependsOnTaskID: parentTaskID,
				Kind:            "parent_task",
			})
		}
	}

	for _, event := range runEvents {
		state.RunEvents = append(state.RunEvents, model.TeamRunEventState{
			AgentTaskID: event.TaskID,
			EdgeRunID:   event.EdgeRunID,
			EventSeq:    event.EventSeq,
			EventType:   event.EventType,
			Payload:     event.Payload,
			CreatedAt:   event.CreatedAt,
		})
	}
	state.Approvals, state.Artifacts = projectTeamRuntimeSummaries(runEvents, taskRefs)
	state.Conflicts = projectTeamConflicts(state.Artifacts)
	if err := s.refreshTeamArtifactIndex(runID, state.Artifacts); err != nil {
		return nil, err
	}
	state.Budget = projectTeamBudget(runEvents, len(agentTaskIDs))

	for _, event := range events {
		switch event.Type {
		case model.TeamEventRouteDecided:
			var decision model.CoordinatorRouteDecision
			if err := json.Unmarshal([]byte(event.Payload), &decision); err == nil && decision.Action != "" {
				state.RouteLog = append(state.RouteLog, decision)
			}
		case model.TeamEventRunStarted:
			state.Status = model.TeamRunStatusRunning
		case model.TeamEventRunCompleted:
			state.Status = model.TeamRunStatusCompleted
			state.TerminalReason = payloadString(event.Payload, "summary", "reason")
		case model.TeamEventRunFailed:
			state.Status = model.TeamRunStatusFailed
			state.TerminalReason = payloadString(event.Payload, "reason", "blocked_reason")
		case model.TeamEventConflictResolved:
			var resolution model.TeamConflictResolution
			if err := json.Unmarshal([]byte(event.Payload), &resolution); err == nil {
				applyConflictResolution(state.Conflicts, resolution)
			}
		case model.TeamEventApprovalDecided:
			var decision model.TeamApprovalDecision
			if err := json.Unmarshal([]byte(event.Payload), &decision); err == nil {
				applyApprovalDecision(state.Approvals, decision)
			}
		}
	}

	return state, nil
}

func (s *AgentTeamService) DecideApproval(ctx context.Context, userID, teamID, runID, approvalID string, decision model.TeamApprovalDecision) (*model.TeamApprovalState, error) {
	approvalID = strings.TrimSpace(approvalID)
	decision.Decision = strings.ToLower(strings.TrimSpace(decision.Decision))
	decision.Reason = strings.TrimSpace(decision.Reason)
	if approvalID == "" || !validApprovalDecision(decision.Decision) {
		return nil, errcode.ErrBadRequest
	}
	if _, err := s.requireTeamOwner(ctx, userID, teamID); err != nil {
		return nil, err
	}

	state, err := s.GetTeamRunState(ctx, userID, teamID, runID)
	if err != nil {
		return nil, err
	}
	approval := findApproval(state.Approvals, approvalID)
	if approval == nil {
		return nil, errcode.ErrBadRequest
	}
	if !pendingApprovalStatus(approval.Status) {
		return s.redeliverDecidedApproval(ctx, userID, teamID, runID, approval, decision)
	}
	if strings.TrimSpace(approval.RequestID) == "" || strings.TrimSpace(approval.EdgeRunID) == "" {
		return nil, errcode.ErrBadRequest
	}

	edgeDeviceID := ""
	targetID := ""
	if s.controlSvc != nil {
		edgeDeviceID, targetID, err = s.approvalControlTarget(userID, approval.AgentTaskID)
		if err != nil {
			return nil, err
		}
	}

	now := time.Now().UTC()
	edgeControl := &model.TeamApprovalEdgeControl{
		RunID:     approval.EdgeRunID,
		RequestID: approval.RequestID,
		Decision:  decision.Decision,
		Reason:    decision.Reason,
	}
	record := model.TeamApprovalDecision{
		ApprovalID:   firstNonEmptyString(approval.ApprovalID, approvalIDFor(approval.RequestID, approval.ToolUseID)),
		AgentTaskID:  approval.AgentTaskID,
		TeamTaskID:   approval.TeamTaskID,
		AssignmentID: approval.AssignmentID,
		MemberID:     approval.MemberID,
		EdgeRunID:    approval.EdgeRunID,
		RequestID:    approval.RequestID,
		ToolName:     approval.ToolName,
		ToolUseID:    approval.ToolUseID,
		Decision:     decision.Decision,
		Reason:       decision.Reason,
		DecidedBy:    userID,
		DecidedAt:    now,
		EdgeControl:  edgeControl,
	}
	if err := s.appendTeamEvent(runID, model.TeamEventApprovalDecided, record); err != nil {
		return nil, err
	}
	if s.controlSvc != nil {
		if err := s.controlSvc.DeliverToDesktopDevice(ctx, userID, edgeDeviceID, model.AgentControlPayload{
			Kind:         model.AgentControlKindPermissionDecide,
			AgentTaskID:  record.AgentTaskID,
			TargetID:     targetID,
			EdgeDeviceID: edgeDeviceID,
			TeamID:       teamID,
			TeamRunID:    runID,
			TeamTaskID:   record.TeamTaskID,
			AssignmentID: record.AssignmentID,
			MemberID:     record.MemberID,
			ApprovalID:   record.ApprovalID,
			EdgeControl:  edgeControl,
		}); err != nil {
			return nil, err
		}
	}

	decided := *approval
	decided.ApprovalID = record.ApprovalID
	decided.Status = record.Decision
	decided.Reason = record.Reason
	decided.DecidedBy = record.DecidedBy
	decided.DecidedAt = &now
	decided.EdgeControl = edgeControl
	return &decided, nil
}

func (s *AgentTeamService) redeliverDecidedApproval(ctx context.Context, userID, teamID, runID string, approval *model.TeamApprovalState, decision model.TeamApprovalDecision) (*model.TeamApprovalState, error) {
	if strings.ToLower(strings.TrimSpace(approval.Status)) != decision.Decision {
		return nil, errcode.ErrBadRequest
	}
	if s.controlSvc != nil {
		if approval.EdgeControl == nil || strings.TrimSpace(approval.EdgeControl.RunID) == "" || strings.TrimSpace(approval.EdgeControl.RequestID) == "" {
			return nil, errcode.ErrBadRequest
		}
		edgeDeviceID, targetID, err := s.approvalControlTarget(userID, approval.AgentTaskID)
		if err != nil {
			return nil, err
		}
		if err := s.controlSvc.DeliverToDesktopDevice(ctx, userID, edgeDeviceID, model.AgentControlPayload{
			Kind:         model.AgentControlKindPermissionDecide,
			AgentTaskID:  approval.AgentTaskID,
			TargetID:     targetID,
			EdgeDeviceID: edgeDeviceID,
			TeamID:       teamID,
			TeamRunID:    runID,
			TeamTaskID:   approval.TeamTaskID,
			AssignmentID: approval.AssignmentID,
			MemberID:     approval.MemberID,
			ApprovalID:   firstNonEmptyString(approval.ApprovalID, approvalIDFor(approval.RequestID, approval.ToolUseID)),
			EdgeControl:  approval.EdgeControl,
		}); err != nil {
			return nil, err
		}
	}
	decided := *approval
	return &decided, nil
}

func (s *AgentTeamService) approvalControlTarget(userID, agentTaskID string) (string, string, error) {
	agentTaskID = strings.TrimSpace(agentTaskID)
	if agentTaskID == "" {
		return "", "", errcode.ErrBadRequest
	}
	pendingTask, err := repository.GetPendingTaskByID(s.db, agentTaskID)
	if err != nil {
		return "", "", errcode.ErrBadRequest
	}
	edgeDeviceID := strings.TrimSpace(pendingTask.EdgeDeviceID)
	if pendingTask.TriggeredByUserID != userID || edgeDeviceID == "" {
		return "", "", errcode.ErrBadRequest
	}
	return edgeDeviceID, strings.TrimSpace(pendingTask.TargetID), nil
}

func (s *AgentTeamService) ResolveConflict(ctx context.Context, userID, teamID, runID string, resolution model.TeamConflictResolution) (*model.TeamConflictState, error) {
	resolution.ConflictID = strings.TrimSpace(resolution.ConflictID)
	resolution.Path = normalizedArtifactPath(resolution.Path)
	resolution.Resolution = strings.ToLower(strings.TrimSpace(resolution.Resolution))
	resolution.SelectedAgentTaskID = strings.TrimSpace(resolution.SelectedAgentTaskID)
	resolution.Reason = strings.TrimSpace(resolution.Reason)
	if resolution.ConflictID == "" && resolution.Path != "" {
		resolution.ConflictID = conflictIDForPath(resolution.Path)
	}
	if resolution.ConflictID == "" || !validConflictResolution(resolution.Resolution) {
		return nil, errcode.ErrBadRequest
	}
	if _, err := s.requireTeamOwner(ctx, userID, teamID); err != nil {
		return nil, err
	}

	state, err := s.GetTeamRunState(ctx, userID, teamID, runID)
	if err != nil {
		return nil, err
	}
	conflict := findConflict(state.Conflicts, resolution.ConflictID)
	if conflict == nil {
		return nil, errcode.ErrBadRequest
	}
	if conflict.Status == model.TeamConflictStatusResolved {
		return nil, errcode.ErrBadRequest
	}
	if resolution.Path == "" {
		resolution.Path = conflict.Path
	}
	if resolution.Resolution == model.TeamConflictResolutionAcceptAgentTask && !stringInSlice(conflict.AgentTaskIDs, resolution.SelectedAgentTaskID) {
		return nil, errcode.ErrBadRequest
	}
	now := time.Now().UTC()
	resolution.ResolvedBy = userID
	resolution.ResolvedAt = now
	if err := s.appendTeamEvent(runID, model.TeamEventConflictResolved, resolution); err != nil {
		return nil, err
	}
	resolved := *conflict
	resolved.Status = model.TeamConflictStatusResolved
	resolved.Resolution = resolution.Resolution
	resolved.ResolvedBy = resolution.ResolvedBy
	resolved.ResolvedAt = &now
	resolved.Reason = resolution.Reason
	resolved.SelectedTask = resolution.SelectedAgentTaskID
	return &resolved, nil
}

func findConflict(conflicts []model.TeamConflictState, conflictID string) *model.TeamConflictState {
	for i := range conflicts {
		if conflicts[i].ConflictID == conflictID {
			return &conflicts[i]
		}
	}
	return nil
}

func validConflictResolution(resolution string) bool {
	switch resolution {
	case model.TeamConflictResolutionAcceptAgentTask,
		model.TeamConflictResolutionManualMerge,
		model.TeamConflictResolutionKeepAll,
		model.TeamConflictResolutionDiscardAll,
		model.TeamConflictResolutionBlocked:
		return true
	default:
		return false
	}
}

func findApproval(approvals []model.TeamApprovalState, approvalID string) *model.TeamApprovalState {
	approvalID = strings.TrimSpace(approvalID)
	for i := range approvals {
		if approvalMatchesID(approvals[i], approvalID) {
			return &approvals[i]
		}
	}
	return nil
}

func approvalMatchesID(approval model.TeamApprovalState, approvalID string) bool {
	approvalID = strings.TrimSpace(approvalID)
	if approvalID == "" {
		return false
	}
	return approval.ApprovalID == approvalID ||
		approval.RequestID == approvalID ||
		approval.ToolUseID == approvalID
}

func validApprovalDecision(decision string) bool {
	switch decision {
	case "allow", "deny":
		return true
	default:
		return false
	}
}

func pendingApprovalStatus(status string) bool {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "", "pending", "requested", "awaiting":
		return true
	default:
		return false
	}
}

func applyApprovalDecision(approvals []model.TeamApprovalState, decision model.TeamApprovalDecision) {
	if decision.ApprovalID == "" {
		decision.ApprovalID = approvalIDFor(decision.RequestID, decision.ToolUseID)
	}
	for i := range approvals {
		if !approvalMatchesID(approvals[i], decision.ApprovalID) {
			continue
		}
		approvals[i].ApprovalID = firstNonEmptyString(approvals[i].ApprovalID, decision.ApprovalID)
		approvals[i].AgentTaskID = firstNonEmptyString(approvals[i].AgentTaskID, decision.AgentTaskID)
		approvals[i].TeamTaskID = firstNonEmptyString(approvals[i].TeamTaskID, decision.TeamTaskID)
		approvals[i].AssignmentID = firstNonEmptyString(approvals[i].AssignmentID, decision.AssignmentID)
		approvals[i].MemberID = firstNonEmptyString(approvals[i].MemberID, decision.MemberID)
		approvals[i].EdgeRunID = firstNonEmptyString(approvals[i].EdgeRunID, decision.EdgeRunID)
		approvals[i].RequestID = firstNonEmptyString(approvals[i].RequestID, decision.RequestID)
		approvals[i].ToolName = firstNonEmptyString(approvals[i].ToolName, decision.ToolName)
		approvals[i].ToolUseID = firstNonEmptyString(approvals[i].ToolUseID, decision.ToolUseID)
		approvals[i].Status = firstNonEmptyString(decision.Decision, approvals[i].Status)
		approvals[i].Reason = firstNonEmptyString(decision.Reason, approvals[i].Reason)
		approvals[i].DecidedBy = firstNonEmptyString(decision.DecidedBy, approvals[i].DecidedBy)
		if !decision.DecidedAt.IsZero() {
			decidedAt := decision.DecidedAt
			approvals[i].DecidedAt = &decidedAt
		}
		if decision.EdgeControl != nil {
			approvals[i].EdgeControl = decision.EdgeControl
		}
		return
	}
}

func applyConflictResolution(conflicts []model.TeamConflictState, resolution model.TeamConflictResolution) {
	for i := range conflicts {
		if conflicts[i].ConflictID != resolution.ConflictID {
			continue
		}
		resolvedAt := resolution.ResolvedAt
		conflicts[i].Status = model.TeamConflictStatusResolved
		conflicts[i].Resolution = resolution.Resolution
		conflicts[i].ResolvedBy = resolution.ResolvedBy
		conflicts[i].ResolvedAt = &resolvedAt
		conflicts[i].Reason = resolution.Reason
		conflicts[i].SelectedTask = resolution.SelectedAgentTaskID
	}
}

func (s *AgentTeamService) refreshTeamArtifactIndex(runID string, artifacts []model.TeamArtifactState) error {
	indexed := make([]model.AgentTeamArtifact, 0, len(artifacts))
	for _, artifact := range artifacts {
		path := normalizedArtifactPath(artifact.Path)
		if path == "" {
			continue
		}
		indexed = append(indexed, model.AgentTeamArtifact{
			TeamRunID:      runID,
			TeamTaskID:     stringPtrOrNil(artifact.TeamTaskID),
			AssignmentID:   stringPtrOrNil(artifact.AssignmentID),
			MemberID:       stringPtrOrNil(artifact.MemberID),
			AgentTaskID:    stringPtrOrNil(artifact.AgentTaskID),
			EdgeRunID:      artifact.EdgeRunID,
			SourceEventID:  stringPtrOrNil(artifact.SourceEventID),
			EventSeq:       artifact.EventSeq,
			Path:           path,
			NormalizedPath: strings.ToLower(path),
			Action:         artifact.Action,
			ToolName:       artifact.ToolName,
			Status:         artifact.Status,
			ConflictID:     artifact.ConflictID,
			CreatedAt:      artifact.CreatedAt,
		})
	}
	return repository.ReplaceTeamArtifactsForRun(s.db, runID, indexed)
}

func stringPtrOrNil(value string) *string {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return &value
}

type teamRuntimeTaskRef struct {
	TeamTaskID   string
	AssignmentID string
	MemberID     string
}

func projectTeamRuntimeSummaries(runEvents []model.AgentRunEvent, taskRefs map[string]teamRuntimeTaskRef) ([]model.TeamApprovalState, []model.TeamArtifactState) {
	approvals := []model.TeamApprovalState{}
	artifacts := []model.TeamArtifactState{}
	approvalIndex := map[string]int{}
	for _, event := range runEvents {
		var payload map[string]any
		if err := json.Unmarshal([]byte(event.Payload), &payload); err != nil {
			continue
		}
		switch event.EventType {
		case "run.agent.permission_requested":
			requestID := firstJSONString(payload, "requestId", "request_id")
			toolUseID := firstJSONString(payload, "toolUseId", "tool_use_id")
			key := firstNonEmptyString(requestID, toolUseID)
			if key == "" {
				continue
			}
			ref := taskRefs[event.TaskID]
			status := firstNonEmptyString(firstJSONString(payload, "status"), "pending")
			approvalIndex[key] = len(approvals)
			approvals = append(approvals, model.TeamApprovalState{
				ApprovalID:   approvalIDFor(requestID, toolUseID),
				AgentTaskID:  event.TaskID,
				TeamTaskID:   ref.TeamTaskID,
				AssignmentID: ref.AssignmentID,
				MemberID:     ref.MemberID,
				EdgeRunID:    event.EdgeRunID,
				RequestID:    requestID,
				ToolName:     firstJSONString(payload, "toolName", "tool_name"),
				ToolUseID:    toolUseID,
				Status:       status,
				CreatedAt:    event.CreatedAt,
			})
		case "run.agent.permission_decided":
			requestID := firstJSONString(payload, "requestId", "request_id")
			toolUseID := firstJSONString(payload, "toolUseId", "tool_use_id")
			key := firstNonEmptyString(requestID, toolUseID)
			if key == "" {
				continue
			}
			decision := firstNonEmptyString(firstJSONString(payload, "decision", "status"), "decided")
			decidedAt := event.CreatedAt
			if idx, ok := approvalIndex[key]; ok {
				approvals[idx].Status = decision
				approvals[idx].Reason = firstJSONString(payload, "reason")
				approvals[idx].DecidedAt = &decidedAt
				if approvals[idx].RequestID == "" {
					approvals[idx].RequestID = requestID
				}
				if approvals[idx].ToolUseID == "" {
					approvals[idx].ToolUseID = toolUseID
				}
				if approvals[idx].ToolName == "" {
					approvals[idx].ToolName = firstJSONString(payload, "toolName", "tool_name")
				}
				continue
			}
			approvalIndex[key] = len(approvals)
			ref := taskRefs[event.TaskID]
			approvals = append(approvals, model.TeamApprovalState{
				ApprovalID:   approvalIDFor(requestID, toolUseID),
				AgentTaskID:  event.TaskID,
				TeamTaskID:   ref.TeamTaskID,
				AssignmentID: ref.AssignmentID,
				MemberID:     ref.MemberID,
				EdgeRunID:    event.EdgeRunID,
				RequestID:    requestID,
				ToolName:     firstJSONString(payload, "toolName", "tool_name"),
				ToolUseID:    toolUseID,
				Status:       decision,
				Reason:       firstJSONString(payload, "reason"),
				CreatedAt:    event.CreatedAt,
				DecidedAt:    &decidedAt,
			})
		case "run.agent.file_change":
			path := firstJSONString(payload, "path", "filePath", "file_path")
			if path == "" {
				continue
			}
			ref := taskRefs[event.TaskID]
			artifacts = append(artifacts, model.TeamArtifactState{
				AgentTaskID:   event.TaskID,
				TeamTaskID:    ref.TeamTaskID,
				AssignmentID:  ref.AssignmentID,
				MemberID:      ref.MemberID,
				EdgeRunID:     event.EdgeRunID,
				SourceEventID: event.ID,
				EventSeq:      event.EventSeq,
				Path:          path,
				Action:        firstJSONString(payload, "action"),
				ToolName:      firstJSONString(payload, "toolName", "tool_name"),
				Status:        firstJSONString(payload, "status"),
				CreatedAt:     event.CreatedAt,
			})
		}
	}
	return approvals, artifacts
}

func approvalIDFor(requestID, toolUseID string) string {
	return firstNonEmptyString(requestID, toolUseID)
}

func projectTeamConflicts(artifacts []model.TeamArtifactState) []model.TeamConflictState {
	type conflictBucket struct {
		conflict model.TeamConflictState
		sources  map[string]bool
	}
	buckets := map[string]*conflictBucket{}
	order := []string{}
	for _, artifact := range artifacts {
		if !artifactCanConflict(artifact) {
			continue
		}
		path := normalizedArtifactPath(artifact.Path)
		if path == "" {
			continue
		}
		key := strings.ToLower(path)
		source := firstNonEmptyString(artifact.MemberID, artifact.AgentTaskID, artifact.EdgeRunID)
		if source == "" {
			continue
		}
		bucket, ok := buckets[key]
		if !ok {
			bucket = &conflictBucket{
				conflict: model.TeamConflictState{
					ConflictID:  conflictIDForPath(path),
					Path:        path,
					Status:      model.TeamConflictStatusPending,
					FirstSeenAt: artifact.CreatedAt,
					LastSeenAt:  artifact.CreatedAt,
				},
				sources: map[string]bool{},
			}
			buckets[key] = bucket
			order = append(order, key)
		}
		bucket.sources[source] = true
		bucket.conflict.AgentTaskIDs = appendUniqueString(bucket.conflict.AgentTaskIDs, artifact.AgentTaskID)
		bucket.conflict.TeamTaskIDs = appendUniqueString(bucket.conflict.TeamTaskIDs, artifact.TeamTaskID)
		bucket.conflict.AssignmentIDs = appendUniqueString(bucket.conflict.AssignmentIDs, artifact.AssignmentID)
		bucket.conflict.MemberIDs = appendUniqueString(bucket.conflict.MemberIDs, artifact.MemberID)
		bucket.conflict.EdgeRunIDs = appendUniqueString(bucket.conflict.EdgeRunIDs, artifact.EdgeRunID)
		bucket.conflict.Actions = appendUniqueString(bucket.conflict.Actions, artifact.Action)
		if bucket.conflict.FirstSeenAt.IsZero() || artifact.CreatedAt.Before(bucket.conflict.FirstSeenAt) {
			bucket.conflict.FirstSeenAt = artifact.CreatedAt
		}
		if artifact.CreatedAt.After(bucket.conflict.LastSeenAt) {
			bucket.conflict.LastSeenAt = artifact.CreatedAt
		}
	}

	conflicts := []model.TeamConflictState{}
	for _, key := range order {
		bucket := buckets[key]
		if len(bucket.sources) < 2 {
			continue
		}
		conflictID := bucket.conflict.ConflictID
		for i := range artifacts {
			if strings.EqualFold(normalizedArtifactPath(artifacts[i].Path), bucket.conflict.Path) {
				artifacts[i].ConflictID = conflictID
			}
		}
		conflicts = append(conflicts, bucket.conflict)
	}
	return conflicts
}

func artifactCanConflict(artifact model.TeamArtifactState) bool {
	status := strings.ToLower(strings.TrimSpace(artifact.Status))
	switch status {
	case "failed", "cancelled", "canceled", "discarded", "skipped":
		return false
	}
	action := strings.ToLower(strings.TrimSpace(artifact.Action))
	switch action {
	case "", "create", "created", "add", "added", "write", "written", "modify", "modified", "edit", "edited", "update", "updated", "delete", "deleted", "remove", "removed", "rename", "renamed":
		return true
	case "read", "view", "open", "inspect":
		return false
	default:
		return true
	}
}

func normalizedArtifactPath(path string) string {
	path = strings.TrimSpace(strings.ReplaceAll(path, "\\", "/"))
	for strings.HasPrefix(path, "./") {
		path = strings.TrimPrefix(path, "./")
	}
	return path
}

func conflictIDForPath(path string) string {
	path = strings.ReplaceAll(path, " ", "_")
	path = strings.ReplaceAll(path, "/", ":")
	return "file:" + path
}

func appendUniqueString(values []string, value string) []string {
	value = strings.TrimSpace(value)
	if value == "" {
		return values
	}
	for _, existing := range values {
		if existing == value {
			return values
		}
	}
	return append(values, value)
}

func stringInSlice(values []string, value string) bool {
	value = strings.TrimSpace(value)
	if value == "" {
		return false
	}
	for _, existing := range values {
		if existing == value {
			return true
		}
	}
	return false
}

func projectTeamBudget(runEvents []model.AgentRunEvent, runCount int) *model.TeamBudget {
	if runCount == 0 && len(runEvents) == 0 {
		return nil
	}
	budget := &model.TeamBudget{RunCount: runCount}
	observedTokensByTask := map[string]int64{}
	limitByTask := map[string]int64{}
	for _, event := range runEvents {
		var payload map[string]any
		if err := json.Unmarshal([]byte(event.Payload), &payload); err != nil {
			continue
		}
		switch event.EventType {
		case "run.agent.context_warning":
			budget.ContextWarnings++
		case "run.agent.context_compaction":
			budget.Compactions++
		}

		input, output, total := teamEventTokenUsage(payload)
		budget.InputTokens += input
		budget.OutputTokens += output
		budget.TotalTokensUsed += total

		if used := firstJSONInt(payload, "tokensUsed", "tokens_used"); used > observedTokensByTask[event.TaskID] {
			observedTokensByTask[event.TaskID] = used
		}
		if limit := firstJSONInt(payload, "tokenLimit", "token_limit", "contextLimit", "context_limit", "maxTokens", "max_tokens"); limit > limitByTask[event.TaskID] {
			limitByTask[event.TaskID] = limit
		}
		if remaining := firstJSONInt(payload, "tokensRemaining", "tokens_remaining", "remainingTokens", "remaining_tokens"); remaining > 0 {
			if budget.RemainingTokens == 0 || remaining < budget.RemainingTokens {
				budget.RemainingTokens = remaining
			}
		}
		if usagePercent := firstJSONFloat(payload, "usagePercent", "usage_percent"); usagePercent > budget.UsagePercent {
			budget.UsagePercent = usagePercent
		}
	}

	var observedTotal int64
	for _, tokens := range observedTokensByTask {
		observedTotal += tokens
	}
	if observedTotal > budget.TotalTokensUsed {
		budget.TotalTokensUsed = observedTotal
	}
	for _, limit := range limitByTask {
		budget.TokenLimit += limit
	}
	return budget
}

func teamEventTokenUsage(payload map[string]any) (input, output, total int64) {
	sawNestedUsage := false
	for _, key := range []string{"tokenUsage", "token_usage", "usage"} {
		if nested, ok := payload[key].(map[string]any); ok {
			sawNestedUsage = true
			nestedInput, nestedOutput, nestedTotal := tokenUsageFields(nested)
			input += nestedInput
			output += nestedOutput
			total += nestedTotal
		}
	}
	if !sawNestedUsage {
		directInput, directOutput, directTotal := tokenUsageFields(payload)
		input += directInput
		output += directOutput
		total += directTotal
	}
	if total == 0 && (input > 0 || output > 0) {
		total = input + output
	}
	return input, output, total
}

func tokenUsageFields(values map[string]any) (input, output, total int64) {
	input = firstJSONInt(values, "input", "inputTokens", "input_tokens")
	output = firstJSONInt(values, "output", "outputTokens", "output_tokens")
	total = firstJSONInt(values, "total", "totalTokens", "total_tokens")
	if total == 0 && (input > 0 || output > 0) {
		total = input + output
	}
	return input, output, total
}

func firstJSONString(values map[string]any, keys ...string) string {
	for _, key := range keys {
		value, ok := values[key]
		if !ok {
			continue
		}
		if text, ok := value.(string); ok {
			return strings.TrimSpace(text)
		}
	}
	return ""
}

func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func firstJSONInt(values map[string]any, keys ...string) int64 {
	for _, key := range keys {
		value, ok := values[key]
		if !ok {
			continue
		}
		switch typed := value.(type) {
		case float64:
			return int64(typed)
		case int:
			return int64(typed)
		case int64:
			return typed
		case json.Number:
			if parsed, err := typed.Int64(); err == nil {
				return parsed
			}
		case string:
			if parsed, err := strconv.ParseInt(strings.TrimSpace(typed), 10, 64); err == nil {
				return parsed
			}
		}
	}
	return 0
}

func firstJSONFloat(values map[string]any, keys ...string) float64 {
	for _, key := range keys {
		value, ok := values[key]
		if !ok {
			continue
		}
		switch typed := value.(type) {
		case float64:
			return typed
		case int:
			return float64(typed)
		case int64:
			return float64(typed)
		case json.Number:
			if parsed, err := typed.Float64(); err == nil {
				return parsed
			}
		case string:
			if parsed, err := strconv.ParseFloat(strings.TrimSpace(typed), 64); err == nil {
				return parsed
			}
		}
	}
	return 0
}

func (s *AgentTeamService) pendingTaskSnapshotByID(assignments []model.AgentTeamAssignment, tasks []model.AgentTeamTask) (map[string]model.PendingAgentTask, error) {
	ids := teamAgentTaskIDs(assignments, tasks)
	if len(ids) == 0 {
		return map[string]model.PendingAgentTask{}, nil
	}
	pendingTasks, err := repository.ListPendingTasksByIDs(s.db, ids)
	if err != nil {
		return nil, err
	}
	byID := make(map[string]model.PendingAgentTask, len(pendingTasks))
	for _, pending := range pendingTasks {
		byID[pending.ID] = pending
	}
	return byID, nil
}

func teamAgentTaskIDs(assignments []model.AgentTeamAssignment, tasks []model.AgentTeamTask) []string {
	ids := make([]string, 0, len(assignments)+len(tasks))
	seen := make(map[string]struct{}, len(assignments)+len(tasks))
	addID := func(id string) {
		id = strings.TrimSpace(id)
		if id == "" {
			return
		}
		if _, ok := seen[id]; ok {
			return
		}
		seen[id] = struct{}{}
		ids = append(ids, id)
	}
	for _, assignment := range assignments {
		if assignment.RunID != nil {
			addID(*assignment.RunID)
		}
	}
	for _, task := range tasks {
		if task.RunID != nil {
			addID(*task.RunID)
		}
	}
	return ids
}

func teamTaskStatusFromPending(status string) string {
	switch status {
	case model.TaskStatusQueued:
		return model.TeamTaskStatusDispatched
	case model.TaskStatusDispatched:
		return model.TeamTaskStatusDispatched
	case model.TaskStatusRunning:
		return model.TeamTaskStatusRunning
	case model.TaskStatusDone:
		return model.TeamTaskStatusDone
	case model.TaskStatusCancelled:
		return model.TeamTaskStatusCancelled
	case model.TaskStatusFailed, model.TaskStatusTimeout:
		return model.TeamTaskStatusFailed
	default:
		return model.TeamTaskStatusPending
	}
}

func assignmentStatusFromPending(status string) string {
	switch status {
	case model.TaskStatusQueued:
		return model.AssignmentStatusDispatched
	case model.TaskStatusDispatched:
		return model.AssignmentStatusDispatched
	case model.TaskStatusRunning:
		return model.AssignmentStatusRunning
	case model.TaskStatusDone:
		return model.AssignmentStatusDone
	case model.TaskStatusCancelled:
		return model.AssignmentStatusCancelled
	case model.TaskStatusFailed, model.TaskStatusTimeout:
		return model.AssignmentStatusFailed
	default:
		return model.AssignmentStatusPending
	}
}

// ListTeamTasks returns first-class TeamTask rows for a run after owner checks.
func (s *AgentTeamService) ListTeamTasks(ctx context.Context, userID, teamID, runID string) ([]model.AgentTeamTask, error) {
	if _, err := s.getTeamForRead(ctx, userID, teamID); err != nil {
		return nil, err
	}
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
	tasks, err := repository.ListTeamTasksByRun(s.db, runID)
	if err != nil {
		return nil, err
	}
	if tasks == nil {
		tasks = []model.AgentTeamTask{}
	}
	return tasks, nil
}

// ListTeamEvents returns append-only events for a team run after owner checks.
func (s *AgentTeamService) ListTeamEvents(ctx context.Context, userID, teamID, runID string) ([]model.AgentTeamEvent, error) {
	if _, err := s.getTeamForRead(ctx, userID, teamID); err != nil {
		return nil, err
	}
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
	events, err := repository.ListTeamEventsByRun(s.db, runID)
	if err != nil {
		return nil, err
	}
	if events == nil {
		events = []model.AgentTeamEvent{}
	}
	return events, nil
}

// HandleRouteDecision consumes a typed supervisor route decision and records
// the accepted or rejected route in the TeamEvent log.
func (s *AgentTeamService) HandleRouteDecision(ctx context.Context, userID, teamID, runID string, decision model.CoordinatorRouteDecision) (*model.AgentTeamAssignment, error) {
	if _, err := s.requireTeamOwner(ctx, userID, teamID); err != nil {
		return nil, err
	}
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

	decision.Action = strings.ToLower(strings.TrimSpace(decision.Action))
	if !model.ValidActions()[decision.Action] {
		return nil, s.rejectRouteDecision(runID, decision, "invalid action")
	}

	if decision.Action == "finish" {
		return nil, s.finishRouteDecision(runID, decision)
	}

	if strings.TrimSpace(decision.NextWorker) == "" {
		return nil, s.rejectRouteDecision(runID, decision, "next_worker is required")
	}
	if strings.TrimSpace(decision.Instructions) == "" {
		return nil, s.rejectRouteDecision(runID, decision, "instructions are required")
	}

	members, err := repository.ListTeamMembers(s.db, teamID)
	if err != nil {
		return nil, err
	}
	supervisor, worker := findSupervisorAndWorker(members, decision.NextWorker)
	if supervisor == nil {
		return nil, s.rejectRouteDecision(runID, decision, "supervisor member is required")
	}
	if worker == nil {
		return nil, s.rejectRouteDecision(runID, decision, "next_worker is not a team member")
	}

	taskCount, err := repository.CountAssignmentsByTeamRun(s.db, runID)
	if err != nil {
		return nil, err
	}
	if taskCount >= s.guardrails.MaxTasksPerTeamRun {
		return nil, s.rejectRouteDecision(runID, decision, "task limit reached")
	}
	timedOut, err := s.hasTimedOutActiveAssignment(runID)
	if err != nil {
		return nil, err
	}
	if timedOut {
		return nil, s.rejectRouteDecision(runID, decision, "assignment timeout reached")
	}
	activeCount, err := repository.CountActiveAssignmentsByTeamRun(s.db, runID)
	if err != nil {
		return nil, err
	}
	if activeCount >= s.guardrails.MaxActiveSubAgentsPerRun {
		return nil, s.rejectRouteDecision(runID, decision, "active subagent limit reached")
	}
	repeatCount, err := s.countMatchingRouteDecisions(runID, decision)
	if err != nil {
		return nil, err
	}
	if repeatCount >= s.guardrails.MaxRouteRepeats {
		return nil, s.rejectRouteDecision(runID, decision, "route repeat limit reached")
	}
	budgetExceeded, err := s.teamRunBudgetExceeded(runID)
	if err != nil {
		return nil, err
	}
	if budgetExceeded {
		return nil, s.rejectRouteDecision(runID, decision, "team run budget exceeded")
	}

	assignment, err := s.CreateAssignment(ctx, userID, runID, supervisor.ID, worker.ID, routeAssignmentType(decision.Action), decision.Instructions, decision.Context)
	if err != nil {
		if appendErr := s.appendRouteRejected(runID, decision, err.Error()); appendErr != nil {
			return nil, appendErr
		}
		return nil, err
	}
	task := &model.AgentTeamTask{
		TeamRunID:        runID,
		AssignmentID:     &assignment.ID,
		AssigneeMemberID: worker.ID,
		Status:           model.TeamTaskStatusPending,
		Objective:        decision.Instructions,
		InputRefs:        "{}",
		Attempt:          1,
		RiskLevel:        model.TeamTaskRiskNormal,
	}
	if err := repository.CreateTeamTask(s.db, task); err != nil {
		return nil, err
	}

	if err := s.appendTeamEvent(runID, model.TeamEventRouteDecided, decision); err != nil {
		return nil, err
	}
	if err := s.appendTeamEvent(runID, model.TeamEventAssignmentCreated, assignment); err != nil {
		return nil, err
	}
	if err := s.appendTeamEvent(runID, model.TeamEventTaskCreated, task); err != nil {
		return nil, err
	}
	return assignment, nil
}

func (s *AgentTeamService) hasTimedOutActiveAssignment(runID string) (bool, error) {
	assignments, err := repository.ListAssignmentsByTeamRun(s.db, runID)
	if err != nil {
		return false, err
	}
	deadline := time.Now().Add(-s.guardrails.AssignmentTimeout)
	for _, assignment := range assignments {
		if assignment.CreatedAt.IsZero() || !isActiveAssignmentStatus(assignment.Status) {
			continue
		}
		if assignment.CreatedAt.Before(deadline) {
			return true, nil
		}
	}
	return false, nil
}

func (s *AgentTeamService) teamRunBudgetExceeded(runID string) (bool, error) {
	assignments, err := repository.ListAssignmentsByTeamRun(s.db, runID)
	if err != nil {
		return false, err
	}
	tasks, err := repository.ListTeamTasksByRun(s.db, runID)
	if err != nil {
		return false, err
	}
	events, err := repository.ListAgentRunEventsByTaskIDs(s.db, teamAgentTaskIDs(assignments, tasks))
	if err != nil {
		return false, err
	}
	budget := projectTeamBudget(events, 0)
	if budget == nil {
		return false, nil
	}
	if budget.TokenLimit > 0 && budget.TotalTokensUsed >= budget.TokenLimit {
		return true, nil
	}
	if budget.TotalTokensUsed >= s.guardrails.MaxTeamRunBudgetTokens {
		return true, nil
	}
	if budget.UsagePercent >= s.guardrails.MaxTeamRunBudgetUsagePct {
		return true, nil
	}
	return false, nil
}

func isActiveAssignmentStatus(status string) bool {
	switch status {
	case model.AssignmentStatusPending, model.AssignmentStatusDispatched, model.AssignmentStatusRunning:
		return true
	default:
		return false
	}
}

func payloadString(payload string, keys ...string) string {
	var values map[string]string
	if err := json.Unmarshal([]byte(payload), &values); err != nil {
		return ""
	}
	for _, key := range keys {
		if value := values[key]; value != "" {
			return value
		}
	}
	return ""
}

func (s *AgentTeamService) finishRouteDecision(runID string, decision model.CoordinatorRouteDecision) error {
	if err := s.appendTeamEvent(runID, model.TeamEventRouteDecided, decision); err != nil {
		return err
	}
	status := model.TeamRunStatusCompleted
	eventType := model.TeamEventRunCompleted
	payload := map[string]string{"summary": decision.Summary}
	if strings.TrimSpace(decision.BlockedReason) != "" {
		status = model.TeamRunStatusFailed
		eventType = model.TeamEventRunFailed
		payload = map[string]string{"blocked_reason": decision.BlockedReason}
	}
	if err := repository.UpdateTeamRunStatus(s.db, runID, status); err != nil {
		return err
	}
	return s.appendTeamEvent(runID, eventType, payload)
}

func (s *AgentTeamService) rejectRouteDecision(runID string, decision model.CoordinatorRouteDecision, reason string) error {
	if err := s.appendRouteRejected(runID, decision, reason); err != nil {
		return err
	}
	return errcode.ErrBadRequest
}

func (s *AgentTeamService) appendRouteRejected(runID string, decision model.CoordinatorRouteDecision, reason string) error {
	return s.appendTeamEvent(runID, model.TeamEventRouteRejected, map[string]any{
		"decision": decision,
		"reason":   reason,
	})
}

func (s *AgentTeamService) countMatchingRouteDecisions(runID string, decision model.CoordinatorRouteDecision) (int, error) {
	events, err := repository.ListTeamEventsByRun(s.db, runID)
	if err != nil {
		return 0, err
	}
	targetAction := strings.ToLower(strings.TrimSpace(decision.Action))
	targetWorker := strings.TrimSpace(decision.NextWorker)
	targetInstructions := strings.TrimSpace(decision.Instructions)
	count := 0
	for _, event := range events {
		if event.Type != model.TeamEventRouteDecided {
			continue
		}
		var previous model.CoordinatorRouteDecision
		if err := json.Unmarshal([]byte(event.Payload), &previous); err != nil {
			continue
		}
		if strings.ToLower(strings.TrimSpace(previous.Action)) == targetAction &&
			strings.TrimSpace(previous.NextWorker) == targetWorker &&
			strings.TrimSpace(previous.Instructions) == targetInstructions {
			count++
		}
	}
	return count, nil
}

func (s *AgentTeamService) appendTeamEvent(runID, eventType string, payload any) error {
	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	return repository.AppendTeamEvent(s.db, &model.AgentTeamEvent{
		TeamRunID: runID,
		Type:      eventType,
		Payload:   string(payloadBytes),
	})
}

func findSupervisorAndWorker(members []model.AgentTeamMember, workerID string) (*model.AgentTeamMember, *model.AgentTeamMember) {
	var supervisor *model.AgentTeamMember
	var worker *model.AgentTeamMember
	for i := range members {
		member := &members[i]
		if supervisor == nil && member.Role == model.TeamMemberRoleSupervisor {
			supervisor = member
		}
		if member.ID == workerID {
			worker = member
		}
	}
	if supervisor == nil && len(members) > 0 {
		supervisor = &members[0]
	}
	return supervisor, worker
}

func routeAssignmentType(action string) string {
	switch action {
	case "review":
		return model.AssignmentTypeReview
	case "approve":
		return model.AssignmentTypeApprove
	default:
		return model.AssignmentTypeDelegate
	}
}

func optionalTeamRunTargetID(targetID string) *string {
	targetID = strings.TrimSpace(targetID)
	if targetID == "" {
		return nil
	}
	return &targetID
}

func teamRunTargetID(run *model.AgentTeamRun) string {
	if run == nil || run.TargetID == nil {
		return ""
	}
	return strings.TrimSpace(*run.TargetID)
}

// --- TeamAssignment ---

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
	visitedAncestors := map[string]struct{}{}
	parentID := fromMemberID
	for {
		if _, seen := visitedAncestors[parentID]; seen {
			return nil, errcode.ErrBadRequest
		}
		visitedAncestors[parentID] = struct{}{}
		parentAssignment, aErr := repository.GetAssignmentByToMember(s.db, teamRunID, parentID)
		if aErr != nil {
			if errors.Is(aErr, gorm.ErrRecordNotFound) {
				break // root of chain
			}
			return nil, aErr
		}
		if parentAssignment.Depth > ancestorDepth {
			ancestorDepth = parentAssignment.Depth
		}
		ancestorIDs = append(ancestorIDs, parentAssignment.FromMemberID, parentAssignment.ToMemberID)
		parentID = parentAssignment.FromMemberID
	}

	newDepth := ancestorDepth + 1
	if newDepth > s.guardrails.MaxDelegationDepth {
		return nil, errcode.ErrBadRequest
	}

	// 5. Check total and active assignment limits for this team run.
	taskCount, err := repository.CountAssignmentsByTeamRun(s.db, teamRunID)
	if err != nil {
		return nil, err
	}
	if taskCount >= s.guardrails.MaxTasksPerTeamRun {
		return nil, errcode.ErrBadRequest
	}
	activeCount, err := repository.CountActiveAssignmentsByTeamRun(s.db, teamRunID)
	if err != nil {
		return nil, err
	}
	if activeCount >= s.guardrails.MaxActiveSubAgentsPerRun {
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
	if a.RunID != nil && strings.TrimSpace(*a.RunID) != "" {
		return nil
	}

	// 2. Find the target agent instance in the team run's session.
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

	teamTask, err := s.ensureTeamTaskForAssignment(a)
	if err != nil {
		return err
	}

	triggerMessageID, err := s.createAssignmentDispatchMessage(ctx, userID, run.SessionID, a)
	if err != nil {
		return err
	}

	pendingTask, triggerErr := s.agentSvc.TriggerAgentTask(ctx, userID, triggerMessageID, targetAIID, "", "", "", teamRunTargetID(run))
	if triggerErr != nil {
		slog.Error("failed to trigger dispatch for assignment", "assignment_id", assignmentID, "error", triggerErr)
		return triggerErr
	}
	if pendingTask == nil || pendingTask.ID == "" {
		return errcode.ErrInternal
	}

	if err := repository.UpdateAssignmentDispatchBinding(s.db, assignmentID, pendingTask.ID); err != nil {
		return err
	}
	if err := repository.UpdateTeamTaskDispatchBinding(s.db, teamTask.ID, pendingTask.ID); err != nil {
		return err
	}
	if err := s.appendTeamEvent(a.TeamRunID, model.TeamEventAssignmentDispatched, map[string]string{
		"assignment_id": assignmentID,
		"team_task_id":  teamTask.ID,
		"agent_task_id": pendingTask.ID,
	}); err != nil {
		return err
	}

	return nil
}

func (s *AgentTeamService) ensureTeamTaskForAssignment(a *model.AgentTeamAssignment) (*model.AgentTeamTask, error) {
	task, err := repository.GetTeamTaskByAssignmentID(s.db, a.ID)
	if err == nil {
		return task, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	assignmentID := a.ID
	task = &model.AgentTeamTask{
		TeamRunID:        a.TeamRunID,
		AssignmentID:     &assignmentID,
		AssigneeMemberID: a.ToMemberID,
		Status:           model.TeamTaskStatusPending,
		Objective:        a.TaskPrompt,
		InputRefs:        "{}",
		Attempt:          1,
		RiskLevel:        model.TeamTaskRiskNormal,
	}
	if err := repository.CreateTeamTask(s.db, task); err != nil {
		return nil, err
	}
	if err := s.appendTeamEvent(a.TeamRunID, model.TeamEventTaskCreated, task); err != nil {
		return nil, err
	}
	return task, nil
}

func (s *AgentTeamService) createAssignmentDispatchMessage(ctx context.Context, userID, sessionID string, a *model.AgentTeamAssignment) (string, error) {
	contentBytes, err := json.Marshal(map[string]string{"text": assignmentDispatchPrompt(a)})
	if err != nil {
		return "", err
	}
	msgClientID, err := uuidv7.New()
	if err != nil {
		return "", err
	}
	msg := &model.Message{
		SessionID:   sessionID,
		ClientMsgID: msgClientID,
		SenderType:  model.SenderTypeUser,
		SenderID:    userID,
		ContentType: model.ContentTypeText,
		Content:     string(contentBytes),
	}
	if err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		seq, seqErr := repository.AllocateSeqID(tx, sessionID)
		if seqErr != nil {
			return seqErr
		}
		msg.SeqID = seq
		return repository.InsertMessage(tx, msg)
	}); err != nil {
		return "", err
	}
	return msg.ID, nil
}

func assignmentDispatchPrompt(a *model.AgentTeamAssignment) string {
	prompt := strings.TrimSpace(a.TaskPrompt)
	contextStr := strings.TrimSpace(a.Context)
	if contextStr == "" {
		return prompt
	}
	return prompt + "\n\nContext:\n" + contextStr
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

	if err := repository.UpdateAssignmentStatus(s.db, assignmentID, model.AssignmentStatusDone, result); err != nil {
		return err
	}
	s.publishTeamEvent(ctx, "team.assignment.completed", map[string]interface{}{
		"team_run_id":   a.TeamRunID,
		"assignment_id": assignmentID,
		"session_id":    run.SessionID,
		"result":        result,
	})
	return nil
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

	if err := repository.UpdateAssignmentStatus(s.db, assignmentID, model.AssignmentStatusFailed, reason); err != nil {
		return err
	}
	s.publishTeamEvent(ctx, "team.assignment.failed", map[string]interface{}{
		"team_run_id":   a.TeamRunID,
		"assignment_id": assignmentID,
		"session_id":    run.SessionID,
		"reason":        reason,
	})
	return nil
}

func (s *AgentTeamService) publishTeamEvent(ctx context.Context, eventType string, payload map[string]interface{}) {
	if s.bus == nil {
		return
	}
	s.bus.Publish(ctx, Event{
		Type:    eventType,
		Payload: payload,
	})
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
