package adapters

import (
	"encoding/json"
	"fmt"
	"sync"
	"unicode/utf8"

	"github.com/agenthub/edge-server/internal/events"
	"github.com/agenthub/edge-server/internal/runnerctx"
)

// DefaultStructuredPayloadMaxBytes is the default JSON payload budget for a
// single structured run.agent.* event emitted by runtime adapters.
const DefaultStructuredPayloadMaxBytes int64 = 1 * 1024 * 1024

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

// ScopedEventEmitter supplies a default scope when an adapter emits an event
// without one, such as control-protocol permission events.
type ScopedEventEmitter struct {
	inner EventEmitter
	scope map[string]any
}

// NewScopedEventEmitter wraps an EventEmitter with a default scope.
func NewScopedEventEmitter(inner EventEmitter, scope map[string]any) *ScopedEventEmitter {
	return &ScopedEventEmitter{inner: inner, scope: scope}
}

func (e *ScopedEventEmitter) Emit(eventType string, scope map[string]any, payload any) {
	if scope == nil {
		scope = e.scope
		payload = payloadWithScopeDefaults(payload, scope)
	}
	e.inner.Emit(eventType, scope, payload)
}

func payloadWithScopeDefaults(payload any, scope map[string]any) any {
	if len(scope) == 0 {
		return payload
	}
	payloadMap, ok := payload.(map[string]any)
	if !ok {
		return payload
	}
	withDefaults := make(map[string]any, len(payloadMap)+len(scope))
	for k, v := range payloadMap {
		withDefaults[k] = v
	}
	for _, key := range []string{"projectId", "threadId", "runId"} {
		if _, exists := withDefaults[key]; !exists {
			if v, ok := scope[key]; ok {
				withDefaults[key] = v
			}
		}
	}
	return withDefaults
}

// PayloadLimitEmitter caps large structured adapter payloads before they reach
// the event bus. It preserves the event type/scope and marks truncated payloads
// with compatible metadata so clients can surface the loss.
type PayloadLimitEmitter struct {
	inner    EventEmitter
	maxBytes int64
}

// NewPayloadLimitEmitter wraps an EventEmitter with a per-event JSON payload
// byte budget. Non-positive budgets use DefaultStructuredPayloadMaxBytes.
func NewPayloadLimitEmitter(inner EventEmitter, maxBytes int64) *PayloadLimitEmitter {
	if maxBytes <= 0 {
		maxBytes = DefaultStructuredPayloadMaxBytes
	}
	return &PayloadLimitEmitter{inner: inner, maxBytes: maxBytes}
}

func (e *PayloadLimitEmitter) Emit(eventType string, scope map[string]any, payload any) {
	e.inner.Emit(eventType, scope, limitStructuredPayload(payload, e.maxBytes))
}

func limitStructuredPayload(payload any, maxBytes int64) any {
	if maxBytes <= 0 {
		return payload
	}
	payloadMap, ok := payload.(map[string]any)
	if !ok {
		return payload
	}

	bytesBefore, ok := jsonPayloadSize(payloadMap)
	if !ok || bytesBefore <= maxBytes {
		return payload
	}

	limited, ok := clonePayloadValue(payloadMap).(map[string]any)
	if !ok {
		return payload
	}
	limited["truncated"] = true
	limited["maxBytes"] = maxBytes
	limited["bytesBefore"] = bytesBefore
	limited["message"] = fmt.Sprintf("structured event payload truncated after %d bytes", maxBytes)

	for {
		currentBytes, ok := jsonPayloadSize(limited)
		if !ok {
			return payload
		}
		if currentBytes <= maxBytes {
			return limited
		}
		if !truncateLargestString(limited, int(currentBytes-maxBytes)+1024) {
			break
		}
	}

	fallback := map[string]any{
		"truncated":   true,
		"maxBytes":    maxBytes,
		"bytesBefore": bytesBefore,
		"dropped":     true,
		"message":     fmt.Sprintf("structured event payload exceeded %d bytes and was dropped", maxBytes),
	}
	if currentBytes, ok := jsonPayloadSize(fallback); ok && currentBytes <= maxBytes {
		return fallback
	}
	delete(fallback, "message")
	if currentBytes, ok := jsonPayloadSize(fallback); ok && currentBytes <= maxBytes {
		return fallback
	}
	return map[string]any{"truncated": true}
}

