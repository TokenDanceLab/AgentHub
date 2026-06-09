export const AGENTHUB_AGENT_SPEC_V1 = 'agenthub.agent_spec.v1' as const;

export interface AgentHubAgentSpecAvatarV1 {
  type: 'emoji' | 'icon';
  value: string;
}

export interface AgentHubAgentSpecRuntimeV1 {
  id: string;
  profile: string;
  provider: string;
  model: string;
  reasoning_effort?: string;
  temperature?: number;
  max_output_tokens?: number;
}

export interface AgentHubAgentSpecMCPServerV1 {
  id: string;
  transport: 'stdio' | 'http' | 'sse' | string;
  command?: string;
  url?: string;
}

export interface AgentHubAgentSpecMemoryPolicyV1 {
  mode: 'none' | 'project' | 'workspace' | string;
  retention: 'ephemeral-fixture' | 'session' | 'persistent' | string;
}

export interface AgentHubAgentSpecApprovalPolicyV1 {
  mode: string;
  require_approval_for?: string[];
}

export interface AgentHubAgentSpecTargetPreferenceV1 {
  mode: 'local-edge' | 'remote-edge' | 'hub-relay' | string;
  target_id?: string;
  health?: string;
}

export interface AgentHubAgentSpecFixturePolicyV1 {
  mode: 'fixture-only';
  no_spend: true;
  live_runtime_allowed: false;
}

export interface AgentHubAgentSpecV1 {
  schema_version: typeof AGENTHUB_AGENT_SPEC_V1;
  id: string;
  name: string;
  description: string;
  avatar: AgentHubAgentSpecAvatarV1;
  runtime: AgentHubAgentSpecRuntimeV1;
  skills: string[];
  mcp_servers: AgentHubAgentSpecMCPServerV1[];
  tool_allowlist: string[];
  memory_policy: AgentHubAgentSpecMemoryPolicyV1;
  approval_policy: AgentHubAgentSpecApprovalPolicyV1;
  target_preference: AgentHubAgentSpecTargetPreferenceV1;
  fixture: AgentHubAgentSpecFixturePolicyV1;
}

export interface AgentHubAgentSpecDraftV1 {
  id?: string;
  name: string;
  description?: string;
  avatar?: AgentHubAgentSpecAvatarV1;
  emoji?: string;
  runtimeId?: string;
  runtimeProfile: string;
  provider: string;
  model: string;
  reasoningEffort?: string;
  temperature?: number;
  maxOutputTokens?: number;
  skills?: string[];
  mcpServers?: AgentHubAgentSpecMCPServerV1[];
  toolAllowlist: string[];
  memoryPolicy?: AgentHubAgentSpecMemoryPolicyV1;
  approvalPolicy: {
    mode: string;
    requireApprovalFor?: string[];
  };
  targetPreference: {
    mode: string;
    targetId?: string;
    health?: string;
  };
}

export function buildAgentHubAgentSpecV1(draft: AgentHubAgentSpecDraftV1): AgentHubAgentSpecV1 {
  const name = draft.name.trim();
  const id = (draft.id ?? slugifyAgentSpecId(name)).trim();
  const runtimeId = firstNonEmpty(draft.runtimeId ?? '', normalizeRuntimeId(draft.runtimeProfile), 'custom-runtime');

  return {
    schema_version: AGENTHUB_AGENT_SPEC_V1,
    id,
    name,
    description: draft.description?.trim() ?? '',
    avatar: draft.avatar ?? { type: 'emoji', value: draft.emoji ?? 'A' },
    runtime: {
      id: runtimeId,
      profile: draft.runtimeProfile,
      provider: draft.provider,
      model: draft.model,
      ...(draft.reasoningEffort ? { reasoning_effort: draft.reasoningEffort } : {}),
      ...(typeof draft.temperature === 'number' ? { temperature: draft.temperature } : {}),
      ...(typeof draft.maxOutputTokens === 'number' ? { max_output_tokens: draft.maxOutputTokens } : {}),
    },
    skills: dedupeStrings(draft.skills ?? []),
    mcp_servers: draft.mcpServers ?? [],
    tool_allowlist: dedupeStrings(draft.toolAllowlist),
    memory_policy: draft.memoryPolicy ?? { mode: 'project', retention: 'ephemeral-fixture' },
    approval_policy: {
      mode: draft.approvalPolicy.mode,
      ...(draft.approvalPolicy.requireApprovalFor ? { require_approval_for: dedupeStrings(draft.approvalPolicy.requireApprovalFor) } : {}),
    },
    target_preference: {
      mode: draft.targetPreference.mode,
      ...(draft.targetPreference.targetId ? { target_id: draft.targetPreference.targetId } : {}),
      ...(draft.targetPreference.health ? { health: draft.targetPreference.health } : {}),
    },
    fixture: {
      mode: 'fixture-only',
      no_spend: true,
      live_runtime_allowed: false,
    },
  };
}

export function formatAgentHubAgentSpecV1(spec: AgentHubAgentSpecV1): string {
  return JSON.stringify(spec, null, 2);
}

function slugifyAgentSpecId(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') || 'agenthub-agent-spec-fixture';
}

function normalizeRuntimeId(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') || '';
}

function firstNonEmpty(...values: string[]): string {
  return values.find((value) => value.trim().length > 0) ?? '';
}

function dedupeStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}
