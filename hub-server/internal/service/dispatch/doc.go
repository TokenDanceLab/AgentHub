// Package dispatch holds pure agent-dispatch helpers for Hub DispatchService.
//
// These helpers are intentionally free of DB / WS / cache / *Service
// dependencies so later DispatchService package extracts can reuse them
// without pulling orchestration code. Orchestration and ports remain in the
// flat service package (agent_dispatch.go); the Payload DTO lives here with a
// thin same-package alias so redispatch JSON stays stable.
//
// Pure residual continue chain: #732 → #756 → #768 → #779 → #789 → #800 →
// #811 → #823 (docs close) → #834 (alias drop) → #902 (assemble / target /
// redispatch-prep peel) → #946 (edge-http prep / trigger guards / target-bound
// / redispatch log peel). Typed DispatchService package move remains deferred
// and high risk. Do not re-open outbox redispatch MarkDeliverySent semantics
// from #866 in this package.
//
// See docs/analysis/hub-service-boundary-map.md.
package dispatch
