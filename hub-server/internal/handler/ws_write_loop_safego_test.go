package handler

// #2246 slice 1 follow-up: writeLoop was the fifth hand-written recover() site
// and the only one the first slice left behind — a per-connection goroutine
// started by a bare `go func(){}` five lines above a safego.SafeGo("ws.readLoop")
// call, guarded by a log-only recover with no stack, no counter and no
// PanicObserver. It now recovers through pkg/safego like everything else.
//
// What these tests pin is what that convergence could silently have broken:
//
//   - the deferred conn.W.Close(StatusNormalClosure) still runs when the loop
//     body panics, so the peer still gets a normal closure on the unwinding
//     path (TestWriteLoop_PanicStillClosesConn);
//   - the panic does not escape writeLoop to its caller (same test);
//   - conn_id survives: a safego name has to stay a low-cardinality label, so
//     the correlation key rides in a second log line written by a defer
//     registered *before* safego.RecoverInto
//     (TestWriteLoop_PanicKeepsConnIDCorrelation);
//   - the panic is attributed to the stable name the PanicObserver and therefore
//     goroutine_panic_recoveries_total key off
//     (TestWriteLoop_PanicReachesObserverUnderStableName);
//   - the launch site still releases its Manager goroutine slot, so Shutdown's
//     bounded drain keeps converging (TestServeWS_LaunchReleasesGoroutineSlot);
//   - the second guard ws.go documents actually exists: a panic raised by the
//     Close defer itself cannot be recovered inside writeLoop, so
//     startWriteLoop's SafeGo is what catches it
//     (TestStartWriteLoop_LauncherGuardCoversClosePanic).
//
// The panic is injected through the one seam writeLoop's loop body offers
// without touching production code: slog. writeLoop logs exactly one message
// from inside the loop — "ws write error", on the branch where a write failed —
// so a slog handler that panics on that message reproduces a real in-body panic
// (a panicking library call, a corrupted conn) faithfully. Each test also
// asserts on the records the panic produced, so a broken injection fails loudly
// instead of turning the Close probe into a vacuous green.
//
// No time.Sleep in this file: the test-sleep ratchet budgets sleeps per file and
// a newly added file has no baseline entry.

import (
	"context"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/agenthub/hub-server/internal/metrics"
	"github.com/agenthub/hub-server/internal/ws"
	"github.com/agenthub/pkg/safego"
	"github.com/agenthub/pkg/testkit"
)

// writeErrorLogMsg is the only message writeLoop logs from inside its loop, and
// therefore the only place a test can raise a panic inside the loop body
// without changing production code.
const writeErrorLogMsg = "ws write error"

// writeLoopPanicLogMsg is the conn_id correlation line writeLoop's own defer
// writes after safego.RecoverInto has filled its error slot.
const writeLoopPanicLogMsg = "ws writeLoop panic recovered"

// safegoPanicLogMsg is pkg/safego report()'s line: the one carrying the stack.
const safegoPanicLogMsg = "goroutine panic recovered"

// writeLoopSafegoName is the stable, low-cardinality label both the RecoverInto
// inside writeLoop and the SafeGo at its launch site report under.
const writeLoopSafegoName = "ws.writeLoop"

// logRig is a slog.Handler that records everything it sees and, when panicOn is
// set, panics on that exact message — the seam the tests use to raise a panic
// inside writeLoop's body. It writes nothing to stderr: induced-panic stacks
// would otherwise bury the test output.
type logRig struct {
	panicOn string

	mu      sync.Mutex
	records []slog.Record
}

// install swaps the rig in as the process-wide slog default and restores the
// previous logger on cleanup. No test in this package calls t.Parallel(), so the
// swap cannot leak into a sibling test's assertions.
func (r *logRig) install(t *testing.T) {
	t.Helper()
	previous := slog.Default()
	slog.SetDefault(slog.New(r))
	t.Cleanup(func() { slog.SetDefault(previous) })
}

func (r *logRig) Enabled(context.Context, slog.Level) bool { return true }

func (r *logRig) Handle(_ context.Context, rec slog.Record) error {
	r.mu.Lock()
	r.records = append(r.records, rec.Clone())
	induced := r.panicOn != "" && rec.Message == r.panicOn
	r.mu.Unlock()
	if induced {
		panic("induced panic from the slog seam: " + rec.Message)
	}
	return nil
}

func (r *logRig) WithAttrs([]slog.Attr) slog.Handler { return r }
func (r *logRig) WithGroup(string) slog.Handler      { return r }

// find returns the first captured record carrying msg.
func (r *logRig) find(msg string) (slog.Record, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, rec := range r.records {
		if rec.Message == msg {
			return rec, true
		}
	}
	return slog.Record{}, false
}

