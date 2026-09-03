package ws

// #2246 slice 1: PushToSession recovered a panic from the injected
// ResolveMembers callback with a private, bare recover() that only wrote a
// slog.Error line — no stack, no counter, no PanicObserver. It now goes through
// pkg/safego, the single recovery path. These tests pin what the convergence
// could silently have broken: the named result still comes back, the panic is
// attributed to a stable safego name, and the Manager keeps working afterwards.
//
// No time.Sleep in this file: the test-sleep ratchet budgets sleeps per file and
// a newly added file has no baseline entry.

import (
	"testing"
	"time"

	"github.com/prometheus/client_golang/prometheus/testutil"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/agenthub/hub-server/internal/metrics"
	"github.com/agenthub/pkg/safego"
)

// TestPushToSession_RecoversPanickingResolveMembers pins the two behaviours a
// caller can observe: the panic does not escape PushToSession, and the named
// result survives it (zero value here, since ResolveMembers panics before
// anything is merged — the same partial-result contract the old inline recover
// had).
func TestPushToSession_RecoversPanickingResolveMembers(t *testing.T) {
	metrics.Register()
	metrics.InstallPanicObserver()

	goroutineBefore := testutil.ToFloat64(metrics.GoroutinePanicRecoveries)
	busBefore := testutil.ToFloat64(metrics.EventBusPanics)

	m := NewManager()
	m.ResolveMembers = func(string) []string { panic("induced ResolveMembers panic") }

	var res FanoutResult
	require.NotPanics(t, func() {
		res = m.PushToSession("sess-panic", NewFrame(TypeMessageNew, nil))
	}, "a panicking ResolveMembers callback must not escape PushToSession")
	assert.Equal(t, FanoutResult{}, res,
		"the named result must be returned as-is after a recovered panic")

	// The observer runs synchronously inside PushToSession's deferred
	// safego.Recover, i.e. before PushToSession returns — no polling needed.
	assert.Equal(t, float64(1), testutil.ToFloat64(metrics.GoroutinePanicRecoveries)-goroutineBefore,
		"a recovered fanout panic must count once in goroutine_panic_recoveries_total; "+
			"0 means PushToSession is not going through pkg/safego (#2246)")
	assert.Equal(t, float64(0), testutil.ToFloat64(metrics.EventBusPanics)-busBefore,
		"ws.push_to_session is not a bus name and must not feed eventbus_panics_total")
}

// TestPushToSession_PanicAttributedToStableSafegoName pins the label itself.
// The machine gate (scripts/verify/verify-safego-convergence.py) can prove no
// bare recover() is left, but only this can prove the replacement is attributed
// to the name the dashboards and the eventbus dispatch rule key off.
func TestPushToSession_PanicAttributedToStableSafegoName(t *testing.T) {
	metrics.Register()

	recorded := make(chan string, 1)
	// pkg/safego keeps exactly one process-global slot, so hand the Hub's
	// dispatch back on cleanup instead of leaving the rest of the package's
	// tests with a foreign observer.
	safego.SetPanicObserver(func(name string, _ any, _ string) {
		select {
		case recorded <- name:
		default:
		}
	})
	t.Cleanup(metrics.InstallPanicObserver)

	m := NewManager()
	m.ResolveMembers = func(string) []string { panic("induced ResolveMembers panic") }
	m.PushToSession("sess-name", NewFrame(TypeMessageNew, nil))

	select {
	case name := <-recorded:
		assert.Equal(t, "ws.push_to_session", name,
			"PushToSession must recover under the stable dotted safego name ws.push_to_session (#2246)")
	case <-time.After(3 * time.Second):
		t.Fatal("the recovered panic never reached a safego PanicObserver: PushToSession is not recovering through pkg/safego")
	}
}

// TestPushToSession_StillWorksAfterRecoveredPanic pins that recovering does not
// poison the Manager: the same instance must fan out normally once the resolver
// stops panicking.
func TestPushToSession_StillWorksAfterRecoveredPanic(t *testing.T) {
	m := NewManager()

	panicNext := true
	m.ResolveMembers = func(sessionID string) []string {
		if panicNext {
			panic("induced ResolveMembers panic")
		}
		return []string{"member-a"}
	}

	conn := &Conn{ID: "conn-fanout-safego", UserID: "member-a", Send: make(chan []byte, 4)}
	m.mu.Lock()
	m.conns[conn.ID] = conn
	m.byUser["member-a"] = map[string]string{conn.ID: conn.ID}
	m.mu.Unlock()

	m.PushToSession("sess-recover", NewFrame(TypeMessageNew, nil))

	panicNext = false
	res := m.PushToSession("sess-recover", NewFrame(TypeMessageNew, nil))
	assert.Equal(t, 1, res.Conns, "the Manager must keep fanning out after a recovered panic")
	assert.Equal(t, 1, res.Queued)
	assert.Equal(t, 0, res.Dropped)
}
