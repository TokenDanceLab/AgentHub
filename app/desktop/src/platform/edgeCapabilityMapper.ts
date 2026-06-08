import type { WorkbenchAgent } from '@shared/platform';
import type { AgentInfo } from '@shared/types';
import type { ModelCatalogResponse } from '@/api/edgeClient';

export interface EdgeRuntimeInventorySnapshot {
  edgeOnline: boolean;
  healthStatus?: string;
  runners: Array<{
    id: string;
    name?: string;
    status: string;
    capabilities?: string[];
  }>;
  agents: AgentInfo[];
  modelCatalog?: ModelCatalogResponse | undefined;
}

export interface DesktopExecutionTarget {
  id: 'local-edge';
  type: 'local_edge';
  name: 'Local Edge';
  status: 'healthy' | 'degraded' | 'offline' | 'unknown';
  route: 'local-edge-api';
  runnerCount: number;
  onlineRunnerCount: number;
  agentCount: number;
  modelCount: number;
  capabilityIds: string[];
}

export function mapEdgeAgentsToWorkbenchAgents(
  agents: AgentInfo[],
  modelCatalog?: ModelCatalogResponse,
): WorkbenchAgent[] {
  return agents.map((agent) => {
    const model = selectModelForAgent(agent, modelCatalog);
    return {
      id: agent.id,
      name: agent.name,
      ...(agent.description ? { description: agent.description } : {}),
      status: agent.status,
      runtimeId: agent.runtimeId ?? agent.id,
      ...(agent.provider ?? model?.provider ? { provider: agent.provider ?? model?.provider } : {}),
      ...(agent.model ?? model?.value ? { model: agent.model ?? model?.value } : {}),
      ...(agent.approvalPolicy ? { approvalPolicy: agent.approvalPolicy } : {}),
      ...(agent.permissionMode ? { permissionMode: agent.permissionMode } : {}),
      ...(agent.reasoningEffort ? { reasoningEffort: agent.reasoningEffort } : {}),
      skills: capabilityLabels(agent.capabilities),
      ...(agent.toolAllowlist ? { toolAllowlist: agent.toolAllowlist } : {}),
    };
  });
}

export function mapLocalEdgeExecutionTarget(snapshot: EdgeRuntimeInventorySnapshot): DesktopExecutionTarget {
  const onlineRunnerCount = snapshot.runners.filter((runner) => runner.status === 'online').length;
  return {
    id: 'local-edge',
    type: 'local_edge',
    name: 'Local Edge',
    status: normalizeLocalEdgeStatus(snapshot.edgeOnline, snapshot.healthStatus, onlineRunnerCount),
    route: 'local-edge-api',
    runnerCount: snapshot.runners.length,
    onlineRunnerCount,
    agentCount: snapshot.agents.length,
    modelCount: snapshot.modelCatalog?.items.length ?? 0,
    capabilityIds: Array.from(new Set([
      ...snapshot.runners.flatMap((runner) => runner.capabilities ?? []),
      ...snapshot.agents.flatMap((agent) => capabilityLabels(agent.capabilities)),
    ])).sort(),
  };
}

function selectModelForAgent(agent: AgentInfo, modelCatalog?: ModelCatalogResponse): ModelCatalogResponse['items'][number] | undefined {
  if (!modelCatalog?.items.length) return undefined;
  const runtimeId = agent.runtimeId ?? agent.id;
  const runtimeMatches = modelCatalog.items.filter((item) => (
    item.runtimeId === runtimeId ||
    item.sourceId === runtimeId ||
    (agent.provider && item.provider === agent.provider)
  ));
  return runtimeMatches.find((item) => item.default) ?? runtimeMatches[0] ?? modelCatalog.items.find((item) => item.default);
}

function capabilityLabels(capabilities: AgentInfo['capabilities']): string[] {
  const labels: string[] = [];
  if (capabilities.streaming) labels.push('streaming');
  if (capabilities.toolCalls) labels.push('tool-calls');
  if (capabilities.fileChanges) labels.push('file-changes');
  if (capabilities.thinkingVisible) labels.push('thinking-visible');
  if (capabilities.multiTurn) labels.push('multi-turn');
  if (capabilities.mcpIntegration) labels.push('mcp');
  if (capabilities.permissionHooks) labels.push('permission-hooks');
  if (capabilities.subAgentSpawn) labels.push('sub-agent-spawn');
  return labels;
}

function normalizeLocalEdgeStatus(
  edgeOnline: boolean,
  healthStatus: string | undefined,
  onlineRunnerCount: number,
): DesktopExecutionTarget['status'] {
  if (!edgeOnline) return 'offline';
  if (healthStatus === 'healthy' || healthStatus === 'ok') return 'healthy';
  if (healthStatus === 'degraded') return 'degraded';
  if (onlineRunnerCount > 0) return 'healthy';
  return 'unknown';
}
