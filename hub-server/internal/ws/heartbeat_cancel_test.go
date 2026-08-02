package ws

import (
	"context"
	"sync/atomic"
	"testing"
	"time"
)

// TestHeartbeatStopsOnContextCancel proves the #1542 fix: the heartbeat
// ticker loop must exit when its context is cancelled — previously it ran
// forever and leaked a goroutine at shutdown. A ping hook counts ticks
// without needing real WebSocket connections.
func TestHeartbeatStopsOnContextCancel(t *testing.T) {
	manager := NewManager()

	var pings atomic.Int64
	manager.SetPingHook(func() { pings.Add(1) })

	hbCtx, hbCancel := context.WithCancel(context.Background())
	manager.StartHeartbeatWithInterval(hbCtx, 10*time.Millisecond)

	// Let a few ticks run.
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) && pings.Load() < 3 {
		time.Sleep(5 * time.Millisecond)
	}
	if pings.Load() < 3 {
		t.Fatalf("heartbeat did not tick: pings=%d", pings.Load())
	}

	// Cancel: the loop must stop (no further ticks).
	hbCancel()
	time.Sleep(30 * time.Millisecond)
	after := pings.Load()
	time.Sleep(60 * time.Millisecond)
	if got := pings.Load(); got != after {
		t.Fatalf("heartbeat continued after cancel: pings %d -> %d", after, got)
	}
}
