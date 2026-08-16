// Package deliveryoutbox holds pure delivery-outbox helpers for Hub AgentService.
//
// These helpers are intentionally free of DB / WS / cache / *AgentService
// dependencies so DeliveryOutbox orchestration can reuse status, eligibility,
// backoff, and string helpers without pulling journal/repository code.
//
// Pure residual is closed (#514 backoff/truncate, #744 status/eligibility).
// Flat service package keeps orchestration split across adjacent files (#801):
//   - delivery_outbox.go — ports, journal, retry loop, redispatch adapters
//   - delivery_outbox_model.go — GORM record, Entry DTO, redispatchTarget, repo
//   - delivery_outbox_facade.go — status/TTL aliases, AgentService facades
//
// Full model package move stays deferred (high-risk residual).
//
// See #744 (prior pure extract #514; #801).
package deliveryoutbox
