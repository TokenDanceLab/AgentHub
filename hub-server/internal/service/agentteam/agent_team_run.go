package agentteam

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"strings"

	"github.com/agenthub/hub-server/internal/bus"
	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
	"github.com/agenthub/hub-server/internal/uuidv7"
	"gorm.io/gorm"
)

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

	// Resolve supervisor with members[0] fallback (see resolveTeamSupervisor).
	// Follow-up (#1385): StartTeamRun is still a large orchestration function
	// (auth + session/member/agent create + persist + async trigger + bus);
	// leave that split out of this projection PR.
	supervisorMember := resolveTeamSupervisor(members)
	if supervisorMember == nil {
		return nil, errcode.ErrBadRequest
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
	// Persist durable TeamEvent so GetTeamRunState replay can derive running
	// from the event log (not only the live bus fan-out).
	if err := s.appendTeamEvent(run.ID, model.TeamEventRunStarted, map[string]string{
		"team_id":    teamID,
		"run_id":     run.ID,
		"session_id": session.ID,
		"user_id":    userID,
	}); err != nil {
		slog.Warn("failed to append team.run.started event", "run_id", run.ID, "error", err)
	}
	s.publishTeamEvent(ctx, "team.run.started", map[string]interface{}{
		"team_id":    teamID,
		"run_id":     run.ID,
		"session_id": session.ID,
		"user_id":    userID,
	})

	return run, nil
}

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
		RunID:         run.ID,
		TeamID:        run.TeamID,
		Status:        run.Status,
		Members:       make([]model.TeamMemberState, 0, len(members)),
		Tasks:         make([]model.TeamTaskState, 0, len(tasks)),
		Dependencies:  make([]model.TeamTaskDependencyState, 0),
		Assignments:   make([]model.TeamAssignmentState, 0, len(assignments)),
		Approvals:     []model.TeamApprovalState{},
		Artifacts:     []model.TeamArtifactState{},
		Conflicts:     []model.TeamConflictState{},
		RunEvents:     make([]model.TeamRunEventState, 0, len(runEvents)),
		RouteLog:      []model.CoordinatorRouteDecision{},
		RouteAuditLog: []model.TeamRouteAuditState{},
	}

	memberIndex := s.projectTeamMembers(state, members)
	s.projectTeamAssignments(state, assignments, pendingTaskByID, memberIndex)
	taskRefs := s.projectTeamTasks(state, tasks, pendingTaskByID)
	s.projectTeamRunEvents(state, runEvents)
	state.Approvals, state.Artifacts = projectTeamRuntimeSummaries(runEvents, taskRefs)
	state.Conflicts = projectTeamConflicts(state.Artifacts)
	// Best-effort index refresh: never fail the read projection on delete+insert.
	s.tryRefreshTeamArtifactIndex(runID, state.Artifacts)
	state.Budget = projectTeamBudget(runEvents, len(agentTaskIDs))

	for _, event := range events {
		if handler, ok := teamStateReplayHandlers[event.Type]; ok {
			handler(state, event)
		}
	}

	// Replay human review events to populate the Reviews slice.
	replayReviewEvents(events, state)

	return state, nil
}

func (s *AgentTeamService) projectTeamMembers(state *model.TeamRunState, members []model.AgentTeamMember) map[string]int {
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
	return memberIndex
}

func (s *AgentTeamService) projectTeamAssignments(state *model.TeamRunState, assignments []model.AgentTeamAssignment, pendingTaskByID map[string]model.PendingAgentTask, memberIndex map[string]int) {
	for _, assignment := range assignments {
		runIDValue := ""
		if assignment.RunID != nil {
			runIDValue = *assignment.RunID
		}
		// Prefer durable DB status; only overlay pending-task projection when
		// the assignment is still active so terminal outcomes (timeout/fail/
		// complete) are never masked by a stale edge snapshot (#1384).
		status := assignment.Status
		edgeRunID := ""
		if pending, ok := pendingTaskByID[runIDValue]; ok {
			if isActiveAssignmentStatus(assignment.Status) {
				status = assignmentStatusFromPending(pending.Status)
			}
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
}

func (s *AgentTeamService) projectTeamTasks(state *model.TeamRunState, tasks []model.AgentTeamTask, pendingTaskByID map[string]model.PendingAgentTask) map[string]teamRuntimeTaskRef {
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
	return taskRefs
}

func (s *AgentTeamService) projectTeamRunEvents(state *model.TeamRunState, runEvents []model.AgentRunEvent) {
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

func (s *AgentTeamService) publishTeamEvent(ctx context.Context, eventType string, payload map[string]interface{}) {
	if s.bus == nil {
		return
	}
	if err := s.bus.Publish(ctx, bus.Event{
		Type:    eventType,
		Payload: payload,
	}); err != nil {
		slog.Warn("failed to publish team event", "event_type", eventType, "error", err)
	}
}
