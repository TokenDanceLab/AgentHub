// Package deliverydedup provides an in-process, TTL-bounded LRU cache of
// recently seen Hub→Edge delivery_id values. It closes the G2 gap identified
// in #2101: Hub's outbox redispatch loop and WS PushToConn path can both
// deliver the same task to Edge; without a dedup contract at the Edge entry
// point, the run could be created twice.
//
// Design choices (documented here so callers don't re-litigate them):
//   - In-process only. A crash clears the cache; post-crash duplicate
//     deliveries replay once. This is acceptable because runs are idempotent
//     at the adapter layer (same prompt + hubTaskId resumes rather than
//     duplicates work) and adding persistence would couple dedup to a store
//     lifecycle that outlives the problem (#2101 G2 scope).
//   - LRU eviction with a hard capacity cap. Prevents unbounded growth when
//     Hub floods Edge during recovery. Capacity and TTL are exported constants
//     so tuning stays in one place and tests can assert the boundary.
//   - Empty delivery_id is never recorded. Legacy payloads without the field
//     must continue to flow through; treating "" as a key would falsely dedup
//     unrelated legacy dispatches.
package deliverydedup

import (
	"sync"
	"time"
)

const (
	// DefaultCapacity bounds the number of distinct delivery_ids held in
	// memory. 4096 covers sustained burst from a full outbox retry sweep
	// (~hundreds of tasks) plus steady-state traffic without approaching
	// heap pressure on the 4C8G dev-class machines Edge typically runs on.
	DefaultCapacity = 4096

	// DefaultTTL is how long a delivery_id remains "recently seen". 5 minutes
	// exceeds the Hub outbox retry base interval (exponential backoff from
	// DeliveryRetryBaseInterval) so a single redispatch cycle cannot slip
	// past the window, while still expiring stale entries before they pin
	// memory across long idle periods.
	DefaultTTL = 5 * time.Minute
)

// entry pairs an absolute expiry with its position in the LRU list.
type entry struct {
	expiry time.Time
}

// Deduper is a concurrency-safe, TTL-bounded LRU of recently seen delivery IDs.
// Zero-value is NOT usable; construct with New.
type Deduper struct {
	mu    sync.Mutex
	cap   int
	ttl   time.Duration
	clock func() time.Time // injectable for tests
	items map[string]entry
	order []string // front = oldest, back = newest (LRU)
}

// New constructs a Deduper with explicit capacity and TTL. Both must be > 0.
func New(capacity int, ttl time.Duration) *Deduper {
	if capacity <= 0 {
		panic("deliverydedup: capacity must be > 0")
	}
	if ttl <= 0 {
		panic("deliverydedup: ttl must be > 0")
	}
	return &Deduper{
		cap:   capacity,
		ttl:   ttl,
		clock: time.Now,
		items: make(map[string]entry, capacity),
		order: make([]string, 0, capacity),
	}
}

// WithClock overrides the time source (for tests). Returns d for chaining.
func (d *Deduper) WithClock(clock func() time.Time) *Deduper {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.clock = clock
	return d
}

// Seen reports whether deliveryID was already recorded within the TTL window.
// Empty string always returns false (legacy payloads pass through, see pkg doc).
func (d *Deduper) Seen(deliveryID string) bool {
	if deliveryID == "" {
		return false
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	e, ok := d.items[deliveryID]
	if !ok {
		return false
	}
	if d.clock().After(e.expiry) {
		d.removeLocked(deliveryID)
		return false
	}
	return true
}

// Record marks deliveryID as seen for the configured TTL. Empty string is a
// no-op. If the ID already exists and is not expired, its TTL is refreshed
// and it is promoted to MRU. Returns true if the ID was newly inserted (i.e.
// not previously seen within TTL); false means it was a duplicate or refresh.
func (d *Deduper) Record(deliveryID string) bool {
	if deliveryID == "" {
		return false
	}
	now := d.clock()
	d.mu.Lock()
	defer d.mu.Unlock()
	if e, ok := d.items[deliveryID]; ok && !now.After(e.expiry) {
		// Refresh TTL + promote to MRU.
		d.promoteLocked(deliveryID)
		d.items[deliveryID] = entry{expiry: now.Add(d.ttl)}
		return false
	}
	// Evict expired first, then LRU if still at capacity.
	d.purgeExpiredLocked(now)
	for len(d.order) >= d.cap {
		d.evictOldestLocked()
	}
	d.items[deliveryID] = entry{expiry: now.Add(d.ttl)}
	d.order = append(d.order, deliveryID)
	return true
}

// Len returns the current number of tracked IDs (including any that may have
// expired but not yet been purged). Exported for test assertions.
func (d *Deduper) Len() int {
	d.mu.Lock()
	defer d.mu.Unlock()
	return len(d.order)
}

func (d *Deduper) removeLocked(id string) {
	delete(d.items, id)
	for i, v := range d.order {
		if v == id {
			d.order = append(d.order[:i], d.order[i+1:]...)
			return
		}
	}
}

func (d *Deduper) promoteLocked(id string) {
	for i, v := range d.order {
		if v == id {
			d.order = append(d.order[:i], d.order[i+1:]...)
			d.order = append(d.order, id)
			return
		}
	}
}

func (d *Deduper) evictOldestLocked() {
	if len(d.order) == 0 {
		return
	}
	oldest := d.order[0]
	d.order = d.order[1:]
	delete(d.items, oldest)
}

func (d *Deduper) purgeExpiredLocked(now time.Time) {
	// order is oldest-first; stop at first non-expired.
	for len(d.order) > 0 {
		id := d.order[0]
		e, ok := d.items[id]
		if !ok || !now.After(e.expiry) {
			return
		}
		d.order = d.order[1:]
		delete(d.items, id)
	}
}
