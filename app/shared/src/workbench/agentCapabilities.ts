import type { AgentConfig } from './pages/AgentsPage';

export type AgentCapabilityStatus = 'enabled' | 'disabled' | 'missing';

export type AgentMemoryRetention =
  | 'thread-only'
  | 'project-policy'
  | 'no-persist-fixture'
  | 'ephemeral-fixture'
  | 'session'
  | 'persistent'
  | 'disabled'
  | string;

export interface AgentMemoryPolicy {
  sources: string[];
  retention: AgentMemoryRetention;
  summary?: string | undefined;
  disabled?: boolean | undefined;
}

export interface AgentCapabilityRef {
  id: string;
  label?: string | undefined;
  status: AgentCapabilityStatus;
  reason?: string | undefined;
}

export interface AgentCapabilityContract {
  agentsMd: AgentCapabilityRef;
  avatar: AgentCapabilityRef;
  memoryPolicy: AgentMemoryPolicy;
  mcpServers: AgentCapabilityRef[];
  skills: AgentCapabilityRef[];
  toolAllowlist: string[];
}

export interface AgentCapabilitySummary {
  agentsMd: string;
  avatar: string;
  memory: string;
  mcp: string;
  skills: string;
  tools: string;
  readiness: 'ready' | 'partial' | 'blocked';
  issues: string[];
}

export function buildAgentCapabilityContractFromConfig(agent: AgentConfig): AgentCapabilityContract {
  const memorySources = agent.memorySources ?? [];
  const toolAllowlist = agent.toolAllowlist ?? Object.keys(agent.tools);

  return {
    agentsMd: {
      id: 'agents-md',
      label: 'AGENTS.md',
      status: memorySources.includes('agents-md') ? 'enabled' : 'missing',
      ...(!memorySources.includes('agents-md') ? { reason: 'not declared in memory sources' } : {}),
    },
    avatar: {
      id: agent.avatarRef ?? `agenthub:avatar/${agent.id}`,
      label: agent.avatarRef ? 'Avatar ref' : 'Generated avatar ref',
      status: agent.avatarRef ? 'enabled' : 'missing',
      ...(!agent.avatarRef ? { reason: 'using generated initials only' } : {}),
    },
    memoryPolicy: {
      sources: memorySources,
      retention: agent.memoryRetention ?? 'disabled',
      summary: agent.memorySummary,
      disabled: memorySources.length === 0 || agent.memoryRetention === 'disabled',
    },
    mcpServers: (agent.mcpServers ?? []).map((id) => capabilityRef(id)),
    skills: agent.skills.map((id) => capabilityRef(id)),
    toolAllowlist,
  };
}

export function buildAgentCapabilitySummary(contract: AgentCapabilityContract): AgentCapabilitySummary {
  const issues = [
    ...capabilityIssues('agents-md', [contract.agentsMd]),
    ...capabilityIssues('avatar', [contract.avatar]),
    ...(isMemoryDisabled(contract.memoryPolicy) ? ['memory:disabled'] : []),
    ...capabilityIssues('mcp', contract.mcpServers),
    ...capabilityIssues('skill', contract.skills),
    ...(contract.toolAllowlist.length === 0 ? ['tools:empty'] : []),
  ];

  return {
    agentsMd: contract.agentsMd.status === 'enabled' ? 'AGENTS.md enabled' : 'AGENTS.md missing',
    avatar: contract.avatar.status === 'enabled' ? contract.avatar.id : 'Generated initials only',
    memory: isMemoryDisabled(contract.memoryPolicy)
      ? 'Memory disabled'
      : contract.memoryPolicy.summary || `${contract.memoryPolicy.sources.length} memory sources`,
    mcp: countEnabled(contract.mcpServers, 'MCP'),
    skills: countEnabled(contract.skills, 'skills'),
    tools: contract.toolAllowlist.length === 0 ? 'No tools allowed' : `${contract.toolAllowlist.length} tools allowed`,
    readiness: readinessFromIssues(issues),
    issues,
  };
}

export function validateAgentCapabilityContract(contract: AgentCapabilityContract): { valid: boolean; issues: string[] } {
  const summary = buildAgentCapabilitySummary(contract);
  return {
    valid: summary.readiness === 'ready',
    issues: summary.issues,
  };
}

function capabilityRef(id: string): AgentCapabilityRef {
  const normalized = id.trim();
  return {
    id: normalized,
    label: normalized,
    status: normalized ? 'enabled' : 'missing',
  };
}

function isMemoryDisabled(memoryPolicy: AgentMemoryPolicy): boolean {
  return memoryPolicy.disabled === true
    || memoryPolicy.retention === 'disabled'
    || memoryPolicy.sources.length === 0;
}

function countEnabled(refs: AgentCapabilityRef[], label: string): string {
  const enabled = refs.filter((item) => item.status === 'enabled').length;
  return `${enabled}/${refs.length} ${label} enabled`;
}

function capabilityIssues(prefix: string, refs: AgentCapabilityRef[]): string[] {
  return refs
    .filter((item) => item.status !== 'enabled')
    .map((item) => `${prefix}:${item.id}`);
}

function readinessFromIssues(issues: string[]): AgentCapabilitySummary['readiness'] {
  if (issues.some((issue) => issue.startsWith('mcp:') || issue.startsWith('skill:'))) {
    return 'blocked';
  }
  return issues.length === 0 ? 'ready' : 'partial';
}
