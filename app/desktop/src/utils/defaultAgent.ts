import type { AgentInfo } from '@shared/types';

export const DEFAULT_AGENT_AUTO = 'auto';

export function normalizeDefaultAgentValue(value: string | null | undefined): string {
  const normalized = value?.trim();
  if (!normalized || normalized.toLowerCase() === DEFAULT_AGENT_AUTO) {
    return DEFAULT_AGENT_AUTO;
  }
  return normalized;
}

export function buildDefaultAgentOptions(
  agents: AgentInfo[],
  autoLabel: string,
): Array<[string, string]> {
  const availableAgents = agents.filter((agent) => agent.status === 'available');
  const labels = availableAgents.map((agent) => (agent.name || agent.id).trim() || agent.id);
  const labelCounts = labels.reduce((counts, label) => {
    counts.set(label, (counts.get(label) ?? 0) + 1);
    return counts;
  }, new Map<string, number>());

  const options: Array<[string, string]> = [[DEFAULT_AGENT_AUTO, autoLabel]];
  availableAgents.forEach((agent, index) => {
    const label = labels[index] ?? agent.id;
    const displayLabel = (labelCounts.get(label) ?? 0) > 1 ? `${label} (${agent.id})` : label;
    options.push([agent.id, displayLabel]);
  });

  return options;
}

export function resolveAvailableDefaultAgentId(
  value: string | null | undefined,
  agents: AgentInfo[],
): string | null {
  const normalized = normalizeDefaultAgentValue(value);
  if (normalized === DEFAULT_AGENT_AUTO) return null;
  return agents.some((agent) => agent.id === normalized && agent.status === 'available')
    ? normalized
    : null;
}
