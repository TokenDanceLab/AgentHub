import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createHubClient } from './hubClient';
import type { AgentProfile, CreateAgentProfileRequest, UpdateAgentProfileRequest } from './hubClient';
import { getAccessToken } from '@/hooks/useAuth';
import { useHubStore } from '@/stores/hubStore';
import { hubQueryKeys } from '@shared/stores/queryKeys';
import type { AgentCapabilities, AgentInfo, ListResponse } from '@shared/types';
import type { AgentConfig } from '@agenthub/workbench';

const hubClient = createHubClient({ getToken: getAccessToken });

const defaultCapabilities: AgentCapabilities = {
  streaming: true,
  toolCalls: true,
  fileChanges: true,
  thinkingVisible: true,
  multiTurn: true,
  mcpIntegration: false,
  permissionHooks: true,
  subAgentSpawn: false,
};

const runtimeCapabilities: Record<string, Partial<AgentCapabilities>> = {
  'claude-code': {
    mcpIntegration: true,
    subAgentSpawn: true,
  },
  codex: {
    mcpIntegration: true,
  },
  opencode: {
    mcpIntegration: true,
  },
};

function parseJSONArray(value: string | undefined): unknown[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseJSONObject(value: string | undefined): Record<string, unknown> | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

function parseStringArray(value: string | undefined): string[] | undefined {
  const parsed = parseJSONArray(value).filter((item): item is string => typeof item === 'string' && item.trim() !== '');
  return parsed.length > 0 ? parsed : undefined;
}

function parseIDArray(value: string | undefined): string[] | undefined {
  const parsed = parseJSONArray(value)
    .map((item) => {
      if (typeof item === 'string') return item.trim();
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        const id = (item as Record<string, unknown>).id
          ?? (item as Record<string, unknown>).serverId
          ?? (item as Record<string, unknown>).name;
        return typeof id === 'string' ? id.trim() : '';
      }
      return '';
    })
    .filter(Boolean);
  return parsed.length > 0 ? Array.from(new Set(parsed)) : undefined;
}

function normalizeRuntimeID(runtimeID: string | undefined): string {
  return (runtimeID || '').trim().toLowerCase();
}

function normalizeRuntimeInput(value: string | undefined): string {
  const normalized = normalizeRuntimeID(value).replace(/\s+/g, '-');
  if (normalized === 'claude-code' || normalized === 'codex' || normalized === 'opencode') {
    return normalized;
  }
  return 'codex';
}

function optionalRuntimeInput(value: string | undefined): string | undefined {
  const normalized = normalizeRuntimeID(value).replace(/\s+/g, '-');
  return normalized === 'claude-code' || normalized === 'codex' || normalized === 'opencode'
    ? normalized
    : undefined;
}

function normalizePermissionMode(value: string | undefined): string {
  const normalized = value?.trim();
  if (normalized === 'default' || normalized === 'readonly' || normalized === 'restricted' || normalized === 'trusted') {
    return normalized;
  }
  return 'default';
}

function optionalPermissionMode(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized === 'default' || normalized === 'readonly' || normalized === 'restricted' || normalized === 'trusted'
    ? normalized
    : undefined;
}

function splitModelLabel(value: string | undefined): { provider?: string; model?: string } {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === '未配置模型') return {};
  const parts = trimmed.split('/').map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const provider = parts[0];
    const model = parts.slice(1).join('/');
    return provider ? { provider, model } : { model };
  }
  return { model: trimmed };
}

function persistableAgentDescription(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  const placeholderRoles = new Set([
    'Hub AgentProfile',
    'Hub owner scope',
    'Hub 配置档案',
    'Hub 所有者范围',
  ]);
  if (placeholderRoles.has(trimmed)) return undefined;
  const withoutRuntimeHints = trimmed
    .replace(/\s+-\s+Runtime:\s*[^-]+(?=\s+-\s+Model:|$)/i, '')
    .replace(/\s+-\s+Model:\s*.+$/i, '')
    .replace(/\s*·\s*Runtime:\s*\S+/i, '')
    .trim();
  if (!withoutRuntimeHints || placeholderRoles.has(withoutRuntimeHints)) {
    return undefined;
  }
  return withoutRuntimeHints;
}

function jsonStringArray(values: string[] | undefined): string | undefined {
  if (!values || values.length === 0) return undefined;
  const normalized = Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
  return normalized.length > 0 ? JSON.stringify(normalized) : undefined;
}

