// React Query hooks for Edge Agent Profiles — CRUD operations.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { AgentConfig } from '@agenthub/workbench';
import {
  fetchAgentProfiles,
  createAgentProfile,
  updateAgentProfile,
  deleteAgentProfile,
  type EdgeAgentProfile,
} from './edgeClient';
import type { ListResponse } from '@shared/types';

export { type EdgeAgentProfile } from './edgeClient';

export function useAgentProfileList(enabled: boolean) {
  return useQuery<ListResponse<EdgeAgentProfile>>({
    queryKey: ['agent-profiles'],
    queryFn: () => fetchAgentProfiles(),
    refetchInterval: 10_000,
    enabled,
    placeholderData: (prev) => prev,
  });
}

export function useCreateAgentProfile() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (agent: AgentConfig) =>
      createAgentProfile(agentConfigToEdgeProfile(agent, t)),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['agent-profiles'] });
    },
  });
}

export function useUpdateAgentProfile() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, agent }: { id: string; agent: AgentConfig }) =>
      updateAgentProfile(id, agentConfigToEdgePatch(agent, t)),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['agent-profiles'] });
    },
  });
}

export function useDeleteAgentProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteAgentProfile(id),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['agent-profiles'] });
    },
  });
}

/** Map AgentConfig (from AgentsPage edit panel) to Edge creation payload. */
type AppTranslate = (key: string, options?: any) => string;

function agentConfigToEdgeProfile(agent: AgentConfig, t?: AppTranslate): Record<string, unknown> {
  const modelParts = (agent.model ?? '').split('/').map((s) => s.trim()).filter(Boolean);
  const allowedTools = Object.entries(agent.tools ?? {})
    .filter(([, v]) => v === '允许')
    .map(([tool]) => tool)
    .filter(Boolean);
  const result: Record<string, unknown> = {
    name: agent.name.trim() || t?.('agentProfile.unnamed') || '未命名 Agent',
    adapterId: agent.runtimeId ?? agent.engine ?? 'codex',
  };
  if (agent.role?.trim()) result.description = agent.role.trim();
  if (modelParts.length >= 2) {
    result.provider = modelParts[0];
    result.model = modelParts.slice(1).join('/');
  } else if (agent.model) {
    result.model = agent.model;
  }
  const reasoning = extractReasoningEffort(agent.mode);
  if (reasoning) result.reasoningEffort = reasoning;
  if (agent.scope) result.permissionMode = agent.scope;
  if (allowedTools.length > 0) result.allowedTools = allowedTools;
  if (agent.skills?.length) result.skills = agent.skills;
  if (agent.avatarRef) result.avatarRef = agent.avatarRef;
  return result;
}

/** Map AgentConfig to a partial update payload. */
function agentConfigToEdgePatch(agent: AgentConfig, t?: AppTranslate): Partial<EdgeAgentProfile> {
  const profile = agentConfigToEdgeProfile(agent, t);
  // Remove undefined values — PATCH should only include changed fields
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(profile)) {
    if (value !== undefined) {
      patch[key] = value;
    }
  }
  return patch as Partial<EdgeAgentProfile>;
}

/** Extract reasoning effort from AgentConfig.mode like "Reasoning medium". */
function extractReasoningEffort(mode: string): string | undefined {
  const match = /^Reasoning\s+(.+)$/i.exec(mode.trim());
  return match?.[1]?.trim() || undefined;
}

/** Map Edge AgentProfile to a WorkbenchAgent for the shared workbench. */
export function edgeAgentProfileToWorkbenchAgent(profile: EdgeAgentProfile): import('@shared/platform').WorkbenchAgent {
  const modelHint = [profile.provider, profile.model].filter(Boolean).join('/');
  return {
    id: profile.id,
    name: profile.name,
    description: profile.description,
    status: 'available',
    model: modelHint || undefined,
    runtimeId: profile.adapterId,
    provider: profile.provider || undefined,
    reasoningEffort: profile.reasoningEffort || undefined,
    approvalPolicy: undefined,
    permissionMode: profile.permissionMode || undefined,
    skills: profile.skills,
    mcpServers: undefined,
    toolAllowlist: profile.allowedTools,
    avatarRef: profile.avatarRef || undefined,
  };
}

// ── Hub Agent Profiles (fallback when Edge is offline) ──────────

import { createHubClient } from '@/api/hubClient';
import { getAccessToken } from '@/hooks/useAuth';
import type { AgentProfile as HubAgentProfile } from '@/api/hubClient';

let _hubClient: ReturnType<typeof createHubClient> | null = null;
function getHubClient() {
  if (!_hubClient) _hubClient = createHubClient({ getToken: getAccessToken });
  return _hubClient;
}

export function useHubAgentProfiles(opts?: { enabled?: boolean }) {
  return useQuery<HubAgentProfile[]>({
    queryKey: ['hub', 'agent-profiles'],
    queryFn: async () => {
      const res = await getHubClient().listAgentProfiles();
      return res.items ?? [];
    },
    enabled: opts?.enabled ?? false,
  });
}




/** Safely parse a JSON string field from Hub, returning undefined on failure. */
function safeJsonParse<T>(value: string | undefined | null): T | undefined {
  if (!value) return undefined;
  try { return JSON.parse(value) as T; } catch { return undefined; }
}

/** Map Hub AgentProfile to a WorkbenchAgent for the shared workbench. */
export function hubAgentProfileToWorkbenchAgent(profile: HubAgentProfile): import('@shared/platform').WorkbenchAgent {
  const modelHint = [profile.provider, profile.model].filter(Boolean).join('/');
  return {
    id: profile.id,
    name: profile.name,
    description: profile.description,
    status: 'available',
    model: modelHint || undefined,
    runtimeId: profile.runtime_id,
    provider: profile.provider || undefined,
    reasoningEffort: profile.reasoning_effort || undefined,
    approvalPolicy: profile.approval_policy || undefined,
    permissionMode: profile.permission_mode || undefined,
    skills: safeJsonParse<string[]>(profile.skills),
    mcpServers: safeJsonParse<string[]>(profile.mcp_servers),
    toolAllowlist: safeJsonParse<string[]>(profile.tool_allowlist),
    avatarRef: undefined,
  };
}