func jsonPayloadSize(value any) (int64, bool) {
	encoded, err := json.Marshal(value)
	if err != nil {
		return 0, false
	}
	return int64(len(encoded)), true
}

func clonePayloadValue(value any) any {
	switch v := value.(type) {
	case map[string]any:
		cloned := make(map[string]any, len(v))
		for key, child := range v {
			cloned[key] = clonePayloadValue(child)
		}
		return cloned
	case []any:
		cloned := make([]any, len(v))
		for i, child := range v {
			cloned[i] = clonePayloadValue(child)
		}
		return cloned
	case []map[string]any:
		cloned := make([]map[string]any, len(v))
		for i, child := range v {
			cloned[i] = clonePayloadValue(child).(map[string]any)
		}
		return cloned
	case []string:
		return append([]string(nil), v...)
	case map[string]string:
		cloned := make(map[string]string, len(v))
		for key, child := range v {
			cloned[key] = child
		}
		return cloned
	default:
		return value
	}
}

type stringSlot struct {
	value string
	set   func(string)
}

func truncateLargestString(value any, removeBytes int) bool {
	if removeBytes <= 0 {
		removeBytes = 1
	}
	var largest *stringSlot
	findLargestString(value, &largest)
	if largest == nil || len(largest.value) == 0 {
		return false
	}
	targetBytes := len(largest.value) - removeBytes
	if targetBytes < 0 {
		targetBytes = 0
	}
	largest.set(truncateUTF8Bytes(largest.value, targetBytes))
	return true
}

func findLargestString(value any, largest **stringSlot) {
	switch v := value.(type) {
	case map[string]any:
		for key, child := range v {
			if isPayloadLimitMetadataKey(key) {
				continue
			}
			k := key
			switch s := child.(type) {
			case string:
				considerStringSlot(&stringSlot{value: s, set: func(next string) { v[k] = next }}, largest)
			default:
				findLargestString(child, largest)
			}
		}
	case []any:
		for i, child := range v {
			idx := i
			switch s := child.(type) {
			case string:
				considerStringSlot(&stringSlot{value: s, set: func(next string) { v[idx] = next }}, largest)
			default:
				findLargestString(child, largest)
			}
		}
	case []map[string]any:
		for _, child := range v {
			findLargestString(child, largest)
		}
	case []string:
		for i, child := range v {
			idx := i
			considerStringSlot(&stringSlot{value: child, set: func(next string) { v[idx] = next }}, largest)
		}
	case map[string]string:
		for key, child := range v {
			if isPayloadLimitMetadataKey(key) {
				continue
			}
			k := key
			considerStringSlot(&stringSlot{value: child, set: func(next string) { v[k] = next }}, largest)
		}
	}
}

func considerStringSlot(candidate *stringSlot, largest **stringSlot) {
	if *largest == nil || len(candidate.value) > len((*largest).value) {
		*largest = candidate
	}
}

func isPayloadLimitMetadataKey(key string) bool {
	switch key {
	case "truncated", "maxBytes", "bytesBefore", "dropped", "message":
		return true
	default:
		return false
	}
}

func truncateUTF8Bytes(value string, maxBytes int) string {
	if maxBytes <= 0 {
		return ""
	}
	if len(value) <= maxBytes {
		return value
	}
	for maxBytes > 0 && !utf8.ValidString(value[:maxBytes]) {
		maxBytes--
	}
	if maxBytes <= 0 {
		return ""
	}
	return value[:maxBytes]
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
