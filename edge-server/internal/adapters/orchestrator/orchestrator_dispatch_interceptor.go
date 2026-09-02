package orchestrator

import (
	"log/slog"
	"strings"
	"sync"

	"github.com/agenthub/pkg/safego"
)

// Residual pure-helper peel of dispatchInterceptor scan/rule/fan-out methods (#1111).

func (d *dispatchInterceptor) Emit(eventType string, scope map[string]any, payload any) {
	d.inner.Emit(eventType, scope, payload)
	switch eventType {
	case BusEventTextBlock:
		d.textBuffer.Reset()
		d.scanForDispatch(payload, scope)
	case BusEventTextDelta:
		text := extractTextContent(payload)
		if text != "" {
			d.textBuffer.WriteString(text)
		}
		// Scan the FULL accumulated buffer to catch JSON lines split
		// across deltas (ISSUE 3.2).
		d.scanTextForDispatch(d.textBuffer.String(), scope)
	}
}

// scanForDispatch collects dispatch events from a payload and fans out
// multiple dispatches concurrently. Used for BusEventTextBlock (complete blocks).
func (d *dispatchInterceptor) scanForDispatch(payload any, scope map[string]any) {
	text := extractTextContent(payload)
	if text == "" {
		return
	}
	d.scanTextForDispatch(text, scope)
}

// scanTextForDispatch scans pre-extracted text for dispatch events.
// Used directly for buffered TextDelta accumulation to prevent JSON
// lines split across deltas from being silently skipped (ISSUE 3.2).
func (d *dispatchInterceptor) scanTextForDispatch(text string, scope map[string]any) {
	// T2-A08: Rule engine pre-processing layer — intercept simple
	// termination/completion signals before JSON dispatch parsing.
	if d.applyRuleEngine(text, scope) {
		return // rule engine consumed the decision
	}

	events := parseDispatchEvents(text)
	if len(events) == 0 {
		return
	}

	// Plan approval gate (P0 #3): pause and wait for user decision.
	if !d.awaitPlanApproval(events, scope) {
		return // plan was rejected or cancelled
	}

	// T2-A08: Apply rule engine to parsed dispatch events for
	// trivial routing optimization (single-finish skip, same-agent sequential).
	events = d.ruleEnginePreprocess(events, scope)
	if len(events) == 0 {
		return
	}

	if len(events) == 1 {
		d.handleDispatch(events[0], scope)
		return
	}

	d.fanOutDispatches(events, scope)
}

// applyRuleEngine scans raw text for simple termination/completion signals
// that can be handled deterministically without JSON dispatch parsing.
// Returns true if the text was consumed (short-circuited).
//
// Rules (evaluated in order):
//  1. Done/finish detection: matches standalone completion signals (e.g. "done",
//     "finish", "all tasks done") and emits aggregate progress events.
//  2. Simple yes/no: when a plan approval is pending, standalone decision
//     keywords (yes/no/approve/reject/deny) short-circuit the JSON parse.
func (d *dispatchInterceptor) applyRuleEngine(text string, scope map[string]any) bool {
	textLower := strings.ToLower(strings.TrimSpace(text))

	// Rule 1: Done/finish/completion detection.
	if matchCompletion(textLower) {
		slog.Info("orchestrator: rule engine completion signal, short-circuiting",
			"runId", d.parentRun.ID,
		)
		d.emitProgressSummary(scope)
		d.inner.Emit(BusEventTextBlock, scope, ruleEngineCompletionPayload())
		return true
	}

	// Rule 2: Standalone yes/no/approve/reject for pending plan decisions.
	if d.planBroker != nil && matchDecisionKeyword(textLower) {
		slog.Info("orchestrator: rule engine decision keyword, skipping JSON parse",
			"runId", d.parentRun.ID,
		)
		return true
	}

	return false
}

// ruleEnginePreprocess applies optimization rules to already-parsed dispatch
// events before fan-out. Returns the filtered/optimized event slice.
//
// Rules (evaluated in order):
//  1. Single "finish" dispatch with no sub-tasks: skip fanOut entirely.
//  2. All dispatches target the same agent: execute sequentially to avoid
//     intra-agent contention (no benefit from parallel fanOut).
func (d *dispatchInterceptor) ruleEnginePreprocess(events []dispatchEvent, scope map[string]any) []dispatchEvent {
	if len(events) == 0 {
		return events
	}

	// Rule 1: Single "finish" dispatch with no actual sub-task work.
	// When the orchestrator emits a lone dispatch with a finish-like
	// description and no task payload, skip fanOut to save resources.
	if len(events) == 1 && isFinishDispatch(events[0]) {
		slog.Info("orchestrator: rule engine skipping single finish dispatch",
			"runId", d.parentRun.ID,
			"agent", events[0].Agent,
		)
		d.emitProgressSummary(scope)
		return nil
	}

	// Rule 2: All dispatches to the same agent — run sequentially.
	// Parallel fanOut provides no benefit when all dispatches target
	// the same agent (they share one adapter and serialize anyway).
	if allSameAgent(events) {
		slog.Info("orchestrator: rule engine sequential fanOut for same-agent batch",
			"runId", d.parentRun.ID,
			"agent", events[0].Agent,
			"count", len(events),
		)
		d.fanOutSequential(events, scope)
		return nil
	}

	return events
}

// fanOutSequential executes dispatch events one at a time for same-agent
// batches where parallel execution would cause intra-agent contention.
// Sibling context is injected identically to fanOutDispatches.
func (d *dispatchInterceptor) fanOutSequential(events []dispatchEvent, scope map[string]any) {
	events = attachSiblingContexts(events)
	for _, evt := range events {
		d.handleDispatch(evt, scope)
	}
}

// fanOutDispatches executes multiple dispatch events concurrently via a
// semaphore-limited goroutine pool. Blocks until all dispatches complete.
// Concurrency bounded by maxConcurrency (default DefaultDispatchConcurrency = 10,
// matching OpenCode default tool concurrency).
//
// Before dispatching, each event is injected with sibling context so every
// sub-agent knows what other agents in the same parallel batch are doing.
// This prevents file conflicts when multiple agents work on the same workspace.
func (d *dispatchInterceptor) fanOutDispatches(events []dispatchEvent, scope map[string]any) {
	maxConc := d.maxConcurrency
	if maxConc <= 0 {
		maxConc = DefaultDispatchConcurrency
	}

	events = attachSiblingContexts(events)

	sem := make(chan struct{}, maxConc)
	var wg sync.WaitGroup

	for i := range events {
		wg.Add(1)
		// SafeGo wraps the worker in a panic recover: handleDispatch drives the
		// full spawn-agent/start-run chain, and an unguarded panic there would
		// crash the whole edge process and every in-flight run with it. The
		// deferred wg.Done/sem release inside fn run before SafeGo's recover,
		// so a panicked worker still frees its slot and lets wg.Wait return.
		safego.SafeGo("orchestrator.dispatch", func(evt dispatchEvent) func() {
			return func() {
				defer wg.Done()
				sem <- struct{}{}
				defer func() { <-sem }()
				d.handleDispatch(evt, scope)
			}
		}(events[i]))
	}
	wg.Wait()
}
