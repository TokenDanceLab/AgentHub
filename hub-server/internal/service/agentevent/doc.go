// Package agentevent holds pure run-event projection and ingress validation
// helpers for Hub AgentService.
//
// These functions are intentionally free of DB / WS / cache / *AgentService
// dependencies so later RunEventService / EdgeCallbackService extracts can
// reuse them without pulling orchestration code.
//
// See #468.
package agentevent
