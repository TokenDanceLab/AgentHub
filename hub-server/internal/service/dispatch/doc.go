// Package dispatch holds pure agent-dispatch helpers for Hub DispatchService.
//
// These helpers are intentionally free of DB / WS / cache / *Service
// dependencies so DispatchService (in sibling package dispatchsvc) can reuse
// them without pulling orchestration code. Orchestration and ports live in
// dispatchsvc; the Payload DTO lives here with a thin same-package alias so
// redispatch JSON stays stable. The full dispatch layering map (helpers /
// orchestration / service-layer adapters + facade) is documented in the
// dispatchsvc package doc.
package dispatch