function jsonStringObject(value: Record<string, unknown> | undefined): string | undefined {
  if (!value || Object.keys(value).length === 0) return undefined;
  return JSON.stringify(value);
}

function agentMCPServers(agent: AgentConfig): string | undefined {
  return jsonStringArray(agent.mcpServers);
}

function agentApprovalPolicy(agent: AgentConfig): string | undefined {
  const mode = (agent.approvalMode ?? agent.approval).trim();
  const riskRules = agent.approvalRiskRules ?? [];
  if (!mode || (mode === 'Hub 默认策略' && riskRules.length === 0)) return undefined;
  const policy = {
    mode: mode === 'Hub 默认策略' ? 'default' : mode,
    ...(riskRules.length ? { risk_rules: riskRules } : {}),
  };
  return jsonStringObject(policy);
}

function agentTargetPreferences(agent: AgentConfig): string | undefined {
  const preferences = agent.targetPreferences && agent.targetPreferences.length > 0
    ? agent.targetPreferences
    : agent.targetPreference
      ? [agent.targetPreference]
      : [];
  return jsonStringObject({
    ...(preferences.length > 0 ? { preferences, primary: preferences[0] } : {}),
    ...(agent.targetPreference ? { label: agent.targetPreference } : {}),
  });
}

function reasoningEffortFromMode(mode: string | undefined): string | undefined {
  const match = /^Reasoning\s+(.+)$/i.exec(mode?.trim() ?? '');
  return match?.[1]?.trim() || undefined;
}

function capabilitiesForProfile(profile: AgentProfile): AgentCapabilities {
  const runtimeID = normalizeRuntimeID(profile.runtime_id);
  const mcpServers = parseJSONArray(profile.mcp_servers);
  return {
    ...defaultCapabilities,
    ...(runtimeCapabilities[runtimeID] ?? {}),
    mcpIntegration: (runtimeCapabilities[runtimeID]?.mcpIntegration ?? false) || mcpServers.length > 0,
  };
}

export function mapHubAgentProfileToAgentInfo(profile: AgentProfile): AgentInfo {
  const runtimeID = normalizeRuntimeID(profile.runtime_id);
  const skills = parseStringArray(profile.skills);
  const mcpServers = parseIDArray(profile.mcp_servers);
  const toolAllowlist = parseStringArray(profile.tool_allowlist);
  const memoryPolicy = parseJSONObject(profile.memory_policy);
  const memorySources = Array.isArray(memoryPolicy?.sources)
    ? memoryPolicy.sources.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
    : undefined;
  const memoryRetention = typeof memoryPolicy?.retention === 'string' ? memoryPolicy.retention : undefined;
  const memorySummary = typeof memoryPolicy?.summary === 'string' ? memoryPolicy.summary : undefined;
  const targetPreferences = parseJSONObject(profile.target_preferences);
  // #1277: keep product description free of Runtime/Model engineering suffixes;
  // runtime/model already live on dedicated AgentInfo fields.
  const description = profile.description?.trim();

  return {
    id: profile.id,
    name: profile.name,
    profileId: profile.id,
    ...(runtimeID ? { runtimeId: runtimeID } : {}),
    ...(profile.model ? { model: profile.model } : {}),
    ...(profile.provider ? { provider: profile.provider } : {}),
    ...(profile.reasoning_effort ? { reasoningEffort: profile.reasoning_effort } : {}),
    ...(profile.approval_policy ? { approvalPolicy: profile.approval_policy } : {}),
    ...(profile.permission_mode ? { permissionMode: profile.permission_mode } : {}),
    ...(skills ? { skills } : {}),
    ...(mcpServers ? { mcpServers } : {}),
    ...(toolAllowlist ? { toolAllowlist } : {}),
    ...(memorySources ? { memorySources } : {}),
    ...(memoryRetention ? { memoryRetention } : {}),
    ...(memorySummary ? { memorySummary } : {}),
    ...(targetPreferences ? { targetPreferences } : {}),
    ...(description ? { description } : {}),
    ...(profile.version != null ? { version: String(profile.version) } : {}),
    status: runtimeID ? 'available' : 'configuring',
    capabilities: capabilitiesForProfile(profile),
  };
}

