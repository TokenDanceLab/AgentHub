package agent

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"sync"
	"time"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/bus"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
)

// BusEventTeamSubagentStream is the in-process bus event type that carries a
// sub-agent's run.agent.* flow event aggregated into its team-run context.
//
// Phase A of #1478: HandleTaskStream publishes this alongside the existing
// agent.stream event when the run's session belongs to a team run. The app
// layer subscribes and forwards it as the ws.TypeTeamSubagentStream frame.
//
// TeamSubagentStreamPayload is the wire shape of a team.subagent.stream bus
// event and WS frame payload. It enriches a run.agent.* event with the
// (team_run_id, assignment_id, team_task_id, member_id) ownership that the
// chat-side agent.stream frame does not carry, so the team-run view can route
// the sub-agent's flow into its assignment card.
//
// Idempotency key is (agent_task_id, event_seq) — identical to agent.stream
// (see api/events.md). team.subagent.stream and agent.stream are independent
// apply stores on the client; the same event may be delivered to both.
type TeamSubagentStreamPayload struct {
	TeamRunID       string          `json:"team_run_id"`
	TeamID          string          `json:"team_id"`
	SessionID       string          `json:"session_id"`
	AssignmentID    string          `json:"assignment_id,omitempty"`
	TeamTaskID      string          `json:"team_task_id,omitempty"`
	MemberID        string          `json:"member_id,omitempty"`
	AgentTaskID     string          `json:"agent_task_id"`
	AgentInstanceID string          `json:"agent_instance_id"`
	EdgeRunID       string          `json:"edge_run_id,omitempty"`
	EventSeq        int64           `json:"event_seq"`
	EventType       string          `json:"event_type"`
	Payload         json.RawMessage `json:"payload"`
	CreatedAt       time.Time       `json:"created_at"`
}

// teamRunContext is the ownership slice resolved for one pending task: which
// team run it belongs to and which assignment/team-task/member it maps to. It
// is resolved once per task (cached) and reused for every stream event of
// that task.
type teamRunContext struct {
	teamRunID    string
	teamID       string
	assignmentID string
	teamTaskID   string
	memberID     string
}

// teamRunContextCache is a small bounded LRU keyed by pending task ID. A team
// run emits many run.agent.* events per task (per-token text_delta); without
// a cache each event would re-run three DB lookups. task IDs are UUIDs and are
// never reused, so cache entries stay correct for the task's lifetime —
// invalidation is memory hygiene, not correctness (#1478 Phase A risk note).
//
// Eviction is LRU by access. The cache is goroutine-safe.
type teamRunContextCache struct {
	mu    sync.Mutex
	max   int
	order map[string]*listNode
	head  *listNode // most-recently-used
	tail  *listNode // least-recently-used
}

type listNode struct {
	key  string
	ctx  teamRunContext
	prev *listNode
	next *listNode
}

func newTeamRunContextCache(max int) *teamRunContextCache {
	if max <= 0 {
		max = 1024
	}
	return &teamRunContextCache{max: max, order: make(map[string]*listNode)}
}

// get returns the cached context for taskID and whether it was present.
func (c *teamRunContextCache) get(taskID string) (teamRunContext, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	n, ok := c.order[taskID]
	if !ok {
		return teamRunContext{}, false
	}
	c.moveToFront(n)
	return n.ctx, true
}

// put stores ctx for taskID, evicting the least-recently-used entry when full.
func (c *teamRunContextCache) put(taskID string, ctx teamRunContext) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if n, ok := c.order[taskID]; ok {
		n.ctx = ctx
		c.moveToFront(n)
		return
	}
	n := &listNode{key: taskID, ctx: ctx}
	c.order[taskID] = n
	c.pushFront(n)
	if len(c.order) > c.max {
		c.evictTail()
	}
}

// invalidate removes the cached context for taskID, if present.
func (c *teamRunContextCache) invalidate(taskID string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	n, ok := c.order[taskID]
	if !ok {
		return
	}
	c.unlink(n)
	delete(c.order, taskID)
}

