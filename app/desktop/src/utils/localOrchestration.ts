import type { AgentInfo } from '@shared/types';

export interface LocalOrchestrationStatus {
  available: boolean;
  orchestratorId?: string;
  orchestratorName?: string;
  availableSubAgents: number;
  selected: boolean;
}

function isOrchestratorAgent(agent: AgentInfo): boolean {
  const id = agent.id.toLowerCase();
  const runtimeId = agent.runtimeId?.toLowerCase() ?? '';
  const name = agent.name.toLowerCase();
  return id === 'orchestrator' || runtimeId === 'orchestrator' || name.includes('orchestrator');
}

export function resolveLocalOrchestration(
  agents: AgentInfo[],
  selectedAgentId?: string,
): LocalOrchestrationStatus {
  const orchestrator =
    agents.find((agent) => isOrchestratorAgent(agent) && agent.status === 'available') ??
    agents.find(isOrchestratorAgent);

  const availableSubAgents = agents.filter((agent) => {
    if (orchestrator && agent.id === orchestrator.id) return false;
    return agent.status === 'available';
  }).length;

  return {
    available: Boolean(orchestrator && orchestrator.status === 'available'),
    orchestratorId: orchestrator?.id,
    orchestratorName: orchestrator?.name,
    availableSubAgents,
    selected: Boolean(orchestrator && selectedAgentId === orchestrator.id),
  };
}
