package httpserver

import (
	"github.com/agenthub/edge-server/internal/adapters"
	"github.com/agenthub/edge-server/internal/adapters/orchestrator"
	"github.com/agenthub/edge-server/internal/agents"
	"github.com/agenthub/edge-server/internal/lifecycle"
	"github.com/agenthub/edge-server/internal/runners"
)

func agentAdapterForRegistry(adapterReg *adapters.Registry, agentDefault string) adapters.AgentAdapter {
	if adapterReg == nil || agentDefault == "" {
		return nil
	}
	agentAdapter, ok := adapterReg.Get(agentDefault)
	if !ok {
		return nil
	}
	return agentAdapter
}

func configureLocalRunner(reg *runners.Registry, execCfg lifecycle.ProcessExecutorConfig, agentAdapter adapters.AgentAdapter, executor lifecycle.RunExecutor) {
	if reg == nil || executor == nil {
		return
	}
	if agentAdapter != nil {
		metadata := agentAdapter.Metadata()
		reg.Upsert(runners.RunnerInfo{
			ID:           "runner_local_1",
			Name:         metadata.Name + " Runner (local)",
			Status:       "online",
			Capabilities: runnerCapabilitiesForAdapter(metadata.ID, agentAdapter.Capabilities()),
		})
		return
	}
	if execCfg.Command != "" {
		reg.Upsert(runners.RunnerInfo{
			ID:           "runner_local_1",
			Name:         "Process Runner (local)",
			Status:       "online",
			Capabilities: []string{"process", "shell"},
		})
	}
}

func runnerCapabilitiesForAdapter(adapterID string, caps adapters.AgentCapabilities) []string {
	capabilities := []string{adapterID}
	if caps.Streaming {
		capabilities = append(capabilities, "streaming")
	}
	if caps.ToolCalls {
		capabilities = append(capabilities, "tool_calls")
	}
	if caps.FileChanges {
		capabilities = append(capabilities, "file_changes")
	}
	if caps.PermissionHooks {
		capabilities = append(capabilities, "permission_hooks")
	}
	if caps.ThinkingVisible {
		capabilities = append(capabilities, "thinking_visible")
	}
	if caps.MultiTurn {
		capabilities = append(capabilities, "multi_turn")
	}
	if caps.MCPIntegration {
		capabilities = append(capabilities, "mcp_integration")
	}
	if caps.SubAgentSpawn {
		capabilities = append(capabilities, "sub_agent_spawn")
	}
	return capabilities
}

// wireOrchestrator sets the SubAgentSpawner, AgentRegistry, MessageQueue, and
// PlanApprovalBroker on the orchestrator adapter so it can spawn sub-agent runs
// and gate them behind plan approval.
func wireOrchestrator(adapterReg *adapters.Registry, executor lifecycle.RunExecutor, agentReg *agents.Registry, msgQueue *agents.Queue, planBroker *orchestrator.PlanApprovalBroker) {
	if adapterReg == nil || executor == nil {
		return
	}
	orch, ok := adapterReg.Get("orchestrator")
	if !ok {
		return
	}
	orchAdapter, ok := orch.(*orchestrator.OrchestratorAdapter)
	if !ok {
		return
	}
	// Wire runtime dependencies into the orchestrator adapter.
	if spawner, ok := executor.(adapters.SubAgentSpawner); ok {
		orchAdapter.WithSpawner(spawner)
	}
	orchAdapter.WithAgentRegistry(agentReg)
	orchAdapter.WithMessageQueue(msgQueue)
	orchAdapter.WithPlanBroker(planBroker)
}
