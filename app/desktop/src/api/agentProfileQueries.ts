// React Query hooks for Edge Agent Profiles — CRUD operations.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AgentConfig } from '@shared/workbench';
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
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (agent: AgentConfig) =>
      createAgentProfile(agentConfigToEdgeProfile(agent)),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['agent-profiles'] });
    },
  });
}

export function useUpdateAgentProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, agent }: { id: string; agent: AgentConfig }) =>
      updateAgentProfile(id, agentConfigToEdgePatch(agent)),
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
function agentConfigToEdgeProfile(agent: AgentConfig): Record<string, unknown> {
  const modelParts = (agent.model ?? '').split('/').map((s) => s.trim()).filter(Boolean);
  const allowedTools = Object.entries(agent.tools ?? {})
    .filter(([, v]) => v === '允许')
    .map(([tool]) => tool)
    .filter(Boolean);
  const result: Record<string, unknown> = {
    name: agent.name.trim() || '未命名 Agent',
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
function agentConfigToEdgePatch(agent: AgentConfig): Partial<EdgeAgentProfile> {
  const profile = agentConfigToEdgeProfile(agent);
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
