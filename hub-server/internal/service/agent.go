package service

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/bus"
	"github.com/agenthub/hub-server/internal/cache"
	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
	"github.com/agenthub/hub-server/internal/service/dispatchsvc"
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
	bus         *bus.Bus
	mgr         *ws.Manager
	cacheClient agentCache
	relay       relayDispatcher
	// runEvents owns list/summary/approvals/artifacts orchestration.
	// Constructed in NewAgentService; tests using struct literals fall back to
	// a lazy facade via runEventService().
	runEvents *RunEventService
	// edgeCallbacks owns Edge ack/stream/done/fail orchestration.
	// Constructed in NewAgentService; tests using struct literals fall back to
	// a lazy facade via edgeCallbackService().
	edgeCallbacks *EdgeCallbackService
	// deliveryOutbox owns journal + retry-loop orchestration.
	// Constructed in NewAgentService; tests using struct literals fall back to
	// a lazy facade via deliveryOutboxService(). Redispatch implementation lives
	// on DispatchService and is injected via the Redispatcher port.
	deliveryOutbox *DeliveryOutbox
	// dispatch owns trigger/dispatch/cancel/regenerate + redispatch residual.
	// Constructed in NewAgentService; tests using struct literals fall back to
	// a lazy facade via dispatchService(). DeliveryOutbox retries call into
	// DispatchService through Redispatcher (dispatchPayload stays private).
	dispatch *dispatchsvc.DispatchService
	// edgeCfg/jwtSecret are the Hub→Edge dispatch configuration (#1549),
	// injected by the composition root and forwarded to DispatchService.
	edgeCfg config.EdgeDispatchConfig
	// edgeClient is the shared Hub→Edge outbound client built at the
	// composition root (outboundhttp.NewClient, #1594); forwarded to
	// DispatchService. nil is tolerated for struct-literal tests that never
	// reach the edge HTTP path.
	edgeClient *http.Client
	jwtSecret  string
}

func NewAgentService(db *gorm.DB, bus *bus.Bus, mgr *ws.Manager, cacheClient *cache.Client, relay relayDispatcher, edgeCfg config.EdgeDispatchConfig, edgeClient *http.Client, jwtSecret string) *AgentService {
	s := &AgentService{db: db, bus: bus, mgr: mgr, cacheClient: resolveAgentCache(cacheClient), relay: relay, edgeCfg: edgeCfg, edgeClient: edgeClient, jwtSecret: jwtSecret}
	s.runEvents = NewRunEventService(db, NewAgentControlService(cacheClient, mgr))
	// Construct outbox first (nil redispatcher), then inject DispatchService
	// adapter after dispatch exists (#573 — redispatch residual on DispatchService).
	s.deliveryOutbox = NewDeliveryOutbox(db, nil)
	s.edgeCallbacks = NewEdgeCallbackService(
		db,
		bus,
		seqAllocatorFunc(s.allocateSeq),
		s.deliveryOutbox, // DeliveryOutbox implements edgeCallbackOutbox via autoAckDeliveriesForTask
	)
	// Dispatch after outbox so RecordDelivery/MarkDeliverySent ports are ready.
	s.dispatch = dispatchsvc.NewDispatchService(db, bus, wsManagerAdapter{manager: mgr}, s.cacheClient, relayServiceAdapter{relay: relay}, s.deliveryOutbox, edgeCfg, edgeClient, jwtSecret)
	s.deliveryOutbox.SetRedispatcher(dispatchRedispatcher{s.dispatch})
	return s
}

// AddAgentToSession adds an agent instance to a session (invite agent into group).
func (s *AgentService) AddAgentToSession(ctx context.Context, userID, sessionID, agentType, customAgentID, displayName string) (*model.AgentInstance, error) {
	session, err := repository.GetSessionByID(s.db, sessionID)
	if err != nil {
		return nil, errcode.SessionNotFound
	}
	if session.Type != model.SessionTypeGroup {
		return nil, errcode.ErrBadRequest
	}
	if session.Dissolved {
		return nil, errcode.SessionDissolved
	}

	active, _ := repository.IsMemberActive(s.db, sessionID, model.MemberTypeUser, userID)
	if !active {
		return nil, errcode.SessionNotMember
	}

	// validate custom agent if provided
	if customAgentID != "" {
		ca, err := repository.GetCustomAgentByID(s.db, customAgentID)
		if err != nil {
			return nil, errcode.AgentNotFound
		}
		if ca.OwnerUserID != userID {
			return nil, errcode.AgentNotFound
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
		return nil, err
	}

	return ai, nil
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
