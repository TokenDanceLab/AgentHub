import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createHubClient } from './hubClient';
import type { AgentProfile, CreateAgentProfileRequest, UpdateAgentProfileRequest } from './hubClient';
import { getAccessToken } from '@/hooks/useAuth';
import { useHubStore } from '@/stores/hubStore';
import type { AgentCapabilities, AgentInfo, ListResponse } from '@shared/types';
import type { AgentConfig } from '@shared/workbench';

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
  if (trimmed === 'Hub AgentProfile' || trimmed === 'Hub owner scope') return undefined;
  const withoutRuntimeHints = trimmed
    .replace(/\s+-\s+Runtime:\s*[^-]+(?=\s+-\s+Model:|$)/i, '')
    .replace(/\s+-\s+Model:\s*.+$/i, '')
    .trim();
  if (!withoutRuntimeHints || withoutRuntimeHints === 'Hub AgentProfile' || withoutRuntimeHints === 'Hub owner scope') {
    return undefined;
  }
  return withoutRuntimeHints;
}

function jsonStringArray(values: string[] | undefined): string | undefined {
  if (!values || values.length === 0) return undefined;
  const normalized = Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
  return normalized.length > 0 ? JSON.stringify(normalized) : undefined;
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
  const modelHint = [profile.provider, profile.model].filter(Boolean).join('/');
  const skills = parseStringArray(profile.skills);
  const toolAllowlist = parseStringArray(profile.tool_allowlist);
  const targetPreferences = parseJSONObject(profile.target_preferences);
  const descriptionParts = [
    profile.description?.trim(),
    runtimeID ? `Runtime: ${runtimeID}` : undefined,
    modelHint ? `Model: ${modelHint}` : undefined,
  ].filter(Boolean);

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
    ...(toolAllowlist ? { toolAllowlist } : {}),
    ...(targetPreferences ? { targetPreferences } : {}),
    ...(descriptionParts.length > 0 ? { description: descriptionParts.join(' - ') } : {}),
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
  const toolAllowlist = jsonStringArray(
    Object.entries(agent.tools)
      .filter(([, value]) => value === '允许')
      .map(([tool]) => tool),
  );
  return {
    name: agent.name.trim() || '未命名 Agent',
    ...(description ? { description } : {}),
    runtime_id: normalizeRuntimeInput(agent.engine),
    ...model,
    ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
    permission_mode: normalizePermissionMode(agent.scope),
    ...(skills ? { skills } : {}),
    ...(toolAllowlist ? { tool_allowlist: toolAllowlist } : {}),
  };
}

export function agentConfigToUpdateAgentProfileRequest(agent: AgentConfig): UpdateAgentProfileRequest {
  const model = splitModelLabel(agent.model);
  const description = persistableAgentDescription(agent.role);
  const runtimeID = optionalRuntimeInput(agent.engine);
  const permissionMode = optionalPermissionMode(agent.scope);
  const reasoningEffort = reasoningEffortFromMode(agent.mode);
  const skills = jsonStringArray(agent.skills);
  const toolAllowlist = jsonStringArray(
    Object.entries(agent.tools)
      .filter(([, value]) => value === '允许')
      .map(([tool]) => tool),
  );
  return {
    name: agent.name.trim() || '未命名 Agent',
    ...(description ? { description } : {}),
    ...(runtimeID ? { runtime_id: runtimeID } : {}),
    ...model,
    ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
    ...(permissionMode ? { permission_mode: permissionMode } : {}),
    ...(skills ? { skills } : {}),
    ...(toolAllowlist ? { tool_allowlist: toolAllowlist } : {}),
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
    queryKey: ['agents', hubAuthenticated ? 'hub' : 'preview'],
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
      queryClient.invalidateQueries({ queryKey: ['agents'] });
    },
  });
}

export function useUpdateAgentProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ agent }: { agent: AgentConfig }) =>
      hubClient.updateAgentProfile(agent.id, agentConfigToUpdateAgentProfileRequest(agent)),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] });
    },
  });
}

export function useDeleteAgentProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (agentId: string) => hubClient.deleteAgentProfile(agentId),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] });
    },
  });
}
