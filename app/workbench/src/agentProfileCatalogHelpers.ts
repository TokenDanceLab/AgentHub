import type {
  AgentConfig,
  MarketTemplate,
  ToolPermission,
} from './pages/AgentsPage';
import {
  buildAgentHubAgentSpecV1,
  type AgentHubAgentSpecDraftV1,
  type AgentHubAgentSpecMCPServerV1,
  type AgentHubAgentSpecMemoryPolicyV1,
  type AgentHubAgentSpecV1,
} from '@shared/agentSpec';
import type { AgentProfileCatalogItem } from './agentProfileCatalogTypes';

/* ═══════════════════════════════════════════════════════════════════════
   agentProfileCatalogHelpers — residual pure mappers from agentProfileCatalog
   (#652). Catalog/config/spec projections only; no React / no UX change.
   ═══════════════════════════════════════════════════════════════════════ */

export function agentProfileCatalogToConfig(item: AgentProfileCatalogItem): AgentConfig {
  return {
    id: item.id,
    name: item.name,
    role: item.role,
    engine: item.runtime.label,
    runtimeId: item.runtime.runtimeId,
    provider: item.runtime.provider,
    model: item.runtime.model,
    mode: item.configuration.mode,
    approval: item.configuration.approval.summary,
    approvalMode: item.configuration.approval.mode,
    approvalRiskRules: item.configuration.approval.riskRules,
    scope: item.configuration.scope,
    state: item.configuration.state,
    skills: item.configuration.skills,
    mcpServers: item.configuration.mcpServers,
    toolAllowlist: item.configuration.toolAllowlist,
    memorySources: item.configuration.memory.sources,
    memoryRetention: item.configuration.memory.retention,
    memorySummary: item.configuration.memory.summary,
    targetPreferences: item.configuration.targetPreferences,
    avatarRef: item.avatarRef,
    avatarColor: item.avatarColor,
    tools: toolPermissionsFromAllowlist(item.configuration.toolAllowlist),
  };
}

export function agentProfileCatalogToMarketTemplate(item: AgentProfileCatalogItem): MarketTemplate {
  return {
    name: item.name,
    description: item.description,
    category: item.category,
    detail: item.market.detail,
    runtime: item.runtime.label,
    runtimeId: item.runtime.runtimeId,
    provider: item.runtime.provider,
    model: item.runtime.model,
    avatarRef: item.avatarRef,
    avatarColor: item.avatarColor,
    skills: item.configuration.skills,
    mcpServers: item.configuration.mcpServers,
    toolAllowlist: item.configuration.toolAllowlist,
    memorySummary: item.configuration.memory.summary,
    approvalSummary: item.configuration.approval.summary,
    targetPreferences: item.configuration.targetPreferences,
  };
}

export function agentConfigToAgentSpecFixture(agent: AgentConfig): AgentHubAgentSpecV1 {
  return buildAgentHubAgentSpecV1({
    id: agent.id,
    name: agent.name,
    description: agent.role,
    avatar: { type: 'icon', value: agent.avatarRef ?? `agenthub:avatar/${agent.id}` },
    runtimeId: agent.runtimeId ?? normalizeSpecId(agent.engine),
    runtimeProfile: agent.engine,
    provider: agent.provider ?? 'fixture-provider',
    model: agent.model,
    skills: agent.skills,
    mcpServers: (agent.mcpServers ?? []).map(toMCPServerSpec),
    toolAllowlist: (agent.toolAllowlist ?? Object.keys(agent.tools)).map(toToolSpecId),
    memoryPolicy: toMemoryPolicySpec(agent),
    approvalPolicy: toApprovalPolicySpec(agent),
    targetPreference: toTargetPreferenceSpec(agent),
  });
}

export function toolPermissionsFromAllowlist(allowlist: string[]): Record<string, ToolPermission> {
  return Object.fromEntries(
    allowlist.map((tool) => [
      tool,
      '允许',
    ]),
  ) as Record<string, ToolPermission>;
}

export function uniqueSorted(items: string[]): string[] {
  // Code-unit order, not localeCompare: the demo-mode catalog assertions
  // (#1855) compare against a bare `.sort()` to stay locale-independent, and
  // localeCompare's collation flips mixed zh/en ordering per host locale
  // (zh hosts put CJK first, en hosts ASCII first) — the same input then
  // fails the assertion on zh hosts. A deterministic code-unit sort keeps
  // fixture and resolved lists identical on every host.
  return Array.from(new Set(items)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

export function toMCPServerSpec(id: string): AgentHubAgentSpecMCPServerV1 {
  return {
    id,
    transport: 'stdio',
    command: `mcp-server-${normalizeSpecId(id)}`,
  };
}

export function toMemoryPolicySpec(agent: AgentConfig): AgentHubAgentSpecMemoryPolicyV1 {
  const retention = agent.memoryRetention ?? 'no-persist-fixture';
  const hasMemory = (agent.memorySources ?? []).length > 0 && retention !== 'disabled';
  return {
    mode: hasMemory && retention === 'project-policy' ? 'project' : hasMemory ? 'workspace' : 'none',
    retention,
  };
}

export function toApprovalPolicySpec(agent: AgentConfig): AgentHubAgentSpecDraftV1['approvalPolicy'] {
  const requireApprovalFor = [
    ...Object.entries(agent.tools)
      .filter(([, permission]) => permission === '需确认')
      .map(([tool]) => toToolSpecId(tool)),
    ...(agent.approvalRiskRules ?? [])
      .filter((rule) => rule.decision === 'require-approval')
      .map((rule) => toToolSpecId(rule.match)),
  ];
  return {
    mode: agent.approvalMode ?? agent.approval,
    // exactOptionalPropertyTypes: only assign when non-empty
    ...(requireApprovalFor.length > 0 ? { requireApprovalFor: uniqueSorted(requireApprovalFor) } : {}),
  };
}

export function toTargetPreferenceSpec(agent: AgentConfig): AgentHubAgentSpecDraftV1['targetPreference'] {
  const [target] = agent.targetPreferences ?? [];
  return {
    mode: target ?? 'local-edge',
    health: agent.state === 'idle' || agent.state === 'waiting' ? 'fixture-pending' : 'fixture-ready',
  };
}

export function toToolSpecId(value: string): string {
  return normalizeSpecId(value);
}

export function normalizeSpecId(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'fixture';
}
