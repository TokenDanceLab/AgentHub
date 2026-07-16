// Package deliveryoutbox holds pure delivery-outbox backoff and string helpers
// for Hub AgentService.
//
// These helpers are intentionally free of DB / WS / cache / *AgentService
// dependencies so later DeliveryOutbox + Redispatcher extracts can reuse them
// without pulling orchestration code.
//
// See docs/analysis/hub-service-boundary-map.md (#514).
package deliveryoutbox
