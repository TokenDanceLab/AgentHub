package ws

import (
	"fmt"
	"sync"
	"testing"

	"github.com/stretchr/testify/require"
)

// drainSeqs drains exactly n frames from c.Send (without blocking) and returns
// their seq_ids in queue order.
func drainSeqs(t *testing.T, c *Conn, n int) []int64 {
	t.Helper()
	seqs := make([]int64, 0, n)
	for i := 0; i < n; i++ {
		select {
		case data := <-c.Send:
			f, err := ParseFrame(data)
			require.NoError(t, err)
			seqs = append(seqs, f.SeqID)
		default:
			t.Fatalf("expected %d frames in send buffer, drained %d", n, len(seqs))
		}
	}
	return seqs
}

// TestPushToConnAssignsMonotonicSeqPerConn verifies that frames pushed to the
// same connection carry a strictly increasing seq_id starting at 1, and that
// counters of different connections are independent (#1361).
func TestPushToConnAssignsMonotonicSeqPerConn(t *testing.T) {
	m := NewManager()
	cA := &Conn{ID: "conn-seq-a", Send: make(chan []byte, 8)}
	cB := &Conn{ID: "conn-seq-b", Send: make(chan []byte, 8)}
	m.mu.Lock()
	m.conns[cA.ID] = cA
	m.conns[cB.ID] = cB
	m.mu.Unlock()

	// Interleave pushes across the two connections.
	for i := 0; i < 3; i++ {
		require.True(t, m.PushToConn(cA.ID, NewFrame(TypeMessageNew, map[string]string{"n": fmt.Sprint(i)})).Queued)
		require.True(t, m.PushToConn(cB.ID, NewFrame(TypeMessageNew, map[string]string{"n": fmt.Sprint(i)})).Queued)
	}

	require.Equal(t, []int64{1, 2, 3}, drainSeqs(t, cA, 3))
	require.Equal(t, []int64{1, 2, 3}, drainSeqs(t, cB, 3))
}

// TestPushToConnConcurrentSeqMatchesQueueOrder verifies that under concurrent
// PushToConn calls to the same connection, seq_ids on the wire (queue order)
// are exactly 1..N with no duplicates, gaps, or reordering: seq stamping and
// enqueue happen atomically inside the sendMu critical section.
func TestPushToConnConcurrentSeqMatchesQueueOrder(t *testing.T) {
	m := NewManager()
	c := &Conn{ID: "conn-seq-conc", Send: make(chan []byte, 512)}
	m.mu.Lock()
	m.conns[c.ID] = c
	m.mu.Unlock()

	const goroutines = 8
	const perGoroutine = 50
	var wg sync.WaitGroup
	for g := 0; g < goroutines; g++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := 0; i < perGoroutine; i++ {
				r := m.PushToConn(c.ID, NewFrame(TypeAgentStream, map[string]string{"chunk": "x"}))
				require.True(t, r.Queued)
			}
		}()
	}
	wg.Wait()

	seqs := drainSeqs(t, c, goroutines*perGoroutine)
	for i, seq := range seqs {
		require.Equal(t, int64(i+1), seq, "queue order must equal seq order at index %d", i)
	}
}

// TestPushToConnConcurrentMultiConnIndependent verifies that concurrent fanout
// to multiple connections keeps every per-connection sequence independently
// consecutive (run with -race).
func TestPushToConnConcurrentMultiConnIndependent(t *testing.T) {
	m := NewManager()
	const numConns = 4
	conns := make([]*Conn, 0, numConns)
	m.mu.Lock()
	for i := 0; i < numConns; i++ {
		c := &Conn{ID: fmt.Sprintf("conn-multi-%d", i), Send: make(chan []byte, 256)}
		m.conns[c.ID] = c
		conns = append(conns, c)
	}
	m.mu.Unlock()

	const rounds = 25
	var wg sync.WaitGroup
	for g := 0; g < 8; g++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := 0; i < rounds; i++ {
				for _, c := range conns {
					require.True(t, m.PushToConn(c.ID, NewFrame(TypeMessageNew, nil)).Queued)
				}
			}
		}()
	}
	wg.Wait()

	for _, c := range conns {
		seqs := drainSeqs(t, c, 8*rounds)
		for i, seq := range seqs {
			require.Equal(t, int64(i+1), seq, "conn %s index %d", c.ID, i)
		}
	}
}

