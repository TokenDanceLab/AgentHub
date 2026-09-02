package agent

import (
	"sync"
	"time"
)

// Bounded in-process state for the Edge stream callback hot path (#2154 P2-9).
//
// HandleTaskStream runs once per streamed chunk — in practice once per token.
// Two of its maintenance writes are meaningful far less often than that:
//
//   - the delivery-outbox auto-ack only has to happen once per task (its own
//     contract is "the *first* authorized stream proves Edge received the
//     task"), yet it ran on every chunk and matched 0 rows forever after;
//   - session.last_message_at only feeds the conversation-list ordering
//     (repository/session.go orders by COALESCE(last_message_at, created_at)),
//     where second-level precision is indistinguishable, yet it was rewritten
//     on every chunk.
//
// The two structures below are the memory that lets both writes be skipped.
// They are deliberately *not* backed by a DB column: that would need a
// migration and would add a write to save a write.
//
// Shared invariants:
//   - Bounded *by construction*: the map is the only backing store and every
//     mutator enforces len(map) <= max before returning, so the live-entry
//     count and the retained memory are the same number and neither can drift.
//     The first version of this file kept a second structure — a FIFO slice of
//     insertion order — and reclaimed it only from a head index that just the
//     over-capacity eviction path advanced. Under the normal path (add on the
//     first chunk, remove on done/fail) that index never moved, so the slice
//     retained one slot per task forever while len(map) stayed at 0 and every
//     test that asserted len() passed. Order is now a sequence number stored
//     in the map value, which is what makes the bound structural instead of a
//     property of a reclamation path being reached.
//   - Fail-open: losing an entry (eviction or process restart) always degrades
//     towards "do the work", never towards "skip work that was needed".
//   - Terminal cleanup: entries are dropped when the task reaches a terminal
//     state (HandleTaskDone / HandleTaskFail), which is also the point after
//     which the key can never be reused.
const defaultStreamStateCapacity = 4096

// ackedTaskSet records the pending tasks whose delivery-outbox auto-ack has
// already succeeded in this process, so later stream chunks of the same task
// skip the UPDATE entirely.
//
// Idempotency / restart safety: the ack itself is
// deliveryoutbox.Outbox.AutoAckDeliveriesForTask → Store.UpdateByTaskID over
// ActiveStatuses() (pending/sent/retrying). Rows already flipped to `delivered`
// are not active, so re-running the ack matches 0 rows and has no effect.
// Therefore a process restart (which empties this set) or an eviction (which
// forgets a task) can only cause a *redundant* 0-row UPDATE — never a missed or
// a duplicated state change. That is what makes an in-process, non-durable
// dedupe set safe here.
//
// Entries are only recorded after the outbox call returned no error, so a
// transient DB failure leaves the task unrecorded and the next chunk retries —
// the same recovery the pre-throttle per-chunk call gave for free.
type ackedTaskSet struct {
	mu  sync.Mutex
	max int
	// seen maps task ID → insertion sequence (1-based, monotonic). The sequence
	// is the eviction order, so no separate ordering structure is needed.
	seen map[string]uint64
	seq  uint64
}

func newAckedTaskSet(max int) *ackedTaskSet {
	if max <= 0 {
		max = defaultStreamStateCapacity
	}
	return &ackedTaskSet{max: max, seen: make(map[string]uint64, max)}
}

