// Package dispatch holds pure agent-dispatch helpers for Hub DispatchService.
//
// These helpers are intentionally free of DB / WS / cache / *Service
// dependencies so later DispatchService package extracts can reuse them
// without pulling orchestration code. Orchestration and ports remain in the
// flat service package (agent_dispatch.go); the Payload DTO lives here with a
// thin same-package alias so redispatch JSON stays stable.
//
// See docs/analysis/hub-service-boundary-map.md (#800 residual continue;
// #789 residual continue; #779 residual continue; #768 residual continue;
// #756 pure surface; #732 pure residual; ports residual #617).
package dispatch
