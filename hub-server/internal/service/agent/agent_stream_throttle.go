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
//   - Bounded: fixed capacity with FIFO eviction, so a long-lived Hub process
//     cannot grow them without limit.
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
	mu   sync.Mutex
	max  int
	seen map[string]struct{}
	fifo []string // insertion order; fifo[head] is the oldest live key
	head int
}

func newAckedTaskSet(max int) *ackedTaskSet {
	if max <= 0 {
		max = defaultStreamStateCapacity
	}
	return &ackedTaskSet{max: max, seen: make(map[string]struct{}, max)}
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
	b.seen[id] = struct{}{}
	b.fifo = append(b.fifo, id)
	for len(b.seen) > b.max {
		b.evictOldest()
	}
	return true
}

// remove forgets id (terminal-state cleanup).
func (b *ackedTaskSet) remove(id string) {
	if id == "" {
		return
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	delete(b.seen, id)
	b.compactLocked()
}

// len reports the live entry count. Test/observability helper.
func (b *ackedTaskSet) len() int {
	b.mu.Lock()
	defer b.mu.Unlock()
	return len(b.seen)
}

// evictOldest drops the oldest live key. Caller holds mu.
func (b *ackedTaskSet) evictOldest() {
	for b.head < len(b.fifo) {
		id := b.fifo[b.head]
		b.fifo[b.head] = "" // release the string reference
		b.head++
		if _, ok := b.seen[id]; ok {
			delete(b.seen, id)
			return
		}
	}
}

// compactLocked reclaims the consumed fifo prefix once every entry in it is
// dead, keeping the slice bounded by max instead of growing forever.
func (b *ackedTaskSet) compactLocked() {
	if b.head == 0 {
		return
	}
	if b.head >= len(b.fifo) {
		b.fifo = b.fifo[:0]
		b.head = 0
		return
	}
	// Only compact when the dead prefix is large enough to be worth the copy.
	if b.head < len(b.fifo)/2 {
		return
	}
	n := copy(b.fifo, b.fifo[b.head:])
	for i := n; i < len(b.fifo); i++ {
		b.fifo[i] = ""
	}
	b.fifo = b.fifo[:n]
	b.head = 0
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
// the next touch immediately.
type sessionTouchThrottle struct {
	mu       sync.Mutex
	max      int
	interval time.Duration
	last     map[string]time.Time
	fifo     []string
	head     int
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
		last:     make(map[string]time.Time, max),
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
	if last, ok := t.last[sessionID]; ok {
		if now.Sub(last) < t.interval {
			return false
		}
		t.last[sessionID] = now
		return true
	}
	t.last[sessionID] = now
	t.fifo = append(t.fifo, sessionID)
	for len(t.last) > t.max {
		t.evictOldest()
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
	t.compactLocked()
}

// len reports the live entry count. Test/observability helper.
func (t *sessionTouchThrottle) len() int {
	t.mu.Lock()
	defer t.mu.Unlock()
	return len(t.last)
}

func (t *sessionTouchThrottle) evictOldest() {
	for t.head < len(t.fifo) {
		id := t.fifo[t.head]
		t.fifo[t.head] = ""
		t.head++
		if _, ok := t.last[id]; ok {
			delete(t.last, id)
			return
		}
	}
}

func (t *sessionTouchThrottle) compactLocked() {
	if t.head == 0 {
		return
	}
	if t.head >= len(t.fifo) {
		t.fifo = t.fifo[:0]
		t.head = 0
		return
	}
	if t.head < len(t.fifo)/2 {
		return
	}
	n := copy(t.fifo, t.fifo[t.head:])
	for i := n; i < len(t.fifo); i++ {
		t.fifo[i] = ""
	}
	t.fifo = t.fifo[:n]
	t.head = 0
}
