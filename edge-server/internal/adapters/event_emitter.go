package adapters

import (
	"sync"

	"github.com/agenthub/edge-server/internal/events"
	"github.com/agenthub/edge-server/internal/runnerctx"
)

// BusEventEmitter adapts events.Bus to the EventEmitter interface.
// It allows adapters to emit structured events without coupling to the
// concrete events.Bus type.
type BusEventEmitter struct {
	bus *events.Bus
}

// NewBusEventEmitter creates a BusEventEmitter that publishes events to the given bus.
func NewBusEventEmitter(bus *events.Bus) *BusEventEmitter {
	return &BusEventEmitter{bus: bus}
}

// Emit publishes an event to the underlying bus.
func (e *BusEventEmitter) Emit(eventType string, scope map[string]any, payload any) {
	e.bus.Publish(eventType, scope, payload)
}

// BudgetAwareEmitter wraps an EventEmitter to emit run.agent.context_warning
// when the context budget first crosses the 85% auto-compaction threshold.
// It suppresses duplicate warnings for the same run.
type BudgetAwareEmitter struct {
	inner  EventEmitter
	budget *runnerctx.ContextBudget
	scope  map[string]any
	mu     sync.Mutex
	warned bool
}

// NewBudgetAwareEmitter creates a BudgetAwareEmitter that monitors token usage
// and emits context_warning events when the auto-compaction threshold is exceeded.
func NewBudgetAwareEmitter(inner EventEmitter, budget *runnerctx.ContextBudget, scope map[string]any) *BudgetAwareEmitter {
	return &BudgetAwareEmitter{
		inner:  inner,
		budget: budget,
		scope:  scope,
	}
}

func (e *BudgetAwareEmitter) Emit(eventType string, scope map[string]any, payload any) {
	e.inner.Emit(eventType, scope, payload)

	if eventType == BusEventContextWarning {
		return // Prevent recursive emission
	}

	e.mu.Lock()
	if !e.warned && e.budget.ShouldCompact() {
		e.warned = true
		e.inner.Emit(BusEventContextWarning, e.scope, map[string]any{
			"usagePercent": e.budget.UsagePercent(),
			"threshold":    85.0,
		})
	}
	e.mu.Unlock()
}
