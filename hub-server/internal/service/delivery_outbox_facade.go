package service

import (
	"github.com/agenthub/hub-server/internal/service/deliveryoutbox"
)

// ── Outbox status constants (aliases to pure deliveryoutbox package) ────────
//
// Residual pure-helper extract (#744) after pure backoff/truncate (#514), thin
// type + Redispatcher (#540), and model ownership residual (#551). Status /
// eligibility / last-error helpers live in service/deliveryoutbox; thin aliases
// keep existing call sites stable. File split residual (#801): aliases live
// here; AgentService facades moved to service/agent/agent_delivery_outbox.go
// when the agent family moved to the subpackage (#1761). Full model package
// move remains deferred.

const (
	DeliveryStatusPending   = deliveryoutbox.StatusPending
	DeliveryStatusSent      = deliveryoutbox.StatusSent
	DeliveryStatusDelivered = deliveryoutbox.StatusDelivered
	DeliveryStatusRetrying  = deliveryoutbox.StatusRetrying
	DeliveryStatusDead      = deliveryoutbox.StatusDead
)

// ── Delivery outbox TTL constants (aliases to pure deliveryoutbox package) ──

const (
	// DefaultMaxDeliveryAttempts is the default retry budget before dead-letter.
	DefaultMaxDeliveryAttempts = deliveryoutbox.DefaultMaxAttempts

	// DeliveryRetryBaseInterval is the base backoff interval (multiplied by 2^attempt).
	DeliveryRetryBaseInterval = deliveryoutbox.RetryBaseInterval

	// DeliveryRetryMaxInterval caps the exponential backoff ceiling.
	DeliveryRetryMaxInterval = deliveryoutbox.RetryMaxInterval

	// DeliveryRetryScanInterval controls how often retryable deliveries are scanned.
	DeliveryRetryScanInterval = deliveryoutbox.RetryScanInterval

	// DeliveryPendingTimeout is the time after which a pending (never sent) delivery
	// is eligible for retry.
	DeliveryPendingTimeout = deliveryoutbox.PendingTimeout

	// DeliverySentTimeout is the time after which a sent (unacked) delivery
	// is eligible for retry.
	DeliverySentTimeout = deliveryoutbox.SentTimeout

	// DeliveryOutboxMaxBatch caps the number of deliveries scanned per retry cycle.
	DeliveryOutboxMaxBatch = deliveryoutbox.MaxBatch

	// DeliveryOutboxRetention is how long a delivered or dead-letter outbox
	// row is kept before CleanupOldDeliveries purges it. 7 days balances
	// operator audit window against unbounded table growth.
	DeliveryOutboxRetention = deliveryoutbox.Retention

	// DeliveryOutboxCleanupInterval is how often the background cleanup loop
	// fires. 24h keeps the purge off the hot path; the retention window
	// (not the cadence) governs how old a row must be to qualify.
	DeliveryOutboxCleanupInterval = deliveryoutbox.CleanupInterval
)

// ── Outbox type aliases (thin views over the pure deliveryoutbox package) ──

// DeliveryOutbox aliases the pure orchestration type; construction now goes
// through deliveryoutbox.NewOutbox with the gorm-backed DeliveryOutboxStore
// (delivery_outbox_store.go). The agent-family facade methods that use this
// alias live in service/agent/agent_delivery_outbox.go.
type DeliveryOutbox = deliveryoutbox.Outbox

// DeliveryOutboxEntry aliases the pure read view (no GORM tags).
type DeliveryOutboxEntry = deliveryoutbox.Entry
