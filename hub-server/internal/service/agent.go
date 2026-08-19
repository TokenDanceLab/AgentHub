package service

import (
	"context"
	"encoding/json"
	"net/http"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/bus"
	"github.com/agenthub/hub-server/internal/cache"
	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
	"github.com/agenthub/hub-server/internal/seqalloc"
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
	SetSeq(ctx context.Context, sessionID string, seq int64) error
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
	// seqAlloc owns message sequence allocation (Redis INCR → DB mirror →
	// DB fallback). Set in NewAgentService; struct-literal tests fall back to
	// a lazy allocator via seqAllocator().
	seqAlloc *seqalloc.Allocator
	// runEvents owns list/summary/approvals/artifacts orchestration.
	// Constructed in NewAgentService; tests using struct literals fall back to
	// a lazy facade via runEventService().
	runEvents *RunEventService
	// edgeCallbacks owns Edge ack/stream/done/fail orchestration.
	// Constructed in NewAgentService; tests using struct literals fall back to
	// a lazy facade via edgeCallbackService().
	edgeCallbacks *EdgeCallbackService
	// deliveryOutbox owns journal + retry-loop orchestration.
	// Constructed by the composition root (deliveryoutbox.NewOutbox) and
	// injected through NewAgentService; the concrete type lives in the
	// deliveryoutbox package and is consumed here via deliveryOutboxPort.
	deliveryOutbox deliveryOutboxPort
	// dispatch owns trigger/dispatch/cancel/regenerate + redispatch residual.
	// Constructed in NewAgentService; tests using struct literals fall back to
	// a lazy facade via dispatchService(). Outbox retries call into
	// DispatchService through the Redispatcher port (dispatchPayload stays private).
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

func NewAgentService(db *gorm.DB, bus *bus.Bus, mgr *ws.Manager, cacheClient *cache.Client, relay relayDispatcher, edgeCfg config.EdgeDispatchConfig, edgeClient *http.Client, jwtSecret string, deliveryOutbox deliveryOutboxPort) *AgentService {
	s := &AgentService{db: db, bus: bus, mgr: mgr, cacheClient: resolveAgentCache(cacheClient), relay: relay, edgeCfg: edgeCfg, edgeClient: edgeClient, jwtSecret: jwtSecret, seqAlloc: seqalloc.New(cacheClient, db), deliveryOutbox: deliveryOutbox}
	s.runEvents = NewRunEventService(db, NewAgentControlService(cacheClient, mgr))
	// The composition root constructs the outbox (deliveryoutbox.NewOutbox)
	// and injects it here; the DispatchService redispatch adapter is wired
	// after dispatch exists (#573 — redispatch residual on DispatchService).
	s.edgeCallbacks = NewEdgeCallbackService(
		db,
		bus,
		seqAllocatorFunc(s.allocateSeq),
		s.deliveryOutbox, // Outbox implements edgeCallbackOutbox via AutoAckDeliveriesForTask
	)
	// Dispatch after outbox so RecordDelivery/MarkDeliverySent ports are ready.
	s.dispatch = dispatchsvc.NewDispatchService(db, bus, wsManagerAdapter{manager: mgr}, s.cacheClient, relayServiceAdapter{relay: relay}, s.deliveryOutbox, edgeCfg, edgeClient, jwtSecret)
	if s.deliveryOutbox != nil {
		s.deliveryOutbox.SetDispatchRedispatcher(s.dispatch)
	}
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

// allocateSeq returns the next message sequence number for a session via the
// shared seqalloc.Allocator (Redis INCR → DB mirror → DB fallback).
func (s *AgentService) allocateSeq(ctx context.Context, sessionID string) (int64, error) {
	return s.seqAllocator().Allocate(ctx, sessionID)
}

// seqAllocator returns the configured allocator, lazily constructing one from
// the cache port + DB for struct-literal tests that bypass NewAgentService.
func (s *AgentService) seqAllocator() *seqalloc.Allocator {
	if s.seqAlloc != nil {
		return s.seqAlloc
	}
	return seqalloc.New(resolveAgentCache(s.cacheClient), s.db)
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
