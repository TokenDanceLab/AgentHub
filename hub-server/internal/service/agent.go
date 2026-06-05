package service

import (
	"context"
	"encoding/json"
	"log/slog"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/cache"
	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
	"github.com/agenthub/hub-server/internal/ws"
)

// agentCache is the subset of *cache.Client methods used by AgentService.
type agentCache interface {
	GetRoute(ctx context.Context, userID, deviceType string) (string, error)
	GetRouteForDevice(ctx context.Context, userID, deviceType, deviceID string) (string, error)
	PushPendingTask(ctx context.Context, userID, taskJSON string) error
	PushPendingTargetTask(ctx context.Context, userID, targetID, deviceID, taskJSON string) error
	AllocateSeq(ctx context.Context, sessionID string) (int64, error)
}

// relayDispatcher is the subset of *RelayService methods used by AgentService.
type relayDispatcher interface {
	CreateCommand(ctx context.Context, targetEdgeID, commandType string, payload json.RawMessage, createdBy string) (*RelayCommandData, error)
}

type AgentService struct {
	db          *gorm.DB
	bus         *Bus
	mgr         *ws.Manager
	cacheClient agentCache
	relay       relayDispatcher
}

func NewAgentService(db *gorm.DB, bus *Bus, mgr *ws.Manager, cacheClient *cache.Client) *AgentService {
	return &AgentService{db: db, bus: bus, mgr: mgr, cacheClient: resolveAgentCache(cacheClient)}
}

// SetRelayService injects an optional relay service for hub_relay target dispatch.
func (s *AgentService) SetRelayService(relay relayDispatcher) {
	s.relay = relay
}

// AddAgentToSession adds an agent instance to a session (invite agent into group).
func (s *AgentService) AddAgentToSession(ctx context.Context, userID, sessionID, agentType, customAgentID, displayName string) error {
	session, err := repository.GetSessionByID(s.db, sessionID)
	if err != nil {
		return errcode.SessionNotFound
	}
	if session.Type != model.SessionTypeGroup {
		return errcode.ErrBadRequest
	}
	if session.Dissolved {
		return errcode.SessionDissolved
	}

	active, _ := repository.IsMemberActive(s.db, sessionID, model.MemberTypeUser, userID)
	if !active {
		return errcode.SessionNotMember
	}

	// validate custom agent if provided
	if customAgentID != "" {
		ca, err := repository.GetCustomAgentByID(s.db, customAgentID)
		if err != nil {
			return errcode.AgentNotFound
		}
		if ca.OwnerUserID != userID {
			return errcode.AgentNotFound
		}
		if agentType == "" {
			agentType = ca.AgentType
		}
	}

	ai := &model.AgentInstance{
		AgentType:     agentType,
		SessionID:     sessionID,
		InviterUserID: userID,
		DisplayName:   displayName,
	}
	if customAgentID != "" {
		ai.CustomAgentID = &customAgentID
	}

	err = s.db.Transaction(func(tx *gorm.DB) error {
		if err := repository.CreateAgentInstance(tx, ai); err != nil {
			return err
		}
		member := &model.SessionMember{
			SessionID:  sessionID,
			MemberType: model.MemberTypeAgent,
			MemberID:   ai.ID,
			Role:       model.MemberRoleMember,
		}
		return repository.CreateSessionMember(tx, member)
	})
	if err != nil {
		return err
	}

	return nil
}

// allocateSeq returns the next message sequence number for a session.
// It tries Redis INCR first and falls back to the DB row-level lock.
func (s *AgentService) allocateSeq(ctx context.Context, sessionID string) (int64, error) {
	seq, err := resolveAgentCache(s.cacheClient).AllocateSeq(ctx, sessionID)
	if err == nil {
		return seq, nil
	}
	slog.Warn("redis seq allocation failed, falling back to DB", "session_id", sessionID, "error", err)
	var fallbackSeq int64
	err = s.db.Transaction(func(tx *gorm.DB) error {
		var txErr error
		fallbackSeq, txErr = repository.AllocateSeqID(tx, sessionID)
		return txErr
	})
	return fallbackSeq, err
}

// ── Thin wrappers for repository calls needed by the app layer ──────────

// GetPendingTaskByID returns a pending agent task by ID. Thin wrapper over repository.GetPendingTaskByID.
func (s *AgentService) GetPendingTaskByID(taskID string) (*model.PendingAgentTask, error) {
	return repository.GetPendingTaskByID(s.db, taskID)
}

// ScanExpiredTasks returns all pending tasks whose deadline has passed. Thin wrapper over repository.ScanExpiredTasks.
func (s *AgentService) ScanExpiredTasks() ([]model.PendingAgentTask, error) {
	return repository.ScanExpiredTasks(s.db)
}

// TimeoutExpiredTask marks a scanned expired task as timeout only if its status
// still matches the status returned by the scan.
func (s *AgentService) TimeoutExpiredTask(taskID, scannedStatus string) (bool, error) {
	rowsAffected, err := repository.UpdatePendingTaskStatusAtomic(s.db, taskID, scannedStatus, model.TaskStatusTimeout, "")
	if err != nil {
		return false, err
	}
	return rowsAffected > 0, nil
}

// UpdatePendingTaskStatus updates the status of a pending agent task. Thin wrapper over repository.UpdatePendingTaskStatus.
func (s *AgentService) UpdatePendingTaskStatus(taskID, status, errMsg string) error {
	return repository.UpdatePendingTaskStatus(s.db, taskID, status, errMsg)
}

// GetAgentInstanceByID returns an agent instance by ID. Thin wrapper over repository.GetAgentInstanceByID.
func (s *AgentService) GetAgentInstanceByID(id string) (*model.AgentInstance, error) {
	return repository.GetAgentInstanceByID(s.db, id)
}

// UpdatePendingTaskDispatched records the edge device that a task was dispatched to. Thin wrapper over repository.UpdatePendingTaskDispatched.
func (s *AgentService) UpdatePendingTaskDispatched(taskID, edgeDeviceID string) error {
	return repository.UpdatePendingTaskDispatched(s.db, taskID, edgeDeviceID)
}
