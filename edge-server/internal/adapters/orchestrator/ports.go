package orchestrator

import (
	"context"
	"io"

	"github.com/agenthub/edge-server/internal/orchestration"
	"github.com/agenthub/edge-server/internal/store"
)

// ── 最小 ports（A-V1 Step 2, #1566）──────────────────────────────────────────
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
//   - AdapterRegistry   — Adapter lookup / registry view（由根 adapters.Registry 实现）

// AgentExecutor is the narrow agent-execution port the orchestrator needs
// from the underlying CLI adapter (currently ClaudeCodeAdapter). Keeping the
// port here lets the leaf depend on the shape, not the concrete adapter.
type AgentExecutor interface {
	Metadata() orchestration.AdapterMetadata
	Capabilities() orchestration.AgentCapabilities
	BuildCommand(ctx orchestration.RunProcessContext) (cmdPath string, args []string, env []string, workDir string)
	ParseStream(ctx context.Context, stdout io.Reader, stdin io.Writer, emitter orchestration.EventEmitter, run store.Run) error
	NeedsStdin() bool
	Available() bool
}

// AdapterRegistry is the adapter-lookup port: enough of the root Registry
// view for agent-name validation (O-01) and alternate-agent discovery.
// The composition root injects the concrete *adapters.Registry.
type AdapterRegistry interface {
	Get(id string) (orchestration.AgentAdapter, bool)
	ListIDs() []string
}
