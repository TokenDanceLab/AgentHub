package agentteam

import (
	"context"
	"strings"
	"time"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
	"github.com/agenthub/hub-server/internal/service/agentevent"
	"gorm.io/gorm"
)

func (s *AgentTeamService) DecideApproval(ctx context.Context, userID, teamID, runID, approvalID string, decision model.TeamApprovalDecision) (*model.TeamApprovalState, error) {
	approvalID = strings.TrimSpace(approvalID)
	decision.Decision = strings.ToLower(strings.TrimSpace(decision.Decision))
	decision.Reason = strings.TrimSpace(decision.Reason)
	if approvalID == "" || !validApprovalDecision(decision.Decision) {
		return nil, errcode.ErrBadRequest
	}
	if _, err := s.requireTeamOwner(ctx, userID, teamID); err != nil {
		s.recordTeamAudit(ctx, auditActionApprovalDecide, runID, userID, auditOutcomeDenied, "not team owner")
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

	// Serialize via per-run row lock: projection check → append event inside
	// one transaction. The first decision wins; a concurrent retry of the same
	// decision reuses the durable record, while an opposite decision conflicts.
	recorded := record
	if err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := repository.LockTeamRunForUpdate(tx, runID); err != nil {
			return err
		}
		existing, err := s.findApprovalDecision(tx, runID, record.ApprovalID)
		if err != nil {
			return err
		}
		if existing != nil {
			if existing.Decision != record.Decision {
				return errcode.ErrBadRequest
			}
			recorded = *existing
			return nil
		}
		return s.appendTeamEventTx(tx, runID, model.TeamEventApprovalDecided, record)
	}); err != nil {
		return nil, err
	}

	// Edge delivery is kept after the transaction commits so a delivery
	// failure does not roll back the already-persisted decision event.
	if s.controlSvc != nil {
		if err := s.controlSvc.DeliverToDesktopDevice(ctx, userID, edgeDeviceID, model.AgentControlPayload{
			Kind:         model.AgentControlKindPermissionDecide,
			AgentTaskID:  recorded.AgentTaskID,
			TargetID:     targetID,
			EdgeDeviceID: edgeDeviceID,
			TeamID:       teamID,
			TeamRunID:    runID,
			TeamTaskID:   recorded.TeamTaskID,
			AssignmentID: recorded.AssignmentID,
			MemberID:     recorded.MemberID,
			ApprovalID:   recorded.ApprovalID,
			EdgeControl:  recorded.EdgeControl,
		}); err != nil {
			return nil, err
		}
	}

	decided := *approval
	decided.ApprovalID = recorded.ApprovalID
	decided.Status = recorded.Decision
	decided.Reason = recorded.Reason
	decided.DecidedBy = recorded.DecidedBy
	decidedAt := recorded.DecidedAt
	decided.DecidedAt = &decidedAt
	decided.EdgeControl = recorded.EdgeControl
	s.recordTeamAudit(ctx, auditActionApprovalDecide, runID, userID, auditOutcomeSuccess, "")
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

	// Serialize via per-run row lock (#1383): two concurrent ResolveConflict
	// calls for the same conflict must not both write team.conflict.resolved.
	if err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := repository.LockTeamRunForUpdate(tx, runID); err != nil {
			return err
		}
		existing, err := s.findConflictResolution(tx, runID, resolution.ConflictID)
		if err != nil {
			return err
		}
		if existing != nil {
			return errcode.ErrBadRequest
		}
		return s.appendTeamEventTx(tx, runID, model.TeamEventConflictResolved, resolution)
	}); err != nil {
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
	return agentevent.ValidApprovalDecision(decision)
}

func pendingApprovalStatus(status string) bool {
	return agentevent.PendingApprovalStatus(status)
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

func (s *AgentTeamService) findApprovalDecision(tx *gorm.DB, runID, approvalID string) (*model.TeamApprovalDecision, error) {
	if approvalID == "" {
		return nil, nil
	}
	events, err := repository.ListTeamEventsByRun(tx, runID)
	if err != nil {
		return nil, err
	}
	var found *model.TeamApprovalDecision
	scanTeamEventPayloads[model.TeamApprovalDecision](events, model.TeamEventApprovalDecided, func(record model.TeamApprovalDecision, _ model.AgentTeamEvent) bool {
		if record.ApprovalID == approvalID {
			found = &record
			return true
		}
		return false
	})
	return found, nil
}

func (s *AgentTeamService) findConflictResolution(tx *gorm.DB, runID, conflictID string) (*model.TeamConflictResolution, error) {
	if conflictID == "" {
		return nil, nil
	}
	events, err := repository.ListTeamEventsByRun(tx, runID)
	if err != nil {
		return nil, err
	}
	var found *model.TeamConflictResolution
	scanTeamEventPayloads[model.TeamConflictResolution](events, model.TeamEventConflictResolved, func(resolution model.TeamConflictResolution, _ model.AgentTeamEvent) bool {
		if resolution.ConflictID == conflictID {
			found = &resolution
			return true
		}
		return false
	})
	return found, nil
}
