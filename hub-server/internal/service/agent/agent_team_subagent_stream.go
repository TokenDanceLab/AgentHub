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
//
// isTeam distinguishes a cached positive entry from a cached *negative* entry
// (this task's session has no team run). Caching the negative is what keeps the
// non-team majority off the database: without it every stream chunk re-runs the
// team-run SELECT and always gets ErrRecordNotFound (#2154 P1-4).
type teamRunContext struct {
	teamRunID    string
	teamID       string
	assignmentID string
	teamTaskID   string
	memberID     string
	isTeam       bool
}

// teamRunContextCache is a small bounded LRU keyed by pending task ID. A team
// run emits many run.agent.* events per task (per-token text_delta); without
// a cache each event would re-run three DB lookups. task IDs are UUIDs and are
// never reused, so cache entries stay correct for the task's lifetime —
// invalidation is memory hygiene, not correctness (#1478 Phase A risk note).
//
// The same argument makes *negative* entries (isTeam=false) equally safe: a
// task ID is minted once (uuidv7, see the note above) and its session's
// team-run binding is established before the first stream chunk, so "no team
// run for this task" cannot later become "team run for this task" within the
// task's lifetime. Negative entries share the identical bounded LRU, so they
// cost the same capped memory and are evicted by the same LRU policy — the
// non-team majority cannot grow the cache beyond max.
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

// len reports the live entry count (positive and negative entries share the
// bound). Used by the capacity tests and for observability.
func (c *teamRunContextCache) len() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return len(c.order)
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

// teamRunLookupOutcome classifies a lookupTeamRunContext result so the caller
// can tell a *definitive* negative answer from a transient failure.
//
// The distinction is required for negative caching: a definitive "this session
// has no team run" may be cached for the task's lifetime, but a DB blip must
// never be cached — otherwise one failed query would silently disable the
// team.subagent.stream fan-out (and the route-decision auto-parse) for every
// remaining chunk of that task.
type teamRunLookupOutcome int

const (
	// teamRunLookupTransient is an inconclusive result (query error). The
	// caller must not cache it and must retry on the next event.
	teamRunLookupTransient teamRunLookupOutcome = iota
	// teamRunLookupNoTeam is a definitive "no team run owns this session".
	// Safe to negative-cache.
	teamRunLookupNoTeam
	// teamRunLookupTeam is a definitive resolved ownership. Safe to cache.
	teamRunLookupTeam
)

// subagentStreamLookup is the DB-backed port that resolves a pending task's
// team-run ownership. It is a distinct interface so tests can substitute an
// in-memory lookup without touching gorm.
type subagentStreamLookup interface {
	lookupTeamRunContext(ctx context.Context, sessionID, taskID string) (teamRunContext, teamRunLookupOutcome)
}

// dbTeamRunLookup resolves team-run ownership via repository queries.
type dbTeamRunLookup struct {
	db *gorm.DB
}

func (l *dbTeamRunLookup) lookupTeamRunContext(ctx context.Context, sessionID, taskID string) (teamRunContext, teamRunLookupOutcome) {
	if sessionID == "" || taskID == "" {
		// Without identifiers there is definitively nothing to resolve. The
		// caller skips caching for an empty task ID, so this cannot poison the
		// cache with a "" key.
		return teamRunContext{}, teamRunLookupNoTeam
	}
	run, err := repository.GetTeamRunBySessionID(l.db, sessionID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			// Definitive negative: cacheable (see teamRunContextCache doc).
			return teamRunContext{}, teamRunLookupNoTeam
		}
		slog.Warn("team.subagent.stream: team run lookup failed",
			"session_id", sessionID, "task_id", taskID, "error", err)
		return teamRunContext{}, teamRunLookupTransient
	}
	out := teamRunContext{teamRunID: run.ID, teamID: run.TeamID, isTeam: true}

	// An assignment binds the pending task via RunID (the pending task ID set
	// by BindClaimedAssignmentDispatch). Find the assignment whose RunID points
	// at this task.
	assignments, err := repository.ListAssignmentsByTeamRun(l.db, run.ID)
	if err != nil {
		slog.Warn("team.subagent.stream: assignments lookup failed",
			"team_run_id", run.ID, "task_id", taskID, "error", err)
		return teamRunContext{}, teamRunLookupTransient
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
		return teamRunContext{}, teamRunLookupTransient
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
	return out, teamRunLookupTeam
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
	tctx, outcome := s.cachedTeamRunContext(ctx, lookup, runEvent.SessionID, taskID)
	if outcome != teamRunLookupTeam {
		// No team run for this task (definitive, possibly cached) or an
		// inconclusive lookup — either way there is no ownership to fan out
		// with, and the chat-side agent.stream publish already succeeded.
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

// cachedTeamRunContext returns the team-run context for (sessionID, taskID)
// plus a three-valued outcome, using the per-service bounded LRU to avoid three
// DB lookups per stream event.
//
// The outcome (not a bool) is what lets the two callers stay exactly as
// conservative as they were before caching:
//
//   - teamRunLookupTeam     — resolved ownership; fan the event out.
//   - teamRunLookupNoTeam   — *definitive* "no team run owns this session".
//     Cached (#2154 P1-4): non-team traffic is the majority and previously
//     re-ran the team-run SELECT on every chunk only to get ErrRecordNotFound.
//   - teamRunLookupTransient — inconclusive (query error). Never cached, so the
//     next chunk retries, and callers that have their own way of answering the
//     question (tryAutoParseRouteDecision re-reads the team run for its status
//     check anyway) fall back to it instead of silently dropping the event.
func (s *EdgeCallbackService) cachedTeamRunContext(
	ctx context.Context,
	lookup subagentStreamLookup,
	sessionID, taskID string,
) (teamRunContext, teamRunLookupOutcome) {
	c := s.teamCtxCache()
	if c != nil {
		if tctx, hit := c.get(taskID); hit {
			if tctx.isTeam {
				return tctx, teamRunLookupTeam
			}
			return teamRunContext{}, teamRunLookupNoTeam
		}
	}
	tctx, outcome := lookup.lookupTeamRunContext(ctx, sessionID, taskID)
	if outcome == teamRunLookupTransient {
		// Retry on the next event; never cache an inconclusive answer.
		return teamRunContext{}, teamRunLookupTransient
	}
	if outcome == teamRunLookupTeam {
		tctx.isTeam = true
	} else {
		tctx = teamRunContext{} // negative entry: isTeam=false
	}
	// An empty task ID cannot be keyed; skip the cache write (also keeps a
	// "" entry from occupying an LRU slot).
	if c != nil && taskID != "" {
		c.put(taskID, tctx)
	}
	return tctx, outcome
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
