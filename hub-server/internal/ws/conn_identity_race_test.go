package ws

import (
	"fmt"
	"strings"
	"sync"
	"testing"
)

// TestConn_AuthSnapshotIsRaceFreeAndCoherent locks in the post-fix contract
// for identity reads: consumers must read through Conn.Auth(), which returns
// a mutex-protected snapshot. Under concurrent SetAuth churn the snapshot
// must stay coherent (all three fields from one SetAuth call) and `go test
// -race` must stay silent.
//
// Falsification evidence (pre-fix): the same workload with direct field
// reads (the former service-side pattern) produced DATA RACE at conn.go:78
// (SetAuth write vs unlocked read) — see PR body.
func TestConn_AuthSnapshotIsRaceFreeAndCoherent(t *testing.T) {
	c := NewConn(nil)

	var wg sync.WaitGroup
	stop := make(chan struct{})

	wg.Add(1)
	go func() {
		defer wg.Done()
		for i := 0; ; i++ {
			select {
			case <-stop:
				return
			default:
			}
			n := i % 4
			c.SetAuth(fmt.Sprintf("user-%d", n), "desktop", fmt.Sprintf("dev-%d", n))
		}
	}()

	var seen int
	var coherent bool
	wg.Add(1)
	go func() {
		defer wg.Done()
		for i := 0; i < 20000; i++ {
			userID, deviceType, deviceID := c.Auth()
			if userID == "" {
				continue
			}
			seen++
			// Coherence: user-N must pair with dev-N from the same SetAuth.
			if strings.TrimPrefix(userID, "user-") == strings.TrimPrefix(deviceID, "dev-") && deviceType == "desktop" {
				coherent = true
			} else {
				t.Errorf("torn identity snapshot: userID=%q deviceType=%q deviceID=%q", userID, deviceType, deviceID)
				return
			}
		}
		close(stop)
	}()

	wg.Wait()
	if seen == 0 {
		t.Fatal("reader never observed a bound identity; test exercised no overlap")
	}
	if !coherent {
		t.Fatal("no coherent snapshot observed")
	}
}