func (c *teamRunContextCache) pushFront(n *listNode) {
	n.prev = nil
	n.next = c.head
	if c.head != nil {
		c.head.prev = n
	}
	c.head = n
	if c.tail == nil {
		c.tail = n
	}
}

func (c *teamRunContextCache) unlink(n *listNode) {
	if n.prev != nil {
		n.prev.next = n.next
	} else {
		c.head = n.next
	}
	if n.next != nil {
		n.next.prev = n.prev
	} else {
		c.tail = n.prev
	}
}

func (c *teamRunContextCache) moveToFront(n *listNode) {
	if c.head == n {
		return
	}
	c.unlink(n)
	c.pushFront(n)
}

func (c *teamRunContextCache) evictTail() {
	if c.tail == nil {
		return
	}
	n := c.tail
	c.unlink(n)
	delete(c.order, n.key)
}

// subagentStreamLookup is the DB-backed port that resolves a pending task's
// team-run ownership. It is a distinct interface so tests can substitute an
// in-memory lookup without touching gorm.
type subagentStreamLookup interface {
	lookupTeamRunContext(ctx context.Context, sessionID, taskID string) (teamRunContext, bool)
}

// dbTeamRunLookup resolves team-run ownership via repository queries.
type dbTeamRunLookup struct {
	db *gorm.DB
}

func (l *dbTeamRunLookup) lookupTeamRunContext(ctx context.Context, sessionID, taskID string) (teamRunContext, bool) {
	if sessionID == "" || taskID == "" {
		return teamRunContext{}, false
	}
	run, err := repository.GetTeamRunBySessionID(l.db, sessionID)
	if err != nil {
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			slog.Warn("team.subagent.stream: team run lookup failed",
				"session_id", sessionID, "task_id", taskID, "error", err)
		}
		return teamRunContext{}, false
	}
	out := teamRunContext{teamRunID: run.ID, teamID: run.TeamID}

	// An assignment binds the pending task via RunID (the pending task ID set
	// by BindClaimedAssignmentDispatch). Find the assignment whose RunID points
	// at this task.
	assignments, err := repository.ListAssignmentsByTeamRun(l.db, run.ID)
	if err != nil {
		slog.Warn("team.subagent.stream: assignments lookup failed",
			"team_run_id", run.ID, "task_id", taskID, "error", err)
		return teamRunContext{}, false
	}
	for i := range assignments {
		if assignments[i].RunID != nil && *assignments[i].RunID == taskID {
			out.assignmentID = assignments[i].ID
			out.memberID = assignments[i].ToMemberID
			break
		}
	}

	// The team task row also binds RunID to the pending task. Prefer it for
	// team_task_id (it is the canonical team-side task handle).
	tasks, err := repository.ListTeamTasksByRun(l.db, run.ID)
	if err != nil {
		slog.Warn("team.subagent.stream: team tasks lookup failed",
			"team_run_id", run.ID, "task_id", taskID, "error", err)
		return teamRunContext{}, false
	}
	for i := range tasks {
		if tasks[i].RunID != nil && *tasks[i].RunID == taskID {
			out.teamTaskID = tasks[i].ID
			if out.assignmentID == "" && tasks[i].AssignmentID != nil {
				out.assignmentID = *tasks[i].AssignmentID
			}
			break
		}
	}
	return out, true
}

