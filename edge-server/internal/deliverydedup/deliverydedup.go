// Package deliverydedup tracks bounded, in-process Hub-to-Edge admission
// receipts. Seeing a delivery is not accepting it: an owner must commit a run
// ID, and a rejected or abandoned request releases its claim for retry.
// This cache is not a process-recovery log. A restart loses receipts; persisted
// Hub task/run identity and execution recovery remain separate concerns.
package deliverydedup

import (
	"strings"
	"sync"
	"time"
)

const (
	DefaultCapacity = 4096
	DefaultTTL      = 5 * time.Minute
)

// Scope binds a delivery to its business task, not to a transport-specific
// thread representation. Legacy deliveries without a Hub task bind directly
// to project/thread. This is idempotency metadata, never an authorization grant.
type Scope struct {
	HubTaskID string
	ProjectID string
	ThreadID  string
}

func (s Scope) matches(other Scope) bool {
	if s.HubTaskID != "" || other.HubTaskID != "" {
		return s.HubTaskID != "" && s.HubTaskID == other.HubTaskID
	}
	return s.ProjectID == other.ProjectID && s.ThreadID == other.ThreadID
}

type State uint8

const (
	Busy State = iota
	Claimed
	Accepted
	Conflict
)

// Admission reports an atomic claim, a committed receipt, or a safe rejection.
// Empty delivery IDs bypass the cache: Claimed with a nil Claim.
type Admission struct {
	State State
	RunID string
	Claim *Claim
}

type entry struct {
	scope  Scope
	runID  string
	expiry time.Time
	owner  *Claim
}

// Deduper bounds pending claims and accepted receipts together. Pending claims
// are never evicted or expired while their request may still accept work.
type Deduper struct {
	mu    sync.Mutex
	cap   int
	ttl   time.Duration
	clock func() time.Time
	items map[string]entry
	order []string // accepted receipts only, oldest use first
}

func New(capacity int, ttl time.Duration) *Deduper {
	if capacity <= 0 {
		panic("deliverydedup: capacity must be > 0")
	}
	if ttl <= 0 {
		panic("deliverydedup: ttl must be > 0")
	}
	return &Deduper{cap: capacity, ttl: ttl, clock: time.Now, items: make(map[string]entry, capacity)}
}

func (d *Deduper) WithClock(clock func() time.Time) *Deduper {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.clock = clock
	return d
}

// Begin reserves a delivery before side effects. Callers must defer Release
// and call Commit only after run admission succeeds. Busy is retryable, never
// a successful duplicate response. Replays retain their original expiry.
func (d *Deduper) Begin(deliveryID string, scope Scope) Admission {
	if deliveryID == "" {
		return Admission{State: Claimed}
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	d.purgeExpiredLocked(d.clock())
	if e, ok := d.items[deliveryID]; ok {
		if !e.scope.matches(scope) {
			return Admission{State: Conflict}
		}
		if e.owner != nil {
			return Admission{State: Busy}
		}
		d.promoteLocked(deliveryID)
		return Admission{State: Accepted, RunID: e.runID}
	}
	for len(d.items) >= d.cap {
		if len(d.order) == 0 {
			return Admission{State: Busy}
		}
		oldest := d.order[0]
		d.order = d.order[1:]
		delete(d.items, oldest)
	}
	claim := &Claim{cache: d, id: deliveryID}
	d.items[deliveryID] = entry{scope: scope, owner: claim}
	return Admission{State: Claimed, Claim: claim}
}

// Claim is an ownership token, so a stale release cannot delete a newer claim
// for the same ID. Its methods are safe to call more than once or concurrently.
type Claim struct {
	cache *Deduper
	id    string
}

func (c *Claim) Commit(runID string) bool {
	if c == nil || strings.TrimSpace(runID) == "" {
		return false
	}
	d := c.cache
	d.mu.Lock()
	defer d.mu.Unlock()
	e, ok := d.items[c.id]
	if !ok || e.owner != c {
		return false
	}
	e.owner = nil
	e.runID = runID
	e.expiry = d.clock().Add(d.ttl)
	d.items[c.id] = e
	d.order = append(d.order, c.id)
	return true
}

func (c *Claim) Release() {
	if c == nil {
		return
	}
	d := c.cache
	d.mu.Lock()
	defer d.mu.Unlock()
	if e, ok := d.items[c.id]; ok && e.owner == c {
		delete(d.items, c.id)
	}
}

func (d *Deduper) Len() int {
	d.mu.Lock()
	defer d.mu.Unlock()
	return len(d.items)
}

func (d *Deduper) promoteLocked(id string) {
	for i, v := range d.order {
		if v == id {
			copy(d.order[i:], d.order[i+1:])
			d.order[len(d.order)-1] = id
			return
		}
	}
}

func (d *Deduper) purgeExpiredLocked(now time.Time) {
	// LRU use order differs from expiry order because replay does not renew TTL.
	kept := d.order[:0]
	for _, id := range d.order {
		e, ok := d.items[id]
		if !ok {
			continue
		}
		if now.After(e.expiry) {
			delete(d.items, id)
			continue
		}
		kept = append(kept, id)
	}
	d.order = kept
}
