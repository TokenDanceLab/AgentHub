// Package orchestrator is the leaf implementation package for the
// orchestrator.
//
// It holds the orchestrator implementation, its dispatch helpers and
// plan_approval.go. The leaf depends only on:
//
//   - internal/orchestration — neutral contract SSOT (TaskStatus, PlanTask,
//     EventEmitter, SubAgentSpawner, BusEvent* …)
//   - narrow ports defined in ports.go — AgentExecutor (agent execution)
//   - external neutral packages — internal/agents, internal/store,
//     internal/runnerctx, internal/events
//
// Dependency direction (machine-gated by TestLeafDoesNotImportRootAdapters
// and TestOrchestrationContractNeutral):
//
//	orchestration → adapters/orchestrator ← composition root
//
// The leaf never imports the root internal/adapters implementation package;
// concrete adapters, the adapter Registry, and the PlanApprovalBroker wiring
// are injected by the composition root (cmd/agenthub-edge, internal/httpserver).
package orchestrator