// publishTeamSubagentStream resolves the team-run context for a run event and,
// when the run belongs to a team run, publishes a BusEventTeamSubagentStream
// event alongside the existing agent.stream publish. It must never fail the
// caller: every error (no team run, lookup miss, bus nil) is swallowed — the
// chat-side agent.stream path is independent and already succeeded.
func (s *EdgeCallbackService) publishTeamSubagentStream(
	ctx context.Context,
	runEvent *model.AgentRunEvent,
	taskID string,
) {
	if s.bus == nil {
		return
	}
	lookup := s.subagentLookup()
	if lookup == nil {
		return
	}
	tctx, ok := s.cachedTeamRunContext(ctx, lookup, runEvent.SessionID, taskID)
	if !ok {
		return
	}
	if err := s.bus.Publish(ctx, bus.Event{
		Type: bus.EventTypeTeamSubagentStream,
		Payload: TeamSubagentStreamPayload{
			TeamRunID:       tctx.teamRunID,
			TeamID:          tctx.teamID,
			SessionID:       runEvent.SessionID,
			AssignmentID:    tctx.assignmentID,
			TeamTaskID:      tctx.teamTaskID,
			MemberID:        tctx.memberID,
			AgentTaskID:     taskID,
			AgentInstanceID: runEvent.AgentInstanceID,
			EdgeRunID:       runEvent.EdgeRunID,
			EventSeq:        runEvent.EventSeq,
			EventType:       runEvent.EventType,
			Payload:         json.RawMessage(runEvent.Payload),
			CreatedAt:       runEvent.CreatedAt,
		},
	}); err != nil {
		slog.Warn("failed to publish team subagent stream event", "team_run_id", tctx.teamRunID, "error", err)
	}
}

// cachedTeamRunContext returns the team-run context for (sessionID, taskID),
// using the per-service LRU cache to avoid three DB lookups per stream event.
func (s *EdgeCallbackService) cachedTeamRunContext(
	ctx context.Context,
	lookup subagentStreamLookup,
	sessionID, taskID string,
) (teamRunContext, bool) {
	if c := s.teamCtxCache(); c != nil {
		if tctx, ok := c.get(taskID); ok {
			return tctx, true
		}
	}
	tctx, ok := lookup.lookupTeamRunContext(ctx, sessionID, taskID)
	if !ok {
		return teamRunContext{}, false
	}
	if c := s.teamCtxCache(); c != nil {
		c.put(taskID, tctx)
	}
	return tctx, true
}

// InvalidateTeamRunContext drops the cached team-run context for a task.
// Terminal-state invalidation (CompleteAssignment/FailAssignment) is deferred
// to a later phase: the agentteam subpackage cannot import the parent service
// package without forming a cycle, and wiring a bus hook for pure hygiene is
// not worth the surface. The cache is bounded (LRU, 1024 entries), so memory
// is capped regardless; and task IDs are UUIDs that are never reused, so a
// stale entry would still attribute events correctly. Exposed now so a future
// phase can wire it through a port that does not introduce a cycle.
func (s *EdgeCallbackService) InvalidateTeamRunContext(taskID string) {
	if c := s.teamCtxCache(); c != nil {
		c.invalidate(taskID)
	}
}

// teamCtxCache lazily allocates the LRU so tests that construct
// EdgeCallbackService via struct literals still get caching. The allocation
// is guarded by sync.Once so concurrent first-callers cannot both observe a
// nil cache and double-allocate (a check-then-write data race).
func (s *EdgeCallbackService) teamCtxCache() *teamRunContextCache {
	s.ctxCacheOnce.Do(func() {
		if s.ctxCache == nil {
			s.ctxCache = newTeamRunContextCache(1024)
		}
	})
	return s.ctxCache
}

// subagentLookup lazily allocates the DB-backed lookup so tests that construct
// EdgeCallbackService via struct literals (no db wiring) still build, and so
// the interface seam is available for substitution. The allocation is guarded
// by sync.Once for the same race-safety reason as teamCtxCache.
func (s *EdgeCallbackService) subagentLookup() subagentStreamLookup {
	s.ctxLookupOnce.Do(func() {
		if s.ctxLookup == nil && s.db != nil {
			s.ctxLookup = &dbTeamRunLookup{db: s.db}
		}
	})
	return s.ctxLookup
}

// SetSubagentStreamLookup substitutes the team-run context lookup — used by
// tests to inject an in-memory lookup without a real gorm DB.
func (s *EdgeCallbackService) SetSubagentStreamLookup(lookup subagentStreamLookup) {
	s.ctxLookup = lookup
}
