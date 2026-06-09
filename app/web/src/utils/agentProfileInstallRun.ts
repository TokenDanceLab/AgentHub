import type {
  AgentProfile,
  ExecutionTarget,
  TriggerAgentTaskOptions,
} from '@/api/hubClient';
import type { AgentInfo } from '@shared/types';

export interface AgentProfileCatalogFixture {
  id: string;
  name: string;
  description: string;
  runtime_id: string;
  provider?: string;
  model?: string;
  reasoning_effort?: string;
  skills: string[];
  tool_allowlist: string[];
  approval_policy: string;
  permission_mode: string;
  icon: string;
}

export interface AgentProfileInstallTarget {
  id: string;
  name?: string;
  target_type?: ExecutionTarget['target_type'];
  workspace_root?: string;
}

export interface InstalledAgentProfileTaskRequestInput {
  agent: Pick<
    AgentInfo,
    | 'id'
    | 'name'
    | 'profileId'
    | 'runtimeId'
    | 'provider'
    | 'model'
    | 'reasoningEffort'
    | 'approvalPolicy'
    | 'permissionMode'
    | 'targetPreferences'
  >;
  triggerMessageId: string;
  agentInstanceId?: string;
}

export interface InstalledAgentProfileTaskCreateRequest extends TriggerAgentTaskOptions {
  trigger_message_id: string;
  agent_type: string;
  custom_agent_id: string;
  target_id: string;
  model_params: string;
}

export const AGENT_PROFILE_INSTALL_FIXTURE_CATALOG: AgentProfileCatalogFixture[] = [
  {
    id: 'fixture-spec-reviewer',
    name: 'Spec Reviewer',
    description: 'Reviews implementation plans, diffs, and acceptance evidence.',
    runtime_id: 'codex',
    provider: 'openai',
    model: 'gpt-5-codex',
    reasoning_effort: 'high',
    skills: ['Code Review', 'Diff Audit', 'Acceptance Evidence'],
    tool_allowlist: ['Read File', 'Git Diff'],
    approval_policy: 'on-request',
    permission_mode: 'workspace-write',
    icon: 'codex',
  },
  {
    id: 'fixture-browser-qa',
    name: 'Browser QA',
    description: 'Checks local web UI states with screenshots and DOM evidence.',
    runtime_id: 'claude-code',
    provider: 'anthropic',
    model: 'sonnet',
    reasoning_effort: 'medium',
    skills: ['Visual QA', 'Playwright', 'Evidence Capture'],
    tool_allowlist: ['Browser Screenshot', 'Read File'],
    approval_policy: 'ask-before-write',
    permission_mode: 'read-only',
    icon: 'claude-code',
  },
];

export function installAgentProfileFixture(
  fixture: AgentProfileCatalogFixture,
  target: AgentProfileInstallTarget,
): AgentProfile {
  const installedId = `installed-${fixture.id}`;
  return {
    id: installedId,
    name: fixture.name,
    description: fixture.description,
    runtime_id: fixture.runtime_id,
    ...(fixture.provider ? { provider: fixture.provider } : {}),
    ...(fixture.model ? { model: fixture.model } : {}),
    ...(fixture.reasoning_effort ? { reasoning_effort: fixture.reasoning_effort } : {}),
    skills: JSON.stringify(fixture.skills),
    tool_allowlist: JSON.stringify(fixture.tool_allowlist),
    approval_policy: fixture.approval_policy,
    permission_mode: fixture.permission_mode,
    target_preferences: JSON.stringify({
      target_id: target.id,
      target_type: target.target_type ?? 'local_edge',
      ...(target.name ? { target_name: target.name } : {}),
      ...(target.workspace_root ? { work_dir: target.workspace_root } : {}),
      source: 'agent-market-install-fixture',
    }),
    version: 1,
  };
}

export function buildInstalledAgentProfileTaskCreateRequest(
  input: InstalledAgentProfileTaskRequestInput,
): InstalledAgentProfileTaskCreateRequest {
  const profileId = input.agent.profileId ?? input.agent.id;
  const runtimeId = input.agent.runtimeId?.trim();
  const targetId = targetPreferenceString(input.agent.targetPreferences, 'target_id');
  if (!runtimeId) {
    throw new Error(`Installed profile "${input.agent.name}" is missing runtime_id.`);
  }
  if (!targetId) {
    throw new Error(`Installed profile "${input.agent.name}" is missing target_preferences.target_id.`);
  }

  return {
    trigger_message_id: input.triggerMessageId,
    ...(input.agentInstanceId ? { agent_instance_id: input.agentInstanceId } : {}),
    agent_type: runtimeId,
    custom_agent_id: profileId,
    target_id: targetId,
    model_params: JSON.stringify({
      source: 'agent-market-install-fixture',
      profile_id: profileId,
      runtime_id: runtimeId,
      ...(input.agent.provider ? { provider: input.agent.provider } : {}),
      ...(input.agent.model ? { model: input.agent.model } : {}),
      ...(input.agent.reasoningEffort ? { reasoning_effort: input.agent.reasoningEffort } : {}),
      ...(input.agent.approvalPolicy ? { approval_policy: input.agent.approvalPolicy } : {}),
      ...(input.agent.permissionMode ? { permission_mode: input.agent.permissionMode } : {}),
      target_preferences: input.agent.targetPreferences,
      ...(targetPreferenceString(input.agent.targetPreferences, 'work_dir') ? {
        work_dir: targetPreferenceString(input.agent.targetPreferences, 'work_dir'),
      } : {}),
    }),
  };
}

function targetPreferenceString(
  preferences: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = preferences?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
