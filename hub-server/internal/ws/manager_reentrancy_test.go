package ws

import (
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// TestUnregister_OnRouteDel_NoManagerReentrancy proves #2071 S2 benign:
// the OnRouteDel callback is invoked *after* Manager.mu is released, so a
// callback that attempts to call Register, SetAuth, or Unregister on the
// same Manager cannot deadlock or observe partially-mutated map state.
//
// This is a negative test: it asserts the absence of reentrancy hazard by
// exercising the exact code path (Unregister → OnRouteDel) with a callback
// that deliberately calls back into Manager methods. If mu were still held
// when OnRouteDel fires, the inner Register/SetAuth/Unregister would
// deadlock (Lock while Lock is held by the same goroutine). The test uses
// a timeout to detect such a deadlock and fails explicitly.
func TestUnregister_OnRouteDel_NoManagerReentrancy(t *testing.T) {
	m := NewManager()

	var delCalled atomic.Int64
	var reentrantOpsDone atomic.Int64

	// Install a callback that deliberately calls back into Manager.
	// If OnRouteDel were invoked while mu is held, these calls would
	// deadlock because Register/SetAuth/Unregister all acquire mu.
	m.OnRouteDel = func(userID, deviceType, deviceID, connID string) {
		delCalled.Add(1)

		// Attempt reentrant Register + SetAuth + Unregister using a conn
		// without UserID so its Unregister does NOT fire OnRouteDel again
		// (avoiding infinite recursion while still proving lock safety).
		newConn := &Conn{
			ID:         "reentrant-" + connID,
			DeviceType: deviceType,
			DeviceID:   deviceID,
			Send:       make(chan []byte, 4),
		}
		_ = m.Register(newConn)
		m.SetAuth(newConn.ID, "", deviceType, deviceID) // empty userID
		m.Unregister(newConn.ID)                        // no OnRouteDel since userID=""

		reentrantOpsDone.Add(1)
	}

	// Register a connection with identity so Unregister triggers OnRouteDel.
	c := &Conn{
		ID:         "conn-under-test",
		UserID:     "user-1",
		DeviceType: "web",
		DeviceID:   "",
		Send:       make(chan []byte, 4),
	}
	require.NoError(t, m.Register(c))
	m.SetAuth(c.ID, "user-1", "web", "")

	// Run Unregister in a goroutine with a deadline to detect deadlock.
	done := make(chan struct{})
	go func() {
		m.Unregister(c.ID)
		close(done)
	}()

	select {
	case <-done:
		// Success: Unregister completed without deadlock.
	case <-time.After(5 * time.Second):
		t.Fatal("Unregister deadlocked: OnRouteDel likely invoked while mu is held")
	}

	require.Equal(t, int64(1), delCalled.Load(), "OnRouteDel must be called exactly once")
	require.Equal(t, int64(1), reentrantOpsDone.Load(), "reentrant ops must complete")

	// Original conn must be gone; reentrant conn was registered then unregistered.
	require.Equal(t, 0, m.Count(), "all connections should be unregistered after test")
}

// TestPingAll_Unregister_OnRouteDel_ConcurrentSafety proves that when
// pingAll workers concurrently trigger Unregister → OnRouteDel, the
// callbacks execute safely without corrupting Manager state or deadlocking.
// This simulates the exact scenario from #2071 S2: multiple stale
// connections detected in one pingAll tick, each worker calling
// c.Close(); m.Unregister(c.ID) which fires OnRouteDel.
func TestPingAll_Unregister_OnRouteDel_ConcurrentSafety(t *testing.T) {
	m := NewManager()

	const connCount = 8 // Stay well under WSMaxConnsPerUser=10 per user.
	var delCalls atomic.Int64

	// Callback that reads Manager state (simulating real-world cache lookups
	// that might inspect online status). Crucially does NOT hold any external
	// lock that could create a lock-ordering cycle with Manager.mu.
	m.OnRouteDel = func(userID, deviceType, deviceID, connID string) {
		delCalls.Add(1)
		// Read-only probe: verify Manager is in a consistent state during
		// concurrent Unregisters. Count() acquires RLock briefly.
		_ = m.Count()
	}

	// Register N connections across distinct users to avoid per-user cap.
	for i := 0; i < connCount; i++ {
		userID := fmt.Sprintf("user-%d", i)
		c := &Conn{
			ID:         fmt.Sprintf("stale-%d", i),
			UserID:     userID,
			DeviceType: "web",
			Send:       make(chan []byte, 4),
		}
		require.NoError(t, m.Register(c))
		m.SetAuth(c.ID, userID, "web", "")
	}
	require.Equal(t, connCount, m.Count())

	// Simulate what pingAll workers do: concurrent Close+Unregister.
	conns := m.snapshotConns()
	var wg sync.WaitGroup
	for _, c := range conns {
		wg.Add(1)
		go func(conn *Conn) {
			defer wg.Done()
			conn.Close()
			m.Unregister(conn.ID)
		}(c)
	}

	done := make(chan struct{})
	go func() {
		wg.Wait()
		close(done)
	}()

	select {
	case <-done:
		// All concurrent Unregisters completed.
	case <-time.After(10 * time.Second):
		t.Fatal("concurrent Unregister deadlocked during simulated pingAll")
	}

	require.Equal(t, int64(connCount), delCalls.Load(),
		"OnRouteDel must fire once per connection")
	require.Equal(t, 0, m.Count(),
		"all connections must be unregistered after concurrent cleanup")
}

// snapshotConns is a test helper returning a copy of current connections,
// mirroring pingAll's RLock-snapshot pattern.
func (m *Manager) snapshotConns() []*Conn {
	m.mu.RLock()
	defer m.mu.RUnlock()
	conns := make([]*Conn, 0, len(m.conns))
	for _, c := range m.conns {
		conns = append(conns, c)
	}
	return conns
}