// count returns how many captured records carry msg.
func (r *logRig) count(msg string) int {
	r.mu.Lock()
	defer r.mu.Unlock()
	n := 0
	for _, rec := range r.records {
		if rec.Message == msg {
			n++
		}
	}
	return n
}

// attrString returns the string value of key, or "" when the record has no such
// attribute.
func attrString(rec slog.Record, key string) string {
	var out string
	rec.Attrs(func(a slog.Attr) bool {
		if a.Key == key {
			out = a.Value.String()
			return false
		}
		return true
	})
	return out
}

// panickedWriteLoop is one induced writeLoop panic plus everything the tests
// assert on.
type panickedWriteLoop struct {
	conn       *ws.Conn
	serverConn *websocket.Conn
	escaped    any // whatever reached writeLoop's caller; must stay nil
	rig        *logRig
}

// runPanickingWriteLoop builds a real websocket pair, kills the transport under
// it so the next write fails fast, and runs writeLoop over one frame with the
// slog rig panicking on the resulting "ws write error" log.
//
// Killing the *raw* net.Conn instead of calling websocket.Close on the server
// side is what keeps the Close assertion honest: coder/websocket sets its
// internal `closing` flag only from Close/CloseNow, so once writeLoop has
// returned, `errors.Is(serverConn.CloseNow(), net.ErrClosed)` is true exactly
// when writeLoop's own deferred Close(StatusNormalClosure) already ran, and
// CloseNow reports no error at all when it did not.
func runPanickingWriteLoop(t *testing.T) *panickedWriteLoop {
	t.Helper()

	rig := &logRig{panicOn: writeErrorLogMsg}
	rig.install(t)

	serverConns := make(chan *websocket.Conn, 1)
	rawConns := make(chan net.Conn, 4)

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err, "listen for the websocket upgrade")

	srv := &http.Server{
		// gosec G112 (Slowloris): every http.Server in the tree sets a read
		// header timeout, test servers included (internal/app/admin_test.go).
		ReadHeaderTimeout: time.Second,
		Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			accepted, acceptErr := websocket.Accept(w, r, nil)
			if acceptErr != nil {
				serverConns <- nil
				return
			}
			serverConns <- accepted
		}),
		// Capture the raw conn so the test can kill the transport without
		// touching the websocket layer sitting on top of it.
		ConnState: func(c net.Conn, state http.ConnState) {
			if state == http.StateNew {
				select {
				case rawConns <- c:
				default:
				}
			}
		},
	}
	go func() { _ = srv.Serve(listener) }()
	t.Cleanup(func() { _ = srv.Close() })

	wsURL := "ws://" + listener.Addr().String() + "/ws"
	dialCtx, dialCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer dialCancel()
	client, _, err := websocket.Dial(dialCtx, wsURL, nil)
	require.NoError(t, err, "dial the test websocket server")
	t.Cleanup(func() { _ = client.CloseNow() })

	serverConn := <-serverConns
	require.NotNil(t, serverConn, "websocket.Accept must have succeeded")

	raw := <-rawConns
	require.NoError(t, raw.Close(), "kill the transport under the websocket")

	// Barrier: wait until the websocket layer has noticed the dead transport,
	// so the next Write fails instead of landing in the TCP send buffer.
	readCtx, readCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer readCancel()
	_, _, err = serverConn.Read(readCtx)
	require.Error(t, err, "the server-side read must fail once the raw conn is gone")

	conn := ws.NewConn(serverConn)
	conn.ID = "conn-writeloop-safego"
	// One frame is enough: the write fails, writeLoop takes its slog.Warn
	// branch, and the rig panics there — inside the loop body.
	conn.Send <- []byte(`{"type":"test.frame","seq_id":1}`)

	result := &panickedWriteLoop{conn: conn, serverConn: serverConn, rig: rig}
	h := NewWebSocketHandler(ws.NewManager(), "")
	done := make(chan struct{})
	go func() {
		// LIFO: the recover runs first, then close(done) publishes escaped.
		defer close(done)
		defer func() { result.escaped = recover() }()
		h.writeLoop(conn)
	}()
	testkit.WaitFor(t, 10*time.Second, done, "writeLoop did not return after the induced panic")

	return result
}

