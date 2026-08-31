package deliverydedup

import (
	"sync"
	"testing"
	"time"
)

// fakeClock is a controllable time source for deterministic TTL tests.
type fakeClock struct {
	mu  sync.Mutex
	now time.Time
}

func newFakeClock(t time.Time) *fakeClock    { return &fakeClock{now: t} }
func (c *fakeClock) Now() time.Time          { c.mu.Lock(); defer c.mu.Unlock(); return c.now }
func (c *fakeClock) Advance(d time.Duration) { c.mu.Lock(); defer c.mu.Unlock(); c.now = c.now.Add(d) }

func TestRecord_NewReturnsTrue_DuplicateReturnsFalse(t *testing.T) {
	d := New(8, time.Minute)
	if !d.Record("a") {
		t.Fatal("first Record(a) should return true")
	}
	if d.Record("a") {
		t.Fatal("second Record(a) should return false (duplicate)")
	}
	if !d.Record("b") {
		t.Fatal("Record(b) should return true")
	}
}

func TestSeen_EmptyStringAlwaysFalse(t *testing.T) {
	d := New(8, time.Minute)
	d.Record("")
	if d.Seen("") {
		t.Fatal("Seen(\"\") must be false even after Record(\"\")")
	}
	if d.Len() != 0 {
		t.Fatalf("Len after Record(\"\") = %d, want 0", d.Len())
	}
}

func TestSeen_WithinTTL_True_AfterExpiry_False(t *testing.T) {
	c := newFakeClock(time.Unix(0, 0))
	d := New(8, 10*time.Second).WithClock(c.Now)
	d.Record("x")
	if !d.Seen("x") {
		t.Fatal("Seen(x) within TTL should be true")
	}
	c.Advance(9 * time.Second)
	if !d.Seen("x") {
		t.Fatal("Seen(x) just before expiry should still be true")
	}
	c.Advance(2 * time.Second) // now 11s > 10s TTL
	if d.Seen("x") {
		t.Fatal("Seen(x) after TTL should be false")
	}
}

func TestCapacity_EvictsOldest_NotRecent(t *testing.T) {
	c := newFakeClock(time.Unix(0, 0))
	d := New(3, time.Minute).WithClock(c.Now)
	d.Record("a")
	c.Advance(time.Millisecond)
	d.Record("b")
	c.Advance(time.Millisecond)
	d.Record("c")
	if d.Len() != 3 {
		t.Fatalf("Len = %d, want 3", d.Len())
	}
	// Adding "d" must evict "a" (oldest), not "c" (most recent).
	d.Record("d")
	if d.Seen("a") {
		t.Fatal("expected a to be evicted when capacity exceeded")
	}
	if !d.Seen("b") || !d.Seen("c") || !d.Seen("d") {
		t.Fatalf("recent ids must survive eviction: b=%v c=%v d=%v",
			d.Seen("b"), d.Seen("c"), d.Seen("d"))
	}
	if d.Len() != 3 {
		t.Fatalf("Len after eviction = %d, want 3", d.Len())
	}
}

func TestCapacity_PromotionPreventsEvictionOfRefreshedID(t *testing.T) {
	c := newFakeClock(time.Unix(0, 0))
	d := New(3, time.Minute).WithClock(c.Now)
	d.Record("a")
	c.Advance(time.Millisecond)
	d.Record("b")
	c.Advance(time.Millisecond)
	d.Record("c")
	// Refresh "a" so it becomes MRU; next insert should now evict "b".
	c.Advance(time.Millisecond)
	d.Record("a")
	c.Advance(time.Millisecond)
	d.Record("d")
	if d.Seen("b") {
		t.Fatal("expected b to be evicted after a was promoted")
	}
	if !d.Seen("a") || !d.Seen("c") || !d.Seen("d") {
		t.Fatalf("a/c/d should survive: a=%v c=%v d=%v",
			d.Seen("a"), d.Seen("c"), d.Seen("d"))
	}
}

func TestExpiredEntriesArePurgedOnRecord(t *testing.T) {
	c := newFakeClock(time.Unix(0, 0))
	d := New(4, 5*time.Second).WithClock(c.Now)
	d.Record("old1")
	c.Advance(time.Millisecond)
	d.Record("old2")
	c.Advance(6 * time.Second) // both expired
	d.Record("fresh")
	if d.Seen("old1") || d.Seen("old2") {
		t.Fatal("expired entries must not appear Seen after purge")
	}
	if !d.Seen("fresh") {
		t.Fatal("fresh entry must be present")
	}
	// Len reflects only live entries after purge-on-record.
	if d.Len() != 1 {
		t.Fatalf("Len = %d, want 1 after expired purge", d.Len())
	}
}

func TestConcurrency_NoRaceUnderLoad(t *testing.T) {
	d := New(256, time.Minute)
	var wg sync.WaitGroup
	for i := 0; i < 16; i++ {
		wg.Add(1)
		go func(base int) {
			defer wg.Done()
			for j := 0; j < 200; j++ {
				id := "id-" + string(rune('A'+base%26)) + "-" + string(rune('0'+j%10))
				d.Record(id)
				_ = d.Seen(id)
			}
		}(i)
	}
	wg.Wait()
	// No panic / race detector trip = pass. Len sanity check.
	if d.Len() > 256 {
		t.Fatalf("Len exceeded capacity: %d", d.Len())
	}
}

func TestNew_PanicsOnInvalidArgs(t *testing.T) {
	defer func() {
		if r := recover(); r == nil {
			t.Fatal("expected panic on zero capacity")
		}
	}()
	New(0, time.Minute)
}