// TestPushToConnDropConsumesSeqLeavingGap verifies that buffer-full drops
// consume a seq_id, so the next delivered frame exposes a gap — the
// client-side drop-detection signal — and that DeliveryResult.ConnDrops
// reports the cumulative per-connection drop count.
func TestPushToConnDropConsumesSeqLeavingGap(t *testing.T) {
	m := NewManager()
	c := &Conn{ID: "conn-gap", UserID: "user-gap", Send: make(chan []byte, 1)}
	m.mu.Lock()
	m.conns[c.ID] = c
	m.mu.Unlock()

	frame := NewFrame(TypeMessageNew, map[string]string{"session_id": "sess-gap"})

	r1 := m.PushToConn(c.ID, frame)
	require.True(t, r1.Queued)

	r2 := m.PushToConn(c.ID, frame)
	require.Equal(t, DeliveryStatusBufferFull, r2.Status)
	require.EqualValues(t, 1, r2.ConnDrops)

	r3 := m.PushToConn(c.ID, frame)
	require.Equal(t, DeliveryStatusBufferFull, r3.Status)
	require.EqualValues(t, 2, r3.ConnDrops)

	require.Equal(t, []int64{1}, drainSeqs(t, c, 1))

	r4 := m.PushToConn(c.ID, frame)
	require.True(t, r4.Queued)
	// Seq 2 and 3 were consumed by the two drops: the delivered stream is
	// 1 -> 4 and the client can detect the loss as a gap.
	require.Equal(t, []int64{4}, drainSeqs(t, c, 1))
}

// TestShouldLogDropSampling pins the drop-log sampling policy: first drop
// always, then every dropLogSampleEvery-th drop.
func TestShouldLogDropSampling(t *testing.T) {
	require.True(t, shouldLogDrop(1))
	require.False(t, shouldLogDrop(2))
	require.False(t, shouldLogDrop(99))
	require.True(t, shouldLogDrop(100))
	require.False(t, shouldLogDrop(101))
	require.True(t, shouldLogDrop(200))
}

// TestPushToUserAggregatesFanoutResult verifies that PushToUser no longer
// discards per-connection DeliveryResults: the aggregate reports targeted
// conns, queued and dropped counts, and whether the drop hit the log-sampling
// boundary.
func TestPushToUserAggregatesFanoutResult(t *testing.T) {
	m := NewManager()
	const user = "user-fanout"
	cOK := &Conn{ID: "conn-fanout-ok", UserID: user, Send: make(chan []byte, 8)}
	cFull := &Conn{ID: "conn-fanout-full", UserID: user, Send: make(chan []byte, 1)}
	cFull.Send <- []byte("already queued")
	m.mu.Lock()
	m.conns[cOK.ID] = cOK
	m.conns[cFull.ID] = cFull
	m.byUser[user] = map[string]string{cOK.ID: cOK.ID, cFull.ID: cFull.ID}
	m.mu.Unlock()

	res := m.PushToUser(user, NewFrame(TypeMessageNew, map[string]string{"session_id": "sess-f"}))
	require.Equal(t, 2, res.Conns)
	require.Equal(t, 1, res.Queued)
	require.Equal(t, 1, res.Dropped)
	require.Equal(t, 0, res.Failed)
	require.True(t, res.LogSampled, "first drop on a conn must be log-sampled")

	// Second fanout: the stuck conn drops again (ConnDrops=2) which is not a
	// sampling boundary, so the aggregate warn is suppressed.
	res = m.PushToUser(user, NewFrame(TypeMessageNew, map[string]string{"session_id": "sess-f"}))
	require.Equal(t, 2, res.Conns)
	require.Equal(t, 1, res.Queued)
	require.Equal(t, 1, res.Dropped)
	require.False(t, res.LogSampled)

	// Unknown user: empty result, no panic.
	require.Equal(t, FanoutResult{}, m.PushToUser("user-unknown", NewFrame(TypeMessageNew, nil)))
}

// TestPushToSessionAggregatesAcrossMembers verifies that PushToSession merges
// FanoutResults across all resolved members.
func TestPushToSessionAggregatesAcrossMembers(t *testing.T) {
	m := NewManager()
	cA := &Conn{ID: "conn-sess-a", UserID: "member-a", Send: make(chan []byte, 8)}
	cB := &Conn{ID: "conn-sess-b", UserID: "member-b", Send: make(chan []byte, 1)}
	cB.Send <- []byte("already queued")
	m.mu.Lock()
	m.conns[cA.ID] = cA
	m.conns[cB.ID] = cB
	m.byUser["member-a"] = map[string]string{cA.ID: cA.ID}
	m.byUser["member-b"] = map[string]string{cB.ID: cB.ID}
	m.mu.Unlock()
	m.ResolveMembers = func(sessionID string) []string {
		if sessionID == "sess-agg" {
			return []string{"member-a", "member-b"}
		}
		return nil
	}

	res := m.PushToSession("sess-agg", NewFrame(TypeMessageNew, map[string]string{"session_id": "sess-agg"}))
	require.Equal(t, 2, res.Conns)
	require.Equal(t, 1, res.Queued)
	require.Equal(t, 1, res.Dropped)
	require.Equal(t, 0, res.Failed)
	require.True(t, res.LogSampled)

	// Unknown session resolves no members.
	require.Equal(t, FanoutResult{}, m.PushToSession("sess-none", NewFrame(TypeMessageNew, nil)))
}