// TestWriteLoop_PanicStillClosesConn pins the one behaviour the convergence
// could have silently dropped. writeLoop registers `defer conn.W.Close(...)`
// *before* its recovery, so under LIFO the close runs *last* — during unwinding
// of a recovered panic. Had the recovery moved above the close (or the close
// been dropped), a panicking writeLoop would leave the socket half-open and the
// peer without a normal closure.
func TestWriteLoop_PanicStillClosesConn(t *testing.T) {
	p := runPanickingWriteLoop(t)

	// The injection really fired. Without this the Close probe below could go
	// green on a writeLoop that never panicked at all.
	_, panicked := p.rig.find(writeLoopPanicLogMsg)
	require.True(t, panicked,
		"the induced panic never reached writeLoop's recovery: the slog seam (%q) did not fire", writeErrorLogMsg)

	require.Nil(t, p.escaped,
		"the induced panic must be recovered inside writeLoop (pkg/safego), not escape to its caller")

	assert.ErrorIs(t, p.serverConn.CloseNow(), net.ErrClosed,
		"writeLoop's deferred conn.W.Close(StatusNormalClosure) must still run when the loop body panics: "+
			"a socket that is not already closing here means the panic skipped the Close defer (#2246)")
}

// TestWriteLoop_PanicKeepsConnIDCorrelation pins the reason writeLoop keeps a
// safego.RecoverInto of its own instead of relying on the launcher's guard: a
// safego name is a metric/observer label and must stay low-cardinality, so
// conn_id cannot ride along in it. Losing conn_id would cost the one key that
// ties a recovered writeLoop panic back to a connection.
func TestWriteLoop_PanicKeepsConnIDCorrelation(t *testing.T) {
	p := runPanickingWriteLoop(t)
	require.Nil(t, p.escaped, "the induced panic must not escape writeLoop")

	rec, ok := p.rig.find(writeLoopPanicLogMsg)
	require.True(t, ok, "writeLoop must still log %q after a recovered panic", writeLoopPanicLogMsg)
	assert.Equal(t, p.conn.ID, attrString(rec, "conn_id"),
		"the recovered-panic log must keep conn_id: a safego name cannot carry per-connection cardinality (#2246)")

	_, ok = p.rig.find(safegoPanicLogMsg)
	assert.True(t, ok,
		"pkg/safego report() must log the recovered panic with its stack; a missing %q line means "+
			"writeLoop is not recovering through pkg/safego", safegoPanicLogMsg)
}

// TestWriteLoop_PanicReachesObserverUnderStableName pins the payoff of the
// convergence itself: the panic now reaches a PanicObserver, which is what
// feeds goroutine_panic_recoveries_total. The old bare recover() wrote one log
// line and nothing else, so this panic was invisible to every dashboard.
func TestWriteLoop_PanicReachesObserverUnderStableName(t *testing.T) {
	recorded := make(chan string, 4)
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

	p := runPanickingWriteLoop(t)
	require.Nil(t, p.escaped, "the induced panic must not escape writeLoop")

	select {
	case name := <-recorded:
		assert.Equal(t, writeLoopSafegoName, name,
			"writeLoop must recover under the stable dotted safego name %q (#2246)", writeLoopSafegoName)
	case <-time.After(5 * time.Second):
		t.Fatal("the recovered panic never reached a safego PanicObserver: writeLoop is not recovering through pkg/safego")
	}
}

// TestServeWS_LaunchReleasesGoroutineSlot covers the launch side of the same
// change: writeLoop is now started by safego.SafeGo instead of a bare
// `go func(){}`, and the closure still has to release the Manager goroutine
// slot it was given (GoroutineAdd(2) covers writeLoop + readLoop). Manager
// .Shutdown waits on that WaitGroup with a 2s bound, so a slot that is never
// released shows up as the drain-timeout warning instead of the converged line.
//
// Scope note, stated rather than implied: this test drives the healthy path
// (dial, then Shutdown). Inducing a panic *and* keeping it deterministic is not
// possible through ServeWS — the auth.ok frame is pushed before a test can
// break the transport — so the panic-path guarantees are the three tests above,
// which call writeLoop directly.
func TestServeWS_LaunchReleasesGoroutineSlot(t *testing.T) {
	rig := &logRig{} // capture only: no message may panic here
	rig.install(t)

	manager := ws.NewManager()
	gin.SetMode(gin.TestMode)
	router := gin.New()
	h := NewWebSocketHandler(manager, "")
	const userID = "user-writeloop-launch"
	router.GET("/client/ws", func(c *gin.Context) {
		// ServeWS fails closed without an authenticated context; the real
		// route gets it from middleware.WSAuthMiddleware.
		c.Set("user_id", userID)
	}, h.ServeWS)

	srv := httptest.NewServer(router)
	t.Cleanup(srv.Close)

	dialCtx, dialCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer dialCancel()
	client, _, err := websocket.Dial(dialCtx, "ws"+strings.TrimPrefix(srv.URL, "http")+"/client/ws", nil)
	require.NoError(t, err, "dial ServeWS")

	// Drain the client side. Manager.Shutdown closes each connection with a
	// websocket close handshake, and coder/websocket waits out a 5s timeout for
	// the peer's answering close frame — a peer that never reads cannot answer,
	// so without a reader this test spends 5s in Shutdown for no reason.
	//
	// A plain Read loop, deliberately not client.CloseRead(ctx): CloseRead
	// registers a closeRead goroutine that Conn.waitGoroutines then waits on
	// with a 15s bound, which made the cleanup a coin flip between 0s and 15s.
	drained := make(chan struct{})
	go func() {
		defer close(drained)
		for {
			if _, _, readErr := client.Read(context.Background()); readErr != nil {
				return
			}
		}
	}()
	t.Cleanup(func() {
		_ = client.CloseNow()
		select {
		case <-drained:
		case <-time.After(5 * time.Second):
			t.Error("the client drain goroutine did not exit after CloseNow")
		}
	})

	testkit.Eventually(t, 5*time.Second, func() bool { return manager.Count() == 1 },
		"the connection never registered on the Manager",
		func() string { return "Count = " + strconv.Itoa(manager.Count()) })

	manager.Shutdown()

	if _, timedOut := rig.find("ws shutdown: timed out waiting for connection goroutines"); timedOut {
		t.Error("Manager.Shutdown hit its 2s drain timeout: a writeLoop/readLoop goroutine never called " +
			"GoroutineDone, so the safego launch site lost the slot GoroutineAdd(2) handed it (#2246)")
	}
	_, converged := rig.find("ws shutdown: all connection goroutines converged")
	assert.True(t, converged,
		"Manager.Shutdown must report that every connection goroutine converged")
}

