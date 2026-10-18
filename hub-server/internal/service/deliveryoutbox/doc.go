// Package deliveryoutbox holds delivery-outbox helpers for Hub AgentService.
//
// The package owns the journal surface (record, mark sent, ack, scan, retry
// claim, dead-letter, stats, cleanup, auto-ack), the read-only Entry view, the
// retry/TTL constants and backoff, status strings and scan cutoffs, the Store
// port, string truncation, and retry/cleanup loop orchestration. The GORM-backed
// Store and AgentService facades live in the parent service package.
package deliveryoutbox