export function agentConfigToCreateAgentProfileRequest(agent: AgentConfig): CreateAgentProfileRequest {
  const model = splitModelLabel(agent.model);
  const description = persistableAgentDescription(agent.role);
  const reasoningEffort = reasoningEffortFromMode(agent.mode);
  const skills = jsonStringArray(agent.skills);
  const mcpServers = agentMCPServers(agent);
  const toolAllowlist = jsonStringArray(
    Object.entries(agent.tools)
      .filter(([, value]) => value === '允许')
      .map(([tool]) => tool),
  );
  const approvalPolicy = agentApprovalPolicy(agent);
  const targetPreferences = agentTargetPreferences(agent);
  return {
    name: agent.name.trim() || '未命名 Agent',
    ...(description ? { description } : {}),
    runtime_id: normalizeRuntimeInput(agent.engine),
    ...model,
    ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
    permission_mode: normalizePermissionMode(agent.scope),
    ...(skills ? { skills } : {}),
    ...(mcpServers ? { mcp_servers: mcpServers } : {}),
    ...(toolAllowlist ? { tool_allowlist: toolAllowlist } : {}),
    ...(approvalPolicy ? { approval_policy: approvalPolicy } : {}),
    ...(targetPreferences ? { target_preferences: targetPreferences } : {}),
  };
}

export function agentConfigToUpdateAgentProfileRequest(agent: AgentConfig): UpdateAgentProfileRequest {
  const model = splitModelLabel(agent.model);
  const description = persistableAgentDescription(agent.role);
  const runtimeID = optionalRuntimeInput(agent.engine);
  const permissionMode = optionalPermissionMode(agent.scope);
  const reasoningEffort = reasoningEffortFromMode(agent.mode);
  const skills = jsonStringArray(agent.skills);
  const mcpServers = agentMCPServers(agent);
  const toolAllowlist = jsonStringArray(
    Object.entries(agent.tools)
      .filter(([, value]) => value === '允许')
      .map(([tool]) => tool),
  );
  const approvalPolicy = agentApprovalPolicy(agent);
  const targetPreferences = agentTargetPreferences(agent);
  return {
    name: agent.name.trim() || '未命名 Agent',
    ...(description ? { description } : {}),
    ...(runtimeID ? { runtime_id: runtimeID } : {}),
    ...model,
    ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
    ...(permissionMode ? { permission_mode: permissionMode } : {}),
    ...(skills ? { skills } : {}),
    ...(mcpServers ? { mcp_servers: mcpServers } : {}),
    ...(toolAllowlist ? { tool_allowlist: toolAllowlist } : {}),
    ...(approvalPolicy ? { approval_policy: approvalPolicy } : {}),
    ...(targetPreferences ? { target_preferences: targetPreferences } : {}),
  };
}

export function createDefaultAgentProfileRequest(index: number): CreateAgentProfileRequest {
  return {
    name: `新 Agent ${index}`,
    runtime_id: 'codex',
    model: 'gpt-5-codex',
    provider: 'codex',
    reasoning_effort: 'medium',
    permission_mode: 'default',
    skills: '[]',
    tool_allowlist: '[]',
  };
}

async function fetchHubAgentProfiles(token: string): Promise<ListResponse<AgentInfo>> {
  const client = createHubClient({ getToken: () => token });
  const res = await client.listAgentProfiles({ pageSize: 50 });
  return {
    items: res.items.map(mapHubAgentProfileToAgentInfo),
    page: res.page,
  };
}

export async function fetchAgentList(preferHub: boolean): Promise<ListResponse<AgentInfo>> {
  const token = getAccessToken();
  if (preferHub && token) {
    return fetchHubAgentProfiles(token);
  }
  return { items: [], page: { hasMore: false } };
}

export function useAgentList(enabled: boolean) {
  const hubAuthenticated = useHubStore((s) => s.authenticated);

  return useQuery<ListResponse<AgentInfo>>({
    queryKey: hubQueryKeys.agents.list(hubAuthenticated ? 'hub' : 'signed-out'),
    queryFn: () => fetchAgentList(hubAuthenticated),
    refetchInterval: 10_000,
    enabled,
    placeholderData: (prev) => prev,
  });
}

export function useCreateAgentProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (agent: AgentConfig) =>
      hubClient.createAgentProfile(agentConfigToCreateAgentProfileRequest(agent)),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: hubQueryKeys.agents.root });
    },
  });
}

export function useUpdateAgentProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ agent }: { agent: AgentConfig }) =>
      hubClient.updateAgentProfile(agent.id, agentConfigToUpdateAgentProfileRequest(agent)),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: hubQueryKeys.agents.root });
    },
  });
}

export function useDeleteAgentProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (agentId: string) => hubClient.deleteAgentProfile(agentId),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: hubQueryKeys.agents.root });
    },
  });
}
