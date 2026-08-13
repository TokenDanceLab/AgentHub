// Package dispatchsvc owns agent task dispatch orchestration: trigger,
// payload assembly, route classification (HTTP / WebSocket / offline queue /
// hub relay), capability minting, and the outbox redispatch residual.
//
// The package is transport-free: it depends on repository / cache / bus /
// metrics / service/dispatch (pure helpers) only, and expresses its WS and
// relay collaborators through local ports (ManagerPort / RelayPort) that the
// service layer adapts from ws.Manager and RelayService. It must never import
// internal/ws or the sibling service implementations.
package dispatchsvc
