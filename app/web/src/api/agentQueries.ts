import { useQuery } from '@tanstack/react-query';
import { createHubClient } from './hubClient';
import type { AgentProfile } from './hubClient';
import { getAccessToken } from '@/hooks/useAuth';
import { useHubStore } from '@/stores/hubStore';
import type { AgentCapabilities, AgentInfo, ListResponse } from '@shared/types';

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
    ...(profile.permission_mode ? { permissionMode: profile.permission_mode } : {}),
    ...(toolAllowlist ? { toolAllowlist } : {}),
    ...(targetPreferences ? { targetPreferences } : {}),
    ...(descriptionParts.length > 0 ? { description: descriptionParts.join(' - ') } : {}),
    ...(profile.version != null ? { version: String(profile.version) } : {}),
    status: runtimeID ? 'available' : 'configuring',
    capabilities: capabilitiesForProfile(profile),
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
