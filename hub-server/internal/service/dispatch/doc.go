// Package dispatch holds pure agent-dispatch helpers for Hub DispatchService.
//
// These helpers are intentionally free of DB / WS / cache / *Service
// dependencies so later DispatchService package extracts can reuse them
// without pulling orchestration code. Orchestration, ports, and private
// payload types remain in the flat service package (agent_dispatch.go).
//
// See docs/analysis/hub-service-boundary-map.md (#768 residual continue;
// #756 pure surface; #732 pure residual; ports residual #617).
package dispatch
