package service

import (
	"github.com/agenthub/hub-server/internal/service/deliveryoutbox"
)

// ── Outbox type aliases (thin views over the pure deliveryoutbox package) ──

// DeliveryOutbox aliases the pure orchestration type; construction now goes
// through deliveryoutbox.NewOutbox with the gorm-backed DeliveryOutboxStore
// (delivery_outbox_store.go). The agent-family facade methods that use this
// alias live in service/agent/agent_delivery_outbox.go.
type DeliveryOutbox = deliveryoutbox.Outbox

// DeliveryOutboxEntry aliases the pure read view (no GORM tags).
type DeliveryOutboxEntry = deliveryoutbox.Entry
