// Package orchestrator is the leaf implementation package for the A-V1
// orchestrator extraction (#1526 Step 0 → #1566 Step 2).
//
// It holds the orchestrator implementation (13 orchestrator_*.go files +
// plan_approval.go) that previously lived in the root internal/adapters god
// package. The leaf depends only on:
//
//   - internal/orchestration — neutral contract SSOT (TaskStatus, PlanTask,
//     AgentAdapter, EventEmitter, SubAgentSpawner, BusEvent* …)
//   - narrow ports defined in ports.go — AgentExecutor (agent execution),
//     AdapterRegistry (adapter lookup / registry view)
//   - external neutral packages — internal/agents, internal/store,
//     internal/runnerctx, internal/events
//
// Dependency direction (machine-gated by TestLeafDoesNotImportRootAdapters
// and scripts/verify/verify-orchestrator-deps.py):
//
//	orchestration → adapters/orchestrator ← composition root
//
// The leaf never imports the root internal/adapters implementation package;
// concrete adapters, the adapter Registry, and the PlanApprovalBroker wiring
// are injected by the composition root (cmd/agenthub-edge, internal/httpserver).
package orchestrator