// TestStartWriteLoop_LauncherGuardCoversClosePanic pins the second of the two
// guards ws.go documents. writeLoop cannot recover a panic raised by its own
// `defer conn.W.Close(...)` — that defer is the panicking frame — so
// startWriteLoop's SafeGo is the only thing between such a panic and a dead
// process, and the Manager goroutine slot still has to be released on that
// path or Shutdown's bounded drain stops converging.
//
// A Conn with a nil W is the synthetic way to make the Close defer itself
// panic: coder/websocket dereferences its receiver in Write and in Close alike,
// so one queued frame produces exactly two recoveries — writeLoop's RecoverInto
// for the body panic, then startWriteLoop's SafeGo for the close panic. Both
// report under the same stable name, so two observer dispatches carrying
// ws.writeLoop is the fingerprint of both guards having fired.
func TestStartWriteLoop_LauncherGuardCoversClosePanic(t *testing.T) {
	rig := &logRig{} // capture only
	rig.install(t)

	dispatched := make(chan string, 8)
	safego.SetPanicObserver(func(name string, _ any, _ string) {
		dispatched <- name
	})
	t.Cleanup(metrics.InstallPanicObserver)

	manager := ws.NewManager()
	h := NewWebSocketHandler(manager, "")
	conn := ws.NewConn(nil) // nil *websocket.Conn: Write and Close both panic
	conn.ID = "conn-writeloop-closepanic"

	// ServeWS reserves two slots (writeLoop + readLoop); this test launches
	// only the write side, so it reserves the one slot startWriteLoop must
	// release.
	manager.GoroutineAdd(1)
	conn.Send <- []byte(`{"type":"test.frame","seq_id":1}`)
	h.startWriteLoop(conn)

	for i := 0; i < 2; i++ {
		select {
		case name := <-dispatched:
			assert.Equal(t, writeLoopSafegoName, name,
				"both guards must report under the same stable safego name %q (#2246)", writeLoopSafegoName)
		case <-time.After(10 * time.Second):
			t.Fatalf("only %d of 2 expected panic dispatches arrived: the launcher guard in "+
				"startWriteLoop did not catch the panic raised by writeLoop's Close defer", i)
		}
	}
	assert.Equal(t, 2, rig.count(safegoPanicLogMsg),
		"expected one pkg/safego report per guard: writeLoop's RecoverInto for the body panic and "+
			"startWriteLoop's SafeGo for the Close panic")

	rec, ok := rig.find(writeLoopPanicLogMsg)
	require.True(t, ok, "writeLoop must still log %q with conn_id", writeLoopPanicLogMsg)
	assert.Equal(t, conn.ID, attrString(rec, "conn_id"), "the conn_id correlation line must survive")

	// The slot release: Shutdown waits on the connection-goroutine WaitGroup
	// with a 2s bound, so its own log tells the two outcomes apart.
	manager.Shutdown()
	if _, timedOut := rig.find("ws shutdown: timed out waiting for connection goroutines"); timedOut {
		t.Error("Manager.Shutdown hit its 2s drain timeout: startWriteLoop's closure did not release the " +
			"goroutine slot after the recovered close panic (#2246)")
	}
	_, converged := rig.find("ws shutdown: all connection goroutines converged")
	assert.True(t, converged, "Manager.Shutdown must report that every connection goroutine converged")
}
