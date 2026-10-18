package agent

import (
	"strconv"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// Bounding tests for the two in-process stream-state structures (#2154).
//
// The structures keep every retained key in the map itself (eviction scans for
// the smallest insertion sequence), so a bounded live count is a bounded
// retained store. These tests exercise the normal terminal-cleanup path
// (add … remove) and a stuck key, and lock the oldest-first eviction order.

const throttleChurnRounds = 20000

// TestAckedTaskSet_RetainedSlotsBoundedUnderTerminalCleanup is the shape every
// task actually takes: one add on the first chunk, one remove on done/fail.
func TestAckedTaskSet_RetainedSlotsBoundedUnderTerminalCleanup(t *testing.T) {
	const max = 4
	set := newAckedTaskSet(max)
	for i := 0; i < throttleChurnRounds; i++ {
		id := "task-" + strconv.Itoa(i)
		require.True(t, set.addIfAbsent(id))
		set.remove(id)
	}
	require.Equal(t, 0, set.len(), "every task terminated, so nothing is live")
}

// TestAckedTaskSet_RetainedSlotsBoundedWithOneStuckKey covers the harder case:
// a task that never reaches a terminal state (abandoned stream, dead Edge) sits
// at the head of the ordering forever, so reclamation cannot depend on the
// prefix in front of it becoming dead.
func TestAckedTaskSet_RetainedSlotsBoundedWithOneStuckKey(t *testing.T) {
	const max = 4
	set := newAckedTaskSet(max)
	require.True(t, set.addIfAbsent("task-stuck"))
	for i := 0; i < throttleChurnRounds; i++ {
		id := "task-" + strconv.Itoa(i)
		require.True(t, set.addIfAbsent(id))
		set.remove(id)
	}
	require.Equal(t, 1, set.len(), "the stuck key is still live under churn")
}

// TestAckedTaskSet_EvictsOldestInsertionFirst locks the eviction order the
// structure promises (FIFO by insertion), so the bounding rewrite cannot
// silently turn it into "evict whichever key the map iteration hits first".
func TestAckedTaskSet_EvictsOldestInsertionFirst(t *testing.T) {
	set := newAckedTaskSet(3)
	for _, id := range []string{"a", "b", "c"} {
		require.True(t, set.addIfAbsent(id))
	}
	require.True(t, set.addIfAbsent("d"), "over capacity the oldest key is evicted to make room")
	require.Equal(t, 3, set.len())
	require.True(t, set.addIfAbsent("a"), "a was the oldest insertion, so a is the one that went")
	require.False(t, set.addIfAbsent("c"), "c must still be live: eviction is oldest-first, not arbitrary")
}

func TestSessionTouchThrottle_RetainedSlotsBoundedUnderTerminalCleanup(t *testing.T) {
	const max = 4
	throttle := newSessionTouchThrottle(max, time.Second)
	now := time.Now()
	for i := 0; i < throttleChurnRounds; i++ {
		id := "sess-" + strconv.Itoa(i)
		require.True(t, throttle.allow(id, now))
		throttle.reset(id)
	}
	require.Equal(t, 0, throttle.len(), "every session terminated, so nothing is live")
}

func TestSessionTouchThrottle_RetainedSlotsBoundedWithOneStuckKey(t *testing.T) {
	const max = 4
	throttle := newSessionTouchThrottle(max, time.Second)
	now := time.Now()
	require.True(t, throttle.allow("sess-stuck", now))
	for i := 0; i < throttleChurnRounds; i++ {
		id := "sess-" + strconv.Itoa(i)
		require.True(t, throttle.allow(id, now))
		throttle.reset(id)
	}
	require.Equal(t, 1, throttle.len(), "the stuck session is still live under churn")
}

func TestSessionTouchThrottle_EvictsOldestInsertionFirst(t *testing.T) {
	throttle := newSessionTouchThrottle(3, time.Second)
	now := time.Now()
	for _, id := range []string{"a", "b", "c"} {
		require.True(t, throttle.allow(id, now))
	}
	require.True(t, throttle.allow("d", now), "over capacity the oldest session is evicted to make room")
	require.Equal(t, 3, throttle.len())
	require.True(t, throttle.allow("a", now), "a was the oldest insertion, so a is the one that went")
	require.False(t, throttle.allow("c", now), "c must still be inside its window: eviction is oldest-first")
}

func (b *ackedTaskSet) len() int {
	b.mu.Lock()
	defer b.mu.Unlock()
	return len(b.seen)
}

func (t *sessionTouchThrottle) len() int {
	t.mu.Lock()
	defer t.mu.Unlock()
	return len(t.last)
}
