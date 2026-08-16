// Package dispatch holds pure agent-dispatch helpers for Hub DispatchService.
//
// These helpers are intentionally free of DB / WS / cache / *Service
// dependencies so DispatchService (in sibling package dispatchsvc) can reuse
// them without pulling orchestration code. Orchestration and ports live in
// dispatchsvc; the Payload DTO lives here with a thin same-package alias so
// redispatch JSON stays stable. The full dispatch layering map (helpers /
// orchestration / service-layer adapters + facade) is documented in
// dispatchsvc's package doc.
//
// Pure residual continue chain: #732 → #756 → #768 → #779 → #789 → #800 →
// #811 → #823 (docs close) → #834 (alias drop) → #902 (assemble / target /
// redispatch-prep peel) → #946 (edge-http prep / trigger guards / target-bound
// / redispatch log peel) → #977 (lookup-error mappers / port predicates /
// redispatch log constants / team+capability residual) → #1012 (dispatch log
// constants / redispatch task gate / offline success attrs / relay port /
// capability payload guard) → #1033 (delivery-mark plans / assemble input core /
// team identity extractors / redispatch status + target-bound conn residual) →
// #1056 (repo/offline success predicates / capability mint result /
// redispatch prep gate / team-run identity / unbound inviter WS residual).
// Typed DispatchService package move remains deferred and high risk. Do not
// re-open outbox redispatch MarkDeliverySent semantics from #866; preserve #999
// soft-fail errors, #1000 running-not-retryable, #1009 atomic claim, and #1031
// offline vs outbox dual-redelivery ownership.
//
// See hub-service-boundary-map analysis.
package dispatch
