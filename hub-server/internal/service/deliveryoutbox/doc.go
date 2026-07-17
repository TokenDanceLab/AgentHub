// Package deliveryoutbox holds pure delivery-outbox helpers for Hub AgentService.
//
// These helpers are intentionally free of DB / WS / cache / *AgentService
// dependencies so DeliveryOutbox orchestration can reuse status, eligibility,
// backoff, and string helpers without pulling journal/repository code.
//
// Orchestration, private GORM model, Redispatcher ports, and AgentService
// facades remain in the flat service package (delivery_outbox.go). Full model
// package move stays deferred.
//
// See docs/analysis/hub-service-boundary-map.md (#744; prior pure extract #514).
package deliveryoutbox
