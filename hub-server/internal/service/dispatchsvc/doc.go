// Package dispatchsvc owns agent task dispatch orchestration: trigger,
// payload assembly, route classification (HTTP / WebSocket / offline queue /
// hub relay), capability minting, and the outbox redispatch residual.
//
// The package is transport-free: it depends on repository / cache / bus /
// metrics / service/dispatch (pure helpers) only, and expresses its WS and
// relay collaborators through local ports (ManagerPort / RelayPort) that the
// service layer adapts from ws.Manager and relay.Service. It must never import
// internal/ws or the sibling service implementations.
//
// Dispatch concern layering (deliberate split, not duplication):
//
//	service/dispatch          pure, wire-free helpers (payload DTO, URL
//	                          prep, log constants, port predicates) —
//	                          imports only errcode/model, no DB/WS/cache
//	service/dispatchsvc       this package: orchestration + ports
//	service/dispatch_adapters.go
//	                          package service: adapts *ws.Manager and
//	                          relay.Service onto the dispatchsvc ports;
//	                          transport types never leak below this layer
//	service/agent_dispatch_facade.go
//	                          package service: AgentService facade methods
//	                          that delegate to DispatchService (kept
//	                          separate to mirror delivery_outbox_facade.go)
//
// The two service-layer files exist because dispatchsvc is transport-free by
// design: the ws/relay adaptation and the AgentService API surface must live
// one layer up. Do not merge them into dispatchsvc and do not inline the
// dispatchsvc orchestration back into AgentService.
package dispatchsvc
