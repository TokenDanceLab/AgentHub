// Package orchestrator is the leaf implementation package for the
// orchestrator. It depends only on the neutral contract
// package internal/orchestration and the narrow AgentExecutor port plus
// external neutral packages (agents, store, runnerctx, events). It does NOT import the root internal/adapters implementation
// package — that direction is machine-gated by scripts/verify.
//
// Contract types are single-SSOT in internal/orchestration; this file keeps
// package-local aliases so implementation files reference the canonical
// contract vocabulary without qualification (aliases are not definitions).
package orchestrator

import "github.com/agenthub/edge-server/internal/orchestration"

// ── Contract aliases (single SSOT: internal/orchestration) ─────────────────

type PlanTask = orchestration.PlanTask
type PlanApprovalConfig = orchestration.PlanApprovalConfig
type PendingPlan = orchestration.PendingPlan
type PlanDecision = orchestration.PlanDecision

type EventEmitter = orchestration.EventEmitter
type AdapterMetadata = orchestration.AdapterMetadata
type AgentCapabilities = orchestration.AgentCapabilities
type SubAgentTask = orchestration.SubAgentTask
type SiblingInfo = orchestration.SiblingInfo
type SubAgentSpawner = orchestration.SubAgentSpawner
type RunProcessContext = orchestration.RunProcessContext

const CtxBudgetKey = orchestration.CtxBudgetKey
const CtxModelKey = orchestration.CtxModelKey

// Bus event type strings（与 orchestration 完全一致，防双 SSOT）。
const (
	BusEventTextDelta        = orchestration.BusEventTextDelta
	BusEventTextBlock        = orchestration.BusEventTextBlock
	BusEventTaskDispatched   = orchestration.BusEventTaskDispatched
	BusEventTaskProgress     = orchestration.BusEventTaskProgress
	BusEventTaskNotification = orchestration.BusEventTaskNotification
	BusEventSubAgentStatus   = orchestration.BusEventSubAgentStatus
	BusEventPlanProposed     = orchestration.BusEventPlanProposed
	BusEventPlanApproved     = orchestration.BusEventPlanApproved
	BusEventPlanRejected     = orchestration.BusEventPlanRejected
)
