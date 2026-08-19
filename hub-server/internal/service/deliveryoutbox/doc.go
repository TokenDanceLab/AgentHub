// Package deliveryoutbox owns the Hub→Edge delivery journal and retry-loop
// orchestration plus the pure status / eligibility / backoff / string helpers
// the orchestration uses.
//
// The orchestration residual (#801 → moved here) closed the flat-service
// split: outbox.go holds the Redispatcher port, Outbox type, and journal ops;
// model.go holds the private GORM row, the Entry read view, and repository
// helpers; retry.go holds the retry loop, redispatch adapters, backlog gauge,
// and cleanup loop.
//
// The flat service package consumes *Outbox through a locally-defined port
// (deliveryOutboxPort) so service never imports this package; the moved tests
// here import the service package for cross-domain auto-ack coverage.
//
// See #514 (backoff/truncate), #744 (status/eligibility), #801 (split).
package deliveryoutbox
