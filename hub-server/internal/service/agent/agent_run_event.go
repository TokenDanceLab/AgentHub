package agent

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
	"github.com/agenthub/hub-server/internal/service/agentcontrol"
	"github.com/agenthub/hub-server/internal/service/agentevent"
)

// runEventControl delivers Hub control commands to the exact Desktop/Edge device
// that owns a local Edge run. Implemented by *agentcontrol.Service.
type runEventControl interface {
	DeliverToDesktopDevice(ctx context.Context, userID, deviceID string, payload model.AgentControlPayload) error
}

// RunEventService owns task run-event list/summary/approval/artifact orchestration.
// Pure projection/validation lives in service/agentevent; control delivery is injected.
type RunEventService struct {
	db         *gorm.DB
	controlSvc runEventControl
}

// NewRunEventService constructs a RunEventService. controlSvc may be nil when
// approval decisions do not need desktop/edge delivery (read-only paths).
func NewRunEventService(db *gorm.DB, controlSvc runEventControl) *RunEventService {
	return &RunEventService{db: db, controlSvc: controlSvc}
}

// SetControlService injects (or replaces) the control delivery port.
func (s *RunEventService) SetControlService(controlSvc runEventControl) {
	s.controlSvc = controlSvc
}

// ListTaskRunEvents returns run events for a pending task, filtered and paginated.
func (s *RunEventService) ListTaskRunEvents(ctx context.Context, userID, taskID string, filter model.AgentRunEventFilter) ([]model.AgentRunEvent, error) {
	task, err := repository.GetPendingTaskByID(s.db, taskID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errcode.AgentTaskNotFound
		}
		return nil, err
	}
	if task.TriggeredByUserID != userID {
		return nil, errcode.AgentTaskNotFound
	}
	filter.EventType = strings.TrimSpace(filter.EventType)
	if filter.Limit < 0 || filter.AfterSeq < 0 {
		return nil, errcode.ErrBadRequest
	}
	if filter.Limit > 500 {
		filter.Limit = 500
	}
	return repository.ListAgentRunEventsByTaskIDFiltered(s.db, taskID, filter)
}

// GetTaskRunEventSummary returns a rollup summary for a task's run events.
func (s *RunEventService) GetTaskRunEventSummary(ctx context.Context, userID, taskID string) (*model.AgentRunEventSummary, error) {
	task, err := repository.GetPendingTaskByID(s.db, taskID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errcode.AgentTaskNotFound
		}
		return nil, err
	}
	if task.TriggeredByUserID != userID {
		return nil, errcode.AgentTaskNotFound
	}
	events, err := repository.ListAgentRunEventsByTaskID(s.db, taskID)
	if err != nil {
		return nil, err
	}
	summary := agentevent.SummarizeAgentRunEvents(task, events)
	return &summary, nil
}

func (s *RunEventService) ListTaskApprovals(ctx context.Context, userID, taskID string) (*model.AgentTaskApprovalList, error) {
	task, events, err := s.taskRunEventsForOwner(userID, taskID)
	if err != nil {
		return nil, err
	}
	return agentevent.ProjectTaskApprovals(task, events), nil
}

