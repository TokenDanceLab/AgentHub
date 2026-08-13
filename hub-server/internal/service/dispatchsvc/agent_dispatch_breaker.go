package dispatchsvc

import (
	"sync"
	"time"
)

// edgeBreakerFailureThreshold is the number of consecutive Edge HTTP dispatch
// failures after which the per-edge circuit breaker opens. When Edge is down
// every dispatch otherwise blocks for the full HTTP client timeout (~30s),
// exhausting the dispatch semaphore and stalling the TTL/redispatch path.
const edgeBreakerFailureThreshold = 3

// edgeBreakerOpenDuration is how long the breaker stays open before allowing a
// single half-open probe to test Edge recovery.
const edgeBreakerOpenDuration = 30 * time.Second

type edgeCircuitState int

const (
	edgeBreakerClosed edgeCircuitState = iota
	edgeBreakerOpen
	edgeBreakerHalfOpen
)

// edgeCircuitBreaker guards dispatchToEdgeHTTP against hammering a down Edge
// server. While open it fails fast (no HTTP call, no semaphore slot consumed)
// for edgeBreakerOpenDuration, then admits exactly one probe to test recovery.
// A successful probe closes the breaker; a failed probe reopens it.
//
// The breaker is per-Edge-endpoint (dispatchToEdgeHTTP targets the single
// configured Edge URL for unbound tasks). A nil breaker (partial test
// constructions via struct literals) allows all traffic — only NewDispatchService
// wires a real breaker so production is protected while pure dispatch tests
// that build &DispatchService{} stay unaffected.
type edgeCircuitBreaker struct {
	mu            sync.Mutex
	state         edgeCircuitState
	failures      int
	openUntil     time.Time
	probeInFlight bool
}

// Allow reports whether a dispatch attempt may proceed.
//
// Closed: always allow.
// Open: deny until openUntil elapses, then transition to half-open and admit a
//
//	single probe.
//
// Half-open: admit exactly one probe; deny additional probes until the
//
//	in-flight probe resolves via RecordSuccess/RecordFailure.
func (b *edgeCircuitBreaker) Allow() bool {
	if b == nil {
		return true
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	switch b.state {
	case edgeBreakerClosed:
		return true
	case edgeBreakerOpen:
		if time.Now().Before(b.openUntil) {
			return false
		}
		// Open window elapsed: promote to half-open and admit one probe.
		b.state = edgeBreakerHalfOpen
		b.probeInFlight = true
		return true
	case edgeBreakerHalfOpen:
		if b.probeInFlight {
			return false
		}
		b.probeInFlight = true
		return true
	}
	return true
}

// RecordSuccess closes the breaker and resets the failure count after a
// successful dispatch or a successful half-open probe.
func (b *edgeCircuitBreaker) RecordSuccess() {
	if b == nil {
		return
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	b.failures = 0
	b.state = edgeBreakerClosed
	b.probeInFlight = false
}

// RecordFailure increments the consecutive failure count. In half-open it
// reopens the breaker for another openDuration window; in closed it counts
// toward the threshold and opens when threshold is reached.
func (b *edgeCircuitBreaker) RecordFailure() {
	if b == nil {
		return
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	b.probeInFlight = false
	switch b.state {
	case edgeBreakerHalfOpen:
		// Probe failed: reopen for a fresh open window.
		b.state = edgeBreakerOpen
		b.openUntil = time.Now().Add(edgeBreakerOpenDuration)
		b.failures = edgeBreakerFailureThreshold
	case edgeBreakerClosed:
		b.failures++
		if b.failures >= edgeBreakerFailureThreshold {
			b.state = edgeBreakerOpen
			b.openUntil = time.Now().Add(edgeBreakerOpenDuration)
		}
	}
}

// State returns the current breaker state (test/diagnostic helper).
func (b *edgeCircuitBreaker) State() edgeCircuitState {
	if b == nil {
		return edgeBreakerClosed
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.state == edgeBreakerOpen && time.Now().After(b.openUntil) {
		// Report half-open once the open window has elapsed even before the
		// next Allow() promotes it, so diagnostics reflect effective state.
		return edgeBreakerHalfOpen
	}
	return b.state
}
