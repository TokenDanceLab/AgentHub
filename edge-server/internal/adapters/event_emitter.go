package adapters

import (
	"github.com/agenthub/edge-server/internal/events"
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