func (s *RunEventService) DecideTaskApproval(ctx context.Context, userID, taskID, approvalID string, decision model.TeamApprovalDecision) (*model.AgentTaskApproval, error) {
	approvalID = strings.TrimSpace(approvalID)
	decision.Decision = strings.ToLower(strings.TrimSpace(decision.Decision))
	decision.Reason = strings.TrimSpace(decision.Reason)
	if approvalID == "" || !agentevent.ValidApprovalDecision(decision.Decision) {
		return nil, errcode.ErrBadRequest
	}

	task, events, err := s.taskRunEventsForOwner(userID, taskID)
	if err != nil {
		return nil, err
	}
	projection := agentevent.ProjectTaskApprovals(task, events)
	approval := agentevent.FindTaskApproval(projection.Approvals, approvalID)
	if approval == nil {
		return nil, errcode.AgentTaskNotFound
	}
	if !agentevent.PendingApprovalStatus(approval.Status) {
		return nil, errcode.ErrBadRequest
	}
	if strings.TrimSpace(approval.RequestID) == "" || strings.TrimSpace(approval.EdgeRunID) == "" || strings.TrimSpace(task.EdgeDeviceID) == "" || strings.TrimSpace(task.TargetID) == "" {
		return nil, errcode.ErrBadRequest
	}

	now := time.Now().UTC()
	edgeControl := &model.TeamApprovalEdgeControl{
		RunID:     approval.EdgeRunID,
		RequestID: approval.RequestID,
		Decision:  decision.Decision,
		Reason:    decision.Reason,
	}
	payloadBytes, err := json.Marshal(map[string]any{
		"requestId":      approval.RequestID,
		"toolUseId":      approval.ToolUseID,
		"toolName":       approval.ToolName,
		"decision":       decision.Decision,
		"reason":         decision.Reason,
		"decided_by":     userID,
		"target_id":      strings.TrimSpace(task.TargetID),
		"edge_device_id": strings.TrimSpace(task.EdgeDeviceID),
		"correlation_id": approval.CorrelationID,
		"edge_control":   edgeControl,
	})
	if err != nil {
		return nil, err
	}
	event := &model.AgentRunEvent{
		TaskID:          task.ID,
		EdgeRunID:       approval.EdgeRunID,
		SessionID:       approval.SessionID,
		AgentInstanceID: task.AgentInstanceID,
		EventType:       "run.agent.permission_decided",
		Payload:         string(payloadBytes),
		CreatedAt:       now,
	}
	if err := repository.CreateAgentRunEventWithNextSeq(s.db, event); err != nil {
		return nil, err
	}

	if s.controlSvc != nil {
		if err := s.controlSvc.DeliverToDesktopDevice(ctx, userID, task.EdgeDeviceID, model.AgentControlPayload{
			Kind:          model.AgentControlKindPermissionDecide,
			AgentTaskID:   task.ID,
			TargetID:      strings.TrimSpace(task.TargetID),
			EdgeDeviceID:  strings.TrimSpace(task.EdgeDeviceID),
			CorrelationID: approval.CorrelationID,
			ApprovalID:    agentevent.FirstNonEmptyString(approval.ApprovalID, agentevent.ApprovalIDFor(approval.RequestID, approval.ToolUseID)),
			EdgeControl:   edgeControl,
		}); err != nil {
			return nil, err
		}
	}

	decided := *approval
	decided.Status = decision.Decision
	decided.Reason = decision.Reason
	decided.DecidedBy = userID
	decided.DecidedAt = &now
	decided.TargetID = strings.TrimSpace(task.TargetID)
	decided.EdgeDeviceID = strings.TrimSpace(task.EdgeDeviceID)
	decided.EdgeControl = edgeControl
	return &decided, nil
}

func (s *RunEventService) ListTaskArtifacts(ctx context.Context, userID, taskID string) (*model.AgentTaskArtifactList, error) {
	task, events, err := s.taskRunEventsForOwner(userID, taskID)
	if err != nil {
		return nil, err
	}
	return agentevent.ProjectTaskArtifacts(task, events), nil
}

func (s *RunEventService) taskRunEventsForOwner(userID, taskID string) (*model.PendingAgentTask, []model.AgentRunEvent, error) {
	task, err := repository.GetPendingTaskByID(s.db, taskID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil, errcode.AgentTaskNotFound
		}
		return nil, nil, err
	}
	if task.TriggeredByUserID != userID {
		return nil, nil, errcode.AgentTaskNotFound
	}
	events, err := repository.ListAgentRunEventsByTaskID(s.db, taskID)
	if err != nil {
		return nil, nil, err
	}
	return task, events, nil
}

// ── Service facade (wiring/handler stability) ───────────────────────────

// runEventService returns the composed RunEventService, lazily constructing one
// from Service deps when tests use struct literals without NewService.
func (s *Service) runEventService() *RunEventService {
	if s.runEvents != nil {
		return s.runEvents
	}
	var control runEventControl
	if controlCache, ok := s.cacheClient.(agentcontrol.CachePort); ok {
		control = agentcontrol.NewService(controlCache, s.mgr)
	}
	return NewRunEventService(s.db, control)
}

// ListTaskRunEvents returns run events for a pending task, filtered and paginated.
func (s *Service) ListTaskRunEvents(ctx context.Context, userID, taskID string, filter model.AgentRunEventFilter) ([]model.AgentRunEvent, error) {
	return s.runEventService().ListTaskRunEvents(ctx, userID, taskID, filter)
}

// GetTaskRunEventSummary returns a rollup summary for a task's run events.
func (s *Service) GetTaskRunEventSummary(ctx context.Context, userID, taskID string) (*model.AgentRunEventSummary, error) {
	return s.runEventService().GetTaskRunEventSummary(ctx, userID, taskID)
}

func (s *Service) ListTaskApprovals(ctx context.Context, userID, taskID string) (*model.AgentTaskApprovalList, error) {
	return s.runEventService().ListTaskApprovals(ctx, userID, taskID)
}

func (s *Service) DecideTaskApproval(ctx context.Context, userID, taskID, approvalID string, decision model.TeamApprovalDecision) (*model.AgentTaskApproval, error) {
	return s.runEventService().DecideTaskApproval(ctx, userID, taskID, approvalID, decision)
}

func (s *Service) ListTaskArtifacts(ctx context.Context, userID, taskID string) (*model.AgentTaskArtifactList, error) {
	return s.runEventService().ListTaskArtifacts(ctx, userID, taskID)
}
