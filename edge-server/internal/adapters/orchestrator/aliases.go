// Package orchestrator is the leaf implementation package for the A-V1
// orchestrator extraction (#1566). It depends only on the neutral contract
// package internal/orchestration and narrow ports (AgentExecutor,
// AdapterRegistry) plus external neutral packages (agents, store, runnerctx,
// events). It does NOT import the root internal/adapters implementation
// package — that direction is machine-gated by scripts/verify.
//
// Contract types are single-SSOT in internal/orchestration; this file keeps
// package-local aliases so the moved implementation files reference the
// contract vocabulary without qualification (aliases are not definitions).
package orchestrator

import "github.com/agenthub/edge-server/internal/orchestration"

// ── Contract aliases (single SSOT: internal/orchestration) ─────────────────

type PlanTask = orchestration.PlanTask
type PlanApprovalConfig = orchestration.PlanApprovalConfig
type PendingPlan = orchestration.PendingPlan
type PlanDecision = orchestration.PlanDecision

type AgentAdapter = orchestration.AgentAdapter
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
	BusEventTextDelta           = orchestration.BusEventTextDelta
	BusEventTextBlock           = orchestration.BusEventTextBlock
	BusEventThinking            = orchestration.BusEventThinking
	BusEventToolCall            = orchestration.BusEventToolCall
	BusEventToolResult          = orchestration.BusEventToolResult
	BusEventFileChange          = orchestration.BusEventFileChange
	BusEventRouteDecision       = orchestration.BusEventRouteDecision
	BusEventSessionInit         = orchestration.BusEventSessionInit
	BusEventResult              = orchestration.BusEventResult
	BusEventCompactBoundary     = orchestration.BusEventCompactBoundary
	BusEventStatusChange        = orchestration.BusEventStatusChange
	BusEventAPIRetry            = orchestration.BusEventAPIRetry
	BusEventTaskStarted         = orchestration.BusEventTaskStarted
	BusEventTaskDispatched      = orchestration.BusEventTaskDispatched
	BusEventTaskProgress        = orchestration.BusEventTaskProgress
	BusEventTaskNotification    = orchestration.BusEventTaskNotification
	BusEventSubAgentStatus      = orchestration.BusEventSubAgentStatus
	BusEventSessionStateChanged = orchestration.BusEventSessionStateChanged
	BusEventHookStarted         = orchestration.BusEventHookStarted
	BusEventHookProgress        = orchestration.BusEventHookProgress
	BusEventHookResponse        = orchestration.BusEventHookResponse
	BusEventToolUseSummary      = orchestration.BusEventToolUseSummary
	BusEventAuthStatus          = orchestration.BusEventAuthStatus
	BusEventRateLimit           = orchestration.BusEventRateLimit
	BusEventCLIInvocationPlan   = orchestration.BusEventCLIInvocationPlan
	BusEventMCPToolCall         = orchestration.BusEventMCPToolCall
	BusEventPermissionRequested = orchestration.BusEventPermissionRequested
	BusEventPermissionDecided   = orchestration.BusEventPermissionDecided
	BusEventSessionMetrics      = orchestration.BusEventSessionMetrics
	BusEventContextUsage        = orchestration.BusEventContextUsage
	BusEventContextWarning      = orchestration.BusEventContextWarning
	BusEventContextCompaction   = orchestration.BusEventContextCompaction
	BusEventPlanProposed        = orchestration.BusEventPlanProposed
	BusEventPlanApproved        = orchestration.BusEventPlanApproved
	BusEventPlanRejected        = orchestration.BusEventPlanRejected
	BusEventPlanExpired         = orchestration.BusEventPlanExpired
	BusEventToolRejected        = orchestration.BusEventToolRejected
)
