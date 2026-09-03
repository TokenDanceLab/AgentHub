// Package deliveryoutbox holds pure delivery-outbox helpers for Hub AgentService.
//
// These helpers are intentionally free of DB / WS / cache / *AgentService
// dependencies so DeliveryOutbox orchestration can reuse status, eligibility,
// backoff, and string helpers without pulling journal/repository code.
//
// Pure residual is closed (#514 backoff/truncate, #744 status/eligibility).
//
// What this package holds, described by responsibility rather than by file
// name: the outbox journal surface (record, mark sent, ack, scan, retry claim,
// dead-letter, stats, cleanup, auto-ack), the read-only Entry view callers and
// store implementations share, the retry/TTL constants and backoff, the journal
// status strings, the scan-eligibility cutoffs, the Store port every
// persistence call goes through, string truncation, and the retry/cleanup loop
// orchestration. The GORM-backed Store implementation and the AgentService
// facades stay in the parent service package (#801).
//
// No file list here on purpose: the one this comment used to carry named three
// files, two of which do not exist anywhere in the tree and the third of which
// lives in the parent package (#2246).
//
// Full model package move stays deferred (high-risk residual).
//
// See #744 (prior pure extract #514; #801).
package deliveryoutbox