// addIfAbsent records id and reports whether it was newly recorded. A false
// result means the task was already acked in this process and the caller may
// skip the outbox round-trip.
func (b *ackedTaskSet) addIfAbsent(id string) bool {
	if id == "" {
		// An empty task ID is not a usable key; let the caller fall through to
		// the real ack instead of collapsing every such call into one entry.
		return true
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	if _, ok := b.seen[id]; ok {
		return false
	}
	b.seq++
	b.seen[id] = b.seq
	for len(b.seen) > b.max {
		b.evictOldestLocked()
	}
	return true
}

// remove forgets id (terminal-state cleanup). Deleting the map entry is the
// whole operation: there is no ordering structure left to reclaim.
func (b *ackedTaskSet) remove(id string) {
	if id == "" {
		return
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	delete(b.seen, id)
}

// len reports the live entry count. Test/observability helper.
func (b *ackedTaskSet) len() int {
	b.mu.Lock()
	defer b.mu.Unlock()
	return len(b.seen)
}

// retainedSlots reports how many key slots the structure holds, live or not.
// The map being the only backing store is what makes this equal to len(); the
// accessor exists so the invariant stays assertable (and stays broken loudly)
// if an ordering structure is ever reintroduced here.
func (b *ackedTaskSet) retainedSlots() int {
	b.mu.Lock()
	defer b.mu.Unlock()
	return len(b.seen)
}

// evictOldestLocked drops the entry with the smallest insertion sequence, i.e.
// the oldest live key — the same FIFO order the previous slice-based version
// promised. Caller holds mu.
//
// Cost: an O(max) scan of the map. It runs only when a *new* key arrives while
// the set is already at capacity, so once per task (never per chunk), and a
// task lives for seconds — tens of microseconds against that is noise. Keeping
// the order inside the map is what makes the bound unconditional, which is the
// trade this file already got wrong once.
func (b *ackedTaskSet) evictOldestLocked() {
	var (
		oldestID  string
		oldestSeq uint64
	)
	for id, seq := range b.seen {
		if oldestSeq == 0 || seq < oldestSeq {
			oldestID, oldestSeq = id, seq
		}
	}
	if oldestSeq == 0 {
		return
	}
	delete(b.seen, oldestID)
}

// sessionTouchThrottle limits session.last_message_at writes to at most one per
// session per interval.
//
// Precision argument: last_message_at is only consumed as the conversation-list
// sort key — repository/session.go orders every listing by
// COALESCE(s.last_message_at, s.created_at) DESC (ListUserSessions,
// ListWorkspaceSessions, SearchSessions) and by nothing else. Second-level
// granularity cannot change a user-visible ordering that a per-chunk write
// would have gotten "right", because two chunks of the same stream are already
// the same conversation activity; the worst case is that a session's list
// position lags the final chunk by under one interval, and the terminal
// (done/fail) callback force-touches unconditionally so the settled value is
// always exact.
//
// Fail-open like ackedTaskSet: an evicted or forgotten session simply performs
// the next touch immediately. Bounded by the same argument — see ackedTaskSet
// for why the order lives in the map value.
type sessionTouchThrottle struct {
	mu       sync.Mutex
	max      int
	interval time.Duration
	last     map[string]sessionTouch
	seq      uint64
}

// sessionTouch is one throttle entry: when the session was last written, and
// the insertion sequence that decides eviction order. The sequence is set once,
// on first sight of the session, so eviction stays FIFO-by-insertion exactly as
// the previous version behaved — re-touching a session refreshes its timestamp
// but not its place in the eviction order.
type sessionTouch struct {
	at  time.Time
	seq uint64
}

func newSessionTouchThrottle(max int, interval time.Duration) *sessionTouchThrottle {
	if max <= 0 {
		max = defaultStreamStateCapacity
	}
	if interval <= 0 {
		interval = time.Second
	}
	return &sessionTouchThrottle{
		max:      max,
		interval: interval,
		last:     make(map[string]sessionTouch, max),
	}
}

// allow reports whether a touch for sessionID at time now must reach the DB,
// recording now when it does. The timestamp is only advanced on an allowed
// touch, so a continuous stream produces one write per interval rather than
// sliding the window forward forever and never writing again.
func (t *sessionTouchThrottle) allow(sessionID string, now time.Time) bool {
	if sessionID == "" {
		return true
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	if entry, ok := t.last[sessionID]; ok {
		if now.Sub(entry.at) < t.interval {
			return false
		}
		entry.at = now
		t.last[sessionID] = entry
		return true
	}
	t.seq++
	t.last[sessionID] = sessionTouch{at: now, seq: t.seq}
	for len(t.last) > t.max {
		t.evictOldestLocked()
	}
	return true
}

// reset forgets sessionID so the next touch is unconditional. Called from the
// terminal callbacks, which must always land the final last_message_at.
func (t *sessionTouchThrottle) reset(sessionID string) {
	if sessionID == "" {
		return
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	delete(t.last, sessionID)
}

// len reports the live entry count. Test/observability helper.
func (t *sessionTouchThrottle) len() int {
	t.mu.Lock()
	defer t.mu.Unlock()
	return len(t.last)
}

// retainedSlots reports how many key slots the structure holds, live or not.
// See ackedTaskSet.retainedSlots.
func (t *sessionTouchThrottle) retainedSlots() int {
	t.mu.Lock()
	defer t.mu.Unlock()
	return len(t.last)
}

// evictOldestLocked drops the oldest-inserted live session. Caller holds mu.
// Cost and rationale as in ackedTaskSet.evictOldestLocked.
func (t *sessionTouchThrottle) evictOldestLocked() {
	var (
		oldestID  string
		oldestSeq uint64
	)
	for id, entry := range t.last {
		if oldestSeq == 0 || entry.seq < oldestSeq {
			oldestID, oldestSeq = id, entry.seq
		}
	}
	if oldestSeq == 0 {
		return
	}
	delete(t.last, oldestID)
}
