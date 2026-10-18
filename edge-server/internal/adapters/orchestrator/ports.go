package orchestrator

import "github.com/agenthub/edge-server/internal/orchestration"

// ── 最小 ports ─────────────────────────────────────────
//
// 叶子实现只依赖合同（internal/orchestration）与以下窄 ports。具体实现由
// composition root（cmd/agenthub-edge、internal/httpserver、internal/api）
// 注入，叶子不反向依赖根 internal/adapters 实现包。
//
// 端口清单：
//   - AgentExecutor     — Agent execution（当前由 ClaudeCodeAdapter 实现）
//   - EventEmitter      — Event emission（合同接口，orchestration.EventEmitter）
//   - PlanApprovalBroker— Plan approval（本包 concretes，plan_approval.go）
//   - SubAgentSpawner   — Sub-agent spawning（合同接口，orchestration.SubAgentSpawner）

// AgentExecutor is the narrow agent-execution port the orchestrator needs
// from the underlying CLI adapter (currently ClaudeCodeAdapter). It aliases the
// canonical contract so the leaf depends on one method surface.
type AgentExecutor = orchestration.AgentAdapter
